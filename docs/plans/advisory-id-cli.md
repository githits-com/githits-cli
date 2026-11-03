# CLI vulnerability lookup

Status: READY for one CLI-only increment under Phase 3 of the approved backend
VULNERABILITY_LOOKUP plan. Product decisions/unknowns: none. This supersedes the
source-only and generic-browser proposals. No backend or other consumer edits.

## Outcome, evidence and ownership

`githits vulns <ids...> [--verbose] [--json]` preserves input order/duplicates,
independent live source and real local advisory evidence, backend-grouped packages,
coverage and unknowns. It drains package pages and never claims safe upgrades.
Private core owns schemas, neutral GraphQL transport/auth and operation-local
partial decoding. Root CLI owns batch admission, continuation, output and exit.
PkgSeer owns identities, grouping, alias relations and derived ranges.

HEAD fast-forwarded from 202dd23 to current origin/main b3c33d9; existing untracked
source-reader/schema/auth/validation tests preserved and adapted, not duplicated.
Authoritative backend artifacts read at eelgrass: SDL, consumer semantics, plan,
executable vulnerability_lookup.graphql. Contract head 1bc64a0; schema hash
sha256:27116f8dd2a5. Backend PR3918 is not deployed; live new-root smoke is blocked
on deployment and cannot be claimed from mocked verification. Direct GraphQL
transport, injected TokenProvider, runtime headers/diagnostics remain current.

## Implementation increment (READY)

Dependencies: approved backend contract; deployment only for live verification.
Assumptions: existing transport/auth utilities remain appropriate (verified).
Expected outcome: complete ordinary CLI reports and lossless defined core JSON,
with partial evidence retained on expected acquisition/continuation failures.

1. Adapt focused advisory reader to vulnerabilityLookup, retaining reusable ID
   validation, source schema, transport and refresh. Compact initial requests use
   1–5 IDs, first2/maxRanges3; compact continuation uses one ID first10/maxRanges3.
   Detailed (--verbose or --json) mirrors LookupCoreDetailed evidence fields, one ID,
   first5/maxRanges10. Continuations select requestedId, affectedPackages and
   unknownDetails with after, omitting the already-read advisory on both modes.
   Initial advisory/coverage stay authoritative; no newer source is adopted. No fixedVersionDetails/relatedAdvisories.
   Use open string vocabulary and precise timestamps; typed response validation
   must require each selected field and validate response IDs/order/cardinality.
2. Operation-local decoder accepts data+errors only for selected nullable display
   paths under sourceEvidence/advisories, with valid item/group/row indices and
   null at that field. Keep bounded sanitized path/code/retryability diagnostics
   as affected-packages unknowns; other paths/required data errors remain fatal.
   No change to unrelated operations' shared error policy. Existing terms and
   one-refresh authentication behavior apply; request access failures stop admission.
3. Root command validates each input before IO and chunks valid inputs. Preserve
   raw input separately from backend trimmed requestedId. Drain each item with
   its own cursor; append only successful same-evidence pages. A null/stale/failed
   continuation preserves earlier evidence and records incomplete pagination,
   without resetting or merging a newer source revision. No client grouping,
   alias join, derived ranges, synthetic local advisories or retry infrastructure.
4. JSON stdout {results:[{inputId,status,lookup?,packagePagination?,error?}]}:
   status success/partial/error, lookup contains the complete selected backend
   evidence with accumulated package entries and final/last successful pageInfo;
   packagePagination {complete,pagesRead} distinguishes drained pages from failed
   continuation. error uses existing CLI {error,code,retryable,details?} shape.
   Full underlying evidence/unknowns remain in lookup, including partial results.
   Client-observed request/continuation failures use item.error, including when
   lookup remains present; partial field errors are sanitized operation-local
   additions to lookup.unknownDetails (path included). Continuation diagnostics
   append to the retained lookup, not a replacement source observation. Successful
   pages add only optional-field diagnostics; failed/null pages also retain typed
   failure unknowns. Repeated acquisition outcomes are not repeated per good page.
   Invalid IDs are per-input errors while valid inputs still run. Request errors
   preserve earlier results; later inputs use status=error, error.details.notAttempted=true.
   Any typed unknown/acquisition/continuation/input/request failure exits nonzero;
   checked empty mapping with source available and no failure succeeds.
   Source NOT_FOUND/AMBIGUOUS/UNAVAILABLE with no usable source/package evidence
   is error, with local rows is partial; local UNAVAILABLE with source evidence is
   partial. Source NOT_FOUND + local UNAVAILABLE is error, never a false 404.
   Acquisition failures take precedence over NOT_FOUND (NOT_FOUND only when all
   acquisitions completed). Otherwise the first ordered typed unknown supplies
   error code/message/retryability and ambiguity candidates, unless an explicit
   request/continuation error exists. error is present iff status != success;
   continuation failure with retained source/package evidence has status partial.
   Display-only errors are also partial/nonzero even when raw ranges survive. Parser/
   startup/interactive-login errors retain the existing global CLI envelope.
5. Pure width-aware ASCII formatter leads with package/range/source-fix evidence,
   attributes source/local IDs/URLs, withdrawal and selected revision, shows
   coverage/unknowns and display/page truncation. Detailed output includes all raw
   ranges/prose/severity/references, original affected evidence and safety reports.
   Compact source selection follows the approved fixture; package-less Git raw
   evidence is available with --verbose/--json (the fixture omits it in compact).
   Unknown ecosystem/producer strings remain explicit, without guessing registry.
   Installed-version follow-up uses existing pkg vulns for known CLI registries.
6. Register top-level command, auth metadata/help (cross-reference pkg vulns),
   CLI smoke, README/durable docs
   and ONE CLI fragment (githits minor; @githits/mcp none). The user's latest “no
   MCP ... release fragment” excludes MCP-impact fragments; no versions/release.
   No MCP public exports, tools, instructions, catalog, skills or schemas change.

## Acceptance and verification

Focused bun service/decoder/command/formatter tests with small distinct fixtures:
mode-specific wire selections and bounds; >5 inputs/duplicates; input grammar;
auth/terms refresh/stop; mixed success/not-found/ambiguity/provider/partial local;
nullable-support data+errors vs fatal unexpected paths; source/local attribution,
unknown strings, unsupported ecosystems, withdrawn/sparse/Git evidence, exact
precision/safety, range/page truncation, complete drain and stale continuation.
Run typecheck/build, changed-file Biome, CLI/MCP smoke (unauthenticated validation
plus live capability as available), and public-package validation if build changes
or packaging evidence requires it. No performance optimization or benchmark claim.
Implementation stays under 1.5–2k changed implementation lines excluding tests/docs.

Completion: internal pre-flight then one external Claude reviewer per round until
clean (max3), focused checks pass, stable commit/push and draft PR. Record live
smoke dependency and exact verification on PR and report via existing coordinator
channel. After clean review move contract to durable docs and delete this plan
before final push. No merge/deploy/tag/release/version bump/publish.

## Local plan review

Internal pre-flight and Claude direction review: sound. Applied the wording
clarifications about failure slots, status mapping, invalid/not-attempted inputs,
display-only nonzero and command cross-reference. Adopted minimal continuation
selection (omit previously read advisory); exact evidence fields stay the same.
No product decisions or infrastructure added. Re-review this tactical change.

Plan round3 clean after minor clarifications: packagePagination is omitted if no
connection exists; pagesRead includes the initial successful page. Failed chunks
are attempted errors; only later admissions mark notAttempted. Non-null cursor-
validated connections with matching requestedId are same-evidence pages; no
client revision comparison or repeated-cursor machinery. A missing continuation
cursor is failure. Null display without a field error is not failure. Compact
empty mapping text says it cannot establish non-affectedness and points to
--verbose for original/package-less evidence. Sanitized optional-field diagnostics
include section AFFECTED_PACKAGES, producer code/retryability, neutral local
message and operation-local path. No raw error body is exposed.
