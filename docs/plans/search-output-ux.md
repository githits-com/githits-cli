# Plan: Shared text output information hierarchy

## Status

- Overall: **IN PROGRESS**
- Phase 1a: **COMPLETE**
- Phase 1b: **COMPLETE**
- Phase 2a (`pkg_upgrade_review`): **COMPLETE**
- Phase 2b+ (one formatter per increment): **PENDING**

Phase 1 merged through PR #317 at `0585e925c9dcc090dbc56b12c8e153829248c15d`
on 2026-08-28. Phase-boundary reorientation found that the same output problem
exists outside search, but the formatter ownership is shared by CLI and MCP.
The remaining work therefore proceeds as one shared formatter per increment.
Phase 2a is the first such increment and is complete. Later formatters remain
unselected until this increment merges and post-merge `$next-steps` reorients
the plan.

## Overall objective

High-information CLI output and MCP `text-v1` should expose the same compact,
scannable evidence hierarchy through one formatter per tool. The first screenful
states what was returned, related evidence stays grouped, warnings and recovery
actions remain visible, color reinforces rather than carries meaning, and JSON
remains the lossless programmatic contract.

### Overall assumptions

- CLI and MCP users both benefit from the same text anatomy; ANSI enablement and
  terminal width are rendering inputs, not reasons to fork the formatter.
- Existing backend response fields are sufficient for the Phase 2a hierarchy.
- Per-tool increments are intentionally preferred over a cross-tool formatter
  migration because the search merge showed that output review depends on
  tool-specific evidence and exact follow-up semantics.

### Overall unknowns or product decisions

- **Later phases only:** which formatter follows `pkg_upgrade_review`. Resolve at
  each merge boundary from observed output and current `origin/main`.
- **Phase 2a:** none. The user selected per-tool increments on 2026-08-28, and
  repository evidence selects `pkg_upgrade_review` as the first formatter.

### Overall dependencies

- Phase 1's shared search formatter and permanent hierarchy documentation.
- Existing shared formatter ownership in `packages/mcp/src/shared/`; no backend,
  schema, migration, or service rollout is required.

### Overall acceptance criteria

- Each migrated tool has one shared CLI/MCP formatter and one reviewed increment.
- Default text is outcome-first, groups related evidence, and keeps fixed
  locators intact while wrapping free-form prose to the caller's width.
- Formatter-authored punctuation is ASCII; backend Unicode remains verbatim.
- ANSI-free output carries the same words, order, evidence, and actions.
- JSON, request construction, backend field selection, and error envelopes stay
  unchanged unless a separately verified defect is explicitly added to scope.
- Commands already meeting the hierarchy are not cosmetically rewritten.
- No theme engine, layout DSL, rendering framework, output mode, or new flag is
  introduced.

## Completed Phase 1 outcome

Search and search-status now use one shared outcome-first formatter for CLI
human output and MCP `text-v1`. The merged behavior:

- groups readiness and trust facts by target instead of repeating backend state;
- retains surface-native continuation actions while sharing all other anatomy;
- preserves the backend's exact `partialResults` truth in JSON;
- keeps ranked, locator-first hits actionable for `docs_read` and `code_read`;
- uses ASCII formatter punctuation while preserving backend Unicode verbatim;
- keeps fixed locators intact and wraps only free-form title tails;
- restores semantic ANSI hierarchy and backend title-match highlighting; and
- leaves JSON as the complete structured/programmatic boundary.

Durable contracts now live in:

- `docs/implementation/tools.md`
- `docs/implementation/cli-commands.md`
- `docs/implementation/mcp-cli-parity.md`

### Merge and verification record

- Merge baseline: `origin/main` at
  `0585e925c9dcc090dbc56b12c8e153829248c15d`.
- PR checks passed on Ubuntu and Windows, Bun, Node 20/22/24/26, build/checks,
  and MCP package validation.
- The final post-runtime full local suite passed 3,461 tests with 0 failures.
- Final validator-only suites passed 41 MCP smoke tests and 53 CLI smoke tests.
- Typecheck, build, Biome, and diff checks passed.
- Authenticated source smoke passed 89 CLI steps and 46 MCP steps; built Node
  CLI and MCP smokes passed.
- Luna preflight was clean. Retained Opus rounds found the delimiter, wrapping,
  ANSI, title-highlight, and wrapped-validator defects; their prescribed fixes
  are present in the merge. The last two-line mirrored validator correction was
  verified by focused tests, inline review, Luna preflight, and CI.

### Deployment record

- Main, root Release, and MCP Package Release workflows completed successfully
  for the merge SHA.
- The change remains represented by
  `changes/search-output-hierarchy.changed.md` for the next prepared patch
  release.
- npm still reports `githits@0.11.1` and `@githits/mcp@0.11.1`; this increment
  is merged but not yet included in a newly versioned npm release.

## Verified Phase 2 current state

### Formatter ownership

The high-information command candidates are not CLI-only renderers. CLI commands
and MCP tools build the same lean response and call the same formatter in
`packages/mcp/src/shared/`; CLI passes `useColors` and, where supported, the
current terminal width, while MCP emits ANSI-free `text-v1`. For
`pkg_upgrade_review` specifically:

1. `src/commands/pkg/upgrade-review.ts` builds the shared request and response,
   then calls `formatPackageUpgradeReviewTerminal` for non-JSON output.
2. `packages/mcp/src/tools/package-upgrade-review.ts` performs the same operation
   and calls the same formatter for `text` / `text-v1`.
3. `packages/mcp/src/shared/package-upgrade-review-response.ts` owns both the
   normalized public response and all text anatomy.
4. CLI `--json` and MCP `format: "json"` already have deep-equality parity tests.

This is the correct ownership boundary. Phase 2a changed the shared formatter in
place; it did not create a second human renderer or move rendering into either
entrypoint.

### Representative output audit

Authenticated `NO_COLOR=1` source runs on 2026-08-28 established these baselines:

| Tool                                                | Observed state                                                                                                                                       | Disposition                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `pkg info npm:express`                              | Compact identity, description, and labelled facts; optional links are already provenance.                                                            | Leave unchanged.                         |
| `pkg vulns npm:express@4.18.0`                      | Outcome and severity precede grouped advisory details; affected state has explicit words.                                                            | Leave unchanged.                         |
| `pkg deps npm:express@5.2.1`                        | Useful hierarchy, but the actionable hidden-groups hint is dimmed.                                                                                   | Preserve for a later one-tool increment. |
| `pkg changelog npm:express --from 5.1.0 --to 5.2.1` | Strong timeline anatomy, but truncation actions are dimmed when present.                                                                             | Preserve for a later one-tool increment. |
| `pkg upgrade-review npm:express@4.18.0 --to 5.2.1`  | Internal `pkg_upgrade_review` header, six dense `key=value` summary rows, identical cyan roles for unrelated levels, and lines up to 199 characters. | Phase 2a.                                |
| `resolve express`                                   | Ranked candidates, concise evidence, and one next action are already scannable.                                                                      | Leave unchanged.                         |
| `code files npm:express@5.2.1 --verbose`            | Strong file inventory, but pagination and recovery hints are dimmed.                                                                                 | Preserve for a later one-tool increment. |
| `code grep npm:express@5.2.1 router --verbose`      | Strong grouped matches, but cursor and narrowing actions are dimmed.                                                                                 | Preserve for a later one-tool increment. |
| `docs list npm:express@5.2.1`                       | Actionable page IDs are retained, but read/cursor/staleness lines share dim styling.                                                                 | Preserve for a later one-tool increment. |

The no-transitive Express upgrade baseline is 36 lines, 194 words, and 1,700
bytes, with a 199-character longest line. The default transitive run is longer
and repeats the same dense anatomy. These measurements are descriptive UX
baselines, not a performance benchmark or a target that justifies dropping
evidence.

The saved agent baseline is
`.agent-eval/runs/upgrade-review-output-baseline-claude-20260828`, produced by:

```bash
bun run agent:e2e --agent claude --server local --guidance-profile descriptors --timeout 600 --out .agent-eval/runs/upgrade-review-output-baseline-claude-20260828 --workload eval/agentic/workloads/package-upgrade-safety.md
```

The baseline metadata does not establish a controlled model/mode pairing; its
captured seven-package request omitted `format` and produced the shared default
text: 9,513 bytes, 970 words, 133 lines, and a 289-character longest line. The
workload completed successfully, rated GitHits helpful with high confidence,
and exposed four package-level unknowns. The run also found a separate recovery
gap: the unknown for package-version changelog fallback does not tell an agent
that a repository-addressed changelog may contain release bodies. The current
response does not carry the repository URL needed for an exact recovery action,
so Phase 2a preserves and highlights the unknown but does not invent a backend
locator or add a service call. Other code/docs/search issues from the workload
are outside this one-formatter increment.

### Contradictions resolved at reorientation

- The old `@githits/mcp: none` release assumption was false: changing this
  formatter changes MCP default text as well as CLI terminal output.
- The old cohort-sized Phase 2 was too broad. The user explicitly selected one
  formatter per increment after the search formatter required several detailed
  review rounds.
- Existing permanent documentation calls `text-v1` compact and shared, while
  the upgrade-review example still documents the internal, dense shape. Phase
  2a updated that documentation rather than preserving the stale example.

## Target architecture and cross-cutting contracts

### Boundaries and data flow

The existing data path remains:

```text
CLI command / MCP tool
  -> shared request builder
  -> package-intelligence service
  -> shared normalized UpgradeReviewResponse
  -> one shared upgrade-review text formatter
       CLI: ANSI enabled when supported; caller terminal width
       MCP: ANSI disabled; 80-column fallback
```

The formatter may add small private pure helpers inside the existing response
module for grouping, pluralization, wrapping, and semantic styling. It must not
add cross-tool rendering infrastructure. Fixed identifiers, package coordinates,
versions, advisory IDs, and URLs remain intact; only formatter-owned free-form
summaries, excerpts, and guidance wrap with hanging indentation.

### Semantic roles proven by search and upgrade review

- Primary outcome: bold, first line, plain words without an internal tool name.
- Package identity: emphasized and visually stronger than its evidence sections.
- Section headings: bold, not the same cyan treatment as the package identity.
- Attention evidence: explicit words plus yellow emphasis when ANSI is enabled;
  this includes added/still-present vulnerabilities, target deprecation,
  heuristic change signals, and unknown evidence. Yellow means “inspect this
  fact,” not a risk rating.
- Provenance: dates and source URLs may be dimmed when they are secondary to the
  evidence. Trust qualifiers and actions are never dimmed.
- Positive factual changes such as fixed advisories remain plain; the formatter
  does not turn them into approval or safety claims.
- ANSI removal changes styling only. Formatter-authored punctuation is ASCII.

### Compatibility, security, performance, and rollback

- JSON shape, request validation/defaults, GraphQL variables/selections, service
  calls, error envelopes, and `text` as an alias of `text-v1` remain unchanged.
- No raw backend string is interpreted as terminal control data and no new
  sanitization policy is introduced in this increment.
- Formatting stays pure and linear in the already bounded response. This is a
  UX change, not a runtime optimization; no performance benchmark is required.
- The change is an in-place unstable `text-v1` revision. Rollback is a normal
  revert of the formatter/docs/tests fragment; there is no flag or migration.
- Both `githits` and `@githits/mcp` receive patch release impact in a new,
  independent `changes/*.changed.md` fragment.

## Phase map

### Phase 1a — shared search semantics and MCP text become outcome-first

- Status: **COMPLETE**
- Expected outcome: structured search truth and MCP text distinguish lifecycle,
  readiness, evidence, and actions without duplicate status prose.
- Assumptions: backend structured fields are authoritative.
- Unknowns or product decisions: none.
- Dependencies: unified-search response contracts.
- Acceptance: delivered and verified through PR #317; no Phase 1a work remains.

### Phase 1b — CLI search uses the same hierarchy and useful color

- Status: **COMPLETE**
- Expected outcome: CLI search/search-status use the same formatter as MCP while
  supplying ANSI, terminal width, and CLI-native actions.
- Assumptions: the shared presentation boundary can own both surfaces.
- Unknowns or product decisions: none.
- Dependencies: Phase 1a.
- Acceptance: delivered and verified through PR #317; duplicated private CLI
  formatting was removed and full CI/smoke/review evidence passed.

### Phase 2a — upgrade-review evidence becomes scannable

- Status: **COMPLETE**
- Delivered outcome: humans and agents can scan an upgrade review from package
  identity through security, change, dependency, and missing-evidence groups
  without decoding internal labels or dense `key=value` rows.
- Assumptions: current normalized response fields are sufficient; no evidence is
  intentionally removed.
- Unknowns or product decisions: none.
- Dependencies: Phase 1 semantic roles and current shared upgrade-review response.
- Acceptance: met; deterministic, smoke, build, package, review, and eval evidence
  is recorded below.

### Phase 2b+ — remaining verified formatter violations are corrected one tool at a time

- Status: **PENDING**
- Expected outcome: each later increment corrects one currently verified
  hierarchy or action-visibility problem without absorbing adjacent tools.
- Assumptions: the verified shared semantic roles remain useful for future
  increments outside search without requiring a general framework.
- Unknowns or product decisions: exact next tool. Resolve after Phase 2a merges by
  running `$next-steps` against current output; do not select it during Phase 2a.
- Dependencies: Phase 2a merged and reorientation complete.
- Acceptance: the selected tool's words, hierarchy, no-color equivalence, parity,
  and smoke behavior are independently reviewed; unrelated tools are unchanged.

## Phase 2a detailed implementation plan

Phase 2a is implemented and verified. The sections below retain the intended
behavior, implementation boundary, edge cases, and acceptance history.

### Exact behavioral outcome

The first line is `Upgrade review - N package(s)`. When the response contains
more than one review, always add one `Across packages:` aggregate line directly
beneath it; omit that line for zero or one review. Its stable clause order is:

1. `N with evidence gaps`;
2. `N with added direct vulnerabilities`;
3. `N with added transitive vulnerabilities`, or `transitive security not checked` when every review omits transitive evidence; when only some reviews
   omit it, also append `N without transitive security evidence`;
4. `N with heuristic change signals`; and
5. `N with direct dependency changes`.

Join clauses with `|` and wrap continuation lines beneath `Across packages:`.
Keep zero counts: they are useful batch evidence and avoid implying that an
omitted category was not checked. Each package then forms one block in this
order:

1. package coordinate, current/target versions, and version delta;
2. `Security`, including direct and optional transitive summaries followed by
   only the non-empty advisory detail groups;
3. target deprecation when present;
4. `Changes`, including an exact source label, entry/body coverage, transparent
   heuristic signals, and representative entries;
5. `Compatibility` when peer metadata or notes exist;
6. `Dependencies` when dependency-change evidence exists;
7. `Dependency issues` whenever the backend returns that evidence: show the
   introduced issue details when non-empty, otherwise `none introduced` with
   the current and target totals; and
8. `Unknown evidence` last, at full attention intensity.

Zero facts remain explicit in the section summary where they answer the upgrade
question, but empty detail headings are omitted. Changelog source labels use the
fixed mapping `releases` -> `Repository releases` and `package_versions` ->
`Package versions (no release notes)`; any other non-empty normalized source is
shown verbatim, without inferring a provider. Existing sibling sample limits and
verbose expansion remain unchanged. Dependency-issue locator categories
intentionally show up to five rows each in default text with an exact remainder;
`verbose` expands those categories fully. “Fixed,” “added,” “still present,” “not
checked,” “not returned by backend,” and “heuristic” stay distinct. No line
claims that an upgrade is safe, risky, approved, or rejected.

Representative default shape for the verified Express response:

```text
Upgrade review - 1 package

npm:express 4.18.0 -> 5.2.1 (major)

Security
  Direct: 2 affected -> 0 affected | 2 fixed | 0 added | 0 still present
  Transitive: 6 affected packages -> 0 | 6 fixed | 0 added | 0 still affected

  Fixed direct advisories
  - GHSA-rv95-896h-c2vc | medium (6.1)
    Express.js Open Redirect in malformed URLs
    Fixed in: 4.19.2, 5.0.0-beta.3

Changes
  Repository releases | 18 entries | 1 with release notes
  Heuristic signals: 1 entry (breaking)
  ...

Dependencies
  Direct: 3 added | 6 removed | 25 changed
  ...
  Transitive: 4 added | 6 removed | 26 changed
  More transitive details are available with verbose output.
```

This is an anatomy contract, not a byte-for-byte snapshot of live backend data.
Tests use fixed fixtures and exact structural assertions.

### Affected components and responsibilities

- `packages/mcp/src/shared/package-upgrade-review-response.ts`
  - Keep response normalization unchanged.
  - Replace only the formatter-owned text anatomy and add private pure helpers.
  - Keep the wrapping helper formatter-local for this per-tool increment. Do
    not move either existing search or package-summary wrapping code: no exact
    stable shared abstraction has been established, and doing so would widen
    the production review surface beyond this formatter.
  - Add `terminalWidth?: number`; use an 80-column fallback and clamp configured
    widths to a 20-column minimum, matching the shared search formatter.
  - Wrap free-form prose with hanging indentation while leaving fixed locators
    intact.
- `src/commands/pkg/upgrade-review.ts`
  - Continue calling the shared formatter; additionally pass
    `process.stdout.columns`.
- `packages/mcp/src/tools/package-upgrade-review.ts`
  - Continue calling the same formatter without ANSI or a surface fork; default
    width remains 80.
- Co-located formatter/tool/command/parity tests
  - Replace assertions that require the internal `pkg_upgrade_review` header.
  - Add exact fixture anatomy, batch, ANSI, no-color, wrapping, ASCII-authored
    punctuation, evidence-preservation, and CLI/MCP text-equivalence coverage.
- `scripts/cli-smoke.ts` and `packages/mcp/src/smoke-test.ts`
  - Assert the new outcome header, package locator, evidence sections, and the
    continued absence of assessment language without snapshotting live metadata.
- Permanent docs
  - Update `docs/implementation/pkg-upgrade-review.md` with the new text anatomy.
  - Update `docs/implementation/cli-commands.md`, `tools.md`, and
    `mcp-cli-parity.md` only with the upgrade-review-specific shared width,
    semantic roles, and in-place `text-v1` behavior; do not broaden unrelated
    cross-command guidance in this increment.
- Canonical agent guidance
  - Add a concise tool-output UX contract to `AGENTS.md`: human-readable text is
    a deliberately optimized product surface, not a serialization of available
    fields; preserve verified strengths before changing it; lead with the
    outcome, group related evidence, remove repetition, retain stable follow-up
    locators, wrap prose to the caller's width, keep authored punctuation ASCII,
    and never make color carry meaning.
  - Keep one shared CLI/MCP text formatter per tool when their information needs
    match; pass color and width as rendering inputs. Keep JSON as the lossless
    machine-readable surface.
  - Follow the canonical plugin workflow: do not edit generated assets directly;
    run generation and stale-output validation, then inspect whether the
    `AGENTS.md`-only input produces any generated diff.
- Release fragment
  - Add one new fragment with `githits: patch` and `@githits/mcp: patch`; do not
    edit the existing search fragment or `CHANGELOG.md`.

### Ordered implementation steps (completed)

1. Strengthen fixed response fixtures so they cover clean evidence, added and
   fixed advisories, deprecation, transitive truncation, change signals,
   dependency changes/issues, unknowns, and a two-package batch.
2. Lock the target ANSI-free anatomy and wrapping behavior in formatter tests,
   including preservation of all evidence categories and sibling sample caps;
   dependency-issue categories additionally use the verified five-row default
   cap with an explicit remainder and complete verbose expansion.
3. Refactor only `formatPackageUpgradeReviewTerminal` and its private formatting
   helpers to produce the grouped hierarchy; leave normalization and service
   code untouched.
4. Pass the CLI terminal width and verify that the MCP call still uses the same
   formatter with the 80-column default.
5. Add ANSI-role and ANSI-stripped equality tests. Attention rows must include
   words that carry the meaning before yellow is applied; provenance alone may
   be dim; verbose/recovery guidance must not be dim. Apply attention color with
   `colorize(..., "yellow", useColors)`; do not use `warning()`, which adds a
   non-ASCII glyph and changes the no-color text.
6. Update structural live smoke assertions, permanent docs, canonical
   `AGENTS.md` tool-output guidance, and the independent two-package release
   fragment. Run plugin generation from canonical inputs and inspect its output;
   do not hand-edit generated assets.
7. Run focused tests, full tests, typecheck, lint/format checks, both source smoke
   suites, build, both built smoke suites, and public-package validation.
8. Re-run the existing `package-upgrade-safety.md` Claude descriptor eval against
   the local implementation with the same effective model and compare its raw
   `stdout.json`, `tool-calls.json`, `final.json`, default-text response volume,
   `toolIssues`, `instructionIssues`, and usefulness with the recorded baseline.
   The qualitative eval informs review; it is not a deterministic CI gate.

### Edge cases and failure behavior

- One package versus batch grammar and aggregate package counts.
- Zero reviews, even though valid requests normally produce at least one: render
  `Upgrade review - 0 packages` without inventing evidence.
- Missing current/target security summaries retain `unknown` wording.
- Transitive security omitted by caller remains `not checked`, not zero.
- Backend-capped transitive detail retains the exact undisclosed count and does
  not imply verbose can recover backend-omitted rows.
- Empty changelog bodies remain different from no changelog source and from a
  sampled response.
- Backend Unicode in summaries/excerpts is preserved; only formatter punctuation
  is constrained to ASCII.
- Long URLs and coordinates remain unbroken even when they exceed the terminal
  width; adjacent free-form text wraps beneath its semantic parent.
- JSON and mapped errors bypass the text formatter and therefore remain exact.

### Verification commands (completed)

```bash
bun test packages/mcp/src/shared/package-upgrade-review-response.test.ts packages/mcp/src/tools/package-upgrade-review.test.ts src/commands/pkg/upgrade-review.test.ts src/tools/package-upgrade-review-parity.test.ts
bun test
bun run typecheck
bun run format:check
bun run lint
bun run plugins:generate
bun run plugins:check
bun run smoke:cli
bun run smoke:mcp
bun run build
bun run smoke:cli:built
bun run smoke:mcp:built
bun run validate:packages
bun run agent:e2e --agent claude --model claude-fable-5 --server local --guidance-profile descriptors --timeout 600 --out .agent-eval/runs/upgrade-review-output-phase2a-after --workload eval/agentic/workloads/package-upgrade-safety.md
bun run agent:e2e:report --compare .agent-eval/runs/upgrade-review-output-baseline-claude-20260828 .agent-eval/runs/upgrade-review-output-phase2a-after
comparison_dir=$(mktemp -d)
for run in upgrade-review-output-baseline-claude-20260828 upgrade-review-output-phase2a-after; do
  jq -rs '[.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "mcp__githits__pkg_upgrade_review") | .id] as $ids | [.[] | select(.type == "user") | .message.content[]? | select(.type == "tool_result" and (.tool_use_id as $id | $ids | index($id))) | .content[]? | select(.type == "text") | .text] | first' ".agent-eval/runs/$run/workloads/package-upgrade-safety/stdout.json" > "$comparison_dir/$run.txt"
  wc -l -w -c "$comparison_dir/$run.txt"
  awk '{ if (length($0) > max) max = length($0) } END { print "max-line=" max }' "$comparison_dir/$run.txt"
done
diff -u "$comparison_dir/upgrade-review-output-baseline-claude-20260828.txt" "$comparison_dir/upgrade-review-output-phase2a-after.txt"
```

### Phase 2a acceptance criteria

- Default CLI and MCP text begin with `Upgrade review - N package(s)` and never
  expose `pkg_upgrade_review` as a human header.
- Every normalized evidence category currently rendered remains represented;
  the new hierarchy drops scaffolding, not facts.
- Security, change, compatibility, dependency, issue, and unknown evidence stay
  in their own package-local groups.
- A returned zero-valued dependency-issue comparison says `none introduced`;
  an omitted comparison remains omitted rather than pretending it was checked.
- Dense machine-like summary rows are replaced with grammatical labels and
  bounded lines; fixture free-form text wraps at the configured width.
- Fixed package/advisory/version/URL locators are not split or removed.
- Attention meaning is explicit without ANSI; CLI yellow emphasis adds no new
  words or state. Actions and trust limits are never dim.
- Formatter-authored punctuation is ASCII while backend Unicode survives.
- `AGENTS.md` records the durable human-readable tool-output UX contract and
  plugin generation/checking remains clean from canonical inputs.
- With the same width and ANSI disabled, CLI terminal text and MCP `text-v1`
  are equivalent apart from the CLI's trailing newline transport convention.
- CLI `--json`, MCP `format: "json"`, request/service behavior, GraphQL field
  selection, and errors are byte/structure compatible with the pre-change path.
- Source and built smoke suites accept the new structure and continue rejecting
  assessment language.
- The after agent eval ran against local `pkg_upgrade_review` successfully, but
  its Fable model and requested `verbose=true` mode were not controlled against
  the baseline's unspecified model/default mode; the comparison is diagnostic,
  not a controlled before/after improvement claim.
- No production file outside the shared formatter and the CLI width call site is
  changed unless implementation evidence proves it necessary and the plan is
  updated before that expansion.

### Phase 2a completion record

The increment delivered one shared CLI/MCP `pkg_upgrade_review` formatter in
place. ANSI enablement and terminal width are inputs; MCP remains ANSI-free at
the 80-column default. JSON, service, GraphQL field selection, request
construction, and mapped error paths are unchanged. The durable `AGENTS.md`
tool-output UX contract was added, and canonical plugin generation/checking
remained clean.

Deterministic and product verification completed as follows:

- The focused four-file suite passed with 29 tests and 155 assertions. The full
  `bun test` passed with 3,486 tests, 0 failures, and 11,211 assertions after a
  test-only `process.stdout` descriptor leak was fixed.
- Typecheck, format, and lint checks passed. Plugin generation/checking passed
  for 10 canonical assets with no generated diff.
- Authenticated source CLI and MCP stable/experimental smokes passed; the build
  passed; built CLI and MCP Node smokes passed; and public-package validation
  passed.
- Real Express default output was inspected. Normal 80-column free prose is
  bounded, while fixed locators remain intentionally unsplit.

Review and evaluation truth is also recorded explicitly: Luna preflight
findings were fixed; the single internal reviewer finding (parity process-state
leak) was fixed; and three actual Claude Opus rounds completed, with round-1
and round-2 findings fixed and the final round clean.
The retained terminal session is not a durable plan requirement.

The after run at
`.agent-eval/runs/upgrade-review-output-phase2a-after` succeeded in 363.4
seconds, used 10 unique GitHits tools across 35 raw events, and rated GitHits
`helped` with medium confidence. Its Fable run requested `verbose=true`, while
the baseline used unspecified model/default mode, so that comparison is not
mode- or model-controlled and is diagnostic only. A direct same-argument
default batch measurement produced 236 lines / 1,122 words / 10,270 bytes,
with a 135-character maximum caused by a long fixed locator; the saved legacy
default measured 133 / 970 / 9,513 / 289. The new output is approximately 8%
larger in bytes, but has dramatically shorter machine rows and a grouped scan
hierarchy. This is not a token-reduction claim.

The evaluation also surfaced material findings that require backend or
tool-contract work outside this formatter-only increment: registry-mode empty
changelog bodies can undercount release notes; a Biome changelog response can
be oversized; repository-commit versus published-tarball target identity is
ambiguous; and TypeScript release-note/docs evidence is weak. Transient
indexing and search-quality observations are evaluation diagnostics as well.
These findings are deferred and are not silently converted into Phase 2a
requirements.

## Phase-boundary reorientation and completion

After Phase 2a merges, run post-merge `$next-steps` against fresh `origin/main`.
Record the
actual CLI/MCP output, review findings, test/smoke/eval evidence, release state,
and whether the semantic roles held without cross-tool infrastructure. Then
select at most one next formatter from the verified candidates and add tactical
detail only for that increment.

The overall effort is complete when reorientation finds no remaining verified
high-information hierarchy/action-visibility violation worth a formatter
increment, all durable contracts live under `docs/implementation/`, and every
change fragment has the correct pending public-artifact impact. Transfer any
remaining durable knowledge, then delete this temporary plan; do not leave a
completed plan in `docs/plans/`.
