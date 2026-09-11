# Discovery indexing estimate adoption

## Objective and status

Status: IN PROGRESS: initial estimate adoption is complete in draft PR #389;
the user-requested five-minute extension is specified below. Earlier 60-second
constraints in the initial implementation record are superseded by that extension.
Outcome: initial discovery search and subsequent status responses preserve backend
indexing duration evidence in CLI/MCP JSON and use it for consistent bounded follow-up
wait guidance. Product decisions: none; the handoff explicitly specifies the policy.

## Verified evidence and assumptions

- Baseline: `0c34ad4`, clean worktree; fetched origin/main matches. GitHub confirms
  #386 merged as `9697466`, an ancestor of this baseline. Its current defaults are
  30 seconds, maximum 60 seconds. Commit `1a2b440` records the deferral in
  its body and durable tools docs. No cap change is required.
- Backend #2460 merged as `88f5be5a`. Its owning-repository
  `docs/implementation/DISCOVERY_SEARCH.md` was read through GitHub at that commit.
  Both `search.progress` and `discoverySearchProgress` expose the same typed list.
- User-supplied dev verification reports deployed descendant `dd6daac`, HTTP 200
  initial/progress range evidence alongside interim hits, unsupported hosted docs,
  completed empty estimates, and unchanged missing-reference NOT_FOUND behavior.
  Production deployment is NOT verified. Selecting the field on an older schema
  fails validation. Production backend rollout on all serving nodes is a client
  release/adoption prerequisite; no speculative schema fallback will be added.
- Bounds are total repository execution seconds, not remaining duration/search ETA.
  Active elapsed seconds can be absent; search elapsedMs must never be subtracted.
  NO_HISTORY may carry elapsed-only evidence, UNSUPPORTED_WORK has no estimate.
- Missing/empty lists do not decide lifecycle. Existing active/terminal/unknown and
  completed evidence-notice policies remain authoritative, including DEFERRED mapping.

## Ownership and architecture

The core code-navigation service owns GraphQL selection, validation, and typed
normalization. Reuse its existing duration estimate schema/normalizer and select
one shared discovery estimate fragment in both queries. Preserve identities,
target labels, nullable timing/provenance and unavailable reasons in typed optional
fields following existing normalization conventions. The wire schema requires the
non-null array, required closed kind enum and target labels; nullable fields follow
the backend contract. A missing selected list is malformed, and an explicit empty
list stays empty. The internal service progress interface remains additive/optional
for existing service providers; absent internal evidence keeps default guidance. This
is not old-schema compatibility.

The MCP shared layer owns CLI/MCP continuation policy. Add one pure
`discovery-indexing-wait.ts` helper used by response JSON guidance and presentation
poll actions. The renderer consumes the action's selected wait and only converts
milliseconds to CLI seconds. Putting this in the core service would couple transport
data to client wait limits; renderer-only calculation would duplicate JSON policy.

All selected fields have consumers: upper bounds drive guidance in every mode, and
JSON retains the full identity/timing/provenance evidence. No per-mode extra query is
needed. No new infrastructure, retries, flags, automatic polling, dependencies,
public descriptors, stable instructions, skills, or generated assets are planned.

## Initial implementation: consistent estimates and bounded follow-up guidance

Status: COMPLETE. Dependencies: existing shared response/presentation flow
and backend contract above. Assumptions: 30-second default and 60-second cap remain
supported; existing lifecycle rules remain unchanged. Unknowns: production deployment
and greater-than-60-second end-to-end timeout support are external release constraints,
not implementation prerequisites. Product decisions: none.

Implemented scope:
1. Extended service interfaces, both wire queries, Zod validation and normalization.
2. Preserved estimates in shared progress JSON. Guidance uses the largest
   numeric upperSeconds plus 10 seconds, rounded up to a ten-second boundary.
   Fully covered ranges may select less than 30 seconds (upper 0 -> 10 seconds).
   With missing ranges, apply the default as a floor. With no ranges, return the
   default unchanged. Clamp to MAX_WAIT_TIMEOUT_MS; never sum or subtract elapsed.
3. Carried the computed wait in active poll actions. Keep completed evidence retrieval
   on the existing default, and preserve terminal/unknown behavior. Update renderer
   CLI seconds and MCP milliseconds from the shared action value.
4. Added service wire/decoding tests on initial and status paths, response and policy
   tests, presentation/text and actual CLI/MCP consumer coverage. Cover numeric,
   unavailable/elapsed-only, mixed, null commit, shared labels, empty/absent lists,
   rounding/capping, initial/subsequent, partial/provisional evidence, malformed missing wire lists, errors,
   completed and terminal states. Keep existing over-fetch selection tests intact.
5. Updated both durable tools.md and cli-commands.md fixed-guidance contracts and add a dual-package patch fragment.
   Replace the prior tools.md deferral with the adopted contract. State backend
   production deployment prerequisite and unchanged wait cap; correct the cap comment
   to describe client support rather than the now-outdated backend ceiling.

Acceptance:
- Both actual query paths select/decode estimates; CLI/MCP JSON preserves evidence.
- All guidance agrees (CLI seconds, MCP milliseconds), including 44s -> 60s,
  40s -> 50s, unavailable-only -> 30s, and mixed low range -> >=30s.
- Bounds never become a search ETA; available interim evidence remains usable;
  no estimate content can reactivate terminal refs or complete an active search.
- Focused tests, full `bun test`, typecheck, lint/format, build and package validation
  pass. Required source smoke CLI/MCP suites run unauthenticated and against dev when
  authentication is available; live validation never uses production or prints secrets.
- Targeted local `bun run agent:e2e` runs against dev where available; inspect
  tool-calls, final, metrics and isolation artifacts. Report limitations honestly.
- Internal preflight and one external reviewer per round converge; draft PR is opened.

## Operational and completion boundaries

No release, deployment, merge, tag or publish is authorized. Keep 60-second cap;
raising it requires verifying validators/help/request timeout, MCP host/proxy chain
and Cloudflare long-wait behavior in a separate approved scope. Roll back client
adoption if backend support is absent; do not invent estimates or schema fallbacks.

At implementation completion replace this plan's status with measured evidence and
review outcomes. Keep it through PR review and merge. Once the last increment merges,
transfer any lasting knowledge to docs/implementation and delete this temporary plan.
Refactoring opportunities: none established beyond the small shared wait policy helper.

## Plan review record

Internal preflight: accepted explicit non-null wire validation and naming both durable
documents. Kept the internal progress type optional for additive service-provider
compatibility; this does not weaken wire validation. Neither finding is blocking/high:
the documentation remedy is small, and the wire contract is resolved before code.

External Fable plan round 1 (2026-09-11): clean after two minor clarifications:
fully numeric evidence can lower the suggested wait, and tests now explicitly live
in core `services/discovery-indexing-estimates.test.ts`, shared
`discovery-indexing-wait.test.ts`, and root `tools/discovery-indexing-estimates-parity.test.ts`.
Rejected open-ended kind decoding: no new producer kinds were evidenced and this is
a closed typed contract, unlike deliberately open lifecycle statuses. Rejected the
claim that IndexingDurationEstimate lacks sampleCount/source: both already exist
in the current interface/schema/normalizer. These findings remain rejected without
new evidence. The first test run before implementation had 2 pass, 25 fail and one
missing-module error, establishing that existing code drops timing evidence.

## Implementation and acceptance evidence

The implementation now selects the same estimate fragment in both queries, validates
required lists, normalizes optional timing and preserves progress evidence in JSON.
One pure shared policy supplies JSON continuation and typed presentation actions;
text only converts units. Existing lifecycle gates and request defaults are unchanged.

Validation so far: focused service/policy/presentation/parity suite 222 passed;
completion and smoke-helper suite 118 passed; full `bun test` 4,639 passed, zero
failures. Typecheck, build, lint/format and `bun run validate:packages` passed.
Lint reports existing warnings in untouched repository-target files; owned-file
Biome checks are clean. A later provisional fixture strengthening passed 20 parity
tests. Source unauthenticated CLI smoke and MCP registration smoke passed.

Initial live dev direct search returned AUTH_REQUIRED; later unchanged-source retry
succeeded after CLI dev smoke passed. The root cause of the first credential lookup
failure is unestablished; no auth changes or retry mechanism were introduced.
Dev search `router` over `github:expressjs/express#4.9.0` and `npm:fastify@5.0.1`,
allow-partial/wait 0, returned seven interim hits, INDEXING, repository range 10-44s,
sampleCount 30/source same_repository_refs, and next wait 60000ms. The CLI live smoke
passed all 110 steps (stable and experimental cohorts). Initial MCP live smoke timed
out at search_language (SDK 60000ms); CLI observed that request take 73s and later
language requests about 1s, and the full MCP smoke retry passed all 59 steps (stable and experimental).

Targeted local Codex descriptor eval `express-router` passed: 110.6s, 12 completed
MCP calls, no CLI calls/errors, high confidence; final answer identified Express 5's
router dependency and contrasted Express 4. Artifacts at
`.agent-eval/runs/2026-09-11T09-18-44-657Z` were inspected: tool-calls, final, metrics
and report. `validationViolations: []`; no isolation-violations file was generated.
This ready-target workload does not establish adaptive polling behavior; deterministic
parity tests and the live pending-target probe cover that. No answer-quality grading
stage ran. Internal changed-delta code review: no findings.

Final live verification at implementation commit `1071a2d`:

- Subsequent two-target discovery status returned ten interim hits, retained the
  10-44s bounds with active elapsed43s, and still suggested60000ms. Later service
  status decoded COMPLETED with `indexingEstimates: []`. No stopped ref was polled.
- `hex:jason@1.0.1` DOCS initial progress returned DOCUMENTATION/UNSUPPORTED_WORK
  without normalized estimate, alongside repository8-27s/sampleCount6 and no active
  elapsed, suggesting40000ms. Its later MCP tool response returned six completed
  results with no continuation. Live NO_HISTORY and retained-terminal estimates were
  not observed; committed wire/policy/parity cases cover those documented shapes.
- Final typecheck after the test-only provisional-fixture strengthening passed.
- Opus code review round1: clean on `origin/main...1071a2d`, including one permitted
  fresh-context full-delta check (66 focused tests passed). The awareness-only
  negative-upper-bound note was rejected: no negative duration producer input was
  evidenced, it violates total-execution semantics, and the bounded consequence is
  only an advisory short wait. No guard or scope expansion was added. No findings
  remain; internal preflight was also clean. Reviewer retained for PR follow-up.

All implementation acceptance criteria are met; production deployment remains an
explicit external release/adoption prerequisite, not an uncompleted client change.
The 60-second cap remains intentionally unchanged, with larger timeout-chain
validation outside this increment as authorized in the handoff. No new refactoring
opportunity was established. The final documentation-only update records measured
evidence and completion; it changes no scope/architecture/acceptance criterion and
does not require another plan or code review. Keep this plan until the PR merges.

## User-requested five-minute extension (in progress)

The user now requests raising the discovery upper range in this PR. This supersedes
this plan's earlier 60-second discovery-cap non-goal. Scope is search/search-status
and their estimate-driven continuation; other navigation limits remain unchanged.

Verified: backend #2458 merged as 435fd51e, accepts 300000ms readiness waits with
unchanged defaults and Fly idle allowance420s. Shared client GraphQL currently has
120s request timeout. Search MCP hardcodes max60000 while status uses shared max;
CLI parsing/help uses60 seconds. Hosted githits-remote-mcp source uses shared package
services and SSE keepalives every15s; Bun server idle255s is therefore not a silent
SSE connection, but production backend routing defaults to pkgseer.dev, whose zone
allowance remains unverified. Dev backend routing bypasses that proxy. MCP SDK
caller default60s is caller-owned; package code cannot override an external host.

Ownership: discovery policy owns its supported wait cap; core service owns the HTTP
request deadline for its wait operation; the CLI fetch adapter owns Node/Undici
socket deadlines. Keep the ordinary request deadlines and other operations' caps.
No new scheduling, polling, recovery or schema fallback is needed.

Planned changes:
- Add MAX_DISCOVERY_WAIT_TIMEOUT_MS=300000 in existing shared defaults; use only for
  search/status validators, CLI help/parser and discovery wait suggestions.
- Pass request-specific timeouts through the existing GraphQL helper, including its
  existing target-resolution fallback. Discovery uses max(120000,wait+30000), giving
  330000ms at the cap. Other requests retain120000ms.
- Node24.15 native fetch failed a 310s delayed response with UND_ERR_HEADERS_TIMEOUT
  after301031ms; a301s response had narrowly succeeded. Its300s header timeout is
  therefore a real boundary, not a backend issue. Existing fetchWithTimeout will
  mark requests exceeding the ordinary120s budget with Bun's timeout:false
  extension while retaining its finite
  AbortSignal deadline. Existing CLI fetch adapter honors that marker on Node via
  a per-request dispatcher interceptor disabling competing header/body deadlines,
  preserving the selected global/native-env-proxy or explicit proxy dispatcher.
  No global dispatcher mutation, new pool, cache or recovery path is needed.
  Hosted Bun uses timeout:false directly; other injected Node fetch hosts must
  configure their own dispatcher deadlines before adopting the long cap.
- Carry optional caller cancellation through UnifiedSearchReadOptions and the
  existing GraphQL helper/fallback into fetchWithTimeout. MCP tools supply their
  context.signal. Request ownership belongs to the service; threading a signal
  across these existing boundaries preserves ownership rather than moving policy.
  Caller cancellation must abort upstream work rather than leaving a330s request.
- Cover long-range arithmetic,300-second CLI/300000-ms MCP boundaries, default
  unchanged, over-cap rejection, service wire wait + actual AbortSignal timeout,
  both query paths and fallback. Add transport regression if the probe proves needed.
- Refresh durable docs, existing fragment and PR; keep production backend + proxy
  support and external MCP host deadlines explicit release/adoption requirements.
- Reuse retained reviewers, run affected/full tests/build/package validation and
  source smoke, targeted agent eval, then converge review and PR CI again.

Unknowns: production proxy configuration and external MCP caller deadlines remain
external release gates. Native Node failure is reproduced; Bun timeout:false is
verified in installed Bun1.3.14: a310s delayed response succeeded HTTP200 after
310034ms with timeout:false and a330s AbortSignal. A local Node interceptor probe
returned HTTP200 and preserved the global dispatcher; long verification follows
implementation of the same adapter path.
No unresolved product decisions; no new infrastructure.

Internal extension preflight accepted caller-signal propagation and clarified host
ownership. Severity is medium rather than blocking: caller timeout is bounded
resource waste, not demonstrated service failure. Small fix remains in scope.

External Fable extension review: design accepted except a claimed native-env-proxy
bypass. Rejected with direct Node24.15 evidence: native dispatcher and npm Undici
getGlobalDispatcher are the identical EnvHttpProxyAgent; both native fetch and the
composed-dispatcher request returned HTTP200 through a local CONNECT proxy (two
proxy connections). The initial test proxy lacked CONNECT support and timed out;
adding the required CONNECT handler established the actual route. Version-skew
concern remains covered by existing supported-Node smoke, not a second transport.
Accepted the narrow advisory to mark only timeouts exceeding120000ms, preserving
ordinary requests exactly. No new architecture or acceptance change; plan ready.
The retained Fable terminal had exited; its failed reuse was recovered by one new
Fable terminal for this review, without review fanout.

Implementation transport check: Bun's built-in Undici compatibility does not expose
Dispatcher.prototype.compose even though installed npm Undici does. The adapter
therefore wraps the stable dispatch method directly, retaining all other dispatcher
properties. This stays in the same host-owned boundary, adds no dependency/pool or
fallback, and passes Node/proxy policy unit cases. Ordinary requests are unmarked.

### Extension implementation and verification

Implementation complete; external code review and PR CI pending.

- Discovery cap300000ms/CLI300s and guidance share MAX_DISCOVERY_WAIT_TIMEOUT_MS;
  ordinary code-navigation caps and30s defaults are unchanged. HTTP budgets are
  max120000,wait+30000 and both fallback paths preserve deadline and caller signal.
- Internal implementation preflight found cancellation was wrapped as NETWORK after
  aborting fetch. Fixed at the low-level GraphQL helper before transport wrapping;
  actual tool-through-service tests preserve the exact caller reason. Follow-up
  internal review clean. Calibrated medium: bounded canceled-call failure, small fix.
- Final bun test:4673 pass,0 fail,16337 assertions across207 files. Typecheck, build,
  format and lint pass; lint retains12 warnings/1info in untouched files.
  Public package validation passes. Source Node proxy smoke passes with marked
  HTTP,HTTPS and NO_PROXY requests. Built CLI unauthenticated and MCP registration
  smoke pass. No skill/instruction numeric cap references needed changing.
- Final Node24.15 adapter310s response:HTTP200 after310038ms (baseline failed after
 301031ms); Bun1.3.14 timeout:false response:HTTP200 after310034ms. These local
  probes verify client transport, not production routing or five-minute backend work.
- Dev CLI initial --wait300 on Express4.8.0 returned10 interim hits at17.6s,
  INDEXING/PROVISIONAL, range10-46s/sample30 and suggestion60000ms. Subsequent
  --wait300 returned completed. No completed ref was polled again.
- First live CLI/MCP smoke attempts hit a dev file-read UPSTREAM_ERROR for existing
  npm:express@5.2.1 package.json. Direct full-file and exact1-5-line retries passed;
  CLI full rerun passed110steps. Root cause of that backend response is unestablished;
  it is separate from discovery wait support and no product retry was introduced.
- Codex targeted experimental-MCP eval used search wait_timeout_ms300000 and completed
  with4 calls,0 errors,46.5s,high self-reported confidence and validationViolations[].
  Inspected tool-calls,final,metrics/report in .agent-eval/runs/2026-09-11T10-36-51-096Z;
  no isolation-violations file was emitted. The ready result needed no continuation;
  long pending guidance is covered by deterministic parity and transport tests.
  No answer-quality grading was run. Earlier ordinary Express eval did not expose
  search and had4 failed reads; it is not evidence for this feature's agent behavior.
- Release prerequisites remain production backend schema/wait deployment, Cloudflare
  route allowance, compatible MCP caller deadlines, and hosted MCP package adoption.
  No merge, version bump, release, publish or deployment is authorized here.
