# Package changelog evidence

`pkg changelog` and MCP `pkg_changelog` show release-note previews alongside
agent-classified statements. They answer what shipped in selected releases;
upgrade review additionally compares security and dependencies between versions.
Statements and their source links are the evidence. Classification does not
establish an application's compatibility or assign a package-level risk.

## Selection and views

Existing package targets remain unchanged: latest `registry:name`, exact
`registry:name@version`, or range `registry:name@from..to`. The lower bound is
excluded and the upper bound included. Latest uses a 1–50 entry limit; ranges
return all selected entries. Exact uses the backend-selected release, including
prereleases, without inventing a prior version.

Default output retains the first ten logical lines of each note body and adds
classified statements grouped under that release's raw `version`. The normalized
version is available in JSON but is not the statement join key. Per-version
sections separate confident action from possible action, should-know statements
and statements too long to classify. A missing kind still retains its tier.
Uncertainty comes only from the backend `ambiguous` boolean; confidence numbers
are evidence, never a client policy. Labels remain understandable without color.

| CLI `--changes` / MCP `changes` | Statements returned |
| --- | --- |
| `all` (default) | Actionable, should know and too-long statements |
| `actionable` | MUST_ACT, including visibly uncertain MUST_ACT |
| `important` | MUST_ACT and SHOULD_KNOW, including uncertain items |

The backend filters before its 50-item cap. Filtering does not filter release
entries or their note previews. A filter therefore retains context and may still
show other changes in the original notes. Empty optional agent strings mean
`all`; unknown active values fail before service access.

`--no-body` / `omit_bodies:true` preserves the version/date/link timeline and
skips both bodies and classification. `changes` is ignored, including validation
and echo, in that mode. MCP text `verbose:true` keeps its existing override:
notes and classifications are enabled even when `omit_bodies:true`. CLI still
rejects `--no-body` combined with `--verbose`. JSON honors omission despite
verbose because verbose is text-only.

Verbose expands note bodies and locally abbreviated quotes, plus headings and
confidence evidence. Text uses the backend-bounded `text`; a backend cut is
explicitly marked and the complete `fullText` is available in JSON. No-impact
statements appear only as a count. Model and formulation stay per-item JSON
provenance, allowing stored labels from different classifier revisions.

## Coverage and locators

The summary uses backend counts before filtering and capping, never counts of
returned quotes. Confident and uncertain counts remain separate. Version
coverage and no-impact counts likewise cover all selected releases. Only
`itemsOmitted` describes the selected filter: matching statements cut by the cap.
The text labels those scopes explicitly.

Pending versions may still be running or their job may have failed; rerun in a
few seconds to a minute to read completed stored labels. Current backend jobs
share a six-second wait budget and allow at most ten classification batches;
there is no twenty-version ceiling. Missing notes and unparseable statements
are never evidence of no risk. Empty selections and exact releases without
notes remain successful.

Each item uses its own backend `url`, including alternate note sources. Version
headings collect available note locators and the Sources table lists URLs once.
Timeline-level `source` describes the aggregate and cannot identify every
entry's source. Use an item's matching URL/source or exact-release source when
available; otherwise label an entry link generically as Notes. Do not invent
links or infer sources from URL patterns. The original markdown previews remain
available and may themselves contain links. Changelog formatter references use
`[S1]` to stay distinct from note-authored numbered Markdown references; notes
retain their original links. Only rendered headers, quotes and verbose details
admit Sources entries; hidden quote-tail links cannot be admitted by matching
numbers in notes or relative Markdown links. JSON retains original Markdown.

Terminal sanitation runs at presentation only, on notes, quotes, headings,
versions and locators. JSON retains raw evidence with the established lowercase
enum and absent-null conventions.

## Transport and envelope

Backend #3204 added `riskItems` and `riskCoverage` to `PackageChangelogResult`
and `PackageVersionChangelog`, with optional `riskTiers` on `packageChangelog`
and `selectedVersion.changelog`. Its production deployment was confirmed by the
owner on 2026-10-13. Both surfaces reuse existing stored labels and alternate
bodies. Risk computation is lazy when selected, and sibling fields share work.

The client makes one query. Body and risk fields use `includeBodies` directives
so timeline-only calls do not trigger classification. Compact text selects only
consumed statement fields; verbose adds confidence/heading fields. JSON adds
`fullText`, model and formulation. The shared risk schema keeps upgrade-review
provenance required while permitting omitted compact changelog fields. Missing
selected fields are protocol errors; there is no old-schema fallback.

The existing envelope retains `registry`, `name`, optional `source`, `mode`,
`entries: {count, items}` and explicit `filter`. When classification is selected,
add top-level `riskItems` and `riskCoverage`. `filter.changes` echoes only an
explicit, effective view. Timeline-only envelopes retain their earlier shape.

Core transport lives in `package-intelligence-service.ts`; shared request,
envelope and per-tool formatter live under `packages/mcp/src/shared`.
`changelog-risk-presentation.ts` owns the small statement presentation primitives
also consumed by upgrade review. CLI and MCP handlers select modes and supply
host-native note expansion hints.

## Verified complexity

Authenticated dev admission measurements on 2026-10-13: exact **56**, latest
with 50 entries **65**, and range **90** for the maximal client JSON selections,
below the 500 limit.
A verified 510-cost control operation (51 fixed-cost packageVulnerabilities aliases)
was added only to admission probes, which were rejected before resolvers;
subtracting 510 from 566/575/600 gives the client costs. Product calls remain
a single query. Runtime directives can still count statically.

## Validation

Unit coverage checks wire selections for each output mode, filter-before-cap
variables, CLI/MCP parity, pending and empty coverage, missing notes, omitted and
truncated statements, source attribution, raw-version joins, terminal sanitation
and preserved JSON evidence. Shared helpers retain upgrade-review regressions.
Source and built CLI/MCP smoke suites, build and typecheck passed.

Authenticated dev CLI/local MCP checks on 2026-10-13 covered exact, latest and
range targets, each filter, empty ranges, releases without notes and no-body
timelines. Biome 2.4.2..2.4.15 returned 50 statements with 12 omitted for `all`,
and 40 with none omitted for `actionable`. All-tier counts stayed unchanged.
Express 5.0.0..5.2.1 had four classified versions and none pending; the warm
request kept the same coverage. Stored labels covered multiple formulations.
Cold pending coverage was tested with fixtures, not observed live.

The exact-release Codex agent workload with explicit GitHits intent used
`quick_start` and `pkg_changelog` in default and verbose modes, with no isolation
violations. Its answer preserved uncertainty and cited the rollback evidence.
The neutral-intent run made no tool calls. These are inspected traces, not graded
quality results.

## Release guidance staging

Keep published `skills/githits-package` unchanged until this behavior is in its
release branch, following `.agents/skills/githits-release/SKILL.md`. At release:

- In SKILL.md, add an example `githits pkg changelog npm:express --changes important`.
- Expand the changelog routing sentence: "Release-note previews include
  agent-classified statements by default. Use `--changes actionable` for action
  statements or `--changes important` for action plus should-know statements;
  these filter classifications, not note previews. `--no-body` remains a compact
  timeline and skips classification, so `--changes` is ignored there."
- In references/package.md, add `--changes actionable|important|all` to changelog
  flags and the same filtering/body-omission distinction. Retain range boundaries,
  exact selection and upgrade-review routing. Do not add a package verdict.

Run plugin generation/check and skill packaging tests when applying those
canonical release edits. No generated plugin input changes in this feature PR.
