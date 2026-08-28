# Plan: Search output information hierarchy

## Status

- Overall: **IN PROGRESS**
- Phase 1a: **COMPLETE**
- Phase 1b: **COMPLETE**
- Phase 2: **PENDING — REPLAN REQUIRED**

Phase 1 merged through PR #317 at `0585e925c9dcc090dbc56b12c8e153829248c15d`
on 2026-08-28. The historical plan was deleted by `d93d36a` while it still
listed Phase 2 as pending. This file restores the remaining lane record; it does
not redesign Phase 2.

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

## Remaining Phase 2 — proven terminal hierarchy across commands

### Expected outcome

Other high-information commands that demonstrably violate the hierarchy proven
by search use the same semantic roles without unrelated copy redesign. Users and
agents see the primary outcome first, actionable warnings and continuations at
full intensity, optional provenance muted, and equivalent meaning without color.
Commands that already satisfy those rules remain unchanged.

### Existing scope

- Audit other user-facing terminal formatters against the Phase 1 hierarchy.
- Select the smallest coherent command cohort with verified hierarchy or
  color-role problems.
- Record permanent cross-command terminal-output guidance after the roles are
  proven outside search.

### Non-goals and constraints

- Do not introduce a theme engine, layout DSL, general rendering framework,
  output mode, or new CLI flag.
- Do not redesign unrelated command copy.
- Do not use color as the only indication of state.
- Preserve JSON structures and automation boundaries.
- Do not absorb raw terminal-content sanitization; that is governed separately.
- Benchmark only if the implementation becomes a performance optimization.

### Dependencies

- Phase 1 is merged and its durable search contract is authoritative.
- Reorientation must use current `origin/main`, representative color/no-color
  output, and the actual shared formatter call graph.

### Acceptance criteria

- Every migrated command has an outcome-first first screenful.
- Warnings and actions are not dimmed, and colors follow documented semantic
  roles.
- No-color output communicates the same state and action.
- The audit explicitly leaves compliant commands unchanged.
- CLI and MCP behavior remains aligned wherever they share a formatter.
- JSON remains unchanged unless a separately verified structured-truth defect is
  part of the approved scope.
- No general rendering infrastructure is introduced.
- Focused, parity, smoke, build, and package checks cover the selected cohort.

## Phase-boundary reorientation — 2026-08-28

The merged ownership correction invalidates the old Phase 2 assumption that the
increment would probably be CLI-only with `@githits/mcp: none`. Current inventory
shows that most candidate high-information formatters are shared by CLI and MCP:
package summary/dependencies/vulnerabilities/changelog/upgrade review, code
files/read/grep, and docs list/read. Resolve and code diff add experimental
surfaces, while languages, init, and MCP setup include separate CLI-only output.

Phase 2 is not implementation-ready because the plan does not yet specify:

- the smallest coherent formatter cohort;
- which observed outputs actually violate the proven hierarchy;
- whether the next increment changes shared MCP text or only CLI styling;
- the resulting per-package release impact;
- representative baseline fixtures and exact parity/smoke tactics; or
- the permanent location and precise content of cross-command guidance.

These are structural planning gaps rather than discoverable implementation
details. Run `$do-plan` to revise Phase 2 before implementation. No product
decision is currently required; the cohort can first be selected from verified
output and codebase evidence.
