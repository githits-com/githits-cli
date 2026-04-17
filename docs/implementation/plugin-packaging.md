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

Root `.mcp.json` is intentional and required for Open Plugin hosts.
Both root and Claude payload MCP configs launch with
`npx -y githits@latest mcp start` so plugin installs track the latest published
GitHits CLI by default.

### Claude marketplace package

Claude marketplace metadata lives at `.claude-plugin/marketplace.json`.
Marketplace plugin source is `./plugins/claude`, which contains:

- `plugins/claude/.claude-plugin/plugin.json`
- `plugins/claude/.mcp.json` with `mcpServers.githits`
- `plugins/claude/skills/`
- `plugins/claude/commands/`

This keeps Claude runtime payload explicit and marketplace-scoped.

## Runtime Behavior in Local Development

When running Claude from this repository directory:

- plugin server appears as `plugin:githits:githits`
- root project `.mcp.json` can also register `githits`

This dual visibility is a local testing artifact, not an `init` behavior bug.
For plugin-only attribution tests, run Claude from a different working
directory.

## Verification

Automated checks:

- `src/plugin-config.test.ts` asserts root and Claude payload MCP server config
- `src/plugin-manifest.test.ts` asserts Claude marketplace source points to
  `./plugins/claude`

Manual checks:

- Open Plugin host install reads root package MCP config
- Claude marketplace install loads `plugin:githits:githits`

## Key Reference Files

| File | Purpose |
|---|---|
| `.mcp.json` | Root Open Plugin MCP server registration |
| `.plugin/plugin.json` | Open Plugin manifest |
| `.claude-plugin/marketplace.json` | Claude marketplace catalog and source path |
| `plugins/claude/.mcp.json` | Claude payload MCP server registration |
| `src/plugin-config.test.ts` | MCP packaging regression checks |
| `src/plugin-manifest.test.ts` | Marketplace source path regression check |
