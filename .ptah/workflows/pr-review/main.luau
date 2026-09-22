--!strict
-- PR review workflow: run the convergent review→validate→fix→verify loop
-- against one pull request whose URL the caller injects through the
-- `PR_URL` environment variable.
--
-- The `pr` playbook (the PR review loop) owns the whole loop — the
-- discovery/delta review passes, the typed judge and its persistent ledger,
-- the batched fix-and-push turns, and the posted PR review report. This
-- shim owns the local config (agent handles, model, cap), the `PR_URL`
-- lookup, and the git context those fix turns need, so a caller composes it
-- as:
--
--   PR_URL=https://github.com/owner/repo/pull/123 \
--     ptah run .ptah/workflows/pr-review/main.luau
--
-- The git context is a provisioned worktree on the PR's head branch. The
-- playbook is git-agnostic (its `workingDir` is just a directory, and
-- provisioning it is the calling shim's business), and with `dryRun = false`
-- its fix turns commit and push from the sessions' working directory — so
-- every session runs in a checkout of the PR branch and the invocation
-- directory's own branch never matters. A caller must know: the PR must
-- live in this repository (a fork PR is rejected up front on
-- `isCrossRepository`, and the head branch name is pinned to the PR's
-- exact head commit after a fetch — a name colliding with one of this
-- repository's own branches fails the pin instead of silently
-- provisioning the worktree on the wrong branch), the invocation
-- checkout must not itself be on the PR head branch (git refuses one
-- branch in two worktrees — also a loud failure), and the worktree is
-- torn down after the loop (refuse dirty: an uncommitted fix keeps it,
-- logged; the branch survives teardown).
--
-- Environment requirements (declared by the playbook, not bundled here):
-- the `pi` agent must resolve in the ptah registry (.ptah/config.toml or
-- the user layer), `gh` must be on PATH, authenticated, with the PR URL
-- a GitHub pull request URL, and `git` must be on PATH for the worktree
-- steps. One loop per PR: two concurrent runs on one PR corrupt the
-- ledger comment.

local libs = require("@ptah_libs")

local pr = libs.pr

-- ---------------------------------------------------------------------------
-- Local config
-- ---------------------------------------------------------------------------

-- The review model, shared by the reviewer, the judge, and the reporter.
-- The three configs stay split so a per-role model can be introduced without
-- rewiring the constructor below.
local MODEL = "zai/glm-5.3"

-- Convergence cap: at the cap with open blocking findings the loop ends
-- non-converged without pushing a final fix (every push is followed by at
-- least one review pass).
local MAX_REVIEW_ITERATIONS = 10

local sessionConfig = { { id = "model", value = MODEL } }
local judgeConfig = { { id = "model", value = MODEL } }
local reporterConfig = { { id = "model", value = MODEL } }

-- ---------------------------------------------------------------------------
-- The injected PR URL
-- ---------------------------------------------------------------------------

-- The caller injects the pull request through PR_URL. An unset or empty
-- variable is a loud misconfiguration: there is no PR to review and no
-- repository context to fall back on.
local function injectedPrUrl(): string
	local url = os.getenv("PR_URL")
	if url == nil or url == "" then
		error("pr-review: PR_URL is not set; the caller must inject the pull request URL", 0)
	end
	return url
end

-- The PR number from the URL, naming the worktree (`pr-<n>`) so it never
-- collides with the factory's per-issue worktrees (`issue-<n>`).
local function prNumber(prUrl: string): string
	local number = string.match(prUrl, "^https?://github%.com/[^/]+/[^/]+/pull/(%d+)")
	if number == nil then
		error(("pr-review: %s is not a GitHub pull request URL"):format(prUrl), 0)
	end
	return number
end

-- ---------------------------------------------------------------------------
-- The worktree on the PR head branch
-- ---------------------------------------------------------------------------

local gh = libs.std.gh
local worktree = libs.std.worktree

-- The PR head's identity as GitHub reports it — the branch name and the
-- exact head commit — plus the cross-repository fact, read in one API
-- call because provisioning consumes them as one fact: a branch name
-- alone is not evidence that `origin/<name>` is the PR's head.
--
-- A fork PR is rejected here, on `isCrossRepository`, before anything is
-- provisioned: its head branch lives in another repository, which this
-- repository's origin can neither fetch nor push, so the loop's fix turns
-- could never reach the PR. The rejection cannot rest on
-- `origin/<name>` failing to resolve — when the fork's branch name
-- collides with a branch of this repository (a fork's `develop` against
-- this repo's `origin/develop`) the name *does* resolve, to the wrong,
-- local branch, and the worktree would be provisioned silently on it
-- with every fix turn pushing agent commits onto that branch (straight
-- onto `origin/develop`) while the fork PR never updates.
type PrHead = {
	branch: string,
	oid: string,
}

local function prHead(prUrl: string): PrHead
	local outcome = gh.run({ "pr", "view", prUrl, "--json", "headRefName,headRefOid,isCrossRepository" }, { json = true })
	if not outcome.ok then
		error(("pr-review: could not read the head of %s: %s"):format(prUrl, outcome.stderr), 0)
	end
	if outcome.json.isCrossRepository == true then
		error(
			(
				"pr-review: %s is a cross-repository (fork) pull request; its head is not in this repository's origin, so fixes cannot be pushed from a same-repository worktree"
			):format(prUrl),
			0
		)
	end
	local branch = outcome.json.headRefName
	local oid = outcome.json.headRefOid
	if type(branch) ~= "string" or branch == "" or type(oid) ~= "string" or oid == "" then
		error(("pr-review: %s carried no head branch or head commit"):format(prUrl), 0)
	end
	return { branch = branch, oid = oid }
end

-- POSIX sh single-quoting, the stdlib libs' own: a branch name may carry
-- characters a shell would otherwise reinterpret.
local function quote(arg: string): string
	return "'" .. (arg:gsub("'", "'\\''")) .. "'"
end

-- Two-sided trim, matching the stdlib transports: command output carries
-- surrounding whitespace that is not part of the value.
local function trim(s: string): string
	local trimmed = (s:gsub("^%s+", ""))
	return (trimmed:gsub("%s+$", ""))
end

-- Pin the branch name to the head commit before anything is provisioned:
-- after a plain fetch (provision's own fetch shape),
-- `refs/remotes/origin/<branch>` must resolve to exactly the commit
-- GitHub reports as the PR's head. A same-named ref that is missing or
-- resolves to any other commit — a colliding branch name, a renamed or
-- deleted head, a local view of some other repository — fails loudly
-- here instead of provisioning the worktree on a branch the PR does not
-- track, which is where the fix turns' pushes would silently land. Runs
-- in the invocation directory, the same repository provision operates
-- on.
local function pinOriginHead(prUrl: string, head: PrHead)
	local fetched = ptah.exec("git fetch origin")
	if fetched.exitCode ~= 0 then
		local detail = if fetched.stderr ~= "" then fetched.stderr else fetched.stdout
		error(("pr-review: git fetch origin failed: %s"):format(detail), 0)
	end
	local ref = ("refs/remotes/origin/%s"):format(head.branch)
	local resolved = ptah.exec(("git rev-parse --verify --quiet %s^{commit}"):format(quote(ref)))
	if resolved.exitCode ~= 0 then
		error(
			(
				"pr-review: %s tracks branch %s, but %s does not resolve in this repository after fetching origin"
			):format(prUrl, head.branch, ref),
			0
		)
	end
	local sha = trim(resolved.stdout)
	if sha ~= head.oid then
		error(
			(
				"pr-review: %s tracks branch %s at %s, but %s resolves to %s here — the name belongs to a different commit than the PR's head (a colliding branch name, or a head that has moved); refusing to provision on it"
			):format(prUrl, head.branch, head.oid, ref, sha),
			0
		)
	end
end

-- Provision the worktree the loop's sessions run in: on the PR head
-- branch, its name pinned to the head commit first, fetched, adopting an
-- earlier run's worktree (same path, same branch) so an interrupted
-- review resumes. Fix turns commit and push from here; the invocation
-- directory is never touched.
local function prepareWorktree(prUrl: string): { path: string, branch: string, ref: string }
	local head = prHead(prUrl)
	pinOriginHead(prUrl, head)
	return worktree.provision({
		name = ("pr-%s"):format(prNumber(prUrl)),
		ref = ("origin/%s"):format(head.branch),
		branch = head.branch,
		fetch = true,
	})
end

-- ---------------------------------------------------------------------------
-- The loop
-- ---------------------------------------------------------------------------

local work = ptah.agent("pi")
local judge = ptah.agent("pi")
local reporter = ptah.agent("pi")

-- `reviewInstruction` is left nil, which selects the playbook's built-in
-- reviewer persona. Configure one (or the pointer pattern, e.g.
-- "Follow the reviewer instruction at .ptah/instructions/reviewer.md") to
-- fully replace it.
local prUrl = injectedPrUrl()
local wt = prepareWorktree(prUrl)

local reviewLoop = pr.new({
	agent = work,
	judgeAgent = judge,
	reporterAgent = reporter,
	sessionConfig = sessionConfig,
	judgeSessionConfig = judgeConfig,
	reporterSessionConfig = reporterConfig,
	workingDir = wt.path,
	dryRun = false,
	maxIterations = MAX_REVIEW_ITERATIONS,
	reviewInstruction = "Use claude cli to review the PR"
})

ptah.log(("pr-review: reviewing %s (worktree %s on branch %s)"):format(prUrl, wt.path, wt.branch))

local outcome = reviewLoop:review(prUrl)

-- The playbook counts convergence from the ledger's open blocking findings;
-- restate that count here for the run's tail log. The terminal report is
-- already posted as a marked PR comment and returned as `outcome.report`.
local openBlocking = 0
for _, finding in outcome.ledger.findings do
	if finding.severity == "blocking" and finding.status == "open" then
		openBlocking += 1
	end
end
ptah.log(("pr-review: %s (%d open blocking finding(s))"):format(outcome.status, openBlocking))

-- Tear the worktree down now the loop is done: refuse-dirty by default, so
-- an uncommitted fix keeps it (logged below) rather than losing state; the
-- branch survives teardown either way.
local removed = worktree.teardown(wt)
if not removed.ok then
	ptah.log(("pr-review: worktree kept at %s: %s"):format(wt.path, tostring(removed.stderr)))
end
