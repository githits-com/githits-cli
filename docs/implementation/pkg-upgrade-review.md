# Package Upgrade Review

## Purpose and ownership

CLI `pkg upgrade-review` and package-owned MCP `pkg_upgrade_review` compare
current and target package versions. They report vulnerabilities, release-note
statements, target deprecation metadata, peers, dependency changes and missing
evidence. Semver alone does not establish compatibility.

The backend owns parsing, source order, restatement suppression, classification,
ambiguity policy and whole-range counters. Core owns GraphQL projections,
validation and complete collection. MCP shared modules own request normalization,
JSON normalization and presentation. CLI commands and MCP handlers adapt host
inputs; both use the same formatter with color and width as inputs.

- `src/commands/pkg/upgrade-review.ts`: CLI addressing and flags.
- `packages/mcp/src/tools/package-upgrade-review.ts`: MCP arguments and handler.
- `packages/mcp/src/shared/package-upgrade-review-request.ts`: shared validation
  and tier/view selection; `changelog-changes.ts` also serves standalone changelog.
- `packages/core-internal/src/services/package-intelligence-service.ts`: aggregate
  query, statement projection/protocol validation and collection.
- `packages/mcp/src/shared/package-upgrade-review-response.ts`: upgrade envelope
  and formatter. `package-changelog-response.ts` supplies the shared statement
  normalization and version/source bullet renderer.

The hosted MCP transport lives in `remote-mcp`, outside this repository. Its
behavior changes only after adopting a released `@githits/mcp` and deploying it.

## Inputs and defaults

Single-package CLI forms:

```bash
githits pkg upgrade-review npm:express@5.0.0..5.2.1
githits pkg upgrade-review npm:express@5.0.0 --to 5.2.1
githits pkg upgrade-review npm:express@5.0.0..5.2.1 --changes actionable
githits pkg upgrade-review npm:express@5.0.0..5.2.1 --changes all --json
```

Batch CLI uses repeatable `--package <registry>:<name>@<current>..<target>`.
MCP accepts either `registry`, `package_name`, `current_version`, `target_version`
or `packages[]` containing those fields. Single and batch addressing are mutually
exclusive. The shared builder removes blank batch rows and rejects more than
30 upgrades before any service call. Go versions accept either spelling and
normalize to canonical lowercase `v`; other registries reject tag-style `v`
except Swift.

Ranges exclude the current version and include the target. A positional range
already supplies its target, so `--to` with that form is invalid. `->`, empty
range sides and repeated/adjacent delimiters get local grammar errors. Only the
version suffix after the final version-separating `@` is parsed as a range.

Transitive security defaults on; `--no-transitive-security` or
`skip_transitive_security: true` disables it. Dependency issue analysis defaults
off; `--dependency-issues` / `include_dependency_issues: true` selects it.
`--min-severity` / `min_severity` accepts low, medium, high or critical; low is
unfiltered, while the other values map to CVSS 4, 7 and 9.

### Detailed statement filters

CLI `--changes <view>` and MCP `changes` share these meanings:

| Selection | Backend tiers | Evidence shown |
| --- | --- | --- |
| Omitted or blank: `focused` | MUST_ACT, SHOULD_KNOW, UNCLASSIFIED | Action, knowledge and oversize statements |
| `actionable` | MUST_ACT | Includes uncertain action labels |
| `important` | MUST_ACT, SHOULD_KNOW | Action and knowledge labels, including uncertain ones |
| `all` | Unfiltered | Every parsed statement, including no impact and null classification |

Input is trimmed and lowercased; invalid values fail locally. `focused` is
output metadata, not an accepted explicit filter. Standalone `pkg changelog`
continues to default to `all`; the explicit filter meanings are identical.

Filters limit detailed quotes only. Whole-range security, classification counters
and batch ranking do not change. Detailed text always names the effective
selection and its exclusions. JSON always includes `statements.selection`, even
for an implicit default, and echoes only an explicitly supplied filter in the
top-level `filter.changes`. Compact batch text explains an explicit filter applies
to detailed reports.

## Backend operation and projections

Use `packageUpgradeReview` directly. Never compose package summary,
vulnerability, changelog or dependency calls as a fallback. Missing fields,
schema/deployment skew and resolver errors use normal package-intelligence
protocol/error handling.

The initial request sends the complete batch once, retaining the public maximum
of 30. `changelogLimit: 20` bounds ordinary entry metadata, not statements.
`changelog.statements(first: 100, offset: 0, tiers: ...)` covers the full range and
filters before pagination. All matching pages are retrieved for detailed views.

| Host view | Selected changelog evidence |
| --- | --- |
| Compact multi-package text | Whole-range coverage/tier counters, source/fallback, entry and keyword totals/signals; no statement pages or entry arrays |
| Single text / verbose batch | Bounded statements, context, classification tier/kind/ambiguity, full assessment coverage and entry locator metadata; keyword bodies for actual lexical excerpts |
| JSON | Complete matching pages with uncut statement/context text, source positions, confidence and per-item model/formulation; ordinary entry/keyword bodies and metadata retained |
| Continuation | One review identity and statement page/progress/coverage only |

Text does not fetch `fullText`, confidence, model or formulation. It omits
ordinary note bodies and duplicate sampled previews. `keywordEntries.body` is
required in detailed text: a keyword match can occur beyond its preview.
Optional transitive security and dependency issues retain their existing request
controls. Complexity counts directives conservatively; runtime omission does not
prove a lower admission cost.

Continuations are sequential, in original review order, with one package per
aggregate request, `includeTransitiveSecurity: false` and `changelogLimit: 1`.
They do not repeat summary, security, dependencies, riskCoverage or entry arrays.
Zero is clamped to one by the backend, so it offers no smaller continuation.
Duplicate reviews are retained; the client adds no deduplicating cache, fanout,
retry loop, background job or snapshot mechanism.

## Completeness and consistency

Both changelog paths share statement selection, schemas, normalization,
page-progress validation and collection. Validate selected JSON evidence fields,
page size at most 100, monotonic offsets, remaining/matching counts,
`hasMore`/`nextOffset`, coverage membership, positions and backend source order.
Filtered positions may have gaps; unfiltered retained positions are contiguous
per version. Original `sourcePosition` may have gaps after suppression.

Upgrade coverage spans the full range and must not be compared with the sampled
entry version list. Continuations must return the initial review's canonical
identity. Complete collected selected tier/ambiguity counts must agree with
whole-range counters; all mode additionally reconciles no-impact and assessment
coverage.

Upgrade review compares complete assessment coverage and total/matching counts
between pages, including all mode, because its global counters came from the
initial aggregate. Observed changes raise a retryable changed-evidence error
with rerun guidance. Stable pages that disagree with those counters are malformed
backend evidence, not a guessed retry condition. Selected fields missing from a
successful response also fail validation. Omitted triage arrays remain absent;
they are not fabricated empty evidence.

Standalone changelog all mode still tolerates labels arriving between pages and
derives assessment coverage from collected statements. This migration does not
change that behavior.

The API uses current offsets, not an immutable snapshot. Coverage checks cannot
detect every same-count source edit. A cold large all view may need a rerun after
background classification settles; there is no automatic restart or guaranteed
fixed latency. Background jobs can take seconds to a minute. Stored labels
remain useful across classifier changes, so model/formulation can differ between
items. Missing or unparseable notes are never evidence of no risk.

## Text evidence

Security precedes Changes; compatibility, dependencies, dependency issues and
unknowns retain their existing sections. Changes leads with whole-range confident
and uncertain counts and classified/not-assessed/without-notes coverage. Versions
and sources follow backend order, with authoritative URLs beside their bullets.
There is no duplicate sampled-note dump or global numbered source table.

Statement tags preserve meaning without color:

- MUST_ACT: `[!behavior]`, or `[!]` when kind is absent.
- SHOULD_KNOW: `[security fix]`, or `[should know]` when kind is absent.
- Backend `ambiguous: true`: muted `(uncertain)`; never a client confidence cutoff.
- NO_IMPACT: plain bullet.
- Null classification: `[not assessed]`.
- UNCLASSIFIED: `[too long to classify - read it]`.

Headings, predecessor context and nested evidence remain intact. Confident and
uncertain action statements use full backend-bounded text. Compact non-action
quotes use at most 240 Unicode characters and an explicit verbose expansion
hint. `--verbose` / `verbose: true` expands all bounded quotes, batch reports and
security/dependency examples. It does not fetch uncut text or original notes.
Backend text/context truncation separately points to JSON full text.

Existing `breakingSignals`, `migrationSignals` and entry `signals` remain
functional. Additional keyword excerpts appear as lexical evidence within the
version; a complete chunk already contained in a displayed same-source statement
is not repeated. A filtered-out statement does not suppress separate keyword
facts. Keyword quotes normalize Markdown list markers and sanitize text/signals;
URLs already shown for the version or statement sources are not repeated. Source
groups nest beneath the version header. The client does not infer classifications
from keywords or invent URLs.

All untrusted quotes, headings, context, dates, versions and URLs follow terminal
sanitization and prose wrapping. Formatter punctuation is ASCII; backend Unicode
is retained. Long locators remain intact. Color only styles trusted annotations.

Compact batches show one triage row per review, sorted by whole-range confident
MUST_ACT counts. Uncertain counts are separate and never a secondary ranking key;
ties retain backend order. JSON order remains backend order. Rows retain target
deprecation, security, keyword, compatibility, dependency and unknown facts.

## JSON migration

The top-level summary/reviews envelope and security, compatibility, dependency,
unknown and ordinary entry/keyword facts remain. Enum spelling is normalized to
lowercase. Existing null omission conventions apply to optional evidence, while
`classification: null` remains explicit and distinct from NO_IMPACT. False
ambiguity and zero numeric values remain evidence.

The complete detailed collection replaces `changelog.riskItems`:

```ts
interface UpgradeStatements {
  selection: "focused" | "actionable" | "important" | "all";
  count: number;          // items.length, after complete collection
  totalCount: number;     // all parsed retained statements, before filtering
  matchingCount: number;  // matches before pagination
  items: Array<{
    version: string;
    position: number;
    sourceIndex: number;
    sourcePosition: number;
    heading?: string;
    source?: string;
    url?: string;
    text: string;
    textTruncated: boolean;
    fullText: string;
    context?: { heading?: string; text: string; textTruncated: boolean; fullText: string };
    classification: null | {
      tier: "must_act" | "should_know" | "no_impact" | "unclassified";
      ambiguous: boolean;
      kind?: string;
      tierConfidence?: number;
      kindConfidence?: number;
      model: string;
      formulation: string;
    };
  }>;
  coverage: Array<{
    version: string;
    status: "classified" | "not_assessed" | "without_notes" | "unparseable";
    statementsTotal: number;
    statementsAssessed: number;
    statementsNotAssessed: number;
    statementsNoImpact: number;
    statementsUnclassified: number;
  }>;
}
```

JSON selects fullText and sourcePosition, including complete context text, and
requires confidence/model/formulation fields on non-null classifications before
normalization. Per-item provenance is not collapsed to one formulation per review.

`riskCoverage` retains versionsClassified, versionsNotAssessed,
versionsWithoutNotes, versionsUnparseable, unitsNoImpact, itemsMustActConfident,
itemsMustActAmbiguous, itemsShouldKnowConfident, itemsShouldKnowAmbiguous and
itemsUnclassified. Each tier total is confident plus ambiguous. Remove
`itemsOmitted`: it describes the deprecated 50-item backend risk API, not complete
statement pages. Neither that old API nor a synthesized compatibility riskItems
array is selected or returned.

This is a pending minor migration for both public 0.x artifacts. Consumers must
read classification fields under each statement, handle nullable classification
and use collection/coverage counts rather than the old cap. Core and shared
legacy risk-item types/options/helpers are removed after consumer migration.
The public `@githits/mcp/smoke-test` helper now validates the complete statement
contract and rejects legacy cap fields. Hosted adoption requires the new aggregate
statement schema in production before release/deployment; this increment verifies
dev and does not deploy either server.

## Other evidence and fact-reporting rules

Direct advisory deltas are backend-provided over logical advisory identity
(`id` and aliases); introduced/fixed/unchanged aliases remain in JSON while text
uses added/fixed/still-present wording. Transitive diffs are package/advisory-aware:
a changed dependency version with the same affected advisory remains still
present. A package can have both introduced and retained advisories. Security
pages retain totalCount/truncated metadata; complete changelog pagination does not
make those bounded security details complete.

Undefined target deprecation means unknown, not false. Direct dependency set or
constraint changes remain install facts. Transitive graph changes provide context;
root/synthetic graph nodes are excluded by the backend. Peer changes and
compatibility notes are factual. Runtime engines/versionDiff are not invented.

Per-statement agent classifications are quoted evidence with provenance, never a
package-level score, risk level or compatibility verdict. They express the model's
reading of a statement, not applicability to the caller's code. The calling
agent/user owns assessment and local testing. Never label an upgrade safe or
approved from absent statements, missing notes or zero counters. Supersession,
reverts and private-code applicability remain limitations recorded in
[open-backlog.md](../plans/open-backlog.md).

## Verification (2026-10-14)

The local canonical backend SDL and dev queries verify the new aggregate field;
dev disables introspection. The initial batch remains unsplit at the public
30-package maximum. The calibrated admission control independently costs 5100;
subtracting it from each rejected combined probe measures the actual operation:

| Final operation, security and dependency issues enabled | Complexity |
| --- | --- |
| JSON initial, 1 / 3 / 30 packages | 330 / 340 / 475 |
| JSON all initial, 30 packages | 475 |
| Compact triage, 30 packages | 391 |
| JSON continuation, 1 package | 88 |

The maximum is 25 below dev's 500 limit. No second initial query, reduced public
maximum or backend change is used. The previous capped operation and maximum
were verified on production during the 0.29.0 release on 2026-10-12; that earlier
verification does not certify deployment of this new field.

Authenticated built CLI and local stdio MCP on dev produced equal focused JSON
for these ranges. All were warm stored labels; no cold-latency claim is made.

| Range | Parsed / focused returned | Act confident + uncertain | Know confident + uncertain | No impact | Classified / pending / without notes / unparseable versions |
| --- | --- | --- | --- | --- | --- |
| npm:express 5.0.0..5.2.1 | 141 / 15 | 0 + 8 | 6 + 1 | 126 | 4 / 0 / 0 / 0 |
| npm:express 4.19.2..4.21.2 | 57 / 14 | 3 + 4 | 7 + 0 | 43 | 4 / 0 / 0 / 0 |
| npm:@biomejs/biome 2.4.2..2.4.15 | 875 / 62 | 13 + 27 | 12 + 10 | 813 | 13 / 0 / 0 / 0 |

Express text/JSON parity passed for focused, actionable, important and all;
three-package compact/verbose text parity also passed. Biome all returned all
875 statements. Source and built CLI/MCP smoke modes passed. Unit coverage
includes pagination past 100, filtered gaps, nullable/oversize/truncated evidence,
zero/pending coverage, counter agreement and changes, canonical/duplicate review
identity, sanitization, source/keyword preservation and mode-specific over-fetch
controls. Standalone changelog regression behavior remains covered.

Built Node Biome all, with the explicitly requested dev URLs, completed in
13.683 seconds across nine observed backend requests (one initial page and eight
continuations), returning 875 items. This single-run walltime includes startup,
normal authentication, network, serialization and a request-count observer; it
is not isolated backend latency or a speedup claim.

For the same three warm ranges with transitive security and dependency issues
selected, compact serialized raw GraphQL responses were 443,505 bytes for the
previous capped projection, 467,275 for detailed statements and 16,202 for triage.
The detailed response includes the 12 Biome matches beyond the old cap. Helper
walltimes include authentication/startup and are not comparable product latency.

The descriptor/intent Codex `package-upgrade-safety` workload completed on the
explicit Fly dev endpoint in 177.3 seconds with nine logical calls, including two
completed upgrade reviews. The final answer used returned quotes, sources and
coverage to suggest local checks; that is observed behavior, not a quality grade.
One nonexistent TypeScript release follow-up failed; a research call remained
unfinished in the trace. No isolation violations were recorded. The first run
using the repo's `oss-dev.githits.dev` preset timed out after starting a review;
the cause was not established. Direct reproduction of its exact seven-package
arguments succeeded on the explicit endpoint using both built Node and source
Bun MCP (3.1 and 9.2 seconds). No auth storage or tokens were inspected/exported.

After the review's MCP argument-wording fix, the same workload ran again. Its
seven-package upgrade review completed in 19.7 seconds and nine calls completed;
the 182-second harness timeout occurred after it entered broader research. That
run produced no final answer or quality grade. The completed tool trace does not
make the whole workload successful; no isolation violations were recorded.

Local verification artifacts are under
`/tmp/upgrade-review-statements-implementation/`; raw traces/metrics are local
working evidence, while the measurements and limitations above remain durable.
Public skill guidance needs the corresponding filter/JSON update during release
preparation, not an unpublished behavior change in this feature PR.
