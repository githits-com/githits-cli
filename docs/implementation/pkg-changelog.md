# Package changelog evidence

`pkg changelog` and MCP `pkg_changelog` show every parsed release-note statement
in source order, with available agent classifications. Raw notes are a separate
view, avoiding duplicate previews. Statements and source links are the evidence;
classifications never assign a package-level verdict. Upgrade review additionally
compares security and dependencies between installed and target versions.

## Selection and views

Targets remain latest `registry:name`, exact `registry:name@version`, or range
`registry:name@from..to`. The lower bound is excluded, the upper included. Latest
uses a 1-50 entry limit (default 10); ranges return all selected entries. Exact
uses the backend-selected release, including prereleases, without inventing a
previous version. Statement joins use raw `entry.version`, not normalizedVersion.

| CLI / MCP | View |
| --- | --- |
| Default | All parsed statements, including NO_IMPACT, oversize and unassessed |
| `--changes actionable` / `changes: "actionable"` | MUST_ACT, including visibly uncertain items |
| `--changes important` / `changes: "important"` | MUST_ACT and SHOULD_KNOW, including uncertain items |
| `--changes all` / `changes: "all"` | Default complete view |
| `--verbatim` / `verbatim: true` | Full original notes instead of statements; no classification work |
| `--verbose` / `verbose: true` | Deprecated alias for verbatim in text and JSON |
| `--no-body` / `omit_bodies: true` | Version/date/URL timeline; no bodies, statement parsing or classification |

Empty optional filter strings mean all. Unknown active filters fail before
service access. `changes` is ignored, including validation and envelope echo,
outside statement mode. Timeline and an explicit original-note flag conflict
before service access. Explicit false alone preserves the default view.

MCP `body_lines` remains a deprecated text-only original-note preview request
and line cap (1-50). It selects that legacy view even with `verbatim:false`;
`verbatim:true`/`verbose:true` show full notes and ignore its cap. Timeline wins
over `body_lines` alone. JSON ignores this text-only knob. There is no separate
verbose classification-detail mode or implicit default note preview.

## Evidence, coverage and sources

Action kinds use compact tags such as `[!behavior]`; should-know kinds use
`[deprecation]` or `[security fix]`. Action without a kind uses `[!]`, and
should-know without a kind uses `[should know]`. One short legend explains
these tags and plain no-impact bullets. Red/yellow highlighting is optional;
the action marker keeps meaning visible without color. NO_IMPACT stays untagged.
Uncertain statements retain `(uncertain)` with muted highlighting, based only on
the backend `ambiguous` boolean; confidence values remain JSON evidence.
Unassessed statements retain `[not assessed]`; oversize UNCLASSIFIED statements
retain `[too long to classify - read it]`. Model/formulation remain per-item JSON
provenance. Omitting no-impact tags changes presentation only, not classification
or coverage data.

The backend owns parsing, headings, source order and conservative alternate-source
restatement suppression. The client preserves nested wording/code and predecessor
`context` when suppression would otherwise remove needed context. It performs
no extraction, local deduplication or generated summarization. Text shows the
bounded backend `text` without additional local excerpt limits; backend cuts
are marked. JSON includes uncut statement/context fullText.

Source URLs appear once at each release/source block, close to their statements.
Embedded Markdown links retain their inline URLs. There is no response-wide
Sources table or invented locator. Missing URLs are stated. Entry-level htmlUrl
is a fallback for releases with no displayed statements, not proof of every
statement's source. Terminal controls are removed from all untrusted text at
presentation; JSON preserves evidence with lowercase enum spelling and the
existing absent-null convention, except classification:null is preserved.

Coverage names classified/not-assessed versions, versions without notes and
versions without parsed statements. Missing notes never establish no risk.
Filtered text explicitly reports pending and oversize statements excluded by
the filter, including zero matches. Coverage in JSON includes every selected
release, regardless of filtering. Pending may mean a background job is still
running, failed or exceeded the request budget; rerun in a few seconds to a
minute to read completed stored labels. No client polling or automatic reruns.

## Transport, pagination and ownership

Backend #3228 exposes `statements(first, offset, tiers)` on PackageChangelogResult
and PackageVersionChangelog, in dev and production. Its 100-item maximum page
size replaces the old risk-only 50-item cap for changelog views. Filters apply
before pagination. Upgrade review also collects this statement shape, with a
focused default instead of changelog's all-statements default; see
[pkg-upgrade-review.md](pkg-upgrade-review.md) for its projections and coverage.

The core service retrieves every matching page. Original-note/timeline and up
to 100 matching statements need one query; larger results need one query/page.
Follow-up pages reuse the same release/range selector and omit first-page release
metadata. No product-side second query is added for optional details.

| Projection | Selected data |
| --- | --- |
| Statement text | First-page version/date/URL; every-page text, position/sourceIndex, heading/source/URL, context, tier/ambiguous/kind and page controls |
| Statement JSON | Above plus normalizedVersion, sourcePosition, fullText/context fullText, confidences, model/formulation and aggregate source; no entry.body |
| All statements | Coverage version/status/statementsTotal; assessment counts derived from collected answers |
| Filtered statements | Full backend assessment coverage to detect shifting filtered offsets |
| Original notes | Entry.body and timeline fields; JSON adds normalizedVersion/source; no statements/risk/provenance |
| Timeline | Timeline fields only; JSON adds normalizedVersion/source; no bodies/statements/risk |
| Follow-up page | Statement projection/controls/coverage only; no entries, source summary, dates, normalized versions or body |

Offsets address current evidence, not immutable snapshots. In all mode, arriving
labels cannot shift parsed positions: compare parse coverage/totals, validate
contiguous ordered positions and derive final assessment coverage from collected
items. Some earlier items may still be null when later pages carry new answers;
coverage honestly describes the returned evidence. Zero-unit note statuses remain
authoritative. Filtered mode compares full coverage and matching counts; observable
changes return a retryable rerun error because labels can shift filtered offsets.
All modes validate forward offsets, page counts and nonduplicate ordered keys.
Same-count source edits cannot reliably be detected; no snapshot guarantee.

Core package-intelligence service owns transport/page validation. Shared request
resolution, JSON shaping and the per-tool formatter live in packages/mcp/src/shared;
CLI and MCP supply host-native expansion hints. The small kind-label vocabulary
is shared with upgrade review, whose classification/provenance contract is retained.

## JSON compatibility

The envelope retains registry/name, optional source, mode, entries:{count,items}
and explicit filter. Statement mode adds statements:{count,totalCount,matchingCount,
items,coverage}; count equals items.length after all pages are collected. Entry
version remains present (possibly null), hasChangelog is present for exact JSON.
Default JSON no longer includes raw entry.body or deprecated top-level riskItems/
riskCoverage. Callers needing original bodies use `--verbatim --json` or
`verbatim:true,format:"json"`. Verbose now selects the same original-note JSON
view; it is no longer a text-only expansion option. Both artifacts have minor
pending impact during 0.x. Empty selections and exact releases without notes
remain successful; actual missing packages/versions keep mapped errors.

## Validation and measurements

Verified on 2026-10-14 against dev, using normal CLI authentication. Maximal
filtered JSON operations measured **85 exact / 88 latest-50 / 113 range**, below
500. Admission-only probes add a separately verified 510-cost control (51 fixed
packageVulnerabilities aliases); rejected totals595/598/623 minus510 give those
costs. Resolvers do not execute the rejection probes. Text, unfiltered JSON and
follow-up projections select fewer fields than these maxima.

Built Node CLI and local stdio MCP matched text/JSON for exact/latest/range, all
three filters, empty ranges, missing notes, original-note aliases and timelines.
Observed selected evidence:

| Selection | Parsed / assessed | No impact identified | All pages | Actionable / important |
| --- | --- | --- | --- | --- |
| Express latest10 | 335 / 335 | 284 | 4 | Not measured |
| Express4.20.0 exact | 40 / 40 | 32 | 1 | 6 / 8 |
| Express4.18.2..5.1.0 | 271 / 271 | 228 | 3 | 30 / 43 |
| Biome2.4.2..2.4.15 | 875 / 875 | 813 | 9 | 40 / 62 |

No pending, oversize or unparseable units were observed in these live ranges.
Missing-note is-even1.0.0 succeeded with one WITHOUT_NOTES version and zero units.
Pending/oversize/unparseable and labels arriving between pages are tested with
fixtures. Stored formulations included s-hier-v2, s-hier-v3 and s-hier-v5.

These are complete-output size/timing observations, not a speedup benchmark.
Old built preview+risk text versus new all-statements bytes:

| Selection | Before bytes | After bytes | New built text time |
| --- | --- | --- | --- |
| Express latest10 | 20,039 | 57,029 | 5.907s |
| Express4.20.0 | 2,501 | 6,482 | 2.174s |
| Express4.18.2..5.1.0 | 16,861 | 40,760 | 3.030s |
| Biome2.4.2..2.4.15 | 39,824 | 260,050 | 14.853s |

Initial Biome text runs before the wrapping fix took10.672s and10.218s with
identical259,575bytes; JSON was772,829bytes and took11.570s. Final text above
wraps nested prose and labels predecessor context clearly. These individual
observations include concurrent smoke-validation load, CLI startup/auth and all
required page requests; they do not isolate rendering cost.
Pages are100-unit backend pages (collection and selectors verified in wire tests),
not model spend. The API does not reveal whether labels were initially stored;
no cold-run claim. Complete all output is larger because it includes no-impact
statements and uncapped source evidence; filters reduce the same Biome range to
40 actionable or62 important statements in one page.

Focused core/shared/CLI/MCP/parity/server/smoke, smoke-script and upgrade regression tests passed
567 cases/2,855 assertions; after the wrapping/context correction, the affected
formatter/tool/CLI/parity/upgrade checks passed162 cases/992 assertions. Build,
typecheck and public-package validation passed. Source unauthenticated
CLI/MCP and built Node smoke modes validate registration/auth handling. External
Opus review round2 was clean after fixing continuation wrapping/context wording;
its one independent final review also found no issues. Both reviewed commits
passed Linux/Windows, build, Bun/Node20/22/24/26 and package-validation CI checks. Full live
smoke harnesses could not use macOS keychain authentication under their isolated
HOME (system-keychain-unavailable), without exporting credentials; the affected
feature's live matrix above uses ordinary CLI/local stdio authentication instead.

The descriptor-intent Codex exact-release workload used quick_start,
pkg_changelog(default), pkg_vulns and pkg_changelog(verbatim:true), four logical
calls in25.154s. Its answer cited the rollback and rejected-CVE evidence. Trace
validation had zero isolation violations. This is an inspected trace, not a
quality grade. No new package verdict was inferred from model labels.

The final compact tags use `[!kind]` for action and `[kind]` for should-know,
with `[!]` / `[should know]` when a kind is missing. No-impact statements stay
plain bullets, explained once in the legend; uncertainty stays explicit.
Focused formatter/CLI/MCP/parity/upgrade tests pass165 cases/1,013 assertions,
with build, typecheck and all four source/built credential-free smoke modes
passing. Authenticated dev built CLI/local MCP text parity passes Express4.22.0,
4.20.0 and5.2.1. Express4.20.0 text is5,687bytes versus6,482before shortening
labels; this is output size, not rendering speed. JSON and query selections,
and their measured complexity, are unchanged. The final descriptor-intent
workload uses three logical calls in19.1s and cites rollback/rejected-CVE evidence
with no isolation violations; this is an inspected trace, not a quality grade.
External Opus bracket-tag review and its independent final check have no code
findings. The final check's stale documentation assertion count is corrected.
No unresolved findings or deferred work remain.

## Public skill guidance

The 0.30.0 release branch updates `skills/githits-package` and its reference to
describe all parsed bullets with available classifications,
`--changes actionable|important|all`, explicit `--verbatim` original notes and
timeline `--no-body`. Verbose is a deprecated verbatim alias; changes is ignored
outside statement mode. Raw bodies require verbatim even in JSON. Exact/range
boundaries and upgrade-review routing are preserved; classifications do not
assign a package verdict. Root code, MCP and onboarding skills need no changes
for these package-only flags. Generate/check plugin assets and skill packaging
when changing canonical guidance.

Live CLI/MCP smoke validation checks complete statement, upgrade-review and
verbatim text structurally without applying the compact-output size budget.
Compact previews and timelines retain that budget. Upgrade smoke assertions use
the shared formatter's agent classification heading, coverage and effective
selection. Regression coverage accepts complete reports longer than the compact
budget and still rejects oversized compact defaults.
