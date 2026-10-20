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
  JSON, standalone copyable command lines, paths/change rows, and raw
  structured output are not wrapped; inline commands in prose may wrap.

Setup handlers preserve partial changes and verification failures. Composite
setups report each executed step and synthesize unchanged rows only for steps
that were already unnecessary. A failed outcome keeps visible changes and a
failure row; it never fabricates a successful cleanup row.

The install report prints per-target changes first, then configured,
already-configured, and failed counts in the Install and verify section. The
Ready/Next Steps section follows those counts and contains only readiness or
reload guidance.

After selection, the MCP summary groups the actual local and hosted targets.
Hosted connections use https://mcp.githits.com; each host owns OAuth and the
new-session tool-discovery step. CLI login only applies to local integrations.
Configuration is never presented as proof of hosted readiness. Cursor retains
its copyable login/list/list-tools commands and separate OAuth instructions.

Claude Desktop directory actions are shown in a separate external-action group,
with https://claude.ai/directory/githits. They are not automatic installation
successes/failures. Staged output reports `manual_action_required`,
`manualAction`, and `manualActionIds`; manual targets are excluded from
`installableIds` and `actionableIds`. Explicit staged Desktop requests return
the same handoff. Existing local Desktop config is retained during init.

Staged output reports top-level setupProfile (`remote`, `local`, `preserve`)
and per-agent effective profile/transport. Explicit selectors survive every
suggested install/verification command. Cursor-only staged auth keeps its
existing `managed_by_cursor` shape; other hosted-only targets report
`managed_by_host`, and mixed runs include per-host `remoteAuth` steps. When MCP
setup is needed, the top-level `auth` describes those setup targets. An unchanged
local target selected alongside remote setup does not trigger local sign-in;
guidance-only repair retains the same no-auth behavior.

## Guidance reporting

Remote guided setup converges only `githits-mcp`; local-first converges all
four canonical skills (`githits-code`, `githits-mcp`, `githits-onboarding`,
`githits-package`). Existing extra skills survive installation. Shared roots
are deduplicated by target path, so mixed preserve profiles request the union.
Agent-specific managed blocks are written only at verified selected targets.
Hosts without a guidance target report that limitation rather than claiming
an instruction write.

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

Without `--keep-guidance`, interactive user uninstall best-effort removes the
active and historical guidance targets owned by the selected tools. Guidance
usable by any unselected detected tool is retained, including a shared skill or
managed-block target also used by a selected tool. A selected tool also retains
its guidance when its MCP removal fails. Non-interactive `--yes`,
project uninstall, and user uninstall with no configured MCP targets continue
to clean every verified guidance target in their chosen scope. Cleanup removes
all four active skill files plus only the historical CLI-owned files
`<scope>/.cline/skills/githits-mcp/SKILL.md` and
`<scope>/.junie/skills/githits-mcp/SKILL.md`; including CLI skills present before remote setup; it preserves unrelated skills,
directories, plugin payloads, and credentials. `--keep-guidance` preserves both
active and historical guidance. When cleanup removes a shared skill
root, the output warns that every compatible agent reading that root is
affected.

Missing files are successful no-ops. A historical Cline or Junie file is
removed only after the requested active shared skill subset has been written and
verified; if active setup fails, the old file remains. A cleanup failure keeps
the active set and reports the exact old path with a generic reason. Later
targets continue after an individual failure.

## Key references

- `src/commands/init/init.ts` — selection, transport summaries, guidance, and
  install/uninstall orchestration.
- `src/commands/init/setup-handlers.ts` — setup and uninstall executors.
- `src/commands/init/setup-format.ts` — structured changes, rows, and prose
  wrapping.

Claude connector disconnection belongs to Claude's UI. CLI uninstall removes
only legacy Desktop local config and the normal verified guidance targets; it
does not claim to disconnect that account-level connector.
