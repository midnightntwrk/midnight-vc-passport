--!strict
-- Factory workflow: the autonomous issue → reviewed PR loop.
--
-- Each iteration claims the oldest eligible `ai-r4d` issue, prepares a
-- worktree for it on the branch `issue-<n>` off WORKTREE_REF, and runs
-- every later step inside that worktree: resolving which existing openspec
-- change the issue maps to (or a direct edit when none applies), driving
-- that change through the openspec lifecycle (groom → implement → verify,
-- which syncs and archives), then committing, pushing, opening a PR
-- against the integration base, and running the convergent PR review loop
-- on it. A completed issue's worktree is torn down — its branch survives —
-- while a failed issue's is kept as the audit trail. The loop stops when
-- the queue holds no eligible issue.
--
-- The issue playbook is agent-free (a claim marker plus earliest-wins
-- read-back); the openspec and pr playbooks own their own convergence and
-- escalation. This script owns only the orchestration between them, so a
-- single issue that fails is logged and the loop moves on — the claim
-- marker stays as the audit trail a human re-queues by hand.
--
-- The `pi` agent must resolve in the ptah registry (.ptah/config.toml or
-- the user layer), `openspec` and `gh` must be on PATH (gh authenticated)
-- for the lifecycle and issue/PR steps, `git` for the worktree steps, and
-- the `claude` CLI for the delegated PR review. Ptah scripts take no
-- runtime arguments; the knobs below are hand-edited per environment.

local libs = require("@ptah_libs")
local issue = libs.issue
local openspec = libs.openspec
local pr = libs.pr
local sessionConfig = libs.std.sessionConfig
local worktree = libs.std.worktree

-- ---------------------------------------------------------------------------
-- Local config
-- ---------------------------------------------------------------------------

-- The repo-configured queue label: a human's assertion that an issue is
-- ready for development. Required by the issue playbook, which never
-- defaults it.
local QUEUE_LABEL = "ai-r4d"

-- Every session shares one model today, but the work/judge/reporter configs
-- stay split so a per-role model can be introduced without rewiring the
-- constructors below.
local WORK_MODEL = "zai/glm-5.3-flash"
local JUDGE_MODEL = "zai/glm-5.3-flash"
local REPORTER_MODEL = "zai/glm-5.3-flash"

-- The delivery policy routes issue work through develop — the integration
-- branch the snapshot release channel gates on — so worktree branches are
-- cut from develop and pull requests target develop rather than the
-- repository's default branch (`main`). pr-check.yml requires a
-- Conventional-Commits title whose type — and scope, when one is used —
-- passes its validate-pr-title allowlists (an omitted scope always passes)
-- plus a non-empty body on every PR; the committer prompt sends the agent
-- to that workflow for the exact lists rather than restating them (a
-- restatement here would drift).
local WORKTREE_REF = "origin/develop"
local WORKTREE_FETCH = true

-- Bounded retries for the typed-result hand-offs (resolve change, open PR):
-- agents may ignore the submit tool, so a nil result is designed degradation,
-- not a hard failure, until the attempts are exhausted.
local RESOLVE_ATTEMPTS = 3
local PR_ATTEMPTS = 3

local MAX_REVIEW_ITERATIONS = 10

local workConfig = { { id = "model", value = WORK_MODEL } }
local judgeConfig = { { id = "model", value = JUDGE_MODEL } }
local reporterConfig = { { id = "model", value = REPORTER_MODEL } }

local work = ptah.agent("pi")
local judge = ptah.agent("pi")
local reporter = ptah.agent("pi")

local issueOps = issue.new({
	queueLabel = QUEUE_LABEL,
})

-- The openspec and PR playbooks take the working directory as constructor
-- config, so each issue builds its own pair around its worktree instead of
-- sharing a module-level instance.
local function makeOpsx(workingDir: string)
	return openspec.new({
		agent = work,
		judgeAgent = judge,
		sessionConfig = workConfig,
		judgeSessionConfig = judgeConfig,
		workingDir = workingDir,
	})
end

local function makeReviewLoop(workingDir: string)
	return pr.new({
		agent = work,
		judgeAgent = judge,
		reporterAgent = reporter,
		sessionConfig = workConfig,
		judgeSessionConfig = judgeConfig,
		reporterSessionConfig = reporterConfig,
		workingDir = workingDir,
		dryRun = false,
		maxIterations = MAX_REVIEW_ITERATIONS,
		reviewInstruction = "Use claude cli to review the PR",
	})
end

-- The pickup brief's shape, restated locally: the package shim does not
-- expose nested qualified type names, so the structural shape is spelled
-- out here.
type Brief = {
	number: number,
	url: string,
	title: string,
	body: string,
}

-- The provision record's shape, restated locally for the same reason as
-- Brief.
type Worktree = {
	path: string,
	branch: string,
	ref: string,
}

-- ---------------------------------------------------------------------------
-- The per-issue worktree
-- ---------------------------------------------------------------------------

-- Each issue is implemented in its own worktree on the branch `issue-<n>`,
-- branched off WORKTREE_REF, so agent edits, commits, and pushes never
-- touch the shared checkout. A rerun adopts the registered worktree or
-- attaches the surviving branch as-is — an interrupted run resumes without
-- anything being reset.
local function prepareWorktree(brief: Brief): Worktree
	local branch = ("issue-%d"):format(brief.number)
	local wt = worktree.provision({
		name = branch,
		ref = WORKTREE_REF,
		branch = branch,
		fetch = WORKTREE_FETCH,
	})
	ptah.log(("factory: issue #%d worktree %s on branch %s"):format(brief.number, wt.path, wt.branch))
	return wt
end

-- ---------------------------------------------------------------------------
-- Issue → change or direct edit
-- ---------------------------------------------------------------------------

-- An agent reads the claimed issue and identifies which *existing* openspec
-- change in `openspec/changes/` should be applied to resolve it. No change
-- is created here. An empty submitted name means no change applies: the
-- issue is a direct edit (see `directEdit` below). The listing is the
-- worktree's, so only changes already merged to WORKTREE_REF are visible;
-- a change that exists only in some unmerged branch resolves as a direct
-- edit.
local function resolveChange(brief: Brief, workingDir: string): string?
	local session = work:session({
		id = ("factory-resolve:%d"):format(brief.number),
		cwd = workingDir,
		resultSchema = {
			type = "object",
			properties = { change = { type = "string" } },
			required = { "change" },
		},
	})
	sessionConfig.apply(session, workConfig)

	local prompt = table.concat({
		("Identify which existing openspec change should be applied to resolve GitHub issue #%d."):format(brief.number),
		"",
		("Title: %s"):format(brief.title),
		("URL: %s"):format(brief.url),
		"",
		"Body:",
		brief.body,
		"",
		"If the issue names an openspec change, use that name. Otherwise list the changes under `openspec/changes/` and pick the one whose scope matches this issue. Do not create a new change and do not implement anything.",
		'Submit that change\'s directory name through this session\'s ptah result tool as { "change": "<kebab-case-name>" }, or an empty string if no change applies and the issue is a direct edit.',
	}, "\n")

	local change: string? = nil
	local resolved = false
	for attempt = 1, RESOLVE_ATTEMPTS do
		local outcome = session:prompt(prompt)
		local result = outcome.result
		if type(result) == "table" and type(result.change) == "string" then
			change = if result.change == "" then nil else result.change
			resolved = true
			break
		end
		ptah.log(("factory: resolver submitted no change name (attempt %d/%d)"):format(attempt, RESOLVE_ATTEMPTS))
	end
	session:close()
	if not resolved then
		error(("factory: could not identify an openspec change for issue #%d"):format(brief.number))
	end
	return change
end

-- No openspec change applies: an agent implements the issue directly in the
-- issue's worktree. The PR review loop that follows is the convergence
-- step.
local function directEdit(brief: Brief, workingDir: string): nil
	local session = work:session({ id = ("factory-direct:%d"):format(brief.number), cwd = workingDir })
	sessionConfig.apply(session, workConfig)

	local prompt = table.concat({
		("Implement GitHub issue #%d directly in this repository. No openspec change applies to it."):format(brief.number),
		"",
		("Title: %s"):format(brief.title),
		("URL: %s"):format(brief.url),
		"",
		"Body:",
		brief.body,
		"",
		"Make the edits the issue asks for, following the repository's conventions (read README.md and CONTRIBUTING.md first), and run the relevant format and test commands before finishing — they assume the nix development shell, so run them through `nix develop -c …` (for example `nix develop -c pnpm run all`, the full lint/typecheck/build/test contract). Do not create an openspec change.",
	}, "\n")
	session:prompt(prompt)
	session:close()
	return nil
end

-- ---------------------------------------------------------------------------
-- Commit, push, open the PR
-- ---------------------------------------------------------------------------

-- The committer owns the git mechanics — commit the dirty tree first,
-- then fetch and rebase onto origin/develop (a rebase on a dirty tree
-- aborts, so the order is load-bearing), then push (`-u
-- --force-with-lease`: the lease is safe on a resumed run whose rebase
-- rewrote already-pushed commits, and `-u` repoints the branch's upstream
-- from the `origin/develop` it inherited from its start point to
-- `origin/issue-<n>` — load-bearing because the review loop that follows
-- pushes its fix commits from this same worktree with a bare `git push`,
-- which against the inherited upstream fails outright or lands on
-- develop) — and finally `gh pr create` plus the pr-check.yml title/body
-- contract checks, repairing a failed contract check with `gh pr edit`.
-- It returns the PR URL as a typed result. The branch `issue-<n>` is
-- already created and checked out by the worktree step, so the prompt
-- tells it to stay on that branch rather than create or reuse one.
local function openPullRequest(brief: Brief, change: string?, workingDir: string): string
	local session = work:session({
		id = ("factory-pr:%d"):format(brief.number),
		cwd = workingDir,
		resultSchema = {
			type = "object",
			properties = { prUrl = { type = "string" } },
			required = { "prUrl" },
		},
	})
	sessionConfig.apply(session, workConfig)

	local summary = if change ~= nil
		then ("The openspec change `%s` for GitHub issue #%d is implemented, verified, synced, and archived."):format(
			change,
			brief.number
		)
		else ("The changes for GitHub issue #%d are implemented."):format(brief.number)
	local first = table.concat({
		summary,
		("Your working directory is the issue's worktree, with the branch `issue-%d` already checked out and the implementation's changes uncommitted. Commit those uncommitted changes (except anything under .ptah) first, with `git commit -S -s` and a Conventional Commits subject ending in `(#%d)` — the sign-off trailer comes from `-s`. Then `git fetch origin` and rebase onto origin/develop so the branch is current against the integration branch (the tree is clean after the commit, so the rebase cannot be blocked by unstaged changes, and it is a no-op when the branch is already based on it). Push the branch to the remote with `git push -u --force-with-lease origin issue-%d`: the lease makes the push safe when the rebase rewrote commits an earlier attempt already pushed, and `-u` both creates the remote branch when it does not exist yet and sets the branch's upstream to `origin/issue-%d` — the branch inherited `origin/develop` as its upstream from its start point, and the review loop that follows pushes fix commits from this same worktree with a bare `git push`, which only lands on `origin/issue-%d` with that upstream set (against `origin/develop` it fails or pushes to develop). Then open a pull request against develop with `gh pr create --base develop`. The title must pass the repository's PR contract: read `.github/workflows/pr-check.yml` first and make the title a Conventional Commits `type: subject` or `type(scope): subject` whose type and, when present, scope are on that workflow's validate-pr-title allowlists — an omitted scope always passes; the body must be non-empty and its first line `Closes #%d`. After creating the pull request, confirm the contract checks with `gh pr checks` on it (they report within seconds; retry briefly if it lists none yet) and, when Validate PR Title or Validate PR Body failed, fix the title or body with `gh pr edit` and confirm they pass; do not wait for the slower build checks. Do not create, rename, or switch away from the branch."):format(
			brief.number,
			brief.number,
			brief.number,
			brief.number,
			brief.number,
			brief.number
		),
		'Submit the pull request URL through this session\'s ptah result tool as { "prUrl": "https://github.com/..." }.',
	}, "\n")
	local retry =
		'Submit the pull request URL now through this session\'s ptah result tool as { "prUrl": "https://github.com/..." }. If the pull request does not exist yet, create it first.'

	local prUrl: string? = nil
	for attempt = 1, PR_ATTEMPTS do
		local outcome = session:prompt(if attempt == 1 then first else retry)
		local result = outcome.result
		if type(result) == "table" and type(result.prUrl) == "string" and result.prUrl ~= "" then
			prUrl = result.prUrl
			break
		end
		ptah.log(("factory: committer submitted no PR URL (attempt %d/%d)"):format(attempt, PR_ATTEMPTS))
	end
	session:close()
	if prUrl == nil then
		error(("factory: could not open a pull request for issue #%d"):format(brief.number))
	end
	return prUrl
end

-- ---------------------------------------------------------------------------
-- One issue, end to end
-- ---------------------------------------------------------------------------

local function runIssue(brief: Brief): nil
	local wt = prepareWorktree(brief)
	local opsx = makeOpsx(wt.path)
	local reviewLoop = makeReviewLoop(wt.path)

	local change = resolveChange(brief, wt.path)
	if change ~= nil then
		ptah.log(("factory: issue #%d resolved to openspec change `%s`"):format(brief.number, change))
		opsx:groom(change)
		opsx:implement(change)
		opsx:verify(change)
		ptah.log(("factory: change `%s` implemented, verified, synced, and archived"):format(change))
	else
		ptah.log(("factory: issue #%d has no openspec change; implementing directly"):format(brief.number))
		directEdit(brief, wt.path)
	end

	local prUrl = openPullRequest(brief, change, wt.path)
	ptah.log(("factory: issue #%d pull request: %s"):format(brief.number, prUrl))

	local prReview = reviewLoop:review(prUrl)
	ptah.log(("factory: pr review loop %s: %s"):format(prReview.status, prReview.verdict))

	-- Teardown only on the success path: a failed issue (the pcall in the
	-- loop) keeps its worktree as the audit trail, and the branch survives
	-- either way. A dirty refusal is logged, never fatal.
	local removed = worktree.teardown(wt)
	if not removed.ok then
		ptah.log(("factory: issue #%d worktree kept at %s: %s"):format(brief.number, wt.path, tostring(removed.stderr)))
	end
	return nil
end

-- ---------------------------------------------------------------------------
-- The loop
-- ---------------------------------------------------------------------------

while true do
	local picked = issueOps:pickUp()
	if picked.status == "no-eligible-issue" then
		ptah.log(("factory: no eligible issue left (scanned %d); stopping"):format(picked.scanned))
		break
	end

	local brief = picked.brief
	ptah.log(("factory: claimed issue #%d — %s"):format(brief.number, brief.title))

	-- Per-issue error boundary: a failed issue is logged and left claimed
	-- (the marker is the audit trail), and the loop advances to the next one.
	local ok, failure = pcall(runIssue, brief)
	if not ok then
		ptah.log(("factory: issue #%d failed: %s"):format(brief.number, tostring(failure)))
	end
end
