# Plugin Packaging

## Purpose

This document defines how GitHits is packaged for Open Plugin hosts and Claude
Code marketplace installs, and explains why both root and Claude-specific MCP
config files exist.

## Background

GitHits now ships two plugin entry paths:

- **Root Open Plugin package** for hosts that read `.plugin/` + root
  `.mcp.json`.
- **Claude marketplace payload** for Claude Code installs via
  `.claude-plugin/marketplace.json`.

Earlier cutover work made root `.mcp.json` empty to avoid duplicate MCP server
visibility while testing Claude in this repo. That broke Open Plugin MCP
packaging expectations. The corrected contract keeps Open Plugin config at root
and keeps Claude payload self-contained under `plugins/claude/`.

## Packaging Contract

### Root Open Plugin package (canonical for Open Plugin hosts)

Required components at repo root:

- `.plugin/plugin.json`
- `.mcp.json` with `mcpServers.githits`
- `skills/`
- `commands/`

Root `.mcp.json` is intentional and required for Open Plugin hosts. It registers
the hosted remote MCP server at `https://mcp.githits.com`. The host owns OAuth
for this connection; local GitHits CLI credentials do not control it.

### Claude marketplace package

Claude marketplace metadata lives at `.claude-plugin/marketplace.json`.
Marketplace plugin source is `./plugins/claude`, which contains:

- `plugins/claude/.claude-plugin/plugin.json`
- `plugins/claude/.mcp.json` with `mcpServers.githits`
- `plugins/claude/skills/`
- `plugins/claude/commands/`

This keeps Claude runtime payload explicit and marketplace-scoped.

The Claude payload intentionally launches
`npx -y githits@latest mcp start` over stdio. It therefore uses the local CLI
authentication flow rather than the Open Plugin host's remote OAuth session.

`plugins/claude/skills/githits-mcp/SKILL.md` is generated from the canonical
`skills/githits-mcp/SKILL.md` during package creation. The root `prepack`
script materializes the Claude payload copy and `postpack` removes it so the
skill content is authored in one place.

## Runtime Behavior in Local Development

When running Claude from this repository directory:

- Claude's stdio plugin server appears as `plugin:githits:githits`
- root project `.mcp.json` can also register the hosted remote server as
  `githits`

This dual visibility is a local testing artifact, not an `init` behavior bug.
For plugin-only attribution tests, run Claude from a different working
directory.

## Verification

Automated checks:

- `src/plugin-config.test.ts` asserts that root uses remote MCP while the Claude
  payload uses stdio
- `src/plugin-manifest.test.ts` asserts Claude marketplace source points to
  `./plugins/claude`
- `src/skills-packaging.test.ts` asserts the GitHits MCP skill is packaged from
  the canonical root skill into the Claude payload

Manual checks:

- Open Plugin host install reads the root remote MCP config and manages its OAuth
- Claude marketplace install loads the stdio server as `plugin:githits:githits`
- `npm pack --dry-run --json` includes
  `plugins/claude/skills/githits-mcp/SKILL.md`

## Key Reference Files

| File | Purpose |
|---|---|
| `.mcp.json` | Root hosted remote MCP server registration |
| `.plugin/plugin.json` | Open Plugin manifest |
| `.claude-plugin/marketplace.json` | Claude marketplace catalog and source path |
| `plugins/claude/.mcp.json` | Claude payload stdio MCP server registration |
| `src/plugin-config.test.ts` | MCP packaging regression checks |
| `src/plugin-manifest.test.ts` | Marketplace source path regression check |
