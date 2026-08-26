# Init setup/uninstall change reporting

## Purpose

`init` and the canonical `uninstall` command make setup auditable by reporting
what changed at each selected target. `githits init uninstall` remains a
compatibility alias for `githits uninstall`.

## Structured and human output

`src/commands/init/setup-format.ts` owns the shared display primitives:

- `SetupChange` and `UninstallChange` describe the operation actually performed
  on each config file, command, skill file, or managed instruction block.
  Config-file changes are `created`, `updated`, or `unchanged`; command changes
  are `ran` or `unchanged`; skill removal is `removed`.
- `ChangeRow` and `renderChangeRows` align fixed-width columns using visible
  text widths, so ANSI styling does not affect alignment. Paths are collapsed
  relative to home and the current project for display.
- `wrapInitProse` is pure and used only at the init/uninstall human-prose
  boundary. It wraps natural-language lines at terminal width with an 80-column
  fallback and 40-column minimum, preserving indentation and hanging bullets.
  JSON, copyable commands, paths/change rows, and raw structured output are not
  wrapped.

Setup handlers preserve partial changes and verification failures. Composite
setups report each executed step and synthesize unchanged rows only for steps
that were already unnecessary. A failed outcome keeps visible changes and a
failure row; it never fabricates a successful cleanup row.

The install report prints per-target changes first, then configured,
already-configured, and failed counts in the Install and verify section. The
Ready/Next Steps section follows those counts and contains only readiness or
reload guidance.

After selection, the MCP summary derives its transport from actual configured
targets: local stdio for non-Cursor targets, hosted remote MCP at
`https://mcp.githits.com` for Cursor-only setup, and both named target groups
for mixed setup. Cursor readiness always calls out separate Cursor OAuth and
the one-time MCP-panel Authenticate action (or `cursor-agent mcp login GitHits`)
followed by tool discovery. Local CLI authentication is labeled as applying
only to non-Cursor integrations in mixed runs.

## Guidance reporting

Guided setup converges the four packaged skill files
(`githits-code`, `githits-mcp`, `githits-onboarding`, and `githits-package`) at
each selected agent's verified active root. Shared roots are deduplicated, and
their Ready/Next Steps output explains that compatible agents reading the root
can discover the skills. Agent-specific managed instruction files remain
separate and are changed only for selected agents.

Guidance outcomes enumerate created, updated, unchanged, removed, and failed
skill files. Guidance-only repairs do not mutate MCP or authenticate. During
uninstall, an all-absent guidance result collapses to one unchanged row, while
removed files and failed paths remain individually visible. Failure reasons are
sanitized; the target path is retained. Guidance contributes to the overall
failure status but not MCP agent counts.

## Uninstall UX

User uninstall uses the same selection model as install: configured tools are
preselected, the user deselects tools to retain, and the selection is the
consent. `--yes` removes all configured user-level MCP targets. Project
uninstall deduplicates project config paths and uses one confirmation.

Without `--keep-guidance`, uninstall independently and best-effort removes all
four active skill files at verified roots plus only the historical CLI-owned
files `<scope>/.cline/skills/githits-mcp/SKILL.md` and
`<scope>/.junie/skills/githits-mcp/SKILL.md`. It preserves unrelated skills,
directories, plugin payloads, and credentials. Removing a shared root can
affect every compatible agent that reads that directory. `--keep-guidance`
preserves both active and historical guidance.

Missing files are successful no-ops. A historical Cline or Junie file is
removed only after a complete active shared skill set has been written and
verified; if active setup fails, the old file remains. A cleanup failure keeps
the active set and reports the exact old path with a generic reason. Later
targets continue after an individual failure.

## Key references

- `src/commands/init/init.ts` — selection, transport summaries, guidance, and
  install/uninstall orchestration.
- `src/commands/init/setup-handlers.ts` — setup and uninstall executors.
- `src/commands/init/setup-format.ts` — structured changes, rows, and prose
  wrapping.
