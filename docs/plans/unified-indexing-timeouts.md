# Unified indexing waits and timeout handling

Status: IMPLEMENTED — verification complete; code review pending.
Date: 2026-10-08. Baseline: `7449018` on
`jlitola/fix-unify-indexing-timeouts`.

## Outcome and scope

Every CLI/MCP request that exposes a repository-indexing wait defaults to
30 seconds, preserves explicit zero, and uses one documented CLI unit. Internal,
GraphQL, and MCP `wait_timeout_ms` values remain milliseconds. HTTP deadlines
allow the requested wait to complete and classify deadline expiry as a timeout.

This is one implementation increment. Audit every command/tool, but distinguish
indexing preparation waits from HTTP request deadlines, research/generation
deadlines, login callbacks, subprocess probes, and local-only commands. No retries,
polling, new infrastructure, or backend schema changes are proposed.

## Verified current state

| Surface | Omitted indexing wait | CLI unit | Accepted maximum | HTTP budget |
| --- | --- | --- | --- | --- |
| `search` / MCP `search` | 30,000 ms in shared builder | seconds | 120,000 ms | max(120,000, wait + 30,000) |
| `search-status` / MCP `search_status` | 30,000 ms at adapters; direct service defaults to zero | seconds | 120,000 ms | max(120,000, wait + 30,000) |
| `read` / MCP `read` | 30,000 ms at adapters | milliseconds | 60,000 ms | 120,000 ms |
| `list` / MCP `list` | omitted; backend controls default | milliseconds | 300,000 ms | 120,000 ms, insufficient for maximum wait |
| `grep` / MCP `grep` | omitted; schema/doc describe zero for first page | milliseconds | 300,000 ms | max(120,000, wait + 30,000) |
| Legacy `code files`, `code read`, `code grep` | 30,000 ms in shared builders | milliseconds | 60,000 ms | 120,000 ms |

These are accepted **client input** maximums, not verified production proxy
budgets. Existing `tools.md:718-724` documents the standard 125-second origin
read limit and warns that even discovery's 120-second readiness wait can exceed
it after target resolution/response overhead. List/grep's advertised 300-second
inputs contradict that standard-edge budget. Extending list's client deadline
closes premature client expiry, but does not extend the edge limit or establish
production support. Keep the existing accepted inputs in this increment; retain
the 120-second maximum for generated list/grep wait recommendations. A limit
change or infrastructure/deployment change requires a separate user decision and
verified production route evidence. This audit makes no such change or guarantee.

All MCP wait fields explicitly use milliseconds. Grep continuation never waits
according to its tool parameter description; the new first-page default must not
change that backend behavior. List continuation uses `after`; preserve its wire
contract and verify readiness behavior before assigning a special cursor default.

Evidence:

- `packages/mcp/src/shared/code-navigation-defaults.ts`: default 30,000, navigation
  maximum 60,000, discovery maximum 120,000.
- `packages/mcp/src/shared/{list,grep}-request.ts`: optional wait omission and
  independent 300,000 ms bounds. Their tests explicitly assert omission.
- `packages/mcp/src/shared/{unified-search,read,list-files,grep-repo}-request.ts`:
  adapter/request-builder defaults.
- `src/commands/search.ts`: seconds parser, optional `s` suffix, seconds help.
  Other affected commands declare `--wait <ms>`.
- `packages/core-internal/src/services/{code-navigation,grep}-service.ts`:
  wait-dependent HTTP budgets; code navigation's direct `searchStatus` default is
  zero. Other optional direct-service waits are forwarded without normalization.
- `packages/core-internal/src/services/{list,read}-service.ts`: no wait-dependent
  deadline. Read's current supported maximum fits its existing HTTP budget.
- Retry guidance has unit branches in `indexing-estimates-text.ts`,
  `mapped-error-text.ts`, and `code-nav-cli-helpers.ts`, plus inline values in
  `grep-text.ts`, `unified-search-text.ts`, and legacy commands.
- Authored `skills/githits-code/SKILL.md` says list waits use milliseconds;
  `references/code-and-docs.md` documents seconds for search status and zero as
  unified grep's preparation default. These require a coordinated release-time
  update regardless of the chosen common CLI unit.

### Other tools and commands

| Group | Current deadline/behavior | Audit disposition |
| --- | --- | --- |
| `resolve` / `resolve_target`; `pkg info`, `vulns`, `deps`, `upgrade-review`, `changelog` and corresponding MCP tools | shared GraphQL HTTP default 120 seconds; no indexing-wait request field | Keep HTTP budget; do not invent backend indexing controls |
| Legacy `docs list`, `docs read` | shared GraphQL HTTP default 120 seconds; no wait field | Same; backend preparation internals are not established by this repository |
| `code diff` / `code_diff` | shared GraphQL HTTP default 120 seconds; documented separately from indexed navigation | Keep existing budget |
| `example` / `get_example` | REST HTTP default 240 seconds; no indexing-wait field | Keep generation budget; repository indexing inside the backend is unverified |
| `research`, including local experimental MCP tool | whole operation 210 seconds, including body and token refresh; no indexing-wait field | Keep research budget; do not replace it with a 30-second preparation wait |
| Auth/network settings operations | shared fetch HTTP default 120 seconds | Keep existing budget |
| Login callback, init probes, auth locks | independent callback/probe/lock budgets; units internally milliseconds | Outside repository indexing policy |
| Update check | 1-second metadata fetch budget | Outside repository indexing policy |
| `doctor`, quick start, local MCP startup and local-only command branches | local work; no repository indexing wait | No added network calls or eager configuration validation |

This inventory verifies client contracts, not backend internals. An endpoint with
no exposed wait argument cannot acquire a backend preparation limit through a
client-only constant change. Hosted behavior requires a later MCP package release,
dependency update in `remote-mcp`, and deployment, each separately authorized.

### Reproduced response-body timeout defect

`postPkgseerGraphql()` calls `response.text().catch(() => "")`. A loopback HTTP
fixture emitted partial JSON immediately and completed after 250 ms. With a
100 ms request deadline, the helper resolved after 102 ms with HTTP 200, empty
body, and `parsedBody: null`; it did not reject as a timeout. Real callers then
classify this as malformed data. This is a timeout-classification defect, not
evidence to add retries or reset data.

Baseline verification:

```sh
bun test packages/mcp/src/shared/list-request.test.ts packages/mcp/src/shared/grep-request.test.ts packages/core-internal/src/services/discovery-indexing-estimates.test.ts packages/core-internal/src/services/grep-service.test.ts src/commands/search-registration.test.ts
```

83 pass, 0 fail, 390 assertions. The loopback reproduction above is separate
diagnostic evidence, not a performance benchmark. No optimization is proposed.

The same loopback fixture through `GitHitsServiceImpl.search()` with a 100 ms
budget rejected after 107 ms with raw `TimeoutError`; `mapGitHitsServiceError()`
mapped it to `UNKNOWN`. Its `response.text()` occurs outside the request error
wrapper. This verifies a sibling defect on `example`/`get_example`, so the
implementation must fix that body-timeout mapping along with GraphQL. Research's
existing whole-operation deadline already wraps response consumption and refresh.

## Decisions and assumptions

User decision on 2026-10-08: use milliseconds everywhere for the smallest
change. Existing numeric search/search-status waits now mean milliseconds,
matching all other CLI commands. Reject the old seconds suffix with normal
integer-option validation; migration examples use `--wait 30000`.

Interpretation recorded explicitly: the requested 30-second default is the
backend indexing readiness wait. Retain existing longer HTTP deadlines and add
headroom where a supported wait currently exceeds them. This follows the
original indexing requirement and minimizes changes to other network operations;
it is not a blanket reduction of HTTP, generation, auth, or research deadlines.
No approval of merge, release, or deploy is inferred.

Assumptions supported by client evidence:

- Explicit zero remains the non-waiting request; defaulting uses `??`, not truthiness.
- Existing maximums remain surface-specific; unification of defaults and units does
  not justify raising/reducing supported ceilings or claiming proxy support.
- Preparation timeout progress/partial-result and terminal search lifecycle
  contracts stay intact. A backend `TIMEOUT` status is not a caller cancellation.
- All durations on wire and in public error details remain milliseconds.

Unknowns: backend-internal indexing on endpoints without wait fields. Backend unknowns do not justify a client field the schema does not expose.

## Target boundaries (recommended indexing-wait interpretation)

Core services own the preparation default and HTTP budget because direct service
users, root CLI, and hosted MCP composition must agree. Put the default beside the
existing core timeout policy and expose it through the existing private core
barrel. Re-export it from `code-navigation-defaults.ts` to preserve existing CLI/MCP
imports. Use one small pure HTTP budget function for requests with preparation
waits: `max(DEFAULT_FETCH_TIMEOUT_MS, effectiveWaitMs + 30_000)`.

Keep supported schema/input ceilings at the MCP shared-request layer, where they
are enforced today. Shared request builders normalize omitted wait to 30,000 ms;
core services also apply the same default for callers bypassing those builders.
There is one policy owner (the core constant), consulted at both boundaries:
public tool factories accept injected service implementations, so their existing
explicit normalized-default contract must remain intact; the concrete service
classes are also publicly exported at `@githits/mcp/client` (`client.ts:100-126`),
and their optional wait inputs must work without a tool factory. Do not add two
independent policies or a new obligation on injected service implementations.
Preserve zero. For grep, supply the default only to a fresh preparation request;
continuation preserves the verified non-waiting backend contract.

CLI input and retry text use milliseconds directly. Reuse the existing
`parseIntCliOption()` for search/search-status instead of adding a new parser;
other commands already use it. Remove seconds conversion and unit switches from
retry formatters. Reject `30s`/`30S`, documenting that numeric `--wait 30` now means
30 ms and the equivalent former 30-second request is `--wait 30000`. Do not
change MCP action values or JSON durations.

GraphQL transport owns response consumption and deadline classification. Keep
fetch headers and body under the same deadline and preserve caller cancellation.
Reuse/extend the existing timeout helper with a minimal response-consumption path
if necessary; do not change `fetchWithTimeout()`'s existing Response-returning
contract or add a second independent body timeout that restarts the budget.
GraphQL body expiry must reach existing service `TIMEOUT` mappings rather than
becoming empty content. The verified REST example sibling must also return the
existing typed timeout error instead of raw `TimeoutError`/`UNKNOWN`. Assess
directly shared REST consumers for the same defect class before choosing the
smallest common remedy; keep their independent default durations.

Keeping defaults only in MCP helpers would be simpler but would leave direct
`@githits/mcp/client` service callers inconsistent. Moving CLI unit parsing into
core would make transport-neutral services own a Commander concern.

## Phase 1 — consistent indexing waits and timeout results

Status: IMPLEMENTED; code review pending.
Expected outcome: omitted waits yield a 30-second readiness budget on every
supported indexing surface, explicit values work in one CLI unit, and HTTP
timeouts remain distinct from malformed responses and caller cancellation.
Dependencies: reviewed plan and recorded millisecond decision. Assumptions: those
above. Unknowns/product decisions: none for this increment; no new infrastructure.

Implementation sequence:

1. Add focused regressions for omitted/zero/explicit waits through shared builders
   and direct-service GraphQL variables. Include first-page grep and continuation.
2. Establish core default and shared HTTP headroom calculation; adopt it in search,
   search status, unified list/read/grep, and legacy list/read/grep service paths.
   Keep query selections and mode-specific fields unchanged.
3. Normalize list/grep defaults, retaining explicit zero and cursor contracts.
   Update MCP parameter descriptions and schema tests without changing tool names
   or standalone first discovery sentences.
4. Reuse the existing millisecond integer parser for search/search-status; list,
   read, grep, and code files/read/grep already use milliseconds. Update help, invalid-value messages, preparation
   actions, successful progress text, and all static retry examples together.
5. Fix the reproduced GraphQL body-timeout classification at the transport owner.
   Test headers, streaming body, caller cancellation, and ordinary malformed JSON
   separately. Fix the verified REST example body timeout in the same shared
   deadline handling; audit related REST consumers for the same timeout behavior.
6. Update durable docs (`tools.md`, `cli-commands.md`, `unified-list.md`,
   `unified-grep.md`, `unified-read.md`, `indexing-estimates.md`, and the wait mapping
   in `mcp-cli-parity.md`). Explain list's explicit default replacing prior omission
   in its implementation doc; keep generated wait recommendations within their
   existing 120-second cap. Mark the old wait contract in `docs/plans/unified-list.md`
   as superseded by this effort when implementation changes it, rather than leaving
   two conflicting current contracts. Record exact release-time corrections to
   `skills/githits-code/SKILL.md` and `references/code-and-docs.md` in durable docs
   and the change fragment. The repository's release skill prohibits publishing
   those behavior-dependent skill changes before the backing CLI behavior is
   released or included in the release being prepared. This timing requirement
   does not defer implementation. Follow plugin-maintenance for the eventual
   authored updates; never edit generated assets directly. If the stable MCP
   quick-start guide changes, update its builder and exact public skill copy in
   this PR under its explicit lifecycle exception.
7. Add independent release fragments for default/error fixes and CLI unit
   migration. Record honest per-artifact SemVer impact: changing interpretation of
   an existing numeric CLI option is a breaking change, not merely wording.
   Include the direct public client's `searchStatus()` omitted-wait change from
   zero to 30 seconds in the MCP release impact and compatibility notes.

Acceptance criteria:

- Omission forwards 30,000 ms through CLI, MCP, and direct indexing service calls;
  explicit zero stays zero. Grep continuation does not acquire a preparation wait.
- Help and emitted retry commands use the selected CLI unit consistently. A retry
  value displayed by each surface parses back to the same effective wait.
  The milliseconds migration rejects the old `s` suffix and documents its removal.
- Existing max, fractional/negative/malformed input, empty optional/cursor inputs,
  and exact backend locators retain their documented validation/meaning.
- At default and each accepted client input maximum, HTTP budget exceeds the readiness wait
  by at least the established 30-second headroom; caller cancellation remains
  cancellation and body expiry maps to `TIMEOUT`. This asserts client construction,
  not production-edge support. HTTP/edge failures retain their ordinary mappings;
  do not relabel every edge 5xx as a local `TIMEOUT`. Existing 300-second list/grep
  inputs remain explicitly unverified through standard production edge routing.
- No unnecessary query fields, retries, new network calls on local branches,
  or changes to authentication/storage timing.
- Focused shared-builder, service, command, tool, formatter, cancellation, and
  wire-variable tests pass with `bun test`; `bun run typecheck` and
  `bun run build` pass. Run `bun run smoke:cli` and `bun run smoke:mcp`, including
  unauthenticated auth handling; authenticated live tests only when available.
- Run descriptor-driven `bun run agent:e2e` for the changed wait/default behavior
  using targeted workloads selected from `eval/agentic/README.md`; inspect actual
  tool args/final answer/metrics/isolation violations. Do not claim quality without
  grading. If authored skills change, run generator/check/parity and lifecycle
  validation required by the maintenance skill, including its full `bun test`.
- Public-package checks prove private core constants/helpers do not leak private
  aliases into published JS/declarations/manifests.

## Review, completion, and cleanup

Internal technical plan review: direction sound; one suffix-compatibility finding
accepted and added to parser requirements/acceptance criteria. No other findings.
External Claude plan review: clean after two rounds. Round 1 accepted client-vs-edge
budget precision and documentation-scope findings; clarified one core policy at
both public boundaries using exported concrete classes and injected tool factories.
Round 2 accepted every closure and raised only minor current-status corrections:
recorded published list packages versus unverified hosted adoption in the older
list plan, and updated this review record. Those corrections are applied. No
production tests were rerun during review; baseline evidence is recorded above.
User selected milliseconds. Readiness-wait interpretation is recorded above.
Production implementation is complete. Internal code review found no production
issues; corrected two retry tests that matched seconds as a substring of milliseconds
and one current-policy documentation sentence. The bounded sibling scan preserved
dated historical observations; the two affected test files passed (77 tests).
External code review is pending.

If decisions change the deadline goal or reveal an endpoint requiring backend work,
revise the plan before implementation. At code review, reassess ownership if the
fix starts adding mechanisms or crossing unrelated timeout domains.

Complete after one reviewed implementation PR with required verification and
updated permanent docs. After the final code review is clean, transfer remaining
durable policy/evidence to `docs/implementation/`, move any substantial open items
to `docs/plans/open-backlog.md`, and delete this plan in a final commit in that PR.
No deferred implementation items are currently accepted. Merge, release, and
deployment remain separate user approvals.

## Implementation verification (2026-10-08)

The implementation uses the existing millisecond CLI parser and timeout helper.
The core default is re-exported through its existing browser-safe entrypoint for
MCP shared code. No new parser module, retry policy, or infrastructure was added.

- `bun test`: 5659 pass, 0 fail, 22536 assertions across 236 files.
- `bun run typecheck`: pass.
- `bun run build` and `bun run --cwd packages/mcp build`: pass.
- `bun run validate:packages`: pass after correcting the default's MCP import
  from the full core barrel to the existing browser-safe core barrel. The first
  validator run caught Node dependencies in the browser tools bundle; the fix
  preserves the same core-owned constant rather than duplicating it.
- Source `bun run smoke:cli --mode unauthenticated` and
  `bun run smoke:mcp --mode registration`: pass with `GITHITS_ENV=dev` and inherited
  endpoint overrides removed. These modes validate local/auth behavior without
  claiming authenticated production/dev backend coverage.
- `GITHITS_ENV=dev bun run agent:e2e --agent claude --surface mcp --server local
  --guidance-profile descriptors --timeout 180 --workload
  eval/agentic/workloads/code-grep-investigation.md --out
  .agent-eval/runs/unified-indexing-timeouts-claude`: attempted. The process failed
  because the isolated Claude CLI is not logged in; zero tool calls, no final.json
  or isolation-violations.json. Harness command exit zero is not a successful
  behavioral eval. Metrics show one failed workload; no usefulness/quality claim.

No authenticated live indexing/proxy rollout claim is made. Public CLI skill
corrections remain release-gated and are recorded in permanent tool docs and
independent release fragments. Historical snapshot verification using seconds
remains historical; current CLI documentation uses milliseconds.
