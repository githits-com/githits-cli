# Init setup/uninstall change reporting

How `init` and `init uninstall` report, per coding tool, what changed during
configuration. Implements GitHub issue #156 and the uninstall UX unification.

## Goal

Make setup auditable: each tool row shows the config file path with a
created/updated/unchanged verb, or the command(s) run for CLI-configured tools.
Install and uninstall share one renderer and read consistently.

## Pieces

- `src/commands/init/setup-format.ts` — pure, IO-free, unit-tested:
  - `SetupChange` / `UninstallChange` — structured per-target changes. The verb
    describes the action **actually taken** on the target, so config files and
    commands read consistently across install/uninstall. Config-file verbs:
    `created` | `updated` | `unchanged`. Command verbs: `ran` | `unchanged`.
    Uninstall never deletes a shared config file — it strips the GitHits entry
    and rewrites the file, so that is an `updated`, not a `removed`. A command
    is `ran`, never `removed`.
  - `ChangeRow` + `renderChangeRows` — the shared display unit. Fixed-width
    columns; padding is applied to raw text **before** color so ANSI codes never
    corrupt alignment. Column widths are caller-supplied (`CHANGE_VERB_WIDTH` +
    a label width computed from the known agent list) because rows print
    incrementally inside a per-agent loop.
  - `formatConfigPath` — collapses home → `~` and cwd → `./`, choosing the
    **longest** matching prefix (a repo under home renders `./…`, not `~/…`).
    Windows-like prefixes match case-insensitively while preserving display
    casing.
  - `describeConfigAsUnchanged` — maps a `SetupConfig` to `unchanged` changes
    without executing, for already-configured tools and pre-skipped composite
    steps.

- `src/commands/init/setup-handlers.ts` — executors emit the change data:
  - `executeConfigFileSetup`: `created` when the file was absent, `updated` when
    it pre-existed (even if empty), `unchanged` when already configured.
  - `executeCliSetup`: one change per command (`ran` / `unchanged`), so
    multi-command setups (e.g. Claude Code) report each step.
  - `executeCompositeSetup`: concatenates executed-step changes with
    synthesized `unchanged` changes for pre-skipped steps (so Pi shows all
    sub-steps).
  - Uninstall executors mirror this: config-file `updated` (entry stripped, file
    kept) / `unchanged`, one `ran` / `unchanged` change per CLI command,
    composite concatenation. Partial changes and warnings are preserved when a
    later step fails.

- `src/commands/init/init.ts` — threads changes onto `AgentOutcome` /
  `AgentUninstallOutcome` (so they also appear in `--install-agents --json`),
  renders them via `renderChangeRows`, and preserves changes through
  verification failure (the written path/command stays visible under a `failed`
  row). A trailing summary confirms the server: `Configured MCP server "githits"
  with local command \`npx -y githits@latest mcp start\`` (wording reflects
  whether anything was actually installed; the command is muted inline so it
  does not read as something to run).

## Uninstall UX

User uninstall uses the same selection model as install: configured tools are
pre-checked in a multiselect, the user deselects the ones to keep, and the
selection itself is the consent — no per-agent or final confirmation (reinstall
is easy). `--yes` / non-interactive removes from all configured tools. Results
render with the shared row format — config-file tools show `updated <path>`
(the entry is stripped, the file kept), CLI tools show `ran <command>`.

`uninstallSelectedAgents` mirrors `installSelectedAgents`. Every uninstall verb
uses the ok tone (green ✓): for uninstall the desired end state is "GitHits
absent", which holds whether we just edited a file, ran a command, or found it
already gone (`unchanged`).

Project uninstall (`init uninstall --project`) is file-based (it dedupes config
paths across project-supported tools) and uses a single confirmation, not the
per-agent prompt. It already shows the affected paths and is intentionally left
on its own rendering path.

## Conventions

- Config-file tools show a path; CLI-configured tools (Claude Code, Codex,
  Gemini at user scope) show the command — never a fabricated path. In project
  scope Claude Code and Codex are config-file and do show paths.
- `format: json` / `--json` carry the structured `changes`; the friendly
  trailing block is text-only.
