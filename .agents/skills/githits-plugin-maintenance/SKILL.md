---
name: githits-plugin-maintenance
description: >-
  Internal repository-maintenance skill for GitHits cross-host plugin and Agent
  Skill surfaces. Use only while working in the githits-cli repository when
  changing skills, agent guidance, plugin or marketplace manifests, Gemini or
  Cursor extensions, MCP transport metadata, root release metadata, plugin
  generation, or agent-facing installation and authentication behavior.
metadata:
  internal: true
---

# Maintain GitHits Plugin Surfaces

This is an internal, repository-only skill. Do not publish or package it with
the public skills under `skills/`.

Keep root skills and shared metadata canonical. Treat generated manifests and
host MCP files as reviewable build artifacts, not authoring locations.

## Workflow

1. Identify the canonical input that owns the requested behavior.
2. Read `docs/implementation/plugin-packaging.md` before changing packaging or
   transport behavior.
3. Edit canonical inputs only.
4. For the stable MCP quick-start guide, keep
   `packages/mcp/src/mcp/instructions.ts` `buildMcpQuickStart()` and the
   terminal `## Quick-start guide` section in `skills/githits-mcp/SKILL.md`
   byte-for-byte aligned in the same PR. `src/skills-packaging.test.ts` is the
   exact-parity contract; exclude `buildLocalMcpQuickStart()` runtime
   appendices from the public copy. Route behavior-dependent guide changes
   through the public Agent Skill lifecycle.
5. Run `bun run plugins:generate`.
6. Inspect every generated diff and confirm it follows from the canonical
   change.
7. Run `bun run plugins:check`.
8. Run targeted tests, then the required smoke or agent evaluations for the
   affected surface.

## Canonical Ownership

- Author public skill content only under `skills/`.
- Author shared agent guidance in `AGENTS.md`; keep `CLAUDE.md` and `GEMINI.md`
  as symlinks to it.
- `packages/mcp/src/mcp/instructions.ts` owns the stable quick-start builder;
  the terminal guide in `skills/githits-mcp/SKILL.md` is its exact public copy.
- Use `package.json` for root version, identity, and shared package metadata.
- Use `server.json` for registry transports and the hosted MCP endpoint.
- Use `scripts/generate-plugin-assets.ts` for host rendering and validation.

## Transport Contract

- Every plugin and extension package uses `https://mcp.githits.com`. Claude,
  Codex, Cursor, and VS Code/GitHub Copilot OpenPlugin share generated
  `.mcp.json`; Gemini uses `gemini-extension.json` with `httpUrl`; and
  Antigravity uses `mcp_config.json` with `serverUrl`.
- Direct `githits init` configuration retains stdio except for Cursor, which is
  remote-only. Claude and Gemini CLI setup remove legacy plugin or extension
  state before installing the user-scoped stdio server.
- `server.json` advertises both remote and version-pinned npm stdio transports.

Do not change another host's transport without an explicit product decision.

## Validation

Always run:

```bash
bun run plugins:generate
bun run plugins:check
bun test
```

Also run `bun run build` before signoff. Run the repository-required smoke suites
when MCP, CLI, packaging, auth, or shared agent behavior changes. Run targeted
`bun run agent:e2e` workloads when skills, instructions, descriptions, or
agent-facing behavior change.

## Guardrails

- Do not manually patch generated manifests to make a check pass.
- Do not add authored host-specific skill forks.
- Do not add Markdown plugin commands unless the command is an intentional,
  tested product surface.
- Stop if generated changes cannot be explained by canonical input changes.
