# Upgrade review backend ambiguity and totals

Status: implementation and locator/full-text adaptation locally verified for
draft PR #463. Client split removal is verified. Live combined-contract and
budget verification wait for owner deployment clarification.
Base c6a2e26. No merge, backend edits or new infrastructure.

## Outcome, ownership and verified state

Backend owns ambiguity policy, pre-cap totals and complexity accounting. Core
selects required `ambiguous` and five required coverage counters; the shared
CLI/MCP formatter presents them without a confidence threshold or reconstructed
totals. JSON keeps numeric confidence and per-item provenance. Existing source
and version grouping, keywords, sanitization and full action quotes remain.

Owner confirmed `itemsMustActConfident`, `itemsMustActAmbiguous`,
`itemsShouldKnowConfident`, `itemsShouldKnowAmbiguous`, `itemsUnclassified` and
Boolean! `ambiguous` against backend SDL bb3807cc. Confident counts exclude
ambiguous items. Ambiguity describes uncertain tier reads, raised or unchanged,
including SHOULD_KNOW. Latest checked branch head 3b2b2e484 has no SDL change.
False and zero values are preserved, and all five totals precede the 50-item cap.

Offline Absinthe 1.11.0 analysis used the pinned SDL, exact query and backend
root callback without resolvers, configuration, credentials or network. With
both optional sections: prior one/three/27/30 package costs 284/300/492/516;
new costs 290/306/498/522. The callback is 20 + 8 per package + child complexity
262. The owner chose backend correction instead of the proposed client split.
Single aggregate fetching and the public 30-package limit remain unchanged.
Full-range budget compliance is blocked on the backend correction and subsequent
verification, not claimed by the client tests.

Assumptions: backend fields will be deployed before consuming them live. Unknowns:
deployed values and corrected complexity await the owner's deployment notice.
No client fallback, threshold, reconstructed totals or polling. No dev probe
before that notice; production fields and budget support are merge/release gates.

## Increment and acceptance

1. Required fields are selected, validated and exposed in core/public responses.
2. Ambiguous alone controls uncertainty. Coverage totals control summary counts
   and batch sorting by confident action count; ties preserve backend order.
   Per-version headings count displayed quotes only.
3. Remove the proposed 27-package split. Wire tests assert one aggregate call for
   1, 3 and 30 packages, preserving options, order, all summary fields and risk
   evidence. Oversized direct-service inputs remain unsplit for backend rejection;
   the public request builder rejects more than 30 locally.
4. Keep tests for confidence-independent flags, uncertain SHOULD_KNOW, false/zero
   JSON, capped totals/ranking, stable ties, oversize/truncated statements, mixed
   provenance, keyword/source handling and CLI/MCP parity. Fixture #3072 fields
   are explicit mocks, not live observations. CLI and public MCP smoke helpers
   assert the required flag and five counters.
5. Run affected Bun tests, typecheck, build/package validation and secret-free
   source/built CLI/MCP smokes. Build before built smokes; do not overlap them with
   the package validator's rebuild. Commit/push/update the same draft PR.
6. After explicit deployment notice, normal-auth dev CLI/local MCP for the three
   owner ranges and their batch; corroborate complexity under 500 including the
   largest supported batch. Report contract problems without backend edits.
   Targeted agent evaluation waits for deployment; earlier Claude evaluation
   could not run because its CLI was not logged in.

Acceptance: no client confidence threshold; backend ambiguity and pre-cap totals
are faithful in text/JSON. One aggregate request, required selection controls,
CLI/MCP parity and coverage edge cases are tested. Live verification and full
batch budget compliance remain required outstanding work. Do not delete this
plan until those close and permanent docs contain the evidence.

## Review and validation record

Internal review found the stable ambiguity/counter implementation sound with no
findings. External plan round 1 found the counter rename, production dependency
and minor schema/documentation omissions; all corrected after owner confirmation.
Round 2 recommended backend budget correction over the client split. The owner
chose backend handling; the split and its dependent tests/docs are removed.
Related core service, request builder, wire tests, release fragment and CLI/
implementation docs were checked for stale split claims. No fourth external
code review: this PR has already reached its three-round limit. A final plan
round closes the owner decision and reviews the UX assessment direction.

At HEAD 553e6de, before split removal: full Bun suite 5,652 passed / 22,738
assertions; typecheck/Biome/build/package validation and four secret-free smokes
passed; CI passed. After removal: full `bun test` passed 5,651 tests / 22,732 assertions;
typecheck, Biome, build, public-package validation and all four secret-free
source/built CLI/MCP smokes passed. No new dev query was made.

## UX assessment and next design decisions

The user's task is to identify what to investigate before an upgrade, inspect
its evidence, and check relevance to their own usage. Statement classification
cannot establish that an application is compatible. The current output protects
that distinction with quotes, explicit uncertainty, honest coverage and lossless
JSON, but still requires too much scanning and interpretation.

An offline 80-column rendering of the Express fixture with explicitly mocked
#3072 flags/counters produced 97 lines, with the first quote on line 22 and the
source list on line 63. Two batch rows were 482 and 480 characters wide. These
are layout measurements, not new dev results or a graded usability evaluation.
The following are recommendations, not shipped behavior:

- **Prioritize investigation.** Start with a concise overview of confident and
  uncertain action statements, security changes and classification coverage.
  Keep full action quotes and one block per version; move detailed fixed
  vulnerability lists after change evidence or into verbose output. The shared
  formatter owns hierarchy; the backend owns the facts. This improves scanning
  without introducing a package verdict. Choosing between version chronology
  and global action-first grouping requires an explicit product decision because
  the current design promises to show each version once.
- **Make batch triage scannable.** Retain confident-action sorting, separate
  uncertain counts and always-visible classified/not-assessed/without-notes
  coverage. Give added vulnerabilities and missing/omitted evidence visible
  space; put routine zeros and supporting dependency details in verbose output.
  Keep package identities and ranges intact. A compact table must handle long
  names and caller width rather than relying on unwrapped hundreds-character
  rows. No-impact statements remain a count, never a safety claim.
- **Provide a source for every quote.** Risk items span the whole range, but their
  locators currently come from sampled entry data. The backend risk item has no
  URL/location field, so a quote can honestly render “entry URL not returned”.
  Exact source locators belong to the backend that extracted the statement and
  should be independent of the entry sample limit. The client should not guess
  tag URLs or changelog lines. This is the smallest backend UX improvement.
- **Connect statement facts to local usage.** Express quotes include
  internal dependency removals and build-tool changes, and a security fix later
  reverted with its CVE rejected. A tier/kind alone cannot tell whether the
  consumer must change code, or whether a historical fix survives at the target
  version. The client must not infer that context, discard statements or
  reclassify them. The backend can supply affected API/option names and supersession within the
  range, but cannot inspect the consumer's private code. The calling agent owns
  local applicability: search the consumer repository for affected usage, inspect
  relevant configuration, and propose migrations and targeted tests grounded in
  those matches. The output should guide that follow-up rather than end at a
  statement dump. Current quotes already support local investigation; structured
  affected symbols would make it easier. This requires an explicit UX decision,
  not a claim that the backend can decide compatibility.
- **Support focused inspection.** Expanding every quote and all security and
  dependency details with verbose output is a coarse follow-up. Compact prefixes
  can hide qualifications, as in the Express revert note. Exact source links
  are the first remedy; focused expansion would need a separate UX decision.
  JSON already preserves complete returned evidence for agents.

Recommended next client slice: concise overview and width-aware batch triage,
while preserving current evidence and coverage rules. Backend source locators
are the first data improvement; application relevance and range reconciliation
are separate product work, not client heuristics. No UX redesign is implemented
by this assessment.

Before a redesign, broaden the evidence beyond this zero-confident-action minor
range: inspect a major upgrade with confident action statements and a capped
package. Use targeted agent evaluation to inspect local follow-up actions and
token use as well as terminal layout. No usability-quality claim is supported
by the current fixture measurement alone.

## Final plan review closure

External plan round 3: direction sound; split removal and deployment gates clean.
Minor documentation findings accepted: distinguish backend statement facts from
local consumer applicability, include the agent follow-up workflow, and move
unshipped recommendations out of permanent implementation docs into this plan.
The same ownership wording was checked in the PR description. No code findings
and no fourth external round. After these wording fixes, the plan round is clean.
Dev verification remains pending deployment; UX changes remain owner decisions.

## Owner-directed data sufficiency audit

The owner will handle CLI-side design; do not implement the proposed layout or
navigation changes above. This audit concerns data availability only. Selection
and public JSON expose all current risk-item and coverage fields. There is no
verified missing client selection to fix, so the operation and its measured
complexity are unchanged. No live dev call before deployment notice.

Backend requirements to support complete evidence inspection, independent of
presentation (proposed outcomes, not approved backend implementation):

1. Each returned statement identifies its exact source entry/location, without
   depending on sampled entry lists. A view must be able to retrieve/read the
   full context, including text cut by the 1,000-character cap. Exact URLs can
   satisfy human source navigation; structured lookup is needed only if a later
   consumer must retrieve that evidence programmatically through the tool.
2. Provide a bounded follow-up path to the classified statements omitted by the
   50-item aggregate cap, preserving their labels, ambiguity and provenance.
   Keep the aggregate bounded; do not raise its limit or add a default second
   query. References needed for lookup/continuation belong to the backend that
   stores the statements. Acceptance: a capped range's complete flagged evidence
   can be inspected, and repeating the same aggregate is not the only option.
3. Expose coverage membership per version if a view needs to identify gaps:
   classified, not assessed, without notes and unparseable. Sampled entries or
   absence of risk items cannot reconstruct this. Do not infer job completion
   or failure from a not-assessed count; distinguish those states only if the
   backend exposes them. Acceptance: every reported gap can be tied to a version
   without treating missing notes as no impact.

Useful richer evidence, separate from those completeness gaps: affected public
API/configuration identifiers and explicit reverted/superseded relationships.
They could reduce local investigation work, but do not make the backend owner of
consumer applicability. Local usage matching and migration/testing remain the
calling agent/user's responsibility. No new classifier output, automatic
reconciliation, compatibility verdict or infrastructure is introduced here.

Contract changes need schema verification, minimal selections, JSON propagation,
CLI/MCP parity and a fresh complexity measurement. Those cannot be implemented
against guessed field names in this PR. Current audit validation uses existing
wire-field and JSON/parity tests; no formatter or CLI command files are changed.

Audit check: targeted Bun wire-field/JSON/parity run passed 6 tests / 76
assertions, with no failures. No query, formatter or command implementation
changed; existing complexity measurements therefore remain applicable.

## Latest schema locator adaptation (2026-10-08)

Status: locator/full-text additions implemented and locally verified; combined
#3072 production contract needs owner clarification. The main checkout bf74b72f0 has
schema hash sha256:cbebf81f69dd. Its changelog adds nullable `url` and non-null
`fullText` on ChangelogRiskItem, independent of sampled entries. It still omits
`ambiguous` and the five counters; do not remove them or restore a client threshold.
The owner was asked which revision supplies the combined deployed contract.

Scope: expose new data for the owner's upcoming design pass, with no formatter,
layout, grouping, colors, labels or quote-rendering edits. Backend owns locators
and complete statements. Core owns field selection/validation; CLI/MCP callers
choose data needed for their output mode. Select URL for all modes. Select
fullText conditionally only for JSON, which consumes it; current text/verbose
rendering does not consume fullText and stays unchanged. Existing aggregate,
keyword fields, backend ambiguity and pre-cap totals remain. No public flag,
fallback, second query or infrastructure is added.

Implementation: add optional url/fullText fields to core and public risk types,
validate nullable URL and conditionally absent non-null fullText; introduce an
internal optional includeChangelogFullText service/response-build option defaulting
to false, and bind a Boolean GraphQL include variable. CLI --json and MCP json set
it true; text (including verbose) sets it false. Public normalization already
spreads item fields and must preserve these raw values. Test wire fields/variables
in compact/verbose/JSON and CLI/MCP parity for returned URL/fullText beyond entry
sampling, null URLs, cut text with uncut fullText, false/zero and raw untrusted
content. Update smoke JSON structural assertions and permanent docs, removing
obsolete missing-locator claims while retaining honest pagination/coverage gaps.

Measure exact selections with current backend SDL/callback offline; retain the
reported >500 large-batch gate until corrected backend accounting is verified.
Live verification may fail on #3072 missing fields; report that protocol problem
without client fallback or backend edits. Use normal CLI auth only, no token reads
or extraction. No production assumptions from a fixture. The existing PR external
review cap is exhausted; internal preflight/verification applies, no fourth external
round. Deliver into PR #463, do not merge. Keep plan while live verification remains.

Acceptance: URL always selected and preserved; fullText selected only for JSON,
kept separate from bounded text/truncation, no extra backend quote shortening.
CLI/MCP data parity, selection controls and required-field validation pass;
output design is unchanged. Unknowns: combined deployed schema and budget fix.

Locator completion record: all listed data/type/query/caller/parity/smoke changes
implemented; formatter logic is unchanged. Focused 291 tests / 1,233 assertions,
full 5,656 / 22,773, typecheck/Biome/build/package validation and four secret-free
smokes passed. Internal plan and delta reviews: direction sound, no findings.
GitHub confirms #3072 still OPEN at 3b2b2e484; no combined deployment assumption.
Offline complexity against explicitly synthesized combined SDL is 292/308/500/524
at 1/3/27/30 packages for both fullText true/false. Absinthe counts conditional
fields despite skipped payload. Production/development live verification and
agent evaluation remain blocked on the combined contract and backend budget fix;
no live query was made. Deliver the reviewed data changes in the same draft PR,
retain the plan until those required verifications close, and do not merge.
