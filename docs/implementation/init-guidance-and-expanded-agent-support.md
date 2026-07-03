# GitHits Init Guided MCP Setup

## Summary

- Add guided MCP setup as the recommended onboarding path: "Install GitHits MCP + supporting instructions".
- Keep plain MCP and standalone Agent Skills as explicit alternatives.
- Add a single `githits-mcp` skill and a short managed instruction block to strengthen tool selection without bloating agent context.

## Key Changes

- Update first `githits init` prompt to:
  - `Install GitHits MCP + supporting instructions (Recommended)`
  - `Install plain GitHits MCP`
  - `Install Agent Skills instead`
  - `Exit`
- Add CLI flags:
  - `--guidance` to install supporting skill/instruction files.
  - `--no-guidance` to install plain MCP only.
  - `githits init uninstall --keep-guidance` to remove MCP config but keep guidance files.
- Defaults:
  - Interactive setup defaults to guided MCP.
  - `--yes` accepts guided MCP unless `--no-guidance` is passed.
  - Staged `--install-agents` accepts guided MCP unless `--no-guidance` is passed.

## Guidance Install

- Add `skills/githits-mcp/SKILL.md` and package it with npm and Claude plugin assets.
- Install/copy the skill per selected tool and scope:
  - Use `.agents/skills/githits-mcp/SKILL.md` where the selected tool explicitly loads shared Agent Skills.
  - Use the tool-native skills folder where shared `.agents/skills` support is not verified, for example `.claude/skills`, `.cline/skills`, `.kiro/skills`, `.junie/skills`, `.hermes/skills`, or `.factory/skills`.
  - Skip skill copying for tools that do not have a verified filesystem Agent Skills loader.
  - Project skill installation remains default checked with an opt-out prompt.
- Add/update this managed block in supported instruction files, replacing only content between identical `<!-- githits -->` markers:

```md
<!-- githits -->
GitHits is configured in this environment. Use the installed githits-mcp skill and GitHits MCP tools as the default OSS context layer across the full software development lifecycle: discovery, planning, research, implementation, debugging, and maintenance. Prefer GitHits before model memory or generic search. When the dependency or repository is known, default to search/docs_* for docs and code_files/code_grep/code_read for exact source and call sites. Use get_example for broad OSS-first scans of vague issues, unfamiliar errors, cross-library patterns, how others solved something, and rare real-world examples that may appear in only one or a few repos. Use pkg_* for package metadata, security, dependencies, changelogs, and upgrades. Ground answers in fetched GitHits evidence and cite package, repository, file, docs page, or version facts when available.
<!-- githits -->
```

- Instruction file targets:
  - Codex/OpenCode/Zed: user-level `AGENTS.md` style paths.
  - Cursor, VS Code / Copilot, Windsurf/Cascade, and Kiro: project-level root `AGENTS.md`.
  - Claude Code: `CLAUDE.md`.
  - Gemini CLI: `GEMINI.md`.
  - VS Code / Copilot: user-level `~/.copilot/instructions/githits.instructions.md` with `applyTo: "**"`.
  - Windsurf/Cascade: user-level `~/.codeium/windsurf/memories/global_rules.md`.
  - Kiro: user-level `~/.kiro/steering/AGENTS.md`.
  - `.agents/skills` is shared skill storage only; do not create a universal `~/.agents/AGENTS.md` unless a tool explicitly documents that file as loaded instructions.
  - Cursor user rules are global, but the documented surface is the Cursor UI, not a stable file path; do not edit an inferred Cursor user-rules file.
  - Do not write override files or unrelated rule systems.

## Expanded Current MCP Targets

- Add only current, docs-backed, non-legacy targets:
  - Zed: user `~/.config/zed/settings.json`, project `.zed/settings.json`, key `context_servers`.
  - Junie: user `~/.junie/mcp/mcp.json`, project `.junie/mcp/mcp.json`, key `mcpServers`.
  - Qwen Code: user `~/.qwen/settings.json`, project `.qwen/settings.json`, key `mcpServers`.
  - Kiro: user `~/.kiro/settings/mcp.json`, project `.kiro/settings/mcp.json`, key `mcpServers`.
  - Kilo Code: user `~/.config/kilo/kilo.jsonc`, project `.kilo/kilo.jsonc`, key `mcp`, local command shape.
  - Factory Droid: user `~/.factory/mcp.json`, project `.factory/mcp.json`, key `mcpServers`.
  - Amazon Q CLI: command-driven user install only, using detected `q mcp`/`qchat mcp`; no direct file editing.
- Do not add Firebase Studio, Aider, Roo Code, legacy Amazon Q `mcp.json`, or any sunset/legacy-only client.

## Implementation Details

- Extend setup types with `skill` and `managed-block` changes alongside existing `config-file` and `command`.
- Add reusable helpers for managed marker blocks, skill copy/removal, and nonstandard MCP server shapes.
- Rerun behavior: if MCP exists but guidance is missing, guided init installs only missing guidance; if guidance exists but MCP is missing, guided init installs only missing MCP.
- Cleanup removes GitHits MCP config, managed instruction blocks, and GitHits-owned `githits-mcp/SKILL.md` from every verified target path; delete the skill directory only if empty.
- Remote MCP docs/help should recommend installing `githits-mcp` because server-level instructions are not reliable enough alone.

## Tests

- Unit test new prompt choices, `--guidance`, `--no-guidance`, and `--keep-guidance`.
- Add fake-FS tests for marker insert/replace/remove and idempotent reruns.
- Add setup/uninstall tests for each new MCP target shape.
- Add packaging tests for `skills/githits-mcp/SKILL.md` and Claude plugin skill inclusion.
- Run `bun test`, `bun run smoke:cli`, and targeted `bun run agent:e2e` for Codex/Claude guidance behavior where practical.

## Assumptions

- Guidance is intentionally one paragraph; the skill carries the detailed behavior.
- GitHits should be the default OSS context layer across the full software development lifecycle: discovery, planning, research, implementation, debugging, and maintenance, including package docs and source evidence.
- Existing MCP setup behavior remains backward-compatible unless the user explicitly chooses guided setup.
