# Consistent indexing and error output

## Status and expected outcome

**Status: READY.** Planning only; no production changes.
Baseline: `origin/main` at `5a95c466ce455ea1b59bcb9cad404f219072f8ad`
(PR #453, merged 2026-10-05). Worktree branch:
`jlitola/consistent-indexing-ux-plan`.

Users and agents should understand what is available, what is still being
prepared, any advisory indexing estimate, and the next useful action without
knowing backend field names. CLI and MCP should share wording, with native
arguments and the existing tool-specific evidence layout. Explicit JSON remains
structured and preserves backend evidence.

This is a focused continuation of the per-formatter approach in
[search-output-ux.md](search-output-ux.md), not a competing general output
redesign. The prior grep plan is complete and deleted; its durable contract is
[indexing-estimates.md](../implementation/indexing-estimates.md).

### Decisions and assumptions

- User-approved: default read/list MCP indexing failures become readable text;
  explicit JSON retains the error envelope.
- User-approved previously: compact status and timing together; one entry per
  source; Sources and Omitted lists for grep; short retry guidance at the end;
  no repeated cursor tutorial or standalone “Serving partial data” paragraph.
- User-approved: all MCP errors respect the selected format. Omitted/default
  and explicit text produce readable errors; only explicit JSON produces JSON.
  This covers shared mapped errors and direct/early error paths, without changing
  schemas or service behavior. This concerns package-produced tool error
  content, not JSON-RPC transport encoding. Open product decisions: none.
- Assumption: improve common copy and ordering without imposing grep's entire
  layout on file content, a path inventory, or search's session lifecycle.
- Assumption: keep existing wait defaults, bounds, budgets, and units. Timing
  remains advisory total repository execution, excluding queue/retry/query/docs
  time; elapsed is observed active execution, never remaining ETA.
- No new backend fields are needed for the first two phases: successful pending
  results carry uniform estimates; zero-wait errors already carry a singular
  duration extension. These are distinct contracts, not interchangeable facts.

Dependencies: merged uniform metadata support, current backend SDL and existing
shared formatters. Production support remains a release prerequisite, not a
condition established by local SDL or the prior dev deployment.

Overall acceptance: consistent preparation lines and final native actions across
waiting surfaces; readable errors whenever MCP text is selected; no lost
results, locators, provenance, cursor/session behavior, error classification or
structured timing; raw CLI output remains pipe-friendly.

## Verified current behavior

Evidence was collected from current source, existing tests, and actual formatter
execution during planning. `/tmp/indexing-ux-baseline.ts` produced seven CLI/MCP
examples in `/tmp/indexing-ux-baseline.md` using deterministic pending fixtures;
these are renderer observations, not claims of live backend replies. Important
examples and their implications are recorded below so the plan survives those
temporary files.

| Surface | Current behavior | Consequence |
| --- | --- | --- |
| grep | Shared Sources/Omitted lists, compact total/elapsed timing, final retry note, native cursor | Keep the reviewed anatomy. |
| read indexing error | Classifier embeds timing and mixed CLI/MCP syntax; CLI adds `hint:`/progress ID; MCP read-file overrides the action with the just-failed wait, including zero | Classification owns presentation it cannot specialize; MCP action can contradict its hint. |
| read successful content | JSON preserves estimates; MCP and CLI verbose append timing; ordinary CLI returns raw content | Preserve evidence and piping; improve only annotated output. |
| list positive wait | Uniform estimates survive result decoding, but an empty pending source starts with a source/read-follow-up header and separate timing prose | Can suggest reading an inventory with no served files; no clear empty-yet outcome. |
| list zero wait | Backend GraphQL exception uses `estimated_indexing_duration`; ListGraphQLError/parser/mapper omit it | Structured timing is lost even though the backend supplied it. |
| list with available pages and refresh | Inventory/cursor and pending work can coexist; retry paragraph precedes the continuation footer | Keep pages and cursor; place one short preparation action at the end. |
| search/search-status | Shared presentation/lifecycle and valid session follow-ups; estimate prose appended separately from target readiness | Align preparation copy without replacing session actions with fresh requests. |
| MCP mapped failures | `mcpMappedErrorResult` always JSON-stringifies, regardless of requested text; search main catch already has a text branch, status/early validation do not | Success format is inconsistently respected on errors. |

Example current read CLI output:

```text
Repository is indexing.
  hint: npm:express@1.0.3: Estimated indexing time: 33-85s total. Time spent indexing: 4s.
    Retry the same request using CLI --wait 60000 or MCP wait_timeout_ms=60000.
  indexing ref: example-progress
```

Example current pending list:

```text
# source npm:express@1.0.3 | follow up with "read npm:express@1.0.3 $path"
npm:express@1.0.3: Estimated indexing time: 33-85s total. Time spent indexing: 4s.
To wait for indexing, run list again with --wait 100000. Leave out --after and keep your other options.
```

A zero-wait list MCP error instead carries the backend estimate only in prose,
with `details.graphqlCode` and `details.indexingRef`, and no structured duration.
This corrects the earlier conversational summary: result-level support is present;
list's zero-wait error support is incomplete.

### Code and backend evidence

- `packages/mcp/src/shared/indexing-estimates-text.ts` owns full/compact timing;
  `indexing-wait.ts` owns the existing request-budget recommendation.
- `list-text.ts`, `read-file-text.ts`, `read-file-response.ts`,
  `unified-search-text.ts`, and `grep-text.ts` own the tool output.
- `code-navigation-error-map.ts` generates mixed-surface action/hint strings.
  `src/commands/code/code-nav-cli-helpers.ts` adds progress IDs and alternatives.
- `packages/mcp/src/tools/shared.ts` builds JSON errors; direct callers include
  read, list, grep, code-diff, package tools, resolve-target and get-example's
  withErrorHandling wrapper. Local mcp/local-research.ts also serializes two
  error paths directly; retain its tool_call_id/thread_id evidence in JSON.
  Search early target validation also uses the wrapper.
  Search-status directly serializes its error payload. MCP server.ts also calls
  withErrorHandling while resolving injected services before the tool handler,
  so provider failures need the parsed request's format too. Trace early-return
  helpers and pre-handler wrappers, not only final catches. read-file.ts uses a
  context-free resolveCodeTarget early return and overrides INDEXING advice with
  the request's existing wait; replace both with boundary-owned format/action.
- `src/commands/format-mapped-error.ts` handles CLI human errors separately.
- Public smoke-test.ts assertLiveOrAuthRequired probes default pkg_info but calls
  assertCleanErrorEnvelope, which parses JSON. Keep that exported assertion's
  explicit-JSON contract; update structured probes to request JSON and separately
  assert readable text failures. The secret-free smoke path must still pass.
- Backend SDL: `~/proj/githits/pkgseer-backend/priv/graphql/schema.graphql`,
  ListResult and CodeContextResult both select uniform estimates. Hosted read
  union branches do not wait and expose no timing metadata.
- Backend `lib/pkg_seer_web/graphql/error_extensions.ex`, `indexing/1`, emits
  `estimated_indexing_duration` and optional `repo_url`, `available_versions`,
  `hint`, `indexing_ref`; it also embeds duration prose in its message.
  Navigation resolver routes zero waits through this error helper. Existing
  code-navigation duration parsing accepts the verified error-extension form;
  reuse it instead of inventing an error estimate contract.
- `docs/implementation/tools.md` and `mcp-cli-parity.md` explicitly describe
  JSON errors in text mode. This is a deliberate contract revision, not just
  correcting an accidental formatter branch. Their current descriptions also
  conflict with search's existing default text catch; update both from code.
- `unified-list.md` still describes an empty inventory as a header alone;
  the merged uniform timing output already makes that description incomplete.
  Update in the list increment rather than rewriting unrelated historical plans.

Planning validation:

```bash
bun test packages/mcp/src/shared/list-text.test.ts \
  packages/mcp/src/shared/list-error-map.test.ts \
  packages/mcp/src/shared/code-navigation-error-map.test.ts \
  packages/mcp/src/shared/indexing-estimates.test.ts \
  packages/mcp/src/shared/read-result-response.test.ts
```

106 passed, 0 failed, 275 assertions, five files (96ms).
No optimization is proposed; a performance benchmark would not decide this plan.
No new live query is necessary to choose wording or prove the dropped extension:
backend source and the client decoder establish that path. Prior PR #453's dev
checks establish pending result metadata, not production rollout.

## Target architecture and presentation contract

**Ownership:** backend/core own state, identity and timing evidence. Shared
formatters own human wording. Each tool boundary owns the action, since it knows
the request, native units and cursor/session semantics. The error classifier must
not choose an operation-specific action or embed both surfaces into one hint.

Extend existing timing helpers for a compact preparation row; use one small
shared error text formatter for mapped error facts. Keep tool-specific outcome,
evidence and continuation formatters. Do not create a universal result model,
layout framework or lifecycle engine. CLI and MCP supply width/color and native
action text at the presentation boundary; core services never receive display
syntax. This is simpler than threading tool identity through error classification.
The formatters are pure functions, tested independently with mapped facts and
width/color inputs. Existing injected service interfaces and factories remain the
only network dependencies; no container or service-composition change is needed.
Both text and JSON consume already-selected timing/error evidence. Keep current
GraphQL selections and mode-specific omission controls unchanged; decoder tests
use captured-shape responses, not new queries. Public helper JSDoc records total
versus elapsed semantics and output-format ownership.

Human output should follow these rules:

1. Lead with the outcome. Empty pending read: “This content is not available yet.”
   Empty pending source list: “No files available yet.” Hosted list: “No pages
   available yet.” Complete empty results remain distinct from pending work.
2. Group pending work under `Preparing:` with one compact target row, reusing
   grep's timing vocabulary. Grep retains its already-approved `Omitted:` list.
   A pending refresh beside readable content is preparation, not an omission.
3. Repository row: `target (indexing, estimated total: 33-85s)`; add active
   elapsed evidence when present. No history: retain its explanation; elapsed
   alone is not a remaining estimate. Hosted work: “preparing documentation,
   no estimate available”. Do not label searching/queued work as an active index
   merely because a duration entry exists; tool lifecycle still decides state.
4. Keep actual file/page/path evidence and concrete freshness/provenance limits.
   Ordinary progress IDs and enum scaffolding stay in JSON, not default prose.
5. Put one native preparation action at the end, after any continuation action.
   Read: “Retry this read with --wait 60000.” MCP uses only
   `wait_timeout_ms=60000`. List: “Retry this list with --wait 100000.” Add
   “Leave out --after.” only when the current request actually used a cursor.
   MCP names `after`. No repeated ordered-target tutorial.
6. A searchRef represents a live search: retain its existing search-status wait
   action. After termination, retain the existing new-search action. Do not add
   client polling, automatic retry, or a status API for read/list/grep.
7. Explicit JSON keeps error/code/retryable/details, backend messages/hints,
   estimates, IDs, alternatives and trusted locators. Client-authored action
   text may become surface-native; do not remove metadata to improve prose.
   MCP errors keep `isError: true`; cancellation remains cancellation.
8. Preserve `list --silent`, ordinary CLI source reads, exit status and stdout/
   stderr behavior. Annotated read output may show preparation; raw body output
   must not acquire prose. ANSI never carries meaning; wrap bullet continuation
   under the text, preserving backend Unicode and intact action operands.

Example target read (ordinary CLI indexing failure):

```text
This content is not available yet.

Preparing:
  - npm:express@1.0.3 (indexing, estimated total: 33-85s)

Retry this read with --wait 60000.
```

The example suggestions are outputs of the existing recommendation, not constants
or promises of completion: largest supplied upper bound plus 10s, rounded up to
10s, capped at 60s for read or 120s for list. No bound uses 30s; uncovered sibling
work preserves the existing 30s floor. Never subtract elapsed or sum targets.
Apply the same formula to a supplied singular upper bound without manufacturing
a uniform entry; missing timing uses the existing default. Do not change units,
caps or the calculation as a copy change.
Raw backend exceptions may have only singular timing. Preserve that value under
its original JSON field; render the same compact timing without pretending the
backend emitted a uniform entry or fabricating repository URL/SHA attribution.

### Scope and non-goals

Include pending errors/results, readable results with refresh, estimates without
bounds, requested-vs-served provenance, and native follow-up placement. The MCP
error scope also changes non-indexing text errors and their format-specific call
sites. Keep good evidence bodies as they are.

Exclude backend edits, new estimates, changed wait policies/defaults, extra field
selection, schema flags, retry automation, deployment/publishing and a redesign
of all result formatters. Hosted read/symbol-ambiguity branches remain nonwaiting.
Broader unknown backend variants are not grounds for fallback parsers or guards.

## Ordered increments

| Phase | Status | Observable outcome |
| --- | --- | --- |
| 1 | READY | Read indexing failures become concise and native; all MCP text-mode errors are readable. |
| 2 | PLANNED; depends on 1 | List distinguishes empty-yet inventory from available pages/refresh and preserves zero-wait timing. |
| 3 | PLANNED; depends on 2 | Search/search-status put timing beside the relevant pending target without changing session actions or evidence. |
| 4 | PLANNED; depends on 3 | Remaining legacy waiting annotations reuse the copy contract; already-correct surfaces stay unchanged. |

Each increment is a bounded shared component or one tool formatter; no phase
exists solely to collect measurements. Reorient against origin/main after each
merge, using next-steps before expanding the next detail horizon.

## Phase 1 — readable error presentation and read preparation

**Expected outcome:** a default read error is readable, with status/timing once
and one read-native action. Explicit JSON retains the structured evidence.
All MCP errors respect text vs JSON in the same increment, including direct
and early validation paths. No text-mode failure contains a serialized JSON envelope.

Assumptions: user-approved read/list default text; existing mapped errors have
sufficient facts; no transport change. Unknown/product decisions: none.
Dependencies: baseline and clean plan review.

Likely files: MCP `tools/shared.ts`, shared mapped-error text/timing helpers,
`code-navigation-error-map.ts`, read/error formatters, `tools/read.ts`, CLI read
and code-nav helpers, mcp/local-research.ts, smoke-test.ts/tests, scripts/mcp-smoke.ts
and scripts/code-diff-audit.ts. Scope includes
every verified shared-wrapper call site, mcp/server.ts service-provider resolution and search-status/early search
validation; errors must follow the effective request format, including
get-example's wrapper, local research, read-file/resolveCodeTarget and invalid-input
paths. Existing public server APIs/ToolResult shape stay unchanged.
MCP SDK schema validation happens before these handlers and already returns an
SDK-authored text error prefixed “Input validation error”, not the package JSON
envelope. Preserve that boundary; do not patch or bypass SDK validation. Direct
CallableTool input.parse throws ZodError before handler execution; it is not an
MCP ToolResult and keeps its public exception contract. Test these boundaries
alongside package invalid-input results so no stronger guarantee is implied.

Ordered work:

1. Preserve typed error classification/metadata. Separate generated preparation
   wording from original backend hint/message. Avoid parsing or stripping the
   backend's English duration sentences. JSON retains them; human text uses
   structured indexing facts and actionable alternatives, not repeated prose.
2. Implement shared error text rendering and propagate effective output format
   at tool boundaries and server-side service-provider resolution. Explicit JSON
   continues through buildMcpErrorPayload; default text stays `isError`. Host-selected auth/terms actions and caller
   cancellation must survive. Never overwrite a more specific backend action.
3. For read, compose compact rows and native wait advice from the exact requested
   target and existing duration metadata. Account for no uniform entries but
   singular timing, no timing, elapsed-only evidence, and unavailable indexed
   alternatives. Preserve useful alternatives in readable output and JSON;
   never silently switch the requested version/ref. Replace read-file's action
   based on the just-failed wait with the metadata-derived recommendation; a
   zero-wait read must not suggest another zero-wait read.
4. Remove mixed CLI/MCP instructions and default progress IDs. Existing shared
   CLI indexing renderer callers must retain timing/ref recovery and a native
   millisecond --wait action in Phase 1, including code read/files/grep; search
   callers must use CLI seconds instead of inheriting the read millisecond
   action; the current shared renderer does not establish that conversion. This
   is shared error integration, not a search result-layout rewrite.
5. Apply the same preparation row to annotated readable code with pending
   refresh. Keep ordinary source stdout raw. Preserve binary/no-content paths
   and read continuation ranges; refresh does not imply missing content.
6. Update smoke probes that parse envelopes to request explicit JSON. Preserve
   assertCleanErrorEnvelope's exported signature and JSON semantics; add text-mode
   error coverage for default/explicit text, keeping auth and host remediation
   verifiable. Include scripts/mcp-smoke.ts's six envelope assertions and the
   manual scripts/code-diff-audit.ts failure cases that parse default code_diff
   output; request JSON there, preserving its existing SDK -32602 branch. Check
   all directly related smoke/parser callers, not just the probe.
7. Update implementation docs and obsolete JSON-always contract comments,
   including tools/mcp-cli-parity/unified-read/indexing-estimates. Add a notable
   change fragment with pending minor impact for both public artifacts, including
   the public smoke validation behavior for the revised default error contract.

Acceptance:

- Default and explicit text failures across MCP tools are readable; explicit
  JSON retains classification/retryability and all supplied metadata. No leaked credentials.
- Same pending read produces the same status/timing/action meaning in CLI/MCP,
  with one syntax per surface, correct units/cap, no repeated timing/hint/ID.
- Null legacy estimate plus populated uniform entries works; original singular
  error evidence works without fabricating a uniform backend field.
- Specific actionable backend guidance, available refs/versions, host auth/terms
  remediation and caller cancellation survive. Unrelated failures never claim
  indexing or recommend waiting by default.
- Raw/annotated source behavior, exit codes, read locators and range guidance stay
  correct. Core does not acquire a presentation-context dependency.

Verification: focused Bun tests for shared error helpers/read rendering and
changed tool/error callers, request-mode parity tests, CLI/MCP smoke, typecheck,
build and scoped Biome. Because smoke validation changes, also run
`bun run smoke:cli:built` and `bun run smoke:mcp:built` after build. Use current
helper tests and service-interface mocks.
Explicit omitted/text/json error modes must be covered, including early invalid
input, auth/terms, cancellation, indexed alternatives and unknown timing. Full
MCP error scope requires stable and local caller coverage, not just a read test,
including
omitted/text/json provider failures, local research early/mapped failures with
thread metadata, read-file early resolution/zero-wait advice, legacy CLI native
waits, and actual SDK invalid-input behavior. Run a targeted
local-dev read indexing workload via agent:e2e; inspect actual tool calls and
output. Warm or zero-call runs do not prove pending UX. Authenticated live
read checks use dev credentials/environment rules; if pending work is not
observable, report that limit and use verified fixtures for that branch.

## Phase 2 — list preparation without losing inventory

**Expected outcome:** users can distinguish pending inventory, an actually empty
inventory and readable pages during refresh; estimates survive either wait path.
Assumptions: SDL/error-extension forms above; paths-only mode remains raw.
Unknown/product decisions: none. Dependency: Phase 1 helper
and native error-format conventions, reorientation after its merge.

Likely files: core `list-service.ts`/`indexing-estimates.ts`, shared list error
mapper/text, list CLI/MCP boundaries and parity/service tests. Reuse/extract the
existing code-navigation error-duration decoder into the existing core timing
module only as needed; inherit its existing accepted alias set, add no new
aliases and no second duration model.

Ordered work:

1. Retain the verified singular duration extension in typed ListGraphQLError and
   mapped JSON details. Keep repo URL/indexed-version alternatives/hint when
   supplied; add regression responses proving the decoder does not drop them.
   Do not add wire selections or claim error extensions are uniform estimates.
2. Replace the misleading read-follow-up header for a pending empty inventory
   with an empty-yet outcome, preparation rows and one final action. A complete
   empty inventory must not suggest retrying; not-found/access/terminal failure
   must not be presented as preparation.
3. Keep existing inventory and read targets when entries are available. Show
   refresh work separately; it is not an Omitted scope and not proof that the
   returned pages are specific to a requested package version.
4. Keep the existing after cursor for pages available now; final retry advice
   describes a fresh first page only when preparation remains. Native leave-out
   cursor advice is conditional, short, and adjacent to the footer.
5. Preserve list --silent; update unified-list/indexing docs and add the next
   independent public-artifact change fragment.

Acceptance:

- Zero and positive waits yield equivalent human preparation meaning when the
  backend supplied equivalent evidence; JSON preserves their distinct shapes.
- Empty pending source/site inventories are distinct from completed empty ones.
- Available entries, canonical attribution, exact read/browse actions and cursor
  survive pending refresh. Site timing stays unsupported; no invented ETA.
- Native wait recommendation appears once at the end, with no irrelevant cursor
  instruction on a first-page request. Silent output contains paths only.

Verification: Bun service decoder/error mapper/list text/tool/CLI/parity cases
for zero/positive wait, bounds/history/elapsed, empty-ready/pending, pages+refresh,
first/continuation pages, terminal failures, explicit JSON and silent mode. Run
CLI/MCP smoke, typecheck/build/scoped formatting, and authenticated dev source/site
list when available. Inspect one target agent workload's actual wait/read actions;
no quality claim follows merely from process success.

## Later phases and reorientation

Phase 3 assumptions: existing search presentation retains lifecycle and per-target
readiness; searchRef and search-status are already the correct backend-supported
wait route. Unknowns: which current estimate placements actually duplicate target
state after the first two phases, resolved from rendered examples at that merge
boundary. Acceptance: same compact preparation vocabulary, correct attribution
for repository/hosted siblings and fallback commits, exactly one session-native
next action; no JSON/ranking/cursor/state loss. Keep initial/status text parity.
Detail files and steps only after reorientation; no schema or new polling.

Phase 4 assumptions: legacy code/docs commands consume the same timing module,
and shared error callers already inherit Phase 1. Unknowns: which annotations
still need edits; inspect only direct consumers of renderIndexingEstimates and
existing wait hints after Phase 3. Acceptance: remaining waiting text uses the
same total/elapsed/no-history meanings and native actions while preserving raw
content/path modes. Do not redesign healthy legacy result bodies or add deprecated
MCP tools. Implement one remaining formatter per increment; unchanged consumers
need no cosmetic migration. Details are intentionally deferred to reorientation.

## Cross-cutting limits and completion

- This is a presentation/verified decoding fix, with no infrastructure, added
  network calls, locks, cache or new automatic retries. Wait policy is unchanged.
- Explicit JSON/ToolResult/error codes remain programmatic contracts. Human action
  wording can change; no field removal or fabricated backend facts. Document the
  intentionally revised default-MCP error behavior and its compatibility impact.
- Sanitize terminal prose with the existing Unicode/control and width rules;
  preserve backend text in JSON and trusted follow-up operands without rebuilding
  them. Never print credential/environment values during verification.
- If fields needed for honest action/identity are absent, stop and request the
  concrete backend metadata rather than parse prose or invent another API.
- Do not use full-suite reruns or new benchmarks as plan phases. Focused behavioral
  evidence first; CI supplies full supported-platform/package checks.
- If Phase 1 approaches the project's 1.5-2k implementation-line threshold,
  stop and propose the existing split: shared format-respecting MCP errors, then
  read preparation/native CLI actions. Do not add mechanism to keep them together.
- No merge, release, publish or deploy is authorized by this planning task.
- After clean review of the last increment, move durable contracts to permanent
  implementation docs, move any major explicitly deferred work to the backlog,
  and delete this temporary plan in that PR's final commit.

## Plan review record

2026-10-05: internal code_reviewer preflight and revised whole-plan passes clean.
Claude Opus 5.5 round 1 found five valid gaps: smoke JSON assumptions, omitted
local/read error paths, legacy CLI actions, dynamic wait wording and selector-read
noun. All accepted and closed in the plan with bounded sibling scans.

Round 2 verified those closures and included one fresh-context final check. Its
three minor clarifications were applied: name the smoke/audit parser scripts,
preserve the audit SDK branch, and explicitly inherit existing decoder aliases.
No code or direction findings remain; round 2 is clean under the review policy.
The optional Phase 1 split is a size-gate contingency, not an additional phase or
a user-mandated boundary. Open product decisions: none. No production changes.
