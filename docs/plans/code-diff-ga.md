# Graduate code diff for CLI and public MCP

Status: Phase 1 implemented; deterministic checks and code review passed.
Default-enabled production acceptance remains pending macOS Keychain access.

## Goal and verified current state

Make `githits code diff` and public `code_diff` available by default with their
existing exact-tree, repository-wide, bounded-evidence contracts. The user
confirmed production validation and both CLI and public MCP scope on
2026-10-02. Publication and hosted deployment remain separate authorized steps.

Delivery is one GA implementation PR in this repository, followed by release
preparation. There is no separate audit PR or audit-merge dependency. The
already-authored regression script and workloads accompany the product change;
recorded live results support the implementation plan rather than constituting
the deliverable. Draft audit PR #447 was closed at the user's direction.

At the plan baseline, the CLI command was gated in `src/services/experimental-cli-policy.ts` and
`src/commands/code/index.ts`. `packages/mcp/src/mcp/local-server.ts` alone
registered the experimental tool. Public descriptors contained 12 stable tools
and omitted `code_diff`. Phase 1 now registers CLI and public MCP diff by
default, with 13 public descriptors. The concrete client implementation already
implements `CodeDiffService`, which is exported by `@githits/mcp/client`;
public `McpToolServices.codeNavigationService` now requires the intersection.

The shared request builders, projector, formatters, query selection, and
error mapping are already implemented and tested. The durable audit and
its exact commands are in
[code-diff-ga-audit.md](../implementation/code-diff-ga-audit.md).
This plan relies on that evidence, including the neutral Codex discovery
limitation and the verified live data/repository-provider limitations.
The follow-up `zig:gh/hejsil/zig-clap` `0.11.0..0.12.0` comparison also verifies
distinct Zig versions through CLI and MCP; the original compiler fixture does
not establish a defect in indexing valid packages on access.

## Boundaries and architecture

`CodeDiffService` naturally owns exact-tree access; MCP composition owns which
capabilities its public tools require. Require `CodeNavigationService &
CodeDiffService` at `McpToolServices.codeNavigationService`, as local composition
already does, and keep `CodeNavigationService` itself unchanged. Adding diff
to that broader core interface would burden unrelated/custom navigation
consumers; a second service property would duplicate an existing capability.
The concrete remote-facing client is already ready for this narrower change.

Stable MCP composition owns registration, descriptors and routing. Move the
existing diff factory into stable composition, remove its duplicate local
experimental registration, and retain experimental Research/Resolve behavior.
CLI composition owns command visibility; remove only diff from the gate.
Shared modules retain request, error, response and presentation ownership.
Remote-mcp owns HTTP transport, request composition, auth and deployment; no
logic is copied into that repository or modified from this worktree.

Flow remains: CLI/MCP input -> shared request builder -> CodeDiffService
authenticated exact-tree query -> shared lean projection -> surface text/JSON.
Keep CLI default patch, MCP default name-status, separate comparison endpoints,
repository scope, bounded glob grammar, explicit truncation, and patch safety
suppression. No queue, cache, feature flag, fallback, timer, or new caller
serialization requirement is needed.

## Assumptions, decisions and exclusions

Verified assumptions:

- Exact source evidence is the intended feature; it does not promise artifact
  tarball comparison, rename detection, package-subpath discovery, Git metadata
  headers, upgrade safety, or all repository-host providers.
- Custom public MCP service providers will need a `codeDiff` implementation
  after the public service requirement changes. The built-in client already
  has one. This is a source-compatibility change, not a transparent addition.
- Current production limitations remain disclosed: unsupported SCM providers
  and unavailable historical package data. Valid packages are expected to
  index on access; an unregistered target alone does not establish a valid
  product limitation. The original missing Zig compiler target was an
  unsuitable package fixture, and a follow-up valid Zig library comparison
  succeeds across distinct versions through CLI and MCP. Indexing on access
  for a previously unseen valid package remains unverified by this audit.
  No evidence warrants manufacturing repository or version substitutions.

Open overall product decisions: none about CLI/public MCP scope or diff
semantics. Phase 1 uses pending `githits: minor` for default command exposure
and `@githits/mcp: major` for the source-breaking service-provider requirement,
with an explicit custom-provider migration note. This is the conservative
classification of the verified public contract change; do not describe it as
universally additive. Exact release versions remain a Phase 2 decision before
version edits, including the repository's coordinated minor-alignment rule.

Non-goals: change diff semantics, overhaul backend resolution, add changelog
action steering without its deployed backend contract, change other
experimental tools, optimize performance, or claim hosted promotion before
dependency adoption and deployment. No major engineering finding was deferred
by this audit; its observed limitations remain recorded in the durable audit.

## Phase map

1. **Stable CLI/public MCP exposure (implemented; acceptance pending).** Default
   composition, guidance, smoke contracts and eval policy agree on diff's
   availability. Depends on the completed audit; no unresolved behavioral
   product decision.
2. **Published distribution and host adoption (LATER).** Release metadata and
   public CLI guidance match shipped behavior; published artifacts support
   outside-repository consumers. Depends on Phase 1 merge, package-scoped
   release preparation, and explicit last-mile approvals. Remote consumer
   adoption/deployment requires a separately authorized lane.

## Phase 1 implementation detail

Orchestration sequence (one Luna worker, dispatched sequentially):

1. Worker: make CLI diff registration independent of experimental policy,
   with focused policy, command-group, and real-process help regressions.
2. Coordinator: promote public MCP capability/registration, stable guidance,
   public consumers, smoke checks, and durable documentation.
3. Worker: rename the five diff workloads and move their manifest entries to
   stable-full (the base package comparison also joins smoke), updating exact
   inventory contracts and eval documentation.
4. Coordinator: verify the full delta and live default-enabled surfaces,
   perform Luna pre-flight/internal/Claude review, and open the product PR.

Workers return uncommitted verified deltas; the coordinator owns acceptance,
commits, integration, and all network-dependent evidence. Effective sandbox
is full access with approval policy never; briefs impose file ownership.

Status: implemented; deterministic acceptance passed. Production matrix and
agent traces await macOS Keychain access. Code review is clean after round 2.
Expected outcome: an unconfigured CLI user sees
and can invoke diff; a normal public MCP server advertises and executes it;
agents receive correct routing and repository-scope guidance without enabling
experimental tools. Assumptions: current production service behavior and
shared diff contracts remain unchanged. Unknowns/product decisions: none.
Dependency: completed audit and approved plan direction.

Likely affected components:

- `src/services/experimental-cli-policy.ts`, `src/commands/code/index.ts`,
  their policy/process/help tests, and CLI command JSDoc.
- `packages/mcp/src/tools/tool-services.ts`, `tools/index.ts`, public
  `index.ts` exports as needed, `mcp/server.ts`, `mcp/local-server.ts`,
  descriptor services/test factories, and public-surface/capability tests.
- `packages/mcp/src/tools/code-diff.ts` description;
  `mcp/instructions.ts` and exact `skills/githits-mcp/SKILL.md` guide copy.
- Public smoke helper inventory/assertions, `scripts/{cli,mcp}-smoke.ts`,
  parity fixtures, and `scripts/validate-public-packages.ts` outside-root
  runtime/declaration consumers.
- `scripts/code-diff-audit.ts`: replace its experimental=true config with an
  isolated tools=false config used by both CLI and MCP, remove the MCP
  `--experimental-tools` override, and retain the matrix cells. This prevents
  caller opt-in state from masking a default-registration regression.
- `eval/agentic/suites.json`, the five diff workloads and README/test inventory;
  README, `docs/experimental-tools.md`, implementation docs, package README,
  and one independent change fragment naming both public artifacts.

Steps:

1. Promote existing CLI registration and public MCP factory/capability; retain
   private navigation-interface compatibility and register diff exactly once
   whether other experimental tools are enabled or disabled.
2. Remove experimental wording from the tool and docs. Add the exact raw-source
   comparison route to the stable guide, distinguish it from upgrade review,
   and state the diff exception to package-subpath scoping. Preserve first
   sentence/first-80 discovery tests, privacy/trust and completeness facts.
   Follow the internal plugin-maintenance skill; regenerate/check canonical
   plugin assets rather than editing generated files. The `githits-mcp` guide
   copy follows the bounded same-PR parity exception. Updates to the public
   CLI code/package skills belong to the release branch after the behavior
   is included there, or follow publication; do not advertise unreleased CLI
   behavior from those skills on main.
3. Rename/reclassify all five neutral diff workloads as stable-full; include
   the small Express comparison in smoke, retaining canary selection. Update
   manifest contract tests and documented counts. Other experimental workload
   classifications remain experimental.
4. Move diff smoke coverage into stable cohorts with registration/auth,
   default view, text/JSON, scoped content and parity assertions. Extend public
   package consumers to prove a real typed service provider can construct and
   execute the tool from exported package paths without private aliases.
5. Verify deterministic tests, build, typecheck, plugin checks, public-package
   validation and source/built CLI/MCP smoke paths. Rerun the direct audit
   without experimental config/override. Run the same 14 local MCP agent cells
   without the experimental flag: both agents × five descriptor-intent
   workloads, original neutral discovery, and full-guidance monorepo. Run
   focused CLI skills evals for Express and monorepo in release preparation
   when the CLI skill changes are included. Inspect actual calls, finals,
   metrics and isolation artifacts, not merely harness success.

Acceptance:

- Stable CLI help includes diff and valid invocations are independent of the
  experimental subsection; existing malformed local-config handling remains
  consistent. Other experimental commands remain opt-in.
- Public descriptors, annotations, tool factory exports, service contracts,
  smoke helper and local server all agree; diff appears exactly once. Custom
  service migration is explicit and outside-root typed consumers pass.
- The guide and skill copy have exact parity and no scope contradiction.
  Descriptor discovery remains useful within its observed rendering bound.
- The named direct matrix preserves exact identities, view-dependent wire
  selection, CLI/MCP JSON/error behavior and safety evidence; reviewed agent
  traces show usable comparison/recovery/scope behavior. Neutral zero-use
  cells remain reported rather than counted as tool acceptance.
- GA docs distinguish supported providers/data coverage from package registry
  syntax, and explain repository-wide package results and patch limitations.
- No public artifact contains private aliases or static forbidden filesystem
  edges. The independent change fragment accounts for CLI/MCP impacts.

No latency/throughput improvement is proposed; test-run durations are evidence
of execution only. Preserve minimal GraphQL selections for each view.

## Phase 2 outcome and reorientation

Status: LATER. Expected outcome: published CLI and public MCP package expose
the stable contract, with correct distribution guidance and version metadata.
Assumptions: Phase 1 has merged and produced outside-root validation evidence.
Unknowns: exact package versions, release branch guidance timing, and
separately assigned remote host rollout.
Resolve these before preparing the release increment. Dependencies: Phase 1
and separate merge/release/publish/deploy approvals where applicable.

Reorient against current `origin/main`, reconcile observed results and release
policy, then detail this phase. Acceptance: released package behavior matches
the stable docs; generated metadata is consistent; hosted availability is
reported only after verified dependency adoption/deployment. Ordinary commit,
push, PR and CI delivery need no additional approval.

The release preparation updates public CLI skills at their permitted lifecycle
boundary, validates the exported/packed packages, consumes the GA change
fragment, and opens the release PR. Publishing the packages makes CLI/public
MCP GA deliverable to consumers. Hosted availability requires a separate
`remote-mcp` worktree to adopt that released MCP version and validate/deploy
its transport and composition; it is not achieved by merging this repo's PR.

## Completion and cleanup

Retain the direct audit script as a manual CLI/MCP regression reproducer owned
by the surface/parity maintainers. Keep it outside deterministic CI; update
dated fixtures only from verified service evidence, preserving prior results.
Stable smoke cohorts own routine product checks, and stable agent workloads
own qualitative use checks. The script's experimental settings are removed
in Phase 1 as specified above.

Before Phase 1 review, transfer any new behavioral decisions into durable
implementation docs. Keep this plan through review. If Phase 1 becomes the
last implementation PR for this repo, transfer remaining operational steps
and any open major findings to durable docs/backlog and delete this plan as
the final commit after its clean review. Otherwise retain it through the
actual final increment, then remove it in that PR after clean review.
Do not merge, tag, release, publish, or deploy on an inferred approval.

Review: internal pre-flight and re-review clean after exact-commit/default-view
audit gaps were fixed. Claude round 1 found only minor plan/doc corrections:
spell out the audit script's stable config and lifecycle, record the final
123-cell result, and classify public release impact in Phase 1. All accepted
and applied; the doc-only round counts as clean under repository review rules.
The subsequent delivery clarification closes the audit-only PR and makes the
single implementation PR explicit. It changes no scope, architecture, phase
boundary, or acceptance criterion; no new review round is required for it.

## Phase 1 execution checkpoint

Product implementation: `4bdc221`; durable guidance reconciliation: `799ad4f`.
CLI/eval work was delegated in four sequential returns. The extra CLI fixture
return followed an ownership omission in the coordinator brief; an ambiguous
trailing period in a verification brief caused an unintended full unit run.
Both were coordinator briefing costs, not a recurring worker design failure.
The complete suite passed 5,327 tests, zero failures across 230 files.
Focused catalog, public service invocation, guide parity, smoke and eval
contracts passed 353 tests with 2,082 assertions. Build, typecheck, plugin
checks, outside-root packed consumer validation, source CLI/MCP smoke and
both built smoke modes passed.

Luna preflight confirmed plan, interface and documentation conformance after
minor stale gated/local-only prose was corrected. It correctly marks current
production acceptance UNPROVEN: the 125-cell default-enabled matrix blocked
inside macOS Keychain before networking, and agent cells timed out during the
same access block. The agent queue was stopped with artifacts preserved.
User input to unlock/approve local Keychain access is pending. No credentials
were displayed, no retries or timer workarounds were added, and earlier
completed baseline results were not counted as current acceptance.

Remaining Phase 1 steps: open the product draft PR and inspect CI while the
local access block is pending; obtain default-enabled production proof after
it is resolved and update evidence before declaring GA acceptance. Keep this
plan while acceptance is pending.

Implementation review: internal pass clean after three minor documentation
corrections. Claude round 1 accepted the direction and found two minor test
issues: a dead single-member-union guard and stale smoke assertion wording.
Both were fixed, including a third sibling auth-probe label. The affected
Resolve parity suite passed 31 tests with 639 assertions; unauthenticated CLI
smoke passed. Fresh internal round 2 and Claude round 2 were clean, including
Claude's one fresh-context final check over the complete delta. Product
behavior did not change during these fixes. Reviewer retained in Orca terminal
`term_b3224af7-ce9b-4ab3-8c4e-b53ba465adb0`, run `run_70b114b47c62`.

Product draft PR: https://github.com/githits-com/githits-cli/pull/448. The
branch is committed and pushed; CI is running. The PR remains a draft until
the current authenticated acceptance gap is closed. This plan remains needed
for that work and will be retired after final acceptance and clean review,
with release/host operational steps kept in durable documentation.
