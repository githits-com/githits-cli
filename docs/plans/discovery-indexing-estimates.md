# Discovery indexing estimate adoption

## Objective and status

Status: IN PROGRESS; plan review complete, one implementation increment.
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

## Single phase: consistent estimates and bounded follow-up guidance

Status: IN PROGRESS. Dependencies: existing shared response/presentation flow
and backend contract above. Assumptions: 30-second default and 60-second cap remain
supported; existing lifecycle rules remain unchanged. Unknowns: production deployment
and greater-than-60-second end-to-end timeout support are external release constraints,
not implementation prerequisites. Product decisions: none.

Implementation:
1. Extend service interfaces, both wire queries, Zod validation and normalization.
2. Preserve estimates in shared progress JSON. Compute guidance using the largest
   numeric upperSeconds plus 10 seconds, rounded up to a ten-second boundary.
   Fully covered ranges may select less than 30 seconds (upper 0 -> 10 seconds).
   With missing ranges, apply the default as a floor. With no ranges, return the
   default unchanged. Clamp to MAX_WAIT_TIMEOUT_MS; never sum or subtract elapsed.
3. Carry the computed wait in active poll actions. Keep completed evidence retrieval
   on the existing default, and preserve terminal/unknown behavior. Update renderer
   CLI seconds and MCP milliseconds from the shared action value.
4. Add service wire/decoding tests on initial and status paths, response and policy
   tests, presentation/text and actual CLI/MCP consumer coverage. Cover numeric,
   unavailable/elapsed-only, mixed, null commit, shared labels, empty/absent lists,
   rounding/capping, initial/subsequent, partial/provisional evidence, malformed missing wire lists, errors,
   completed and terminal states. Keep existing over-fetch selection tests intact.
5. Update both durable tools.md and cli-commands.md fixed-guidance contracts and add a dual-package patch fragment.
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

## Implementation evidence (in progress)

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
language requests about 1s, so a targeted full MCP smoke retry is running.

Targeted local Codex descriptor eval `express-router` passed: 110.6s, 12 completed
MCP calls, no CLI calls/errors, high confidence; final answer identified Express 5's
router dependency and contrasted Express 4. Artifacts at
`.agent-eval/runs/2026-09-11T09-18-44-657Z` were inspected: tool-calls, final, metrics
and report. `validationViolations: []`; no isolation-violations file was generated.
This ready-target workload does not establish adaptive polling behavior; deterministic
parity tests and the live pending-target probe cover that. No answer-quality grading
stage ran. Internal changed-delta code review: no findings.
