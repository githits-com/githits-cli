# GitHits Init Guided MCP Setup

## Purpose

`githits init` configures MCP and, by default, the supporting GitHits Agent
Skills for the agents selected by the user. This document records the shipped
selection model, skill placement, migration behavior, and human-readable
output contract.

## Setup and selection

Interactive setup and staged `--install-agents` setup use the same per-agent
status model. A selected agent can need MCP setup, guidance repair, or both;
an already-configured but unselected agent is reporting-only and is never
retargeted. Guidance-only and stale-skill cleanup selections do not mutate MCP
configuration or authenticate. An empty selection prints `Nothing selected, no
changes made` and returns before review, authentication, or writes.

The first prompt offers guided MCP, plain MCP, standalone Agent Skills, or an
exit. Guided MCP is the default. `--no-guidance` selects plain MCP and performs
no skill migration. A project guidance consent decline recomputes the selected
actions and exits before review, authentication, or writes when only guidance
repair remains.

Staged detection preserves the machine-readable `installableIds` MCP-only
contract. `guidanceStatus`, `guidanceRequested`, and `actionableIds` expose
guidance repair without changing the meaning of existing fields. Staged JSON
is authoritative for the selected IDs and distinguishes success,
`already_configured`, unsupported, skipped, and failed outcomes.

## MCP transport and authentication

Before selection, intent copy is transport-neutral. After selection, review and
final summaries describe the actual targets:

- all non-Cursor targets use the local stdio command
  `npx -y githits@latest mcp start`;
- Cursor-only targets use the hosted remote MCP at
  `https://mcp.githits.com`;
- mixed selections name both the local target group and Cursor's remote target.

Cursor authentication is separate from local GitHits CLI authentication. A
Cursor setup requires one Authenticate action in Cursor's MCP panel, or
`cursor-agent mcp login GitHits`, followed by tool discovery in a new Cursor
Agent chat. Cursor-only setup skips local CLI login. Mixed setup authenticates
only the non-Cursor integrations locally and labels that status accordingly.

Pi user setup writes `directTools: true` alongside its eager lifecycle in the
Pi-owned `~/.pi/agent/mcp.json` entry. Project `.mcp.json` keeps the standard
shared MCP shape and does not receive Pi's user-only `directTools` setting.
Codex detection requires both a successful `PATH` lookup and a successful,
bounded `codex --version` probe; a missing, failing, timed-out, or unlaunchable
probe means Codex is not detected.

## Supporting MCP guidance

Remote MCP docs and setup help recommend the `githits-mcp` skill. The skill
carries the stable quick-start guide, so a skill-loaded agent skips the
`quick_start` call. Plain MCP clients use `quick_start` as the fallback
for shared routing, scope, output, and safety guidance because clients expose
server-level MCP instructions inconsistently. Every evidence descriptor repeats
that same session prerequisite, with no tool-specific exceptions. The stable
skill copy is kept byte-for-byte aligned with `buildMcpQuickStart()` in
`packages/mcp/src/mcp/instructions.ts`; runtime-only local appendices are
excluded and do not change when `quick_start` is called.

## Skill catalog and active roots

Guided setup requires exactly these four packaged skills:

- `githits-code`
- `githits-mcp`
- `githits-onboarding`
- `githits-package`

The runtime catalog is defined in `src/commands/init/guidance-assets.ts` and
is checked for parity with plugin packaging. Missing files are repaired;
complete files are unchanged. Shared roots are deduplicated when multiple
selected agents use the same directory.

| Agent group | User scope | Project scope |
|---|---|---|
| Cursor, Windsurf, VS Code/Copilot, Codex CLI, Pi, Gemini CLI, OpenCode, Zed, Junie, Qwen Code, Kilo Code, Cline | `~/.agents/skills/` | `.agents/skills/` |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Kiro | `~/.kiro/skills/` | `.kiro/skills/` |
| Factory Droid | `~/.factory/skills/` | `.factory/skills/` |
| Google Antigravity | `~/.gemini/config/skills/` | `.agents/skills/` |
| Hermes Agent | `~/.hermes/skills/` | not supported |

The shared root is intentionally visible to every compatible agent that reads
it. The Ready/Next Steps output says this explicitly for successful or already
configured shared-root guidance. Agent-specific managed instruction blocks
remain separate targets and are written only for selected agents.

## Cline and Junie migration

Cline and Junie now use the shared `.agents/skills` root. Historical cleanup
targets are only the exact CLI-owned files
`<scope>/.cline/skills/githits-mcp/SKILL.md` and
`<scope>/.junie/skills/githits-mcp/SKILL.md`; unrelated skills, directories,
plugin payloads, and managed instruction blocks are preserved.

Guided setup writes and verifies all four active skill files before removing a
historical file. If active installation or verification fails, the historical
file remains. If cleanup fails, the active set remains usable and the exact
failed historical path is reported with a generic reason. Missing historical
files are successful no-ops. `--no-guidance` leaves historical files untouched.
After successful cleanup, another guided run is a no-op for that migration.

## Uninstall and reporting

The canonical command is `githits uninstall`; `githits init uninstall` remains
a compatibility alias with identical `--yes`, `--project`, and
`--keep-guidance` behavior. Without `--keep-guidance`, interactive user
uninstall best-effort removes active and historical guidance only for selected
tools. It retains a shared skill or managed-block target when any unselected
detected tool could use it, and retains a selected tool's guidance when its MCP
removal fails. Non-interactive `--yes`, project uninstall, and user uninstall
with no configured MCP targets clean every verified guidance target in the
chosen scope. Cleanup removes all four active skill files and the exact
historical Cline/Junie files while preserving unrelated files and directories.
The `--keep-guidance` option preserves active and historical guidance.
When cleanup removes a shared root, the result warns that every compatible
agent reading that root is affected.

Human output lists created, updated, unchanged, removed, and failed skill files
accurately. Uninstall failure reasons are sanitized while failed target paths
remain visible; an all-absent guidance cleanup collapses to one unchanged row.
Configured, already-configured, and failed counts appear in Install and verify
before Ready/Next Steps. Natural-language init/uninstall prose wraps at the
terminal width (80-column fallback, 40-column minimum); JSON, standalone
copyable command lines, paths, and change rows remain byte-stable and
unwrapped, while inline commands in prose may wrap.

## Public skill and release boundary

The public `skills/githits-onboarding/SKILL.md` was reviewed in this feature
branch: it contains no `init uninstall` reference and its existing description
is host-neutral. It is intentionally not edited here. Behavior-dependent
changes to the published onboarding skill are made on the release branch only
after the corresponding CLI behavior is included, so `skills.sh` does not
advertise unreleased behavior.

## Key references

- `src/commands/init/init.ts` — selection, transport, authentication, output,
  migration, and uninstall orchestration.
- `src/commands/init/guidance-assets.ts` — four-skill runtime catalog.
- `src/commands/init/agent-definitions.ts` — Pi and Codex host behavior.
- `src/commands/init/setup-format.ts` — human prose wrapping and change rows.
