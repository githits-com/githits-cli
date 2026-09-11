# Discovery indexing estimates and bounded waits

## Objective and status

Status: implementation complete; final review and PR CI pending in draft PR #389.
Outcome: CLI/MCP initial search and subsequent status preserve backend indexing
estimates and share useful follow-up waits, capped at the user-selected 120 seconds.
Default waits remain 30 seconds. Product decisions: none.

The initial estimate implementation was committed as1071a2d and reviewed clean.
The user subsequently requested a300-second cap, then revised it to120 seconds
because the production route uses Cloudflare. The120-second scope below supersedes
both the original60-second constraint and the intermediate300-second implementation.
No five-minute socket adapter, timeout marker, proxy bypass or new dependency remains.

## Verified contract and assumptions

- Baseline main0c34ad4 includes CLI PR #386 (9697466); prior commit1a2b440 recorded
  estimate adoption deferral. Default30 seconds and initial maximum60 were verified
  in the repository. Public skill claims of default20 were stale.
- Backend #2460 merged as88f5be5a and exposes the same non-null typed
  indexingEstimates list on initial search.progress and discoverySearchProgress.
  Its schema and implementation docs were read through owning-repository GitHub.
  Entry kind is REPOSITORY/DOCUMENTATION; targets are required; repository URL,
  commit, timing and unavailableReason are nullable. Unsupported unknown kind
  handling is not required by this closed producer contract.
- Bounds are TOTAL repository execution seconds, not remaining duration or a
  search ETA. Active elapsed may be absent while queued/retrying/unobservable.
  Neither active elapsed nor search elapsedMs is subtracted. Preserve sampleCount
  and source provenance; NO_HISTORY may carry elapsed-only evidence, while hosted
  documentation can report UNSUPPORTED_WORK without an estimate.
- Pending work can coexist with partial/provisional/stale usable evidence. Target
  labels can share a snapshot; independent jobs are not summed. Missing or empty
  entries never establish completion. Existing active/terminal/unknown lifecycle
  and completed evidence-notice rules remain authoritative, including the existing
  public DEFERRED-to-TIMEOUT mapping.
- Backend #2458 supports300000ms waits with unchanged defaults and Fly idle420s.
  Dev deployment and live checks are verified; production schema rollout is not.
  An older production schema rejects the new selection. Deploy on every serving
  node before client release/adoption; no speculative schema fallback is added.
- Cloudflare's standard origin proxy read timeout is125 seconds, configurable only
  for Enterprise zones. Verified2026-09-11 against the official page, updated
  2026-07-23: https://developers.cloudflare.com/fundamentals/reference/connection-limits/
  The user's120-second readiness cap leaves at most5 seconds for other origin work.
  Cold resolution plus readiness can still exceed that budget; production route
  timing remains an adoption check. A150-second client deadline does not extend
  Cloudflare's125-second origin limit.
- MCP callers own their request deadlines. The SDK default60 seconds cannot sustain
  the longest wait; caller configuration must allow the requested wait and headroom.
  Hosted MCP adopts this implementation only after package release, dependency update
  and deployment in its owning repository.

## Ownership and implementation

The core code-navigation service owns shared GraphQL selection, validation and
normalization. Both actual query paths select the same duration fields, preserve
identities/provenance/unavailability, and validate the non-null wire list. The
internal progress interface remains additive/optional for injected services;
absence there keeps default guidance, not old-schema compatibility. Every selected
field has a consumer: bounds drive all guidance; JSON retains the full evidence.

The MCP shared layer owns CLI/MCP continuation policy. One pure
`discovery-indexing-wait.ts` helper takes the largest numeric upper bound, adds10
seconds, rounds upward to10 seconds, and caps at MAX_DISCOVERY_WAIT_TIMEOUT_MS120000.
Mixed missing ranges apply the30-second floor; no ranges retain30 seconds exactly.
Fully covered short ranges may suggest less than30 seconds. Response JSON and
presentation use this same policy; the renderer only converts milliseconds to CLI
seconds. Core-only policy would couple transport data to client limits; renderer-only
policy would duplicate JSON behavior.

Discovery owns its120-second validator/help/guidance cap in existing shared defaults.
Other navigation limits remain60 seconds. The core service owns per-request HTTP
headroom: max(120000, waitTimeoutMs +30000), or150000ms at the cap, forwarded through
both queries and existing target-resolution fallback. Ordinary deadlines remain120s.
Standard socket timeouts need no changes at this budget.

Caller cancellation belongs to the request. MCP context.signal reaches service read
options and the GraphQL helper. The helper preserves the exact caller reason before
transport wrapping and after response-body reads; cancellation cannot become a
retryable network or malformed-response tool result. No cause-chain walker or new
infrastructure is needed.

Public skills own agent guidance. Two stale default20/range0to60 claims now point to
the rendered continuation and installed search-status --help. This is accurate for
released clients and the revised client, without advertising an unreleased cap on
skills.sh. Stable MCP instructions and generated manifests are unchanged.

## Acceptance and verification

Implementation acceptance:
- Both wire queries select/decode numeric, unavailable/mixed and nullable evidence;
  actual CLI/MCP JSON preserves it, including partial/provisional results.
- Initial/subsequent JSON and text agree on bounded guidance and units. Examples:
  upper44 ->60 seconds; upper80 ->90; upper110 or higher ->at most120.
  No ranges ->30; terminal/unknown refs never become pollable due to timing.
- CLI120s and MCP120000ms are accepted;121s/120001ms and invalid integers reject.
  Default30s, completed evidence retrieval and other navigation caps stay unchanged.
- Per-request deadlines, fallback propagation and cancellation during headers/body
  are covered through service and real tool-to-service tests.
- No obsolete five-minute socket machinery remains; docs and PR state rollout limits.

Current verification:
- `bun test`:4671 pass,0 fail,16324 assertions across207 files.
  Focused wire/policy/parity/cancellation suite:96 pass,0 fail.
- Typecheck, build, format and lint pass. Lint retains12 warnings/1info in untouched
  files. Public-package validation and plugin generation/check pass; generation
  produces no manifest changes.
- Local actual MCP tool ->real service ->Node HTTP delayed response completed after
  122029ms with wait120000 and caller timeout150000. This verifies client headroom,
  not production routing. Earlier310s Node/Bun/MCP probes apply only to the
  superseded300-second implementation and are not shipped-cap evidence.
- Current dev source CLI/MCP smoke and focused MCP/skills agent evals are recorded
  below as they finish. Earlier full live reruns passed110 CLI/59 MCP steps after
  a separate backend indexed-file UPSTREAM_ERROR. Exact full-file/1-5-line retries
  passed; that backend response's root cause is unestablished. No retry workaround
  was added to product code.
- Original live estimate probes verified interim hits with repository ranges,
  unchanged bounds on subsequent status, unsupported hosted docs, and completed
  empty lists. Live NO_HISTORY/retained-terminal timing were not observed;
  committed backend wire tests and client contract/parity tests cover those shapes.

## Review and completion

Initial estimate code review was clean. The300-second review was stopped when the
user revised scope; its socket findings became obsolete. Accepted relevant findings:
fix stale public skill text, preserve exact caller cancellation before domain wrapping,
and cover body-phase cancellation. Both body-phase red tests reproduced the swallowed
abort before the one-line helper correction.

Final120-second plan review: internal preflight clean; retained Fable clean after its
minor note to update public smoke continuation samples (now90000/120000). Final
implementation preflight is clean; retained Opus review is pending. No new architecture
or infrastructure is proposed. Reject speculative negative-duration/unknown-kind
producer compatibility without new evidence, as already adjudicated.

Keep this plan through PR review; remove only after merge. Durable behavior and
release constraints are in docs/implementation/tools.md and cli-commands.md, with
one dual-package patch fragment. Completion requires final tests/review and green
PR CI. Merge, release, publish and deployment require separate user approval.

Final120-second live verification:
- Source CLI smoke passed110steps; MCP smoke passed59steps on dev, using explicit
  dev MCP/API/code-navigation URLs. Logs /tmp/discovery-120-{cli,mcp}-smoke.log.
- Targeted MCP eval2026-09-11T10-56-02-345Z actually used wait_timeout_ms120000,
  succeeded with7calls/0errors in62.5s, and returned grounded source evidence.
- Skills eval initially verified help but could not access auth inside isolation.
  Reran through documented GITHITS_API_TOKEN automation support, transferring the
  existing container token only in child-process memory, never output or persisted.
  Run2026-09-11T10-58-54-007Z checked search-status --help and used --wait120;
  search completed with exact served source,5CLI calls/0errors in64.7s.
- Inspected tool-calls,final,metrics/report for both successful runs: high
  self-reported confidence, validationViolations[], no isolation artifact emitted.
  Ready searches needed no status continuation; deterministic tests cover pending
  policy. No later answer-quality grading ran.
- Consolidated this plan around the final scope after the user correction; this
  documentation rewrite changes no reviewed architecture or acceptance criterion.
