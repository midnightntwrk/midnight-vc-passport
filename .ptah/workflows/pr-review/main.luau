--!strict
-- PR review workflow: run the convergent review→validate→fix→verify loop
-- against one pull request, whose URL the caller injects via `PR_URL`.
--
--   PR_URL=https://github.com/owner/repo/pull/123 \
--     ptah run .ptah/workflows/pr-review/main.luau
--
-- The `pr` playbook owns the loop (review passes, typed judge, persistent
-- ledger, batched fix-and-push turns, the posted report); this shim owns the
-- local config, the `PR_URL` lookup, and the worktree the fix turns push
-- from. The PR must live in this repository — a fork PR is rejected up front.
-- One loop per PR at a time: concurrent runs corrupt the ledger comment.
--
-- Environment: the `pi` agent must resolve in the ptah registry, and `gh`
-- (authenticated) and `git` must be on PATH.

local libs = require("@ptah_libs")

local pr = libs.pr

-- ---------------------------------------------------------------------------
-- Local config
-- ---------------------------------------------------------------------------

-- Shared today, but split per role so a per-role model can be introduced
-- without rewiring the constructor.
local MODEL = "ollama-cloud/deepseek-v4.1-flash"

-- At the cap with open blocking findings the loop ends non-converged without
-- pushing a final fix (every push is followed by at least one review pass).
local MAX_REVIEW_ITERATIONS = 10

local sessionConfig = { { id = "model", value = MODEL } }
local judgeConfig = { { id = "model", value = MODEL } }
local reporterConfig = { { id = "model", value = MODEL } }

-- ---------------------------------------------------------------------------
-- The injected PR URL
-- ---------------------------------------------------------------------------

local function injectedPrUrl(): string
	local url = os.getenv("PR_URL")
	if url == nil or url == "" then
		error("pr-review: PR_URL is not set; the caller must inject the pull request URL", 0)
	end
	return url
end

-- Names the worktree `pr-<n>`, so it never collides with the factory's
-- per-issue worktrees (`issue-<n>`).
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

type PrHead = {
	branch: string,
	oid: string,
}

-- A fork PR is rejected here: its head lives in another repository that this
-- origin can neither fetch nor push, so the loop's fix turns could never
-- reach the PR. The rejection rests on `isCrossRepository`, not on
-- `origin/<branch>` failing to resolve — a fork branch whose name collides
-- with a local branch would resolve to the wrong commit.
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

-- POSIX sh single-quoting: a branch name may carry characters a shell would
-- otherwise reinterpret.
local function quote(arg: string): string
	return "'" .. (arg:gsub("'", "'\\''")) .. "'"
end

local function trim(s: string): string
	local trimmed = (s:gsub("^%s+", ""))
	return (trimmed:gsub("%s+$", ""))
end

-- After a plain fetch, `origin/<branch>` must resolve to exactly the commit
-- GitHub reports as the PR's head; a missing or divergent ref fails loudly
-- here rather than provisioning on a branch the PR does not track, where the
-- fix turns' pushes would silently land.
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

-- Provision the worktree the sessions run in, adopting an earlier run's
-- (same path, same branch) so an interrupted review resumes; the invocation
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

local prUrl = injectedPrUrl()
local wt = prepareWorktree(prUrl)

-- `reviewInstruction` is a full replacement of the playbook's built-in
-- reviewer persona.
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

local outcome = reviewLoop:reviewFixLoop(prUrl)

-- Restate the ledger's open blocking count for the tail log; the report is
-- already posted as a marked PR comment and returned as `outcome.report`.
local openBlocking = 0
for _, finding in outcome.ledger.findings do
	if finding.severity == "blocking" and finding.status == "open" then
		openBlocking += 1
	end
end
ptah.log(("pr-review: %s (%d open blocking finding(s))"):format(outcome.status, openBlocking))

-- Refuse-dirty teardown: an uncommitted fix keeps the worktree (logged
-- below); the branch survives either way.
local removed = worktree.teardown(wt)
if not removed.ok then
	ptah.log(("pr-review: worktree kept at %s: %s"):format(wt.path, tostring(removed.stderr)))
end
