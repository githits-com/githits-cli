# Plan: Complete, calmer package-vulnerability CLI output

## Status

- Overall: **READY**
- Phase 1 — CLI text shows every selected advisory and verbose mode adds aligned,
  actionable evidence: **READY**
- Last verified: 2026-09-07

## Problem and expected outcome

`githits pkg vulns npm:jest --transitive --scope all` currently finds 83
historical advisory occurrences across 29 dependency packages but shows only the
first five rows. The CLI requires `-v` to reveal the remaining 78 rows, yet the
main visible effect of `-v` on this all-historical result is a loosely indented
`aliases` row beneath nearly every headline. This makes the output both incomplete
by default and visually restless when expanded.

When this increment is complete:

- CLI text prints every advisory selected by the caller, for direct and transitive
  results, without requiring `-v`;
- compact rows remain one-line, risk-sorted scan targets;
- `-v` only adds evidence that is absent from compact text;
- every transitive detail row begins beneath the dependency package coordinate,
  creating one consistent visual hierarchy; and
- historical transitive rows can explain the advisory with advisory-wide affected
  ranges and fixed versions, without implying that the resolved dependency version
  is affected.

This is a client improvement using the deployed GraphQL contract. It requires no
backend change and remains useful if the backend later gains broader package or
repository intelligence.

## Verified current state and evidence

### Current output contract

- `packages/mcp/src/shared/package-vulnerabilities-response.ts` owns the one shared
  CLI/MCP formatter. `formatAdvisoryList()` and `formatTransitiveRows()` both use
  `DEFAULT_ADVISORY_CAP = 5` unless verbose mode is enabled.
- CLI and MCP already pass a surface discriminator into that formatter, so row
  completeness can differ deliberately without duplicating formatting logic.
- Transitive headlines use a fixed eight-column severity gutter. The package
  coordinate starts at column 12, while `matched`, `nearest fix`, `higher fixes`,
  and `aliases` currently start at column 4. The detail hierarchy therefore shifts
  left of the item it describes.
- Affected transitive occurrences already show occurrence-specific `matched` ranges
  and `nearest fix` evidence in compact output. Verbose mode adds all higher fixes
  and aliases.
- Historical occurrences correctly have empty `matchedAffectedVersionRanges`,
  `fixVersionsAboveResolved`, and `nearestFixedVersion`: those fields describe the
  resolved version, which is not affected. Their current verbose text therefore
  adds aliases but no range or fix context.
- The service already selects `publishedAt` and `modifiedAt` for every transitive
  row, and JSON preserves them. Rendering more dates would add information but would
  not explain why an occurrence is historical or what versions the advisory covers.

### Live package evidence

Authenticated CLI probes on 2026-09-07 established:

- `npm:jest@30.5.1 --transitive --scope all` checks 268 resolved package versions
  and returns 83 advisory occurrences across 29 dependency packages: 0 affected,
  83 historical, and 57 unique advisory IDs.
- 77 of the 83 occurrences carry aliases. Alias-only verbose detail therefore adds
  a second line to almost every result without adding remediation context.
- None of the 83 historical occurrences carries an occurrence-specific matched
  range or higher fix, as required by the backend schema.
- Direct all-scope probes of the first visible dependencies prove that the deployed
  advisory records contain useful advisory-wide evidence:
  - `color-convert` advisory `GHSA-pxx3-g568-hxr4` affects `==3.1.1` and
    `>=3.1.1 <3.1.2`, fixed in `3.1.2`;
  - `color-name` advisory `GHSA-5fvm-p68v-5wmh` affects `==2.0.1` and
    `>=2.0.1 <2.0.2`, fixed in `2.0.2`; and
  - `debug` advisories similarly expose advisory-wide affected ranges and fixed
    versions.

The backend schema confirms that
`TransitiveDependencyVulnerability.advisory.affectedVersionRanges` and
`fixedInVersions` are available. Its field documentation explicitly distinguishes
these advisory-wide facts from occurrence-specific `matchedAffectedVersionRanges`
and `nearestFixedVersion`.

### Contradictions resolved during planning

- “Show all data without `-v`” cannot mean rendering every metadata field in normal
  text: that would make verbose mode non-additive and duplicate JSON. In this plan it
  means showing every advisory row selected by the caller. Compact rows remain
  concise; verbose and JSON retain richer metadata.
- Historical rows cannot use the existing `matched` or `nearest fix` fields because
  empty values are correct evidence, not missing backend data. The plan uses clearly
  labeled advisory-wide ranges/fixes instead of weakening that invariant.
- Removing the cap from MCP default text would turn a Jest audit into at least 83
  rows in an agent turn. The user asked about CLI `-v`; MCP compact text remains
  bounded and routes complete machine consumption to JSON.

## Scope

1. Remove the five-row cap from CLI text for both direct and transitive advisory
   lists.
2. Preserve the existing five-row cap and surface-native completion hint for MCP
   compact text.
3. Align every transitive detail row and continuation beneath the package coordinate,
   not beneath the severity gutter.
4. Add advisory-wide affected ranges and fixed versions to detailed transitive
   responses and render them only for historical rows in verbose text.
5. Keep occurrence-specific matched range, nearest fix, and higher-fix behavior for
   affected rows.
6. Update help, descriptors where their statements become inaccurate, permanent
   implementation documentation, parity/smoke coverage, and release metadata.

## Non-goals

- Changing direct or transitive vulnerability classification, counts, severity
  filtering, scope semantics, sorting, or withdrawn-advisory behavior.
- Grouping rows by dependency package or changing the current global risk-first sort.
- Deduplicating advisory occurrences across resolved dependency versions. Counts and
  rows remain occurrence-based; JSON retains 57 distinct IDs across 83 current Jest
  occurrences.
- Showing aliases in compact text, adding a new detail flag, or removing `-v`.
- Printing advisory publication/modification dates merely to make verbose output
  longer.
- Claiming that an advisory-wide fixed version is an upgrade recommendation for an
  unaffected historical occurrence.
- Backend changes, client-side vulnerability evaluation, another service call per
  dependency, or new infrastructure.

## Target architecture

### Ownership and boundaries

The shared vulnerability response formatter naturally owns row completeness and
visual hierarchy because those are presentation decisions shared by CLI and MCP. The
core package-intelligence service naturally owns conditional GraphQL field selection
and neutral advisory metadata because transport facts must be validated before they
reach either surface. CLI and MCP entrypoints own only the decision that verbose text
or JSON needs detailed advisory fields.

A simpler formatter-only placement was considered. It can fix the cap and indentation
but cannot give historical rows meaningful range/fix evidence because those fields are
not currently selected. Selecting the deployed advisory fields through the existing
service boundary is the smallest complete design; no new module or abstraction is
needed.

The data flow remains:

```text
CLI command / MCP tool
  -> shared request normalization
  -> PackageIntelligenceService
       -> direct advisory query
       -> opt-in transitive audit query
            advisory ranges/fixes selected only for verbose text or JSON
       -> Zod validation and neutral normalized types
  -> shared lean response builder
  -> JSON, or shared surface-aware text formatter
       CLI compact: every selected row
       MCP compact: first five rows + completion hint
       verbose text: every row + aligned detail evidence
```

### Text contract

CLI compact output keeps the present summary, breakdown, one-line headlines, sorting,
sanitization, color, and wrapping. It removes only the row slice and `use -v` footer.
This applies equally to direct and transitive lists so `--scope all` never silently
hides selected CLI rows.

MCP compact output keeps the five-row cap and the existing
`use verbose=true or format=json` hint. MCP verbose text continues to show every row.

Every transitive detail line uses the package-coordinate column as its base:

```text
  MALWARE   color-convert@2.0.1  [historical]  GHSA-pxx3-g568-hxr4  ...
            advisory ranges  ==3.1.1, >=3.1.1 <3.1.2
            advisory fixes   3.1.2
            aliases          CVE-2025-59162, GHSA-ch7m-m9rf-8gvv, ...
```

The detail label column begins at the package-coordinate column. Use one shared detail
label width derived from the longest supported label (`advisory ranges`, 15 columns),
so every detail value starts at the same value column; wrapped values continue at that
value column rather than colliding with labels. Wrapped headline summaries move from
their current eight-space indent to the package-coordinate column. The formatter
derives that coordinate indent from its severity-gutter layout rather than scattering
a second numeric constant. Long atomic package coordinates, advisory IDs, ranges,
fixes, and URLs retain the existing no-split behavior.

For affected occurrences, compact text continues to show `matched` and `nearest fix`;
verbose adds non-redundant `higher fixes` and aliases. For historical occurrences,
verbose renders available `advisory ranges`, `advisory fixes`, and aliases. The word
`advisory` is required on historical range/fix labels: unqualified `affected` or
`fixed in` could wrongly imply that the resolved dependency version needs remediation.

### Structured contract and fetching

Extend each transitive occurrence additively with optional advisory-wide
`affectedRanges` and `fixedIn` arrays, matching the established direct-advisory JSON
vocabulary. Existing occurrence-specific fields and meanings do not change.

Add one internal request-breadth boolean to `PackageVulnerabilitiesParams`. CLI and
MCP set it for verbose text or JSON; compact text leaves it false/omitted. The
transitive GraphQL query conditionally selects only
`advisory.affectedVersionRanges` and `advisory.fixedInVersions` behind a clearly named
directive variable. The direct query is unchanged because it already returns these
fields. JSON remains the complete selected-data surface and therefore always requests
the detailed fields.

This value passes through the existing entrypoint-to-service boundary. The extra
threading is not evidence of misplaced ownership: the entrypoint knows the requested
output mode, while only the service may decide which backend fields that mode needs.

## Assumptions and unknowns

### Assumptions

- The user's reference to `-v` and the earlier CLI-only scope means CLI compact text
  should become complete while MCP compact text remains token-bounded.
- “All data” means all selected advisory rows, not all metadata fields. JSON remains
  the lossless complete envelope and verbose remains additive.
- Direct and transitive CLI lists should follow the same completeness rule; preserving
  the direct five-row cap would make `--scope all` inconsistent.
- The deployed GraphQL schema remains authoritative for advisory-wide range/fix
  semantics. Live direct probes confirm those fields are populated for the reported
  Jest examples.
- Text-v1 may evolve in place. Additive JSON fields do not require migration or a
  versioned envelope.

### Unknowns or product decisions

- None for Phase 1. If product review rejects complete direct CLI history while
  accepting complete transitive history, the scope must be revised before
  implementation; the current plan deliberately favors one predictable CLI rule.

## Cross-cutting considerations

### Security and trust

Advisory IDs, summaries, aliases, versions, and ranges remain untrusted backend data.
Sanitize each field before width measurement or interpolation, preserve ordinary
Unicode, and never place rendered values into executable follow-up commands. JSON
remains lossless through `JSON.stringify`.

### Performance and payload size

This is not an optimization, so no benchmark is required. The default direct-only
network path is unchanged. Compact transitive text keeps its existing graph-analysis
cost and does not fetch advisory-wide detail arrays. Verbose/JSON callers explicitly
request the two extra arrays in the already opt-in transitive query. No N+1 query is
added.

CLI text can become long by design: the caller selected every matching row, and
`--scope`, `--severity`, or omitting `--transitive` are the existing ways to narrow
the result. MCP compact output stays bounded for agent-token safety.

### Compatibility and rollback

The change is additive for JSON and deliberately changes human-readable CLI
completeness. Existing headings, row order, colors, and field meanings remain stable.
Rollback is a normal code revert; there is no state, migration, cache, or feature flag.

### Documentation and release boundary

Update `docs/implementation/cli-commands.md` and `docs/implementation/tools.md` with
the surface-specific completeness rule, verbose hierarchy, occurrence/advisory scope
distinction, and conditional field selection. Update CLI/MCP descriptions only where
their current “default text is capped” wording becomes inaccurate. Add an independent
`changes/*.changed.md` fragment with explicit pending SemVer impact for both `githits`
and `@githits/mcp`; do not edit `CHANGELOG.md` or package versions.

## Phase map

### Phase 1 — complete CLI rows and additive verbose evidence

- **Status:** READY
- **Expected outcome:** CLI users see every selected direct and transitive advisory
  row without `-v`; verbose output is calmer and adds correctly scoped range/fix and
  alias evidence; MCP compact output remains bounded.
- **Assumptions:** The overall assumptions above hold.
- **Unknowns or product decisions:** none.
- **Dependencies:** Current draft PR #356 and its deployed transitive GraphQL fields.
- **Acceptance criteria:**
  - CLI compact direct and transitive output contains every selected row and no row-cap
    footer.
  - MCP compact output still caps rows at five with its MCP-native completion hint;
    MCP verbose output is complete.
  - `-v` changes detail only, never row completeness, on CLI.
  - At 20, 40, 80, and 120 columns, every transitive detail label begins beneath the
    package coordinate, every wrapped detail value continues at the common value
    column, and every wrapped headline summary begins beneath the package coordinate.
    Narrow widths preserve this hierarchy even when the fixed prefix or an indivisible
    atomic value already exceeds the available columns.
  - Affected rows retain occurrence-specific match/fix evidence. Historical verbose
    rows use explicitly advisory-wide range/fix labels and never imply current
    affectedness.
  - Compact text omits the two new advisory arrays on the wire; verbose text and JSON
    select, validate, and preserve them when the backend supplies them.
  - CLI/MCP JSON parity remains exact and existing JSON meanings remain unchanged.
  - Focused/full tests, typecheck, lint, formatting, build/package validation, all
    four smoke suites, real Jest CLI verification, and the targeted package
    vulnerability agent workload pass or have an explicitly verified external
    availability failure.

## Phase 1 detailed implementation plan

### Likely affected components

- `packages/core-internal/src/services/package-intelligence-service.ts` and tests:
  add the internal detailed-advisory selection input, conditional GraphQL fields,
  optional Zod fields, neutral type projection, and compact/detailed wire assertions.
- `packages/mcp/src/shared/package-vulnerabilities-response.ts` and tests: make row
  caps surface-specific, add the two optional lean fields, align detail helpers to the
  package-coordinate column, render historical advisory-wide evidence only in verbose
  mode, and preserve wrapping/sanitization/color parity.
- `src/commands/pkg/vulns.ts` and tests: request detailed fields for `-v` and `--json`,
  update CLI help, and prove normal text is row-complete.
- `packages/mcp/src/tools/package-vulnerabilities.ts` and tests: request detailed
  fields for verbose text and JSON while preserving compact MCP selection and
  descriptor truthfulness.
- CLI/MCP parity fixtures, smoke assertions, permanent implementation docs, and one
  independent release fragment.

### Ordered implementation steps

1. Add failing formatter tests for more than five direct and transitive rows on CLI
   compact, MCP compact, CLI verbose, and MCP verbose surfaces. Assert exact presence
   or absence of completion hints without broad snapshots.
2. Add failing layout tests proving the first detail label and every continuation
   begins at the package-coordinate column across representative widths, colors, long
   atomic values, and Unicode.
3. Add failing service tests for compact versus detailed transitive wire variables and
   field directives. Cover omitted backend detail fields, populated arrays, and
   malformed field shapes at the transport boundary. The GraphQL fields are nullable,
   so selected null values remain valid absence rather than invented empty evidence.
4. Extend the neutral and lean occurrence types, then pass the detailed-selection
   decision from CLI/MCP entrypoints to the existing service call. Keep the request
   builder's registry/filter semantics unchanged.
5. Implement the surface-aware cap policy and one derived transitive-detail indent.
   Use a shared 15-column detail-label width and align wrapped values at the resulting
   value column. Render advisory-wide ranges/fixes only for historical verbose rows;
   retain current affected-row evidence and risk sorting.
6. Update behavioral tests for help/descriptors, CLI/MCP JSON parity, zero/singular
   cases, terminal sanitization, width wrapping, and no-color/color word parity.
7. Update permanent docs and add the release fragment. Do not update the public
   `githits-package` skill until its release-gated lifecycle requires it.
8. Run focused and full verification. Re-run the exact live Jest command with and
   without `-v` at normal terminal width and inspect the first, middle, and final rows,
   historical labels, detail indentation, and absence of a CLI cap hint. Inspect live
   transitive JSON before declaring the UX complete and confirm that at least the
   verified `color-convert`, `color-name`, and `debug` historical occurrences populate
   advisory-wide ranges/fixes through the transitive selection; schema availability and
   direct-query population alone are not sufficient evidence.

### Edge cases and failure behavior

- Zero and singular direct/transitive results retain their current wording.
- An advisory with no aliases, affected ranges, or fixed versions gets no empty verbose
  rows. Do not print a speculative “no fix” statement for an unaffected historical
  occurrence.
- Backend-provided null or empty advisory-wide arrays are valid absence and produce no
  detail row. Malformed field shapes still fail closed at the service boundary.
- Multiple occurrences of one advisory against different resolved dependency versions
  remain separate rows and counts.
- Backend-truncated direct affected ranges retain their current explicit truncation
  hint. The new transitive advisory-wide arrays have no truncation metadata; preserve
  supplied values without inventing a client truncation count.
- Long atomic identities may exceed terminal width but are never split. Splittable
  prose and comma-separated detail values continue to wrap within the caller width when
  the fixed hierarchy prefix plus one splittable token can fit.
- Formatter-owned ASCII punctuation and backend Unicode remain unchanged; color never
  carries affected/historical meaning.

### Verification

Run:

```text
bun test <affected service, formatter, tool, command, and parity tests>
bun test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run validate:packages
bun run validate:packages:mcp-publish
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
bun run agent:e2e -- <targeted package-vulnerability workload>
```

Also verify real packages without snapshotting unstable counts:

- `npm:jest --transitive --scope all` in compact and verbose CLI text;
- one package with currently affected transitive occurrences to verify `matched`,
  `nearest fix`, and non-redundant `higher fixes`; and
- one direct package history with more than five advisories to verify the direct CLI
  cap is gone while MCP compact remains bounded.

Inspect structured output to prove advisory-wide historical fields are present in JSON
and remain distinct from occurrence-specific affectedness fields.

## Plan review

Fable reviewed the plan on 2026-09-07 and found it implementation-ready with no
blocking findings. Four minor findings were accepted and incorporated:

- detail and headline continuation columns are now explicit;
- the shared label pad is fixed to the longest planned label;
- narrow-width acceptance checks hierarchy rather than promising an impossible fit;
  and
- live transitive population of the newly selected advisory fields is a completion
  checkpoint rather than an inference from direct-query evidence.

The reviewer also noted that the MCP handler currently builds an unused lean payload
before formatting text. This was rejected from this plan: it is harmless, unrelated to
the requested output contract, and changing it as an optimization would require the
repository's benchmark-first evidence rather than opportunistic cleanup.

## Phase-boundary reorientation

There is one implementation phase. If it merges separately from draft PR #356, run
`$next-steps` against current `origin/main` before any follow-on package-vulnerability
work. Re-check live counts and the deployed schema; counts are expected to change, but
field semantics and structural assertions must remain stable.

## Completion and plan cleanup

The effort is complete when Phase 1 is merged, permanent implementation docs describe
the final surface-specific contracts, the independent release fragment remains for
release preparation, and no accepted review finding exists only in this plan.

Keep this plan through implementation review. Before deleting it, transfer any durable
formatter, wire-selection, or verification rules discovered during implementation to
`docs/implementation/`, then delete the plan in the implementation PR.
