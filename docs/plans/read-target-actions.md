# Phase 4: backend-owned read actions

Status: implemented; root review and isolated eval acceptance pending.
Branch: `jlitola/unified-read-target-clients`; verified starting base
`1739290b03ebcb8dee920f536c30f9ac1e0145e8` (fresh origin/main, 2026-09-29).
Governing design: backend `docs/plans/UNIFIED_READ_CLIENT_SIMPLIFICATION.md`,
Phase 4 and its three-round clean planning review. This is the CLI execution
record; retain through review and merge, then transfer evidence to permanent
implementation documentation and retire it.

## Verified contract and assumptions

- Current main matches the reviewed search/status, docs inventory, unified list
  and read consumers. No descriptor selection exists. Legacy grep/files and
  compatibility reads remain separate roots. No wire-design contradiction found. Fresh tracing subsequently verified that
  baseline search text printed only headers/snippets, never a per-hit command.
  Root confirmed one explicit action line per hit preserves evidence headers
  while fulfilling the approved selector/full-CLI-selection contract. A bounded
  root conformance check caught repository descriptor addresses replacing
  per-hit package attribution; headers now retain producer target/path/ranges
  while only the action uses canonical identity. Commands
  stay unwrapped. This corrects the plan baseline, not its product contract.
- Backend owns target/path/selector/bounds; core validates wire facts; shared
  presentation owns syntax, existing caps and public JSON projection. Selector
  is opaque and target-dependent. No target parser, resolver or fallback added.
- Search and served-read SDK descriptors are optional for old custom providers;
  selected built-in fields must be present and valid. Nullable actions accept
  explicit null. Docs inventory maps required `readTarget.target` to its existing
  required `docsReadTarget`; list aliases `read: readTarget { target path }` with
  the existing directive and null/omission contract.
- Search JSON retains MCP syntax/caps on both surfaces; CLI text retains full
  selections. Pathless docs action bounds remain uncapped. Public JSON content,
  metadata and schema remain unchanged. Concrete continuations use served
  identity and clear selector, without fetching additional content.
- Single docs-list action, explicit selector, served SHA continuations and
  unavailable exact revision replace the approved old action spellings.
- Effective sandbox is danger-full-access. Both Luna roles are callable. Root
  owns internal/Claude reviews and draft PR approval after this checkpoint.
- Dev only for network verification. Eval authentication must be pre-provisioned
  by a trusted launcher; no credentials are extracted or exposed.

## Responsibility and mechanical slice sequence

Coordinator keeps selections/parser requirements, cap math, JSON boundaries,
search/header migration, served continuations, live verification, adjudication
and permanent docs. One Luna implementor performs sequential mechanical slices;
each returns uncommitted changes for hunk and exact-evidence inspection. No
tests/builds run concurrently with its edits. Twenty-minute supervision floor
and explicit takeover after two failed attempts apply.

1. Core descriptor value/parser. Ownership: `packages/core-internal/src/services/read-target.ts`,
   `packages/core-internal/src/services/read-target.test.ts`,
   `packages/core-internal/src/index.ts`. Criterion: opaque bytes, null omission,
   positive ordered integer bounds and target-only/target-path projections.
   Command: `bun test packages/core-internal/src/services/read-target.test.ts`.
2. Pure command renderer. Ownership: `packages/mcp/src/shared/read-target-text.ts`,
   `packages/mcp/src/shared/read-target-text.test.ts`. Criterion: both syntaxes
   recover opaque arguments and optional range/selector fields without policy.
   Command: `bun test packages/mcp/src/shared/read-target-text.test.ts`.
3. Single canonical docs-list action. Ownership:
   `packages/mcp/src/shared/list-package-docs-text.ts`,
   `packages/mcp/src/shared/list-package-docs-response.ts`,
   `packages/mcp/src/shared/list-package-docs-response.test.ts`. Criterion: one
   renderer action per page on either surface, with unchanged JSON/provenance.
   Command: `bun test packages/mcp/src/shared/list-package-docs-response.test.ts`.
3a. Close TypeScript conformance from the parser/renderer returns. Ownership:
    `packages/core-internal/src/services/read-target.ts`,
    `packages/mcp/src/shared/read-target-text.test.ts`. Criterion: inferred Zod
    input types support piping and opaque test values remain required strings.
    Command: `bun run typecheck`. The isolated Bun returns missed these compiler
    errors; coordinator verification found them before committing. The initial
    pipe-type fix diagnosis was incomplete; coordinator explicitly took the
    parser correction back inline and verified typecheck. Renderer fixture fix
    was accepted. A verified CLI smoke caller retains a pure target-only wrapper.
4. Search wire fixtures and regressions. Ownership:
   `packages/core-internal/src/services/code-navigation-service.test.ts`.
   Criterion: both built-in search roots select/require the descriptor and retain
   nullable actions. Command: `bun test packages/core-internal/src/services/code-navigation-service.test.ts`.
5. Unified-read wire fixtures and regressions. Ownership:
   `packages/core-internal/src/services/read-service.test.ts`. Criterion: distinct
   union aliases validate selected nullable code/non-null docs actions with one
   backend call. Command: `bun test packages/core-internal/src/services/read-service.test.ts`.
6. Docs-inventory wire fixtures and regressions. Ownership:
   `packages/core-internal/src/services/package-intelligence-service.test.ts`.
   Criterion: target-only wire selection equals existing required public string.
   Command: `bun test packages/core-internal/src/services/package-intelligence-service.test.ts`.
7. Unified-list wire regression. Ownership:
   `packages/core-internal/src/services/list-service.test.ts`. Criterion: aliased
   target/path keeps directives and selected/unselected/null projections.
   Command: `bun test packages/core-internal/src/services/list-service.test.ts`.
8. Shared search-text fixture migration. Ownership:
   `packages/mcp/src/shared/unified-search-text.test.ts`. Criterion: backend
   descriptors produce exactly one unwrapped action while evidence, attribution,
   layout and old-provider unavailable guidance remain covered.
   Command: `bun test packages/mcp/src/shared/unified-search-text.test.ts`.

Re-derive ownership before dispatch if tracing exposes another affected file;
record the correction here before sending a revised slice. Give Luna only its
current slice. Coordinator owns remaining presentation/provider/parity tests.

## Acceptance and evidence (checks passed; isolated eval auth pending)

Use the governing phase-4 matrix: descriptor versus conflicting locator facts;
heading/symbol selectors; 299/300/301 and pathless >300 ranges; completed,
interim/retained status and pagination; docs/list equality; code/docs default and
explicit caps, absolute/EOF continuations; empty/binary/null/typed outcomes;
quoting; no descriptor keys in public JSON and old provider compatibility.

Named focused run: core descriptor/search/docs inventory/list/read tests; MCP
shared renderer/follow-up/search response/text/semantic/status/presentation/list
and read/docs response tests; CLI search/read/list/docs-list tests; MCP
search/status/read/docs-list tests; existing search/read-file/read-package-doc/
list-package-docs parity tests. Include actual changed sibling consumers, then `bun run typecheck`, `bun run build`, and
`bun run validate:packages` (outside-alias packed declarations/provider fixture).
Run endpoint/token-override-cleaned `GITHITS_ENV=dev bun run smoke:cli` and
`GITHITS_ENV=dev bun run smoke:mcp`; auth-only skips are not authenticated proof.
Replay emitted dev actions with metadata-only output. Run local Codex MCP evals
for `docs-search-followup.md` and `unified-search-investigation.md`, inspect actual
tool calls/final/metrics/isolation and distinguish replay evidence from grading.
Missing trusted auth provisioning is a reported verification limitation.
The packed consumer fixture now typechecks old provider results and the exported
ReadTarget outside aliases; because product validation changed, also run
`bun run smoke:cli:built` and `bun run smoke:mcp:built` after building.

Update unified-read, unified-list and search/docs-output implementation docs;
add `changes/read-target-actions.changed.md` with patch for both public artifacts.
No versions, historical changelogs, infrastructure or performance claims.
Stop/reslice before 1.5-2k changed implementation lines. One fresh bounded
Luna preflight checks conformance/evidence/docs/interfaces, followed by root-owned
internal and external review. Return a secret-free /tmp review packet with exact
commands/results, commits, dispatch accounting and outstanding checks; no PR
before root's reviewed delivery instruction. Merge/publication/deployment stay
separate last-mile approvals; production descriptor support gates publication.

## Verification record

- Nine sequential Luna implementation dispatches (1-3, 3a, 4-8), no interrupts.
  Isolated slice tests passed. Slice 3a returned a failed typecheck because the
  coordinator's pipe-type diagnosis was incomplete; parser correction was
  explicitly taken back inline. No worker scope violation. Final text slice
  passed 101 cases/368 assertions before coordinator formatting and rerun.
- Final focused command is recorded exactly in
  `/tmp/read-target-phase4-focused.sh`: 1,011 tests, 3,667 assertions across 32
  named files, zero failures. Seven new coordinator assertion/fixture failures
  in the first combined run were corrected (quoting, explicit parity action,
  lifecycle/gutter expectations); no production changes resulted.
- `bun run typecheck`, `bun run build`, changed-TypeScript Biome formatting/lint,
  `bun run validate:packages` pass. Packed consumer fixtures compile optional
  descriptors on old search/read providers and the exported ReadTarget outside
  workspace aliases. Both dev-preset built secret-free smokes pass.
- Safe dev CLI auth status reports authenticated at
  `https://mcp-dev.githits.com` via existing macOS Keychain. It initially produced
  no output for minutes, then exited 0; exact cause is unknown, no workaround or
  credential diagnosis was applied. Live smokes and isolated evals remain
  separately classified below before final review.

- Endpoint/token-override-cleaned `GITHITS_ENV=dev bun run smoke:cli` passes
  stable and experimental live cohorts. Both built secret-free smokes pass.
  Dev MCP smoke passes stable live and experimental live checks (exit 0).
- `bun run /tmp/read-target-phase4-client-replay.ts` passes three actual emitted
  search JSON actions: ordinary code `npm:express@4.21.2` route.js 36-51;
  symbol search's opaque HTTPS repo/SHA action route.js 43-51; hosted
  resources.txt action with selector router resolves absolute lines 503-508.
  Public JSON has no descriptor keys. Only metadata is emitted to the replay
  artifact. These supplement root's nine backend-only owner checks and do not
  satisfy the isolated qualitative eval criterion.

- `bun test packages/mcp/src/shared/unified-search-status-text.test.ts
  --test-name-pattern 'retains package attribution'`: one case, three assertions,
  exit 0. Combined sibling coverage includes ordinary/semantic repository code,
  repository docs, hosted pages, completed search and retained/interim status.
- Isolated eval environment still has no trusted dev API-token provisioning.
  The two specified local Codex workloads were not run as auth-only traces;
  their authenticated tool-call/final/metrics/isolation acceptance is pending.
  Root already requested a trusted operator/CI launcher. No credential extraction
  or harness/auth workflow change was attempted.

## Bounded preflight adjudication

One fresh Luna preflight found no implementation or interface conformance mismatch.
Its two stale-guidance findings were inspected: the remaining tools.md paragraph
about omitted actions, fragment promotion and page-ID fallback was fixed in place.
The plan status now records implemented/review-pending; branch and starting-base
metadata remain a dated verification record rather than a claim about future HEAD.
The MCP quick-start wording finding was escalated to root. Root corrected the
phase's exclusion assumption: the stable MCP guide has a same-PR exact-parity
exception in `docs/implementation/release-process.md` (Public Agent Skill
lifecycle). The builder and its public `githits-mcp` copy now say to replay
generated actions unchanged, including supplied selector/bounds; hosted docs
retain mutable provenance and direct fragment reads retain subtree semantics.
This accepts the bounded main-to-release window and ships with the next
applicable `githits` and `@githits/mcp` artifacts. No wider guide redesign or
descriptor exposure is included. Root declared this wording-only preflight clean
once applied; no second preflight is required.

The bounded correction passed `bun run plugins:generate` (10 assets; no generated
diff), `bun run plugins:check` (10 validated), and
`bun test packages/mcp/src/mcp/instructions.test.ts src/skills-packaging.test.ts`
(23 pass, 316 assertions, including exact guide parity). Biome checked the two
instruction TypeScript files without changes; build and external packed-package
validation passed again. Required dev source CLI/MCP smoke rechecks passed after
the correction (stable and experimental live coverage, no auth skip); logs are
`/tmp/read-target-phase4-guide-smoke-cli.log` and
`/tmp/read-target-phase4-guide-smoke-mcp.log`. The two isolated qualitative evals
remain pending trusted provisioning.

The public `githits-code` skill and `references/code-and-docs.md` still describe
the previous automatic hosted-doc follow-up spelling. Their broader promotion
remains at the applicable release boundary, as approved; review and update those
two passages when the backing behavior is released or included in release
preparation. The `githits-package` skill/reference scan found no corresponding
action-selection claim. Report: `/tmp/read-target-phase4-preflight.md`.

## Internal continuation finding closure

Root internal review found a medium correctness bug under ordinary selections
larger than a display cap: a selected symbol at 700-1100 emitted 850-999 after
showing 700-849. Replaying that exact-file action completed without a hint and
silently omitted 1000-1100. Headings shared the display narrowing; longer code
replays also lost the selected end in generic exact-file cap retry guidance.

MCP presentation owns the remaining returned selection; the existing exact-file
request cap owns the explicit requested end. Ownership is correct at both seams.
The bounded fix retains returnedEndLine in the concrete action and originalEnd
(clamped to totalLines) in an explicit generic retry. Response caps still apply
per call, and default unbounded-file guidance stays start-only. No new state,
field, token, parser, fallback, extra fetch, caller constraint or infrastructure.

The sibling scan covered code text/JSON, docs capped text versus uncapped JSON,
selector/fragment clearing, default150/explicit300, EOF and old optional-end DTOs.
The docs paragraph still mentioning pageId continuation was corrected to describe
the existing served action identity and whole remaining range. CLI retains its
full selected output. Search action caps and unrelated legacy roots are untouched.

Actual createReadTool replay tests use source-aware async service mocks that no
longer know a symbol/heading's endpoint once selector/fragment is cleared. The ten
cases assert monotonic nonoverlapping displayed ranges, every selected line once,
no content beyond selection, served identity/path, cleared selector, one backend
call per step, caps and final hint absence. The baseline had nine failures; after
only the display fix, three code cases still failed at generic retries. Both
seams corrected: `bun test packages/mcp/src/tools/read.test.ts
packages/mcp/src/tools/read-file.test.ts
packages/mcp/src/shared/read-result-response.test.ts
packages/mcp/src/tools/read-package-doc.test.ts` passes 119 tests, 797 assertions.
Logs: `/tmp/read-target-phase4-continuation-{red,intermediate,focused}.log`.
Typecheck and six-file Biome check pass. Build, authenticated dev MCP smoke and
existing emitted-action replay evidence are recorded in the updated review packet.
No new delegation/preflight/reviewer was added; dispatch accounting stays nine.
Root owns internal closure verification and the fresh Claude round. The two
isolated qualitative evals remain pending trusted dev provisioning.

Closure live evidence: cleaned-env dev `bun run smoke:mcp` passed stable and
experimental live coverage, exit0 without auth skips. The existing three emitted
client-action replays passed (ordinary code36-51, symbol43-51, hosted docs503-508),
metadata only. Logs: `/tmp/read-target-phase4-continuation-smoke-mcp.log` and
`/tmp/read-target-phase4-continuation-client-replay.jsonl`. These supplement the
deterministic multi-window handler proof; no qualitative score is claimed.
