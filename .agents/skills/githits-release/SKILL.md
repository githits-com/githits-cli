---
name: githits-release
description: >-
  Use when preparing, reviewing, or executing a GitHits CLI release. Covers
  release-version consistency, plugin manifests, user-visible changelog notes,
  MCP instruction quality, and the special lifecycle for published Agent Skills.
compatibility: Project-local skill for GitHits maintainers; not packaged for end users.
metadata:
  internal: true
---

Use this skill for GitHits release work, version-bump PRs, release-readiness reviews, and release notes.

## Release Checklist

- Root `githits` and `@githits/mcp` have separate release flows. Bump both only when both surfaces changed.
- For root `githits` releases, bump `package.json`, `.plugin/plugin.json`, `.claude-plugin/plugin.json`, `plugins/claude/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `gemini-extension.json` together.
- For `@githits/mcp` releases, bump `packages/mcp/package.json` only when MCP package API, tool behavior, instructions, schemas, MCP auth/error behavior, or remote-server-facing public types changed.
- Run or rely on package-scoped version checks to verify root plugin versions stay aligned and MCP versions are intentionally independent.
- Collect a changelog of user-visible changes before release. Include CLI behavior, MCP tool behavior, Agent Skills, auth/error UX, output format changes, and agent-facing instruction changes.
- Review public skills before signoff whenever user-facing CLI/MCP behavior changed. After the behavior is released or included in the same release branch, update `skills/githits-code/SKILL.md`, `skills/githits-package/SKILL.md`, and their references so `skills.sh` users get instructions that match the released surface.
- Keep PR titles and labels release-note friendly; GitHub release notes are generated from merged PRs and `.github/release.yml` categories.
- Run `bun run build` before release-readiness signoff. Run targeted smoke/eval commands when MCP tools, CLI commands, shared formatters, auth/error envelopes, Agent Skills, or agent-facing instructions changed.

## Agent Skills Lifecycle

- User-facing skills under `skills/` are picked up by `skills.sh` from `main`, not from npm release artifacts.
- Do not update `skills/` to describe unreleased CLI/MCP behavior. A merge to `main` can expose those skill instructions immediately.
- After the backing CLI/MCP behavior is released or part of the release being prepared, update `skills/` so skill descriptions, decision flows, examples, detailed references, and command-to-MCP mappings match the released surface.
- When MCP instructions, tool descriptions, or guardrails change, review `skills/githits-code/SKILL.md`, `skills/githits-package/SKILL.md`, and their references for parity. Keep MCP instructions as the quality baseline; they are currently strong and should not be weakened casually.
- If a skill update is intentionally delayed until after release, note that in the release/change plan so it is not forgotten.

## Changelog Collection

- Use `git log` and merged PRs since the previous tag to identify user-visible changes.
- Exclude purely internal refactors unless they affect users, agent behavior, performance, or reliability.
- Call out changes that require users or agents to adjust commands, flags, config, auth setup, environment variables, MCP setup, or skill usage.
- Mention known limitations or intentionally deferred skill updates when they affect current users.

## Guardrails

- Do not expose credentials while verifying release/auth flows.
- Do not force-push, amend, or rewrite release history unless explicitly requested.
- If root package and plugin manifests disagree, stop and fix them before a root `githits` release.
- If `@githits/mcp` changed but its package version did not, stop and either bump it or document why the change is not MCP-package-visible.
