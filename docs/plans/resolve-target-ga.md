# Resolve Target GA

## Objective and status

**Status:** COMPLETE for Phase 1 after review wording closure. Release and hosted
adoption remain pending. Implementation was authorized through `orchestrate`
on 2026-10-06.

Make `resolve_target` a default stable MCP tool and `githits resolve` a default
CLI command, including the released public MCP package and hosted MCP used by
plugins. Preserve the existing resolution and continuation contracts.

The user accepted current production quality on 2026-10-06: "I think we call
this good enough and adjust when we see issues." The remaining observed coverage,
preference and ambiguity limits are accepted, not new GA blockers.

**Dependencies:** the existing resolver implementation, normal package release
process, and subsequent `remote-mcp` adoption. Merge, release, publish and deploy
each require their own direct human authorization.

**Assumptions:** promotion includes the existing paired CLI command, following
the repository's MCP/CLI parity convention. GA changes availability and supported
public composition, not backend ranking or the supported target universe.

**Open product decisions:** none for Phase 1. Exact release versions and hosted
consumer revision are later operational unknowns, resolved before Phase 2 execution.

**Overall acceptance:** released CLI and local MCP work without experimental
opt-in; the public package exposes and executes the resolver through public
imports; hosted MCP exposes it after adopting that package; agents preserve
confidence, ambiguity, malicious-content and documentation-locator boundaries.

## Verified baseline and evidence

- Audit checkout: `564e6b6`, branch `jlitola/audit-resolve-target-ga`, initially
  clean. Planning fetched `origin/main` at `d425bb4` on 2026-10-06; implementation
  must start from current main rather than copy this older checkout's inventories.
- Current main already released `githits` and `@githits/mcp` 0.26.0 and promoted
  `code_diff`. Its stable registry has 13 tools. Adding the resolver makes 14;
  `research` remains local and experimental (`ask` remains its CLI alias).
- `packages/mcp/src/mcp/local-server.ts` owns the gated resolver factory and
  service today. The stable registry, `McpToolServices`, public `/client` and
  `/tools` exports, and public smoke inventory do not yet expose the resolver.
  This is package-source evidence, not a verified current hosted deployment inventory.
- `src/services/experimental-cli-policy.ts` gates `resolve`; `src/cli.ts` uses
  that policy for registration/help. The CLI container already constructs the
  resolver. Shared request, response and continuation helpers already exist.
- The latest production recheck, saved locally under
  `.agent-eval/resolve-target-ga-2026-10-06/summary.json`, replayed 255 cases:
  49/49 core package matches, zero unexpected resolver errors, 11 successful
  inventory checks, and 32 local calls across eight inputs with agreement between
  JSON, default text, verbose text and direct compact-service gates. React
  repository preference now returns `github:react/react` HIGH, and the unrelated
  ASGI suggestion for Cloudflare documentation is gone.
- That audit used client `564e6b6`, a fixed corpus and production endpoints. It
  did not verify deployed backend commits, load/rate limits, live malicious
  AFFECTED/UNKNOWN fixtures, or a new descriptor/agent eval. It is ranking evidence,
  not proof that the newly promoted package composes correctly. Implementation
  verification below covers that delta without reopening the accepted ranking audit.
- Existing documentation: `docs/experimental-tools.md`, implementation
  `tools.md`, `cli-commands.md`, `mcp-cli-parity.md`, `resolve-site-availability.md`,
  and `release-process.md`. No separate resolver GA plan was found.

Accepted limits to preserve in durable documentation/backlog: absent docs.rs and
Cloudflare site candidates; soft kind preference for some Swift inputs;
misleading "multiple candidates remain" text on some singleton ambiguous
responses; Emacs bindings rather than unsupported Savannah core identity;
Pydantic docs usable from a stale index while refresh completion remains unverified.
Docker's MEDIUM SDK choice without a kind preference is explicitly accepted.
Do not infer provider expansion, mandatory vendor-site admission, or a new load
gate. An actual newly introduced regression remains actionable.

## Scope and ownership

One cohesive implementation PR promotes the existing CLI/MCP pair, public
composition API, stable guidance, smoke coverage, targeted agent workloads and
documentation. A second milestone covers release and hosted adoption.

The backend owns candidate discovery, ranking, confidence, ambiguity and
malicious-content classification. Private core owns authenticated transport and
neutral service types. The MCP package owns registration, tool descriptors,
shared presentation, continuation rules and the stable routing guide. The CLI
owns command registration/help and local composition. `remote-mcp` owns HTTP,
request-scoped services, dependency adoption and deployment.

Move the existing factory into the stable registry and make
`resolveTargetService: ResolveTargetService` a required `McpToolServices` member.
Expose `ResolveTargetServiceImpl` and the existing resolver service/request/result
types needed by consumers through `@githits/mcp/client`, and the factory and
`ResolveTargetMcpArgs` through `@githits/mcp/tools`. Publish no private core or
workspace-only imports. The resolver is naturally a required dependency because
every stable server now registers it; an optional service/fallback or separate
hosted implementation would duplicate the established composition boundary.

No backend/schema/query changes, new ranking policy, renamed tool/arguments,
output-envelope changes, extra retries, caching, flags, infrastructure or auth
flows. Research remains experimental. Existing code-diff GA and current main's
indexing/error improvements must remain intact. No performance optimization is
proposed, so no performance benchmark is needed for this promotion.

## Phase map

| Phase | Status | Observable outcome |
| --- | --- | --- |
| 1. Stable CLI and package promotion | COMPLETE | Default CLI/local MCP and public package provide the existing resolver with stable guidance and tested public composition. |
| 2. Release and hosted adoption | WAITING ON MERGE/RELEASE | Published artifacts and the hosted endpoint expose the same stable resolver; plugins receive it through their existing hosted connection. |

## Phase 1: stable CLI and package promotion

**Dependencies:** start an implementation branch from current `origin/main`;
reconcile the baseline changes above. No backend work is required by this plan.
**Assumptions:** existing resolver behavior is retained; public services remain
request-scoped. **Unknowns/product decisions:** none.

### Implementation order

1. Promote the package surface in `packages/mcp/src/mcp/server.ts`,
   `tools/tool-services.ts`, `client.ts`, the public `tools.ts` entrypoint and
   `tools/index.ts`. Add the stable
   factory and descriptor-service stub; export the existing concrete client and
   transitive public resolver types. Update service fixtures/constructors across
   package tests, eval mock servers and CLI parity helpers to supply the required
   service. Preserve the public `/tools` browser contract by importing neutral
   errors/registry constants through the existing core browser entry. Remove the
   local resolver factory, duplicate service member/stub and
   experimental-only parity helper; keep local research composition.
2. Remove `resolve` from experimental CLI paths and register it unconditionally
   in `src/cli.ts`, including default help/getting-started text. Simplify only the
   now-unused resolver availability switch. Existing opt-in configs continue to
   work; absent, false or malformed experimental settings no longer hide or block
   resolve. Local-only help must work with malformed network environment settings.
3. Remove the experimental label in `tools/resolve-target.ts` without changing
   schemas/defaults. Promote its routing row and continuation guidance into
   `buildMcpQuickStart()` in `mcp/instructions.ts`; remove resolver from the local
   experimental type/appendix. Update the stable guide copy in
   `skills/githits-mcp/SKILL.md` in the same PR and retain exact-parity tests.
   Preserve the <=79-character first-sentence/first-80 descriptor contract.
4. Move existing resolver live/auth/text/verbose/JSON checks from experimental
   cohorts into stable CLI/MCP smoke. Put reusable remote resolver assertions
   and coverage in `@githits/mcp/smoke-test`, not only the local launcher. Update
   inventories to 14 stable tools and assert a single resolver registration with
   opt-in both disabled and enabled. Experimental coverage now concerns research.
5. Rename the two resolver workloads to `resolution-follow-up.md` and
   `site-resolution-follow-up.md`; update `eval/agentic/suites.json`, its tests
   and README references. Classify them stable and include them in `stable-full`;
   use them directly for the targeted verification below without experimental flags.
6. Update root/package READMEs, experimental-tool documentation, CLI/tool/parity
   docs, annotations inventory and configuration/eval references that describe
   current availability. Also correct the current-state claim under "Local
   experimental surface" in `docs/plans/mcp-served-githits-skill.md`: it still
   calls resolver and code-diff guidance experimental and absent from the public
   surface. State package availability and hosted adoption separately. Keep
   historical audit reports historical. Create
   `docs/implementation/resolve-target.md` for the stable contract, consumer
   migration, accepted audit summary and remaining rollout checklist. Extend
   `docs/backlog.md` with accepted outstanding resolver findings, evidence and
   observable future acceptance criteria; do not file public issues or dispatch
   another backend lane during this planning/promotion task.
7. Add `changes/resolve-target-ga.added.md` with pending **minor** impact for
   both `githits` and `@githits/mcp`. Describe default availability and the new
   required public service. Do not bump versions or edit historical changelog
   sections in the implementation PR. Public CLI skills `githits-code` and
   `githits-package` receive behavior-dependent terminal guidance in the release
   containing this behavior, following their release lifecycle; the MCP stable
   guide's same-PR parity requirement is the documented exception.

### Contracts and edge cases

- Automatic continuation still requires unambiguous EXACT/HIGH and CLEAR or
  NOT_APPLICABLE malicious-content status. AFFECTED, UNKNOWN, future/missing
  statuses remain non-actionable; CLEAR does not mean vulnerability-free.
  MEDIUM/LOW or ambiguity still needs narrowing or explicit actionable selection.
- Existing canonical package/repository/site input rejection stays before the
  resolver service call. Registry/kind hints, empty strings/arrays, explicit
  false, limit boundaries, default text and lossless JSON retain current behavior.
- Site selections are docs-only: list their inventory or search with docs source,
  then replay emitted read actions unchanged. Do not invent paths or hostnames.
- Auth, terms remediation, error envelopes, read-only annotations and minimal
  compact-versus-detailed GraphQL selections remain the existing contract.
- Remote consumers must supply the newly required resolver service when updating
  the package. Demonstrate request-scoped auth composition using public imports;
  never import `@githits/mcp/internal` or private core from remote consumers.

### Verification and acceptance

Use `bun test` on the affected server/local-server, public-surface, descriptor,
instruction/skill-parity, CLI policy/help/resolve, resolver request/response/gate,
core resolver wire-selection, parity, smoke and eval-suite tests. Add behavioral
regressions for default registration/execution, request-scoped resolver services,
auth errors, malformed-config help and single registration with opt-in enabled.
Reuse existing malicious-status and over-fetch tests rather than changing the
service or inventing live unsafe fixtures. Run the repository's required checks
for touched files and `bun run typecheck` to catch missing service compositions.

Run `bun run plugins:generate` when canonical packaged guidance inputs require
it, then `bun run plugins:check`, `bun run build`, and
`bun run validate:packages`. Extend `scripts/validate-public-packages.ts` to
prove `/client` construction, `/tools` imports and one packed `resolve_target`
invocation through a supplied resolver service outside root path aliases.
Include `resolveTargetService` in its typed `McpToolServicesProvider` consumer
fixture, following the existing packed stable code-diff invocation. Verify
stable registration and no private workspace dependencies in packed artifacts.

Run `bun run smoke:cli` and `bun run smoke:mcp`; authenticated dev runs
exercise the newly stable resolver in text/verbose/JSON and a bounded selected
target follow-up. Report experimental Research failures separately when they
occur: they must not erase stable-cohort evidence or become a new resolver gate.
Also run `bun run smoke:cli:built` and `bun run smoke:mcp:built` after building;
these existing secret-free Node modes verify default help/registration/auth
without application credentials. Preserve auth handling in unauthenticated mode.
The implementation skill requires dev for new live checks. Set `GITHITS_ENV=dev`
and remove inherited endpoint overrides for live smoke and agent runs; keep the
accepted production audit as prior ranking evidence, not new production traffic.

Run these targeted local stable agent evaluations, for each `claude` and `codex`:

```sh
bun run agent:e2e --agent <agent> --surface mcp --server local --guidance-profile descriptors --workload eval/agentic/workloads/resolution-follow-up.md
bun run agent:e2e --agent <agent> --surface mcp --server local --guidance-profile full --workload eval/agentic/workloads/site-resolution-follow-up.md
bun run agent:e2e --agent <agent> --surface mcp --server local --guidance-profile full --workload eval/agentic/workloads/express-router.md
```

Inspect `tool-calls.json`, `final.json`, `metrics.json` and
`isolation-violations.json`: resolver discoverable without opt-in, fuzzy identity
handled with existing gates, selected package/site followed using emitted locators,
and canonical Express workflow still works. Report actual traces and neutral
answer/confidence; harness completion alone does not prove quality. No broad
accuracy, load or benchmark sweep is a release requirement here.

Phase acceptance is default availability on all local/public package entrypoints,
preserved request/response/security behavior, meaningful passing affected tests
and stable smokes, successful public-package validation, synchronized stable
guidance, and inspected targeted agent traces. Review the implementation through
a fresh internal preflight and one external reviewer per round; obtain a clean
round before treating the increment as complete.

## Phase 2: release and hosted adoption

**Status:** WAITING ON MERGE/RELEASE. **Dependencies:** reviewed/merged Phase 1 and
separate human authorizations for merge, release/publish and deployment steps.
**Assumptions:** hosted MCP consumes the released canonical package; plugins
continue using their existing hosted URL. **Unknowns:** exact versions, remote
consumer revision and its resolver-service composition must be verified during
release/adoption reorientation, before the corresponding PR or deploy.

Prepare the coordinated CLI/MCP release using the normal fragment and public
skill lifecycle. On the release branch add stable `githits resolve` routing to
the relevant canonical CLI skills/references and generate/check assets. Compute
versions from the then-current release state; do not pin a next version here.
Release preparation stops at a concrete release PR until its merge is approved.

After publishing, the authorized `remote-mcp` lane updates the dependency and
supplies the public resolver client through its existing authenticated
request-scoped composition, validates with the released public smoke helper,
and deploys only with separate human approval. Do not edit/message that lane
without the user's specific handoff. No backend ranking deployment is required
by promotion itself.

Acceptance: published CLI/local MCP provide resolver by default; hosted
`tools/list` advertises it once, stable `quick_start` includes its guidance,
authenticated text/JSON calls and a selected-target follow-up work, auth-required
behavior remains correct, and research is not accidentally added to the stable
surface. Check through the existing hosted connection used by plugins; no
plugin-specific registration or transport switch is needed. Record released
versions, adopted revision, smoke evidence and approval/deployment state in the
durable rollout documentation. If rollback is necessary, use the existing
package/deployment rollback process with the required authorization; do not add
a feature flag or fallback to this plan.

## Reorientation, completion and cleanup

At implementation start and after a merge, reorient against current main and
the preceding increment's observed evidence (use `next-steps` if available).
Update the next milestone's details only from verified release/consumer state;
do not continue a stale plan when it needs product input or replanning.

Phase 1 is the final runtime implementation PR in this repository. Keep this plan
through its review. After its clean review, migrate all durable contracts and
the still-pending Phase 2 rollout checklist into `docs/implementation/resolve-target.md`,
and accepted unresolved findings into `docs/backlog.md`. Delete this plan as the
final commit of that implementation PR, then check links/docs and commit it;
do not retain it through release as a stale implementation plan. Track Phase 2
in the durable rollout checklist. GA is complete only after its release and
hosted acceptance evidence is recorded, regardless of plan-file deletion.

## Plan review record

- Internal technical preflight: clean on 2026-10-06. Direction sound; stable
  registry, required-service/public-export route, guidance parity and release/
  hosted boundaries verified against `origin/main` at `d425bb4`. No findings.
- External Claude Opus 5.5 plan review: clean on 2026-10-06 after two minor
  wording fixes. Direction sound. Accepted: make packed execution/typed-provider
  proof explicit, and include the stale current-state claim in the related MCP
  skill plan's documentation update list. Checked the related Phase 1 public
  exports, service-fixture, documentation and acceptance sections for the same
  gaps; no additional contradictions found. No production changes or test runs.

## Implementation verification record

Branch `jlitola/resolve-target-ga` starts from `d425bb4`. Current validation and
inspected agent traces are recorded in `docs/implementation/resolve-target.md`.
The public factory export lives in `tools.ts` as well as the internal tool barrel;
packed consumer validation caught and corrected that distinction. Existing
search-status smoke needed explicit JSON when asserting its error envelope; a
regression covers the completed-search branch. No production checks were rerun.

Luna completed three serial dispatches: CLI availability; one correction to
restore the narrow experimental-command type and update stale error fixtures;
stable workload migration. The correction came from a fixture omission in the
coordinator brief. No worker interrupts or architecture decisions were delegated.
Fresh Luna implementation preflight marked all acceptance MET; its transient-ID
suggestion was rejected because the plan is temporary and the audit baseline
is explicitly historical provenance. Internal code review was clean. External
Claude Opus 5.5 round 1 found no code issues and three minor wording fixes:
remove an experimental resolver smoke label; include sites in CLI argument
documentation; remove stale experimental guidance wording from historical CLI
notes. Applied these and scanned related labels/help/docs for the same omissions.
The round is clean under the minor-wording policy once the help correction is
verified. Two final Luna wording dispatches changed only Getting started help;
one clarified the coordinator wording. Total five serial dispatches, zero
interrupts. All durable evidence/checklists are in the implementation doc.
