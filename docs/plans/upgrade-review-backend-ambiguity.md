# Upgrade review backend ambiguity, totals and locator verification

Status: implementation delivered and combined-contract dev verification passed
in draft PR #463. Remaining gate: backend 30-package complexity correction and
production availability verification before merge/release. No merge, backend
edits, client split or output-design changes are authorized.

## Outcome and ownership

Backend owns ambiguity policy, pre-cap totals, source locators, complete statement
text and complexity accounting. Core selects/validates those fields; the shared
CLI/MCP data builder preserves them. JSON keeps false/zero, raw quotes, numeric
confidence and per-item model/formulation. The owner handles CLI output design.
The client never derives ambiguity from confidence or totals from capped items.

Confirmed contract: Boolean! `ambiguous`; Int! `itemsMustActConfident`,
`itemsMustActAmbiguous`, `itemsShouldKnowConfident`, `itemsShouldKnowAmbiguous`,
`itemsUnclassified`. Confident excludes ambiguous; tier total is their sum. All
counts precede the 50-item cap. `url` is nullable and independent of sampled
entries. `fullText` is non-null when selected and preserves the complete statement.
Core always selects URL, and JSON alone selects fullText through an internal
include variable; text/verbose do not fetch unconsumed fullText. No public flag,
extra request, fallback, polling or new infrastructure.

Owner confirmed backend #3072/#3077 merged and deployed to dev. Merged SDL
707adc4571d86f506eed004e975870fbd44e14ff contains the combined fields. The earlier
local bf74b72f0 snapshot was stale, and its missing-field gate is resolved on dev.
Production is not probed or assumed deployed. Required production support remains
an owner-controlled merge/release gate.

## Completed implementation and checks

- Required field selection, types, Zod validation and raw public JSON propagation.
- Backend ambiguity alone drives uncertainty; pre-cap counters drive summaries
  and confident-action sorting, with stable ties. Version counts describe quotes.
- One aggregate request for the existing public maximum 30 packages. The proposed
  27-package split was removed after the owner chose backend budget handling.
- Tests cover flags independently of confidence, false/zero, cap-independent totals,
  sorting/ties, raw truncated/uncut text, URL beyond sampling, nullable URL,
  non-null fullText and mode-specific selection, mixed provenance, keyword/source
  handling, coverage edge cases and CLI/MCP parity. Smoke fixtures contain items.
- Full Bun suite 5,656 passed / 22,773 assertions; focused 291 / 1,233;
  typecheck/Biome/build/public-package validation and four secret-free source/built
  CLI/MCP smokes passed. Code CI is green at 817909a.
- Internal plan/delta preflight: direction sound, no findings. Earlier external
  code rounds reached the three-round cap; no fourth round. Final plan round was
  clean after minor ownership/doc-placement fixes. Current edits record observed
  verification/status only; no architecture or acceptance changes require a new
  plan review.

## Dev verification completed (2026-10-08)

Normal CLI auth with GITHITS_ENV=dev and explicit API/MCP/OSS endpoints matching
the owner request; no credentials or headers read, extracted or printed. CLI
JSON first/repeat, text, batch JSON/text; local stdio MCP same singles/batch and
Express verbose passed. Whole JSON and text matched exactly across surfaces.
All ranges were already fully classified; no cold-label/job-completion claim.

| Range | Act confident/uncertain | Know confident/uncertain | Coverage classified/not assessed/without notes/unparseable | Returned/omitted |
| --- | --- | --- | --- | --- |
| express 5.0.0..5.2.1 | 0 / 8 | 6 / 2 | 4 / 0 / 0 / 0 | 16 / 0 |
| express 4.19.2..4.21.2 | 3 / 1 | 8 / 2 | 4 / 0 / 0 / 0 | 14 / 0 |
| biome 2.4.2..2.4.15 | 13 / 28 | 12 / 10 | 13 / 0 / 0 / 0 | 50 / 13 |

All 80 returned statements have URL/fullText. Pre-cap sums match returned plus
omitted. Express internal dependency removals are uncertain based on ambiguous;
batch order is Biome, Express 4.x, Express 5.x by confident action totals. No live
statement was backend-truncated; unit/parity tests cover that case. Full details,
no-impact counts/formulations and excerpts are in the implementation document.

Agent eval was retried on dev: Claude CLI not logged in, zero tool calls, no final
artifact or qualitative grade. No account configuration or credential handling
was attempted. This is unavailable qualitative coverage, not a passing eval.

## Remaining backend gate and completion

Dev alias probes measure exact operation complexity 292 single / 308 three
(501 extra scalar aliases returned 793/809 without resolver execution). Actual
30-package request is rejected at 524, max 500, before resolvers run. This
corroborates the offline combined-schema result; @include false reduces payload
but still contributes complexity. No selected consumer field was removed and no
client limit or split introduced. Owner chose to fix backend accounting; report
this verified blocker, do not change backend. After that correction is deployed,
repeat the narrow exact-operation/30-package check; no broad revalidation absent
new code or failures. Production support must also be confirmed before release.

Acceptance still open: all supported batch sizes fit server complexity <=500.
Unknowns: timing/revision of backend budget fix and production deployment. These
are external dependencies, not a reason to add client mechanisms or thresholds.
Keep this plan until that final gate closes; transfer evidence to permanent docs
and remove it in the final closure commit, not before verification is complete.
PR #463 stays draft/unmerged for the owner's output design/review pass.

## Data gaps outside this implementation

Source locators and complete text are now available. The aggregate still exposes
only counts for coverage membership and no continuation for omitted statements.
These remaining data requirements were identified by the owner-directed audit;
backend design remains outside this CLI PR. Affected API/configuration identifiers
and reverted/superseded relationships are possible richer facts, not approved
client heuristics. Private-code usage matching and migration/testing belong to
the calling agent/user; the backend cannot decide consumer applicability. No CLI
redesign proposal is being implemented by this lane.
