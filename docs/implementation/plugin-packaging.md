# Cross-Host Plugin Packaging

## Purpose

GitHits publishes one canonical skill and guidance surface from this repository
for Claude Code, Codex, Cursor, Gemini CLI, Google Antigravity, and
VS Code/GitHub Copilot OpenPlugin hosts.

Root `skills/` and `AGENTS.md` are authored inputs. Host manifests and MCP
configuration are deterministic generated artifacts.

## Canonical Inputs

| Input | Ownership |
|---|---|
| `skills/**` | Public Agent Skill names, descriptions, workflows, and references |
| `AGENTS.md` | Shared repository and agent guidance |
| `package.json` | Root version, identity, and shared package metadata |
| `server.json` | MCP registry metadata, canonical plugin keywords, hosted endpoint, and supported transports |
| `scripts/generate-plugin-assets.ts` | Host capability matrix, rendering, and validation |

`CLAUDE.md` and `GEMINI.md` are symlinks to `AGENTS.md`. Do not maintain
host-specific copies.

## Generated Outputs

Run:

```bash
bun run plugins:generate
bun run plugins:check
```

The generator owns:

- `.plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.codex-plugin/plugin.json`
- `.cursor-plugin/plugin.json`
- `.mcp.json`
- `gemini-extension.json`
- `plugin.json`
- `mcp_config.json`

Generated files are committed because Git-hosted marketplaces inspect repository
contents without running npm lifecycle scripts. `prepack` validates committed
outputs instead of creating or deleting them.

## Skill Contract

All hosts discover the same root skill directories:

- `githits-onboarding`
- `githits-mcp`
- `githits-code`
- `githits-package`

There are no authored host-specific skill copies. If a host later requires a
self-contained copy, the generator may create it, but tests must enforce exact
content and reference parity with the root source.

Plugin Markdown commands are intentionally absent. User-facing CLI commands are
implemented under `src/commands/**` and are not plugin slash commands.

## Transport Contract

| Host | Generated configuration | Transport |
|---|---|---|
| Cursor | `.cursor-plugin/plugin.json` + `.mcp.json` | Hosted Streamable HTTP at `https://mcp.githits.com` |
| Claude Code | `.mcp.json` | Hosted Streamable HTTP at `https://mcp.githits.com` |
| Codex | `.codex-plugin/plugin.json` + `.mcp.json` | Hosted Streamable HTTP at `https://mcp.githits.com` |
| Gemini CLI | `gemini-extension.json` | Hosted Streamable HTTP through `httpUrl` at `https://mcp.githits.com` |
| Google Antigravity | `plugin.json` + `mcp_config.json` | Hosted Streamable HTTP through `serverUrl` at `https://mcp.githits.com` |
| VS Code/GitHub Copilot OpenPlugin | `.plugin/plugin.json` + `.mcp.json` | Hosted Streamable HTTP at `https://mcp.githits.com` |
| MCP registry | `server.json` | Hosted remote and version-pinned npm stdio |

All plugin and extension packages use the hosted remote MCP through each host's
native remote field. Direct `githits init` configuration remains a separate
path: it installs stdio for Claude Code, Codex CLI, Gemini CLI, and the other
local hosts, while Cursor remains remote-only. Claude and Gemini CLI setup
remove obsolete plugin or extension state before installing the user-scoped
stdio server so the remote package and local server are not registered together.

The repository root is also a native Antigravity plugin directory:
`plugin.json` is its marker, `mcp_config.json` supplies the hosted remote MCP
using Antigravity's `serverUrl` field, and the root `skills/` tree supplies the
same four canonical skills. Direct CLI setup remains local stdio and writes the
current global `~/.gemini/config/mcp_config.json` or workspace
`.agents/mcp_config.json` path.

Generated plugin manifests use the publisher-provided `keywords` from
`server.json`. `package.json` retains the same ordered list so npm and every
plugin marketplace describe the product consistently.

## Marketplace Layout

The repository root is the plugin root for the Anthropic community marketplace,
the first-party Claude marketplace, direct Codex installs, Cursor, the Gemini
extension gallery, VS Code/GitHub Copilot OpenPlugin installs, and a manually
installed Antigravity plugin.

The first-party Claude marketplace entry uses the public HTTPS Git URL for
`githits-com/githits-cli`. Claude clones that repository as the plugin root and
installs the root `.claude-plugin/plugin.json`, root skills, and remote root
`.mcp.json` as one payload. A relative `source: "."` is not accepted by Claude's marketplace
validator, while the `github` shorthand can require users to have working SSH
credentials.

The obsolete standalone Claude and Gemini repositories are migration-only. They
must be archived after legacy installation migration is verified.

## Validation

Unit tests cover pure rendering, version parity, canonical skill discovery,
transport selection, stale outputs, symlink targets, and removal of legacy
payloads.

Before signoff:

```bash
bun run plugins:generate
bun run plugins:check
bun test
bun run build
```

Run CLI/MCP smoke suites when packaging or startup behavior changes. Run targeted
agent evaluations when skills, instructions, or agent-facing setup behavior
changes. Validate real Claude, Cursor, and Gemini installs before a release that
changes their manifests.

Use the repository-internal `githits-plugin-maintenance` skill for every change
in this area. It lives under `.agents/skills/` and is never part of the public
package or canonical root `skills/` tree.
