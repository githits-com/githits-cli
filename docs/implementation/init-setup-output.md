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
Ready/Next Steps section follows those counts and contains readiness, host
sign-in and reload guidance. Section headings are unnumbered because steps vary
by route and existing configuration.

Before confirmation, review names any existing GitHits entries being replaced
and warns that their custom settings are removed; unrelated servers are retained.
It never displays configuration values.

After selection, the MCP summary groups the actual local and hosted targets.
Hosted connections use https://mcp.githits.com; each host owns OAuth and the
new-session tool-discovery step. CLI login only applies to local integrations.
Human hosted-MCP next steps introduce the sign-in block and contain only
authentication actions, grouped under bold tool names with indented prose and
standalone CLI commands. Mixed hosted and local runs group local
authentication under GitHits CLI. The troubleshooting link follows all sign-in
actions. Blank lines separate tools, and the layout also works without color.
Cursor shows its UI sign-in route and the CLI login alternative. A single link
points to the root `TROUBLESHOOTING.md` for verification and recovery,
including Cursor list and list-tools commands. Structured agent output retains
its complete verification instructions and command fields; this presentation
change does not alter them. Configuration is never presented as proof of
hosted readiness. Shared skill-root visibility belongs in the installation
report before Next Steps.

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
guidance-only repair retains the same no-local-CLI-auth behavior.

## Guided hosted sign-in

Human interactive setup checks the selected usable hosted connections after
configuration, including a no-change rerun after skipped sign-in. Native command
capabilities are checked before authentication status. Claude Code user-level
setup, Codex, Kilo and OpenCode versions exposing the dedicated auth-status
subcommand can participate. Unknown, unsupported and in-app-only connections
remain manual, with instructions at the end. Claude project-level sign-in stays
manual because an unapproved project entry can make native checks report a
user-level entry instead.

Init offers **Sign in now** or **Show instructions**, then displays each command
and offers **Run command** or **Skip this tool**. Each login needs its own consent;
commands run sequentially in the user's terminal. The host owns its browser
flow and credential storage. A zero exit code alone is not sign-in success:
init rechecks native status before removing that tool's instructions. These
checks establish host-reported authentication, not tool availability in an agent
session. Skipped or failed sign-ins do not make a successful config write fail.

`src/commands/init/host-auth.ts` owns native capabilities, command context and
consent sequencing; `host-auth-status.ts` classifies captured native status output
without exposing it. `ExecService.execInteractive()` owns inherited terminal
execution and temporary parent SIGINT handling. User-level checks and commands
share an isolated temporary cwd to exclude project overrides; supported relative
home/config path overrides are made absolute against the original cwd in child-only
environment values. Claude's check additionally requires the user scope and
canonical endpoint and stays manual under managed-exclusive MCP configuration.
No host token file is read or copied by GitHits.

Ctrl-C during the native command stops the sequence on signal termination or
exit 130, then prints unresolved instructions; installed configuration survives.
A host that consumes Ctrl-C itself and exits with another failure code remains
unresolved and proceeds to the next explicit command selector. On Windows a
`.cmd` shim may ask **Terminate batch job (Y/N)?**. The process service restores
the terminal mode after the child exits, then removes its signal listener.
On macOS/Linux it snapshots and restores exact POSIX terminal flags using the
standard `stty` command; if that snapshot is unavailable, sign-in stays manual.
Windows uses the native console-mode API.

`--skip-login` and `--yes` leave hosted authentication manual. Detect/staged
install/JSON and non-TTY paths never start this flow. Structured instructions
retain their existing compatibility contract.

## Guidance reporting

Remote guided setup converges only `githits-mcp`; local-first converges all
four canonical skills (`githits-code`, `githits-mcp`, `githits-onboarding`,
`githits-package`). Existing extra skills survive installation. Shared roots
are deduplicated by target path, so mixed preserve profiles request the union.
Agent-specific managed blocks are written only at verified selected targets.
Hosts without a guidance target report that limitation rather than claiming
an instruction write.

Guidance outcomes enumerate created, updated, unchanged, removed, and failed
skill installations. Guidance-only repairs do not mutate MCP or start local CLI
authentication. Human setup can separately offer hosted sign-in for those usable
selected connections. During
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


## Partial failures

Interactive setup exits nonzero when any selected setup fails. It retains
sign-in actions for successfully configured hosted targets even
when another tool fails. Selected already-configured hosted targets retain those
steps during a rerun or guidance-only failure; configuration status does not
prove OAuth readiness. Supported hosted targets can use the separately confirmed
sign-in flow; unresolved targets retain instructions. Probe failures name known
configuration paths and
explain that permissions, syntax and the GitHits entry need checking; they
leave existing config untouched and never echo config contents.

Interactive next steps follow the selected tools. A configured but unselected
host receives no sign-in or tool-discovery instructions. When no tool selector
is needed, the no-op report covers the existing detected setup. Choosing a
guidance repair and then declining keeps that chosen host in the unchanged
report without configuration writes; hosted sign-in still requires both explicit
consent steps. Ordinary tool choices use names;
transport and replacement details belong in the review before confirmation.
Already-configured rows remain disabled when another tool needs setup or a
manual handoff. Use `githits init --detect-agents` to see hosted sign-in steps for
those existing connections.

Interactive prompt rendering belongs to the prompt adapter. It wraps questions,
choice labels/descriptions, disabled reasons and confirmations at word boundaries,
reserving the selector prefix or confirmation suffix columns. Continued labels
retain indentation. Completed answers use concise labels on an indented line;
agent summaries use names without setup qualifiers. Disabled reasons stay on
the row when they fit. Choice values and defaults are unchanged.

Selector help fits a single line at 80 columns. Narrow terminals continue to wrap
between words. Project guidance help includes the committed-file warning on the
same help line.
