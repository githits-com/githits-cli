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
only installed `githits-mcp` receives local metadata outside its canonical
payload. The other skill files use the existing unmarked installer path. Shared
roots are deduplicated when multiple selected agents use the same directory.

| Agent group | User scope | Project scope |
|---|---|---|
| Cursor, Windsurf, VS Code/Copilot, Codex CLI, Pi, Gemini CLI, OpenCode, Zed, Junie, Qwen Code, Kilo Code, Cline | `~/.agents/skills/` | `.agents/skills/` |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Kiro | `~/.kiro/skills/` | `.kiro/skills/` |
| Factory Droid | `~/.factory/skills/` | `.factory/skills/` |
| Google Antigravity | `~/.gemini/config/skills/` | `.agents/skills/` |
| Hermes Agent | `~/.hermes/skills/` | not supported |

## Installed MCP Skill Lifecycle

The root `skills/githits-mcp/SKILL.md` and packaged plugin copies remain
canonical and unmarked. Direct `githits init` adds one
`githits-managed-skill` comment immediately after the YAML frontmatter closing
delimiter in the installed `githits-mcp/SKILL.md` only. The comment records the
writing CLI version and a SHA-256 checksum. Its format is:

```text
<!-- githits-managed-skill v1 version=0.26.0 sha256=<64 lowercase hex characters> -->
```

The version is illustrative, not a proposed release version. The checksum
covers the exact canonical UTF-8 file, including frontmatter, whitespace, and
its final newline, excluding only the inserted marker line and its newline.
Removing one valid marker recovers the original bytes; the other three skill
files are not marked. The checksum detects edits, not authenticity: it is not a
signature or authorization boundary.

Init's configured check and setup early return accept a single correctly placed
marker when its checksum verifies and the stripped payload matches the bundled
skill. Equality ignores the marker's writing version, so identical managed
content remains configured across CLI upgrades without a marker-only rewrite.
Explicit init enrolls an unchanged unmarked installation and keeps its existing
overwrite policy for differing content.

The root CLI's local MCP startup updater inspects only existing
`githits-mcp/SKILL.md` targets beneath existing active user roots and project
roots derived from the startup working directory (`cwd`) in the shared init
map. It does not walk parent directories or discover Git roots, create roots,
parent directories, or missing files; inspect historical Cline/Junie migration
paths or plugin caches; or update other skills.
Symlinked homes and active roots are allowed, including intentionally owned
dotfiles roots. A directory or file alias is accepted only when its resolved
skill file equals an expected destination under an active root. Resolved
destinations are deduplicated and updates target the resolved file, preserving
the alias links. Escaping aliases and non-regular files are skipped. Hosted or
plugin-only MCP launches do not invoke the local updater.

An unmarked exact current payload is left byte-identical. A fixed set of 25
verified pre-feature SHA-256 hashes bridges known older unmarked installs;
unknown unmarked content is preserved. The hashes and fixture payloads were
verified on 2026-10-01 against all 44 published npm releases from 0.6.0 through
0.25.1 and the available release tags; [npm registry provenance](https://registry.npmjs.org/githits)
is retained here. The fixture keeps per-version payload bytes and hashes. A
marked payload identical to the bundled skill is silent regardless of writing
version. A different payload is refreshed only when its writing CLI version is
older than the running CLI. A different same-version payload is preserved
silently; a different newer-version payload is preserved with a short warning.
Malformed, duplicate, misplaced, unsupported, or checksum-mismatched markers
are preserved.

Maintenance runs after ordinary startup dependency validation and before the
local MCP server connects. Failure to discover a user or project base emits a
sanitized warning while discovery of the other scope continues; a deleted cwd
can skip project-root maintenance without blocking user-root maintenance or
startup. Other policy and IO failures also produce sanitized stderr warnings
and do not block startup; stdout remains reserved for MCP protocol output.
The startup factory also catches unexpected maintenance failures; even a
maintenance warning failure cannot prevent the server from connecting.
Before replacement, the updater rereads the file and requires it to match the
inspected bytes, then uses the existing atomic replacement helper.
That final check narrows but cannot eliminate a manual-edit or competing-launch
race before rename; the lifecycle makes no stronger concurrency guarantee.
Startup changes the file on disk only: agents that loaded it earlier in the
session do not hot-reload and need a new session to see refreshed content.

See [configuration](config.md#local-mcp-skill-update-policy) for the opt-out
and persistent `skills.auto_update` setting.

Implementation references:

- `src/commands/init/guidance-assets.ts` owns the canonical skill and active-root map.
- `src/services/mcp-skill-content.ts` owns marker parsing, checksums, and version decisions.
- `src/services/mcp-skill-update.ts` owns startup scope, alias checks, reread, and replacement.
- `src/services/mcp-skill-history.ts` and
  `src/services/fixtures/mcp-skill-history.json` hold the fixed hashes and
  verified payloads.
- `src/services/mcp-skill-content.test.ts` checks that the 25 fixture hashes
  match the unique legacy array.
- `src/services/skill-config.ts` owns the local update policy reader.

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
