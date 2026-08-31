# Cross-Host Plugin Packaging

## Purpose

GitHits publishes one canonical set of four skills and guidance surfaces from
this repository as a portable Agent Plugin and through native adapters for
Claude Code, Codex, Cursor, Gemini CLI, Google Antigravity, and VS Code/GitHub
Copilot OpenPlugin hosts.

Root `skills/` and `AGENTS.md` are authored inputs. Portable and host manifests
and MCP configuration are deterministic generated artifacts.

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
- `mcp.json`
- `gemini-extension.json`
- `plugin.json`
- `mcp_config.json`

Generated files are committed because Git-hosted marketplaces inspect repository
contents without running npm lifecycle scripts. `prepack` validates committed
outputs instead of creating or deleting them.

## Skill Contract

Every plugin and guided CLI setup uses the same four canonical skill
directories:

- `githits-code`
- `githits-mcp`
- `githits-onboarding`
- `githits-package`

Generated plugin assets package these root skills directly. Direct `githits
init` setup places the same files at each selected host's verified active root;
shared hosts use `.agents/skills`, while Claude Code, Kiro, Factory Droid,
Antigravity user scope, and Hermes user scope use their native roots. Cline and
Junie use the shared root; their historical native `githits-mcp/SKILL.md` files
are migration-only targets.

The public `githits-mcp` skill is self-contained for the stable path: its
terminal `## Quick-start guide` section is an exact copy of
`buildMcpQuickStart()` from `packages/mcp/src/mcp/instructions.ts`, enforced by
`src/skills-packaging.test.ts`. Plain MCP clients use the `quick_start` tool;
clients with the loaded skill skip that call for stable tools. Stable evidence
descriptors repeat this prerequisite at MCP composition time, while exposed
local `Experimental` descriptors still require their runtime-specific
`quick_start`. The
runtime-only `buildLocalMcpQuickStart()` appendices are excluded from the
public skill copy.

There are no authored host-specific skill copies. If a host later requires a
self-contained copy, the generator may create it, but tests must enforce exact
content and reference parity with the root source.

## Description ownership

Canonical and generated plugin descriptions are host-neutral. The reported
Claude-specific onboarding text (`Set up GitHits from Claude Code`) is not
present in repository source or generated manifests; it remains an external
registry/marketplace metadata ownership check. Do not add a speculative
manifest override in this repository.

Plugin Markdown commands are intentionally absent. User-facing CLI commands are
implemented under `src/commands/**` and are not plugin slash commands.

## Portable Agent Plugins Contract

Root `plugin.json` and `mcp.json` target Agent Plugins 1.0.0. The portable
manifest reuses the same canonical product metadata as the generated host
manifests. Portable MCP uses the explicit `streamable-http` transport while
native adapters retain their host-specific field names and files. Do not remove
native adapters until their consumers have migrated to the portable format.

## Transport Contract

| Host | Generated configuration | Transport |
|---|---|---|
| Agent Plugins 1.0.0 | `plugin.json` + `mcp.json` | Hosted Streamable HTTP at `https://mcp.githits.com` |
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

The hosted server lives in the separate `remote-mcp` repository. It consumes a
released `@githits/mcp` version for tool registration, descriptors,
`quick_start`, and tool logic, while retaining ownership of HTTP transport,
request-scoped service composition, auth/session handling, deployment, and
observability. Do not mirror package-owned MCP behavior in `remote-mcp`. Changes
to that behavior reach plugin and extension clients only after the package is
released, the remote dependency is updated, and the hosted server is deployed.

The repository root is the portable Agent Plugin root and also a native
Antigravity plugin directory. `plugin.json` is the shared Agent Plugins manifest
and Antigravity marker. Portable clients load the hosted remote MCP from
`mcp.json`; Antigravity retains `mcp_config.json` with its native `serverUrl`
field. Both formats discover the same four canonical root skills. Direct CLI
setup remains local stdio and writes the current global
`~/.gemini/config/mcp_config.json` or workspace `.agents/mcp_config.json` path.

Generated plugin manifests use the publisher-provided `keywords` from
`server.json`. `package.json` retains the same ordered list so npm and every
plugin marketplace describe the product consistently.

## Marketplace Layout

The repository root is the plugin root for Agent Plugins clients, the Anthropic
community marketplace, the first-party Claude marketplace, direct Codex
installs, Cursor, the Gemini extension gallery, VS Code/GitHub Copilot
OpenPlugin installs, and a manually installed Antigravity plugin.

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
changes. Validate a real Agent Plugins client plus Antigravity, Claude, Cursor,
and Gemini installs before a release that changes their manifests.

Use the repository-internal `githits-plugin-maintenance` skill for every change
in this area. It lives under `.agents/skills/` and is never part of the public
package or canonical root `skills/` tree.
