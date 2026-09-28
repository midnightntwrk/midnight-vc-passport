#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const errors = [];

const readYaml = (relativePath) =>
  parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));

const requiredBranches = ["main"];

const assertBranches = (workflow, eventName, relativePath) => {
  const branches = workflow.on?.[eventName]?.branches;
  if (!Array.isArray(branches)) {
    errors.push(`${relativePath} must declare on.${eventName}.branches`);
    return;
  }
  for (const branch of requiredBranches) {
    if (!branches.includes(branch)) {
      errors.push(`${relativePath} on.${eventName} must include ${branch}`);
    }
  }
};

const assertExternalActionPinned = (action, location, violations) => {
  if (typeof action !== "string" || action.startsWith("./")) {
    return;
  }
  if (action.startsWith("docker://")) {
    if (!/@sha256:[0-9a-f]{64}$/u.test(action)) {
      violations.push(`${location} must pin ${action} to a sha256 image digest`);
    }
    return;
  }

  const separatorIndex = action.lastIndexOf("@");
  const reference = separatorIndex === -1 ? "" : action.slice(separatorIndex + 1);
  if (!/^[0-9a-f]{40}$/u.test(reference)) {
    violations.push(`${location} must pin ${action} to a full commit SHA`);
  }
};

/**
 * External-action pinning violations for one workflow document. Pure
 * (returns the list) so the release-tooling mutation tests can exercise
 * mutated copies of the publication workflow; the main check pushes these
 * into the global error list.
 */
export const externalActionPinningViolations = (workflow, relativePath) => {
  const violations = [];
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    assertExternalActionPinned(job.uses, `${relativePath} job ${jobName}`, violations);
    for (const step of job.steps ?? []) {
      assertExternalActionPinned(
        step.uses,
        `${relativePath} job ${jobName} step ${step.name ?? "<unnamed>"}`,
        violations,
      );
    }
  }
  return violations;
};

const assertExternalActionsPinned = (workflow, relativePath) => {
  errors.push(...externalActionPinningViolations(workflow, relativePath));
};

const assertCheckoutDoesNotPersistCredentials = (step, location) => {
  if (
    typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@") &&
    step.with?.["persist-credentials"] !== false
  ) {
    errors.push(`${location} checkout must set persist-credentials: false`);
  }
};

const assertCheckoutsDoNotPersistCredentials = (workflow, relativePath) => {
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      assertCheckoutDoesNotPersistCredentials(
        step,
        `${relativePath} job ${jobName}`,
      );
    }
  }
};

const PUBLISH_REGISTRY = "https://registry.npmjs.org/";

/**
 * Dedicated assertions for the publication workflow (npm-publication +
 * github-release-distribution specs): dispatch-only trigger, channel/branch
 * gate present, npm CLI trusted-publishing floor checked, registry locked to
 * the public npmjs registry, the protected npm-release environment, zero
 * npm-token references, and — WINDOW (temporary) — the operator `tag` input,
 * the tag reconciliation before any build step, the GitHub-Release steps
 * ahead of a best-effort npm publish, and the exact window permission grant
 * (contents: write, id-token: write, attestations: write). Returns the list
 * of violations (prefixed with `relativePath`); exported so the
 * release-tooling tests can exercise mutated copies of the workflow. The
 * window-exit change restores the registry-only shape (contents: read +
 * id-token: write, no tag input, no Release steps, fail-closed publish).
 */
export const assertPublishWorkflow = (workflow, relativePath) => {
  const violations = [];

  // Manual dispatch only: no automated (push-event) publication may exist.
  const events = workflow.on ?? {};
  const eventNames = Object.keys(events);
  if (
    eventNames.length !== 1 ||
    events.workflow_dispatch === undefined ||
    events.push !== undefined ||
    events.pull_request !== undefined ||
    events.schedule !== undefined
  ) {
    violations.push("must be triggered by workflow_dispatch only");
  }

  const channelInput = events.workflow_dispatch?.inputs?.channel;
  if (
    JSON.stringify(channelInput?.options ?? null) !==
    JSON.stringify(["snapshot", "rc", "release"])
  ) {
    violations.push(
      "workflow_dispatch channel input must offer exactly snapshot|rc|release",
    );
  }

  // The channel/branch gate must run before any build step.
  const gatePresent = Object.values(workflow.jobs ?? {}).some((job) =>
    (job.steps ?? []).some(
      (step) =>
        typeof step.run === "string" &&
        step.run.includes("release-resolve-context.sh"),
    ),
  );
  if (!gatePresent) {
    violations.push(
      "must resolve the publication context (release-resolve-context.sh) in a step",
    );
  }

  // WINDOW (temporary): the operator-owned release tag is a required input.
  const tagInput = events.workflow_dispatch?.inputs?.tag;
  if (tagInput?.required !== true || tagInput?.type !== "string") {
    violations.push(
      "workflow_dispatch must declare the required string input 'tag' (the operator-created release tag)",
    );
  }

  // WINDOW (temporary): the operator-tag reconciliation must run before any
  // build step (setup or the repository gate) so tag drift fails the run
  // within seconds.
  const stepIndex = (steps, predicate) => steps.findIndex(predicate);
  const runIncludes = (needle) => (step) =>
    typeof step.run === "string" && step.run.includes(needle);
  const usesIncludes = (needle) => (step) =>
    typeof step.uses === "string" && step.uses.includes(needle);
  const reconcilePresent = Object.values(workflow.jobs ?? {}).some(
    (job) => stepIndex(job.steps ?? [], runIncludes("verify-release-tag.mjs")) !== -1,
  );
  if (!reconcilePresent) {
    violations.push(
      "must reconcile the operator release tag (verify-release-tag.mjs) in a step",
    );
  }
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    const steps = job.steps ?? [];
    const reconcile = stepIndex(steps, runIncludes("verify-release-tag.mjs"));
    if (reconcile === -1) {
      continue;
    }
    const setupIndex = stepIndex(steps, usesIncludes("setup-node-pnpm"));
    const gateRunIndex = stepIndex(steps, runIncludes("pnpm run all"));
    if (setupIndex !== -1 && reconcile > setupIndex) {
      violations.push(`job ${jobName} must reconcile the release tag before tool setup`);
    }
    if (gateRunIndex !== -1 && reconcile > gateRunIndex) {
      violations.push(`job ${jobName} must reconcile the release tag before the repository gate`);
    }
  }

  // WINDOW (temporary): the GitHub-Release steps — checksums/body, create +
  // digest verification, provenance attestation, release-URL consumer test —
  // must all be present and precede the best-effort npm publish, so the
  // Release is produced whatever the npm outcome.
  const releaseSteps = [
    ["publish-github-release.mjs prepare", runIncludes("publish-github-release.mjs prepare")],
    ["publish-github-release.mjs publish", runIncludes("publish-github-release.mjs publish")],
    ["actions/attest-build-provenance", usesIncludes("actions/attest-build-provenance@")],
    ["test-release-package-consumers.mjs --release-url", runIncludes("--release-url")],
  ];
  for (const [label, predicate] of releaseSteps) {
    const hosts = Object.entries(workflow.jobs ?? {}).filter(
      ([, job]) => stepIndex(job.steps ?? [], predicate) !== -1,
    );
    if (hosts.length === 0) {
      violations.push(`must run the GitHub-Release step '${label}'`);
      continue;
    }
    for (const [jobName, job] of hosts) {
      const steps = job.steps ?? [];
      const publishIndex = stepIndex(steps, runIncludes("publish-npm-packages.sh"));
      if (publishIndex !== -1 && stepIndex(steps, predicate) > publishIndex) {
        violations.push(
          `job ${jobName} must run the GitHub-Release step '${label}' before the npm publish`,
        );
      }
    }
  }

  // The npm CLI trusted-publishing floor (>= 11.5.1) must be checked before
  // the publish step: older CLIs cannot exchange the GitHub OIDC token.
  const cliFloorPresent = Object.values(workflow.jobs ?? {}).some((job) =>
    (job.steps ?? []).some(
      (step) =>
        typeof step.run === "string" &&
        /supports trusted publishing/u.test(step.run),
    ),
  );
  if (!cliFloorPresent) {
    violations.push(
      "must verify the npm CLI supports trusted publishing before publishing",
    );
  }

  // Registry lockdown: the publication path only ever talks to public npmjs.
  if (workflow.env?.NPM_REGISTRY !== PUBLISH_REGISTRY) {
    violations.push(
      `env.NPM_REGISTRY must be locked to ${PUBLISH_REGISTRY} (got '${workflow.env?.NPM_REGISTRY}')`,
    );
  }

  // Trusted publishing: the publishing job must run inside the protected
  // npm-release environment (the npmjs Trusted Publisher mapping names it,
  // and it carries the human gate) with exactly the least-privilege grant
  // contents: read + id-token: write (id-token is both the OIDC publish
  // identity and the provenance signer).
  const publishJobs = Object.values(workflow.jobs ?? {}).filter((job) =>
    (job.steps ?? []).some(
      (step) =>
        typeof step.run === "string" &&
        step.run.includes("publish-npm-packages.sh"),
    ),
  );
  if (publishJobs.length === 0) {
    violations.push("must run publish-npm-packages.sh in a job");
  }
  for (const job of publishJobs) {
    if (job.environment !== "npm-release") {
      violations.push(
        `the npm publish job must declare environment: npm-release (got '${job.environment}')`,
      );
    }
    // WINDOW (temporary): the npm publish is best-effort (id: publish,
    // continue-on-error), and every downstream registry step runs only when
    // it succeeded.
    const steps = job.steps ?? [];
    const publishStep = steps.find(runIncludes("publish-npm-packages.sh"));
    if (publishStep.id !== "publish" || publishStep["continue-on-error"] !== true) {
      violations.push(
        "the npm publish step must be best-effort during the window (id: publish, continue-on-error: true)",
      );
    }
    const registrySteps = steps.filter(
      (step) =>
        typeof step.run === "string" &&
        (step.run.includes("wait-for-npm-packages.mjs") ||
          (step.run.includes("npm-release-state.mjs") && step.run.includes("--verify")) ||
          (step.run.includes("test-release-package-consumers.mjs") &&
            step.run.includes("--registry"))),
    );
    for (const step of registrySteps) {
      if (step.if !== "steps.publish.outcome == 'success'") {
        violations.push(
          `registry step '${step.name ?? "<unnamed>"}' must run only if steps.publish.outcome == 'success'`,
        );
      }
    }
  }
  // WINDOW (temporary) least-privilege permissions: exactly what the GitHub
  // release (contents: write), its provenance attestations (attestations:
  // write), and the OIDC identity for npm trusted publishing and attestation
  // signing (id-token: write) need. The window-exit change restores the
  // contents: read + id-token: write shape.
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    const permissions = job.permissions ?? {};
    const permissionKeys = Object.keys(permissions);
    if (
      permissionKeys.length !== 3 ||
      permissions.contents !== "write" ||
      permissions["id-token"] !== "write" ||
      permissions.attestations !== "write"
    ) {
      violations.push(
        `job ${jobName} must grant exactly contents: write, id-token: write, and attestations: write`,
      );
    }
  }

  // No npm token anywhere: trusted publishing authenticates through the
  // OIDC exchange only, and no secret may override it.
  const workflowText = JSON.stringify(workflow);
  if (/NODE_AUTH_TOKEN|NPM_TOKEN|MIDNIGHTCI|secrets\./u.test(workflowText)) {
    violations.push(
      "must not reference any secret or npm token (trusted publishing uses the OIDC identity only)",
    );
  }

  // Template-injection hygiene (zizmor template-injection): expressions must
  // never be interpolated directly into run: scripts — every value flows
  // through the step's env map and is referenced as "$VAR".
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === "string" && step.run.includes("${{")) {
        violations.push(
          `job ${jobName} step '${step.name ?? "<unnamed>"}' interpolates \${{ }} inside run: (use env indirection)`,
        );
      }
    }
  }

  return violations.map((violation) => `${relativePath} ${violation}`);
};

const main = () => {
  const workflowDirectory = ".github/workflows";
  for (const fileName of readdirSync(path.join(repoRoot, workflowDirectory))) {
    if (!/\.ya?ml$/u.test(fileName)) {
      continue;
    }
    const relativePath = `${workflowDirectory}/${fileName}`;
    const workflow = readYaml(relativePath);
    assertExternalActionsPinned(workflow, relativePath);
    assertCheckoutsDoNotPersistCredentials(workflow, relativePath);
  }

  const actionsDirectory = ".github/actions";
  for (const actionName of readdirSync(path.join(repoRoot, actionsDirectory))) {
    const relativePath = `${actionsDirectory}/${actionName}/action.yml`;
    const action = readYaml(relativePath);
    for (const step of action.runs?.steps ?? []) {
      const location = `${relativePath} step ${step.name ?? "<unnamed>"}`;
      assertExternalActionPinned(step.uses, location);
      assertCheckoutDoesNotPersistCredentials(step, location);
    }
  }

  const scanPath = ".github/workflows/scan.yaml";
  const scan = readYaml(scanPath);
  assertBranches(scan, "push", scanPath);
  assertBranches(scan, "pull_request", scanPath);
  if (scan.jobs?.scan?.permissions?.["security-events"] !== "write") {
    errors.push(`${scanPath} scan job must grant security-events: write`);
  }
  const scanActionStep = scan.jobs?.scan?.steps?.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("midnightntwrk/upload-sarif-github-action@"),
  );
  if (scanActionStep?.with?.skip_scorecard_scan !== "true") {
    errors.push(
      `${scanPath} must skip Scorecard because the dedicated workflow owns it`,
    );
  }
  if (scanActionStep?.with?.scorecard_checks !== undefined) {
    errors.push(`${scanPath} must not configure competing Scorecard checks`);
  }

  const scorecardPath = ".github/workflows/scorecard.yml";
  const scorecard = readYaml(scorecardPath);
  const scorecardEvents = scorecard.on ?? {};
  if (!scorecardEvents.push?.branches?.includes("main")) {
    errors.push(`${scorecardPath} must run on pushes to main`);
  }
  if (scorecardEvents.pull_request !== undefined) {
    errors.push(`${scorecardPath} must not publish results from pull requests`);
  }
  if (!scorecardEvents.workflow_dispatch) {
    errors.push(`${scorecardPath} must be manually dispatchable`);
  }
  if (
    !Array.isArray(scorecardEvents.schedule) ||
    scorecardEvents.schedule.length === 0
  ) {
    errors.push(`${scorecardPath} must run on a schedule`);
  }

  const scorecardJob = scorecard.jobs?.analysis;
  if (
    scorecardJob?.permissions?.contents !== "read" ||
    scorecardJob?.permissions?.["id-token"] !== "write" ||
    scorecardJob?.permissions?.["security-events"] !== "write"
  ) {
    errors.push(
      `${scorecardPath} analysis must grant read contents, write id-token, and write security-events`,
    );
  }
  const scorecardStep = scorecardJob?.steps?.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("ossf/scorecard-action@"),
  );
  if (
    scorecardStep?.with?.results_format !== "sarif" ||
    scorecardStep?.with?.publish_results !== true
  ) {
    errors.push(
      `${scorecardPath} must publish official Scorecard results in SARIF format`,
    );
  }
  const scorecardUploadStep = scorecardJob?.steps?.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("github/codeql-action/upload-sarif@"),
  );
  if (scorecardUploadStep?.with?.sarif_file !== "results.sarif") {
    errors.push(`${scorecardPath} must upload results.sarif`);
  }

  const dependencyReviewPath = ".github/workflows/dependency-review.yml";
  const dependencyReview = readYaml(dependencyReviewPath);
  assertBranches(dependencyReview, "pull_request", dependencyReviewPath);
  if (
    dependencyReview.jobs?.["dependency-review"]?.if !==
    "github.event.repository.private == false"
  ) {
    errors.push(
      `${dependencyReviewPath} must activate dependency review when the repository is public`,
    );
  }

  const dependencyReviewStep =
    dependencyReview.jobs?.["dependency-review"]?.steps?.find(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/dependency-review-action@"),
    );
  if (!dependencyReviewStep) {
    errors.push(`${dependencyReviewPath} must run dependency-review-action`);
  } else {
    if (dependencyReviewStep.with?.["fail-on-severity"] !== "high") {
      errors.push(`${dependencyReviewPath} must fail on high vulnerabilities`);
    }
    if (
      dependencyReviewStep.with?.["fail-on-scopes"] !==
      "runtime, development, unknown"
    ) {
      errors.push(`${dependencyReviewPath} must review every dependency scope`);
    }
  }

  // Publication workflow contract: dispatch-only trigger, branch/channel
  // gate, pinned public npmjs registry, and least-privilege permissions.
  // (Provenance is asserted through the publish-script contract test.)
  const publishPath = ".github/workflows/publish.yml";
  const publish = readYaml(publishPath);
  errors.push(...assertPublishWorkflow(publish, publishPath));

  const dependabotPath = ".github/dependabot.yml";
  const dependabot = readYaml(dependabotPath);
  const updates = Array.isArray(dependabot.updates) ? dependabot.updates : [];
  for (const ecosystem of ["github-actions", "npm"]) {
    const update = updates.find(
      (candidate) =>
        candidate?.["package-ecosystem"] === ecosystem &&
        candidate?.directory === "/",
    );
    if (!update) {
      errors.push(`${dependabotPath} must update root ${ecosystem} dependencies`);
      continue;
    }
    if (!update.schedule?.interval) {
      errors.push(`${dependabotPath} ${ecosystem} updates need a schedule`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[check-security-workflows] ${error}`);
    }
    process.exit(1);
  }

  console.log(
    "Security workflow contract is valid: branch coverage, dedicated Scorecard publication, public dependency review, Dependabot, immutable action refs, checkout credential hygiene, and the publication workflow contract (dispatch-only trigger, channel gate, tag reconciliation, GitHub-Release steps before a best-effort npm publish, npm CLI trusted-publishing floor, locked npmjs registry, protected npm-release environment, zero token references, window permissions: contents write + id-token write + attestations write).",
  );
};

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main();
}
