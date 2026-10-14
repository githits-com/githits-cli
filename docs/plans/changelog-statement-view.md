# Complete changelog statement view

Status: CODE REVIEW READY — backend complete, owner approved UI route 2026-10-14.

## Outcome, scope and decisions

Update existing draft CLI/MCP PR #476 so default changelogs show every selected
parsed statement once, with classification and nearby sources. Remove raw-note
previews from the default. All parsed units include model NO_IMPACT and absent
answers. Preserve source order, nested wording, headings and predecessor context.
Classification remains per statement; no package risk verdict or client threshold.

Owner approved: all default; --changes actionable|important|all; --verbatim shows
original notes instead of bullets; --verbose is only a deprecated alias for that
view; JSON carries structured evidence/provenance. Preserve --no-body / MCP
omit_bodies as timeline-only. Raw/timeline modes ignore changes, including echo
and validation. Conflicting timeline and explicit original-note switches fail
before service access. MCP verbatim mirrors CLI; explicit false alone preserves default; explicit body_lines still requests its legacy preview view.

MCP body_lines is existing released behavior. Retain as a deprecated original-note
preview request: it both selects and caps that view, avoiding a flag that silently
does nothing or requires a second optional switch. Explicit verbatim/verbose show
full notes, ignoring body_lines; omit_bodies wins over body_lines alone. JSON ignores
this text-only legacy preview knob. No other verbose behavior remains. This is an
implementation compatibility choice grounded in existing calls/tests, not a new
product mode. No open product decisions.

Non-goals: upgrade-review redesign, backend/remote MCP edits, deployment/release,
client parsing/deduplication, new storage/cache/jobs or model policy. No merge.

## Verified evidence and assumptions

- Backend #3228 merged and deployed dev/production; exact/latest/range expose
  statements(first:1..100 default100, offset>=0 default0, tiers nullable).
- Complete schema/contract: ~/proj/githits/pkgseer-backend/priv/graphql and
  /tmp/pkg-changelog-statements-backend-contract.md. Deprecated changelog riskItems
  remain functional; upgrade-review risk API unchanged.
- Page items: raw version, position, sourceIndex/sourcePosition, heading, source/url,
  text/textTruncated, fullText, context and nullable classification. Tier includes
  MUST_ACT, SHOULD_KNOW, NO_IMPACT, oversize-only UNCLASSIFIED. ambiguous is authoritative;
  nullable classification is actual missing evidence, not a no-impact answer.
- Page counts and nextOffset support complete retrieval; coverage per version has
  status and total/assessed/not-assessed/no-impact/oversize counts. Nonempty tier
  filters exclude absent labels but coverage remains complete across selected releases.
- Meaningful source representative/deduplication and predecessor context belong to
  backend; retain its returned evidence, never infer equivalence locally.
- Authenticated backend dev verification:271 units in100/100/71 pages, stable coverage.
  Corpus maxima141/release and875/range justify pagination. Final backend maximal
  complexity exact103/latest50=101/range126, not yet final client measurements.
- Offset pages are current evidence, not immutable snapshots. In all mode, compare only
  parse identity (versions, unit totals and zero-unit note status), page counts and
  contiguous raw version/position keys; classification arrivals do not move offsets.
  Derive per-release assessment counts/status from the items actually collected,
  preserving WITHOUT_NOTES/UNPARSEABLE for zero units. Do not reject new labels in
  this mode. Filtered mode compares full assessment coverage/matching counts/order
  and returns an explicit classification-in-progress rerun message if they change.
  No retry/polling infrastructure. Same-count source edits are not reliably detectable
  from this API; do not claim snapshot consistency. This honors the delivered contract.
- Existing service executes queries and validates DTOs; shared request/envelope/text
  live in packages/mcp/src/shared; CLI and MCP are thin callers. Existing request,
  response/parity/server tests pass, and exact Express4.20.0 dev baseline captured
  with normal CLI authentication under /tmp/changelog-statements-baseline-*.log.

## Ownership and next increment

Backend owns extraction/source identity/labels. Core service owns page collection
and protocol validation so CLI/MCP cannot diverge. Shared request builder owns
view/flag resolution; per-tool shared formatter owns source/heading grouping and
sanitation. No new module unless it reduces existing complexity; source-page types
and query projection belong with package-intelligence-service.

1. Backend contract (COMPLETE): all parsed statements and optional stored answers
   are retrievable. Evidence above and390 focused backend cases; dependencies and
   product unknowns:none. No backend edits in this increment.
2. Client statement view (CODE REVIEW READY): default statements, explicit original notes
   and timeline, complete paged evidence with local sources. Depends on deployed
   contract (met); assumptions above; unknown product decisions:none. Expected
   outcome: CLI/MCP offer the same views/data, query only consumed fields, and show
   pending/missing/oversize coverage honestly. Update #476; do not merge.

Implementation order:
- Add neutral typed statement/classification/context/coverage/page DTOs and Zod
  validation. Preserve classification:null. Replace deprecated changelog risk
  selections; leave upgrade-review schemas/helper behavior intact.
- Core request controls express the selected view plus JSON detail selection and
  tier filter. Fetch100 per page only in statement mode; first request includes
  timeline presentation data, subsequent requests omit bodies/package/date fields.
  Use raw version/position to validate ordered, nonduplicate statement keys. Collect
  until exhausted, checking forward nextOffset/counts/parse identity (full assessment coverage for
  filtered mode) and selected field
  presence. No invented default classifications or old-schema fallback.
- Shared request builder resolves flags and filters before access. Update CLI
  Commander options and MCP descriptors without changing discovery first sentence.
- Replace duplicate preview formatter with one source-ordered bullet formatter.
  Labels identify action/should-know/no impact identified/too-large/not-assessed plus optional kind
  and uncertainty. Ordinary statements are not locally excerpted; backend1000-char
  cuts are explicit. Preserve nested lines/code and context. Source URL appears at
  its version/source block; embedded note links stay inline, no global Sources table.
  Original-note/timeline views use existing entry metadata and sanitation.
  Filtered views explicitly report excluded not-assessed and oversize counts,
  including when no statements match; JSON retains these in coverage.
- JSON keeps existing entries envelope and adds a complete statements block with
  items/count/totalCount/coverage. Enum casing follows existing lower-snake conventions;
  provenance/fullText retained only in statement JSON. No raw bodies there by default.
- Update mock fixtures/tests, smoke structural assertions, server catalog keys,
  command/tool/implementation docs and release fragment. Public skill changes stay
  staged for release per repo release policy; no plugin generation unless input changes.

## Wire projections and efficiency acceptance

| View | Fields required |
| --- | --- |
| Statement text | first-page timeline identity/date/URL; every page bounded statement text, version/position/sourceIndex, heading/source/URL, context text/heading/cut, classification tier/ambiguous/kind, page controls + coverage version/total/status; assessment counts derived from all collected items (filtered mode selects backend counts) |
| Statement JSON | above plus normalized entry version, sourcePosition, fullText/context fullText, confidences and model/formulation; no entry bodies |
| Verbatim text/JSON, verbose alias | timeline + raw entry.body; no statements, risk fields or classification jobs; no statement provenance/fullText |
| Timeline/no-body | version/date/URL (+ JSON normalized version); no raw body or statements/classification |
| Subsequent statement page | no package echo, source summary, dates, normalized timeline versions or bodies; page items match text/JSON projection, mode-specific coverage and page controls; no timeline inventory |

Conditional fields must have tests for actual wire variables/selections in every
mode and flag combination. Queries remain one call for timeline/verbatim or <=100
statements; additional calls only for required pages. Final maximal actual documents
must stay below500; no performance speedup is claimed without measured evidence.

## Verification, completion and cleanup

Test parsed no-impact, absent classifications, oversize, missing/unparseable/empty
notes, source order/raw joins/context/dedup preserved, mixed formulations, >100
retrieval for both timeline and an exact release above100, labels arriving between
pages in all and filtered modes, filtered pages, coverage/count changes, malformed/nonprogressing offsets and duplicate/order keys,
filtered text exclusions for pending and oversize statements even with zero matches,
query projections and option conflicts/legacy aliases (including verbatim:false
with body_lines), multiline/code sanitation,
width and lossless JSON. Use bun test focused core/shared/CLI/MCP/parity/server files
and upgrade formatter regressions. Build/typecheck/Biome/diff check; source and
built CLI/MCP smoke suites. Authenticated dev CLI/local MCP exactExpress4.20.0,
Express4.18.2..5.1.0 (>100), Biome2.4.2..2.4.15, all3filters, verbatim/verbose alias,
timeline and JSON/text parity. Inspect targeted exact-release agent trace/final/
metrics/isolation artifacts; no graded quality claim. Measure actual text bytes
before/after for default latest Express, exact Express4.20.0 and its271-statement
range and Biome2.4.2..2.4.15; measure built-client page count/wall time for Biome.
Public API does not expose whether labels were already stored; report observed
coverage and timing without inventing a cold claim. Read credential guidance,
use normal auth, never handle or expose tokens. No local broad backend tests.

Review this plan internally then one external reviewer; implementation gets its
own review rounds (one external per round). Scope is this redesigned increment;
prior #476 implementation review evidence applies only to unchanged areas. Fix
accepted findings with bounded sibling scans. Keep plan through review, transfer
permanent semantics/measurements to docs, then delete in final clean-review commit.
Push/update draft #476 and complete CI. No merge, deployment or release.

Internal plan review: direction sound. Accepted projection mismatch: page items
are disjoint and alternate source inventory is not available, so checks now use
comparable coverage/counts/progress and ordering keys, with no snapshot guarantee.
Accepted explicit NO_IMPACT presentation: [no impact identified], a per-statement
model answer rather than a package verdict. Baseline127pass/802assertions and
authenticated current dev exact output pass. External plan round2 clean after
three minor wording fixes: explicit filtered-exclusion acceptance, Biome built-client
bytes/timing acceptance, and this completed review status.

## Compatibility and external round1 closure

Approved original-note-only explicit view applies equally to text and JSON flags:
default JSON now omits entries.body and carries parsed statement evidence; callers
needing bodies use --verbatim --json / verbatim:true,format:json. Keeping unused
raw bodies by default would contradict the owner's separate-copy flag and minimal
fetching direction. No repeat approval is needed for this already approved route.
Other intentional released behavior changes: default text drops previews; MCP
verbose selects original-note view in JSON too; verbose+omit_bodies now errors like
its verbatim alias; body_lines is a legacy preview request; explicit false by itself
does not select a view, but a present body_lines does. Rewrite the unmerged fragment
as changed with minor impact for both0.x artifacts, explicitly noting JSON migration.

External plan round1: direction sound. Accepted cold all-mode pagination correction
(derive assessment from collected items; check parse identity, not arriving labels),
explicit filtered exclusions, false/legacy precedence, exact paging case and measured
latency/size evidence. Compatibility findings are documented, including JSON removal
as part of the approved route; repeat owner approval request rejected on that evidence.
Measurement and internal closure precede external round2.

Live latency planning evidence (2026-10-14): npm:eslint@8.0.0..8.10.0 has162
units across12 releases. First complete two-page retrieval took6.426s, repeat
3.902s, including a separate normal-auth helper invocation per page; this is not
pure server latency or a client speedup claim. Both responses were fully assessed
at return, so the public API cannot prove they were initially cold. Quote text
alone totals27,900 UTF-8 bytes. Evidence /tmp/changelog-statement-probe-measurements.json.
The cold/arriving-label case will be exercised deterministically in core paging
tests; backend's6s per-parent budget still makes9-page worst-case54s plus transport
an estimate, not a measured timeout. Final built-client timings/bytes remain acceptance.

## Implementation evidence

Neutral statement DTOs and projection builder implemented in core; host view
resolution/formatter shared. Exact text statement queries omit duplicate entry
version, aggregate source and hasChangelog; JSON adds them where consumed.
Follow-ups omit all first-page metadata. Coverage must match the selected raw
version timeline, preserving joins and preventing hidden evidence.

567 focused tests/2,855 assertions pass; build/typecheck and changed-file Biome
pass. Authenticated built Node CLI/local MCP complete matrix passes: exact40,
latest335, range271, Biome875 statements; actionable/important6/8,30/43,40/62.
All selected units assessed; no pending/oversize/unparseable live, fixtures cover
those plus arriving-label behavior. Missing-note is-even has one WITHOUT_NOTES
version. Complexity85exact/88latest50/113range, dev admission probes with510control.
Built all text Biome9pages10.672s, repeat10.218s;259,575bytes vs39,824 old preview
bytes. This is complete evidence rather than a speedup claim; no cold claim.
Other counts/timings/bytes moved to permanent pkg-changelog.md.

Targeted Codex descriptor-intent workload succeeds4calls25.154s, uses default
statements then verbatim:true; no isolation violations, no quality grade.
Full source live smoke harnesses fail their auth probe because isolated HOME
cannot use this system keychain. No credentials copied/exported. Run required
source unauthenticated/registration modes and built Node modes; authenticated
affected-feature matrix above replaces full live harness proof for this task.
Internal complete code preflight direction sound, no findings; final gates pass; external code review in progress. Plan stays until clean external review.

## External implementation round1 closure

Direction sound. F1 accepted: blanket four-space detection confused nested prose
with code. Renderer now measures code indentation relative to the first bullet's
content indent and excludes nested list markers; prose retains its hanging indent.
Bounded sibling scan: statement/context renderer (one shared helper), original
notes (explicit verbatim remains unchanged), width/code/Unicode tests and live
exact/latest/range evidence. New Express-style case covers long four-space prose
and nested bullets plus genuinely indented code. F2 accepted: context label now
explicitly says Context for next statement, including heading variant. Checked
context truncation hints, heading state and source groups; provenance unchanged.
No policy, wire or field changes; no complexity/JSON rerun required. New text bytes
and representative live text output remeasured, with permanent docs updated.
Round2 reviews the full revised increment.

Round1 closure evidence:162affected tests/992assertions pass; rebuilt/typechecked
formatter and changed-file Biome pass; all4 source/built unauth smoke modes pass.
Authenticated rebuilt CLI/local MCP text parity passes all4 representative views;
final bytes latest57,029/exact6,482/range40,760/Biome260,050, text times
5.907s/2.174s/3.030s/14.853s under concurrent validation. No speedup claim.
Wire/JSON/classification policy unchanged, prior85/88/113complexity proof applies.
Standalone public package validation also passed. Internal full revised closure
clean, no findings. Prior d8a225d CI all tests/build/compat/package checks green.
