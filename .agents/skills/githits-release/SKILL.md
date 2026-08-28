---
name: githits-release
description: >-
  Use when maintaining the GitHits changelog or preparing, reviewing, or
  executing a GitHits release. Covers continuous per-package release impact,
  version consistency, plugin manifests, MCP instruction quality, MCP registry
  publishing/versioning, and the special lifecycle for published Agent Skills.
compatibility: Project-local skill for GitHits maintainers; not packaged for end users.
metadata:
  internal: true
---

Use this skill for GitHits changelog maintenance, release work, version-bump PRs, release-readiness reviews, and release notes.

## Human Merge Gate

- Release preparation ends with an open release PR. A request to audit,
  prepare, create, cut, or release a version does not authorize merging,
  enabling auto-merge, tagging, publishing, or waiting for publication.
- Merge a release PR only after receiving separate, explicit human approval
  given after the release PR exists. The approval must explicitly authorize
  merging and identify that PR by number, URL, or an otherwise unambiguous
  reference to the already-open PR.
- Earlier requests for an end-to-end release do not satisfy the merge gate.
  After opening the PR, report its URL and check status, then stop and ask for
  merge approval. Do not enable auto-merge as a substitute for approval.
- After the separate approval, merge only the approved PR. The successful
  `Main` workflow will trigger publication, which may then be monitored to
  completion.

## Release Checklist

- Root `githits` and `@githits/mcp` have separate release flows. Bump both only when both surfaces changed.
- For root `githits` releases, bump `package.json` and `server.json`, then run `bun run plugins:generate` to update `.plugin/plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `gemini-extension.json`, and the versionless Antigravity `plugin.json`/`mcp_config.json` adapter together.
- For `@githits/mcp` releases, bump `packages/mcp/package.json` and its workspace version in `bun.lock` only when MCP package API, tool behavior, instructions, schemas, MCP auth/error behavior, or remote-server-facing public types changed.
- For coordinated CLI and MCP releases, keep the MCP minor aligned with the CLI minor for discoverability. Start the first MCP release for a CLI minor at `X.Y.0`, then bump MCP patch for later MCP-package-visible changes in that CLI minor. Do not bump MCP for CLI-only changes.
- After merge, the root release workflow and MCP release workflow both run from the successful `Main` workflow on `main`. The MCP workflow publishes only when `@githits/mcp@<version>` is not already on npm; use its manual `workflow_dispatch` path only for recovery or explicit dry runs.
- The root release workflow also publishes `server.json` to the official MCP registry as `com.githits/githits` after npm publishes `githits@<version>`. Treat the MCP registry entry as part of the root `githits` release, not the `@githits/mcp` package release.
- Keep `server.json.version`, the npm package entry version in `server.json`, and root `package.json.version` aligned. The release workflow rewrites a temporary registry manifest from `package.json`, but the committed `server.json` should still reflect the intended next root release for review and local validation.
- Keep root `package.json#mcpName` equal to `com.githits/githits`; npm registry ownership validation depends on the published package manifest matching `server.json.name`.
- Run or rely on package-scoped version checks to verify root plugin versions stay aligned and MCP versions are intentionally independent.
- Reconcile the complete package-specific tag-to-HEAD delta with the files in `changes/`. Every fragment must name every public artifact and an explicit pending bump, including `none` for unaffected packages.
- Run `bun run plugins:generate`, inspect the generated diff, and run `bun run plugins:check` before release-readiness signoff. Do not release with manually edited or stale generated assets.
- Finalize the changelog before release. Group the fragments into a separate `## [<artifact> <version>] - YYYY-MM-DD` section for each released artifact, then delete every consumed fragment.
- Review public skills before signoff whenever user-facing CLI/MCP behavior changed. After the behavior is released or included in the same release branch, update `skills/githits-code/SKILL.md`, `skills/githits-package/SKILL.md`, and their references so `skills.sh` users get instructions that match the released surface.
- Keep PR titles and labels release-note friendly; GitHub release notes are generated from merged PRs and `.github/release.yml` categories.
- Run `bun run build` before release-readiness signoff. Run targeted smoke/eval commands when MCP tools, CLI commands, shared formatters, auth/error envelopes, Agent Skills, or agent-facing instructions changed.

## MCP Registry

- Registry name: `com.githits/githits`.
- Registry `server.json` should list both supported transports when available: hosted remote MCP at `https://mcp.githits.com` and npm stdio via the root `githits` package with `packageArguments` equivalent to `githits mcp start`.
- Do not encode `npx githits@latest` literally in `server.json`. The registry package entry uses `runtimeHint: "npx"`, `identifier: "githits"`, the exact release `version`, and package arguments. This represents the pinned release artifact, while docs can continue to show `npx githits@latest mcp start` for manual setup.
- Publish to the MCP registry only after `githits@<version>` is published to npm, because registry validation checks the npm package metadata.
- MCP registry publishing uses GitHub Actions OIDC, the `production` environment, and the Azure Key Vault-backed signer. Do not add an Azure client secret, Key Vault secret, exported signing key, npm token, or raw registry private key.
- Required GitHub production environment secrets are identifiers used for masking and OIDC wiring: `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_CLIENT_ID`, `MCP_REGISTRY_KEY_VAULT_NAME`, and `MCP_REGISTRY_SIGNING_KEY_NAME`. Do not print them, dump environment variables, or enable shell tracing.
- Before releasing a registry update, verify `mcp-publisher validate server.json` locally with the pinned publisher version when practical.
- Before the first registry publish, verify the domain proof is deployed at `https://githits.com/.well-known/mcp-registry-auth`.
- For remote MCP auth, do not add static `Authorization` header metadata to `server.json`. The official registry remote transport schema supports URL, optional user-provided headers, and URL variables; OAuth is discovered from the remote MCP server through its `WWW-Authenticate` response and `/.well-known/oauth-protected-resource` metadata. Validate `https://mcp.githits.com/.well-known/oauth-protected-resource` returns 200 and unauthenticated remote MCP requests return the expected 401 with `resource_metadata`.

## Agent Skills Lifecycle

- User-facing skills under `skills/` are picked up by `skills.sh` from `main`, not from npm release artifacts.
- Do not update `skills/` to describe unreleased CLI/MCP behavior, except for the bounded `githits-mcp` stable-guide rule below. A merge to `main` can expose those skill instructions immediately.
- For the `githits-mcp` stable guide, exact parity is a bounded exception: when backing stable behavior or `buildMcpQuickStart()` changes, update the backing behavior, builder, and embedded terminal guide copy in the same PR, merge that PR to `main`, and ship it in the next applicable release cycle. This accepts the bounded main-to-release window for `skills.sh`; it does not create a deploy-first or two-PR flow. `buildLocalMcpQuickStart()` runtime appendices remain excluded from the public copy.
- `githits-onboarding` keeps its separate release-branch rule: update the public skill only on the release branch after the corresponding CLI behavior is included, so `skills.sh` does not advertise unreleased onboarding behavior.
- After the backing CLI/MCP behavior is released or part of the release being prepared, update `skills/` so skill descriptions, decision flows, examples, detailed references, and command-to-MCP mappings match the released surface.
- When MCP instructions, tool descriptions, or guardrails change, review `skills/githits-code/SKILL.md`, `skills/githits-package/SKILL.md`, and their references for parity. Keep MCP instructions as the quality baseline; they are currently strong and should not be weakened casually.
- After changing public skills or plugin-facing guidance, run `bun run plugins:generate` and `bun run plugins:check` so every host manifest remains aligned with the canonical root surface.
- If a skill update is intentionally delayed until after release, note that in the release/change plan so it is not forgotten.

## Changelog Fragments

- Follow `docs/implementation/release-process.md` and `changes/README.md`; every notable change owns a new independent fragment under `changes/` rather than editing `CHANGELOG.md`.
- Use `git log` and merged PRs since each package's previous tag to audit the fragments and find omissions before release; fragments do not replace range review.
- Record the pending SemVer impact for `githits`, `@githits/mcp`, and every future independently versioned public artifact in each fragment. Keep unaffected packages explicit as `none`.
- During release preparation, compute each artifact's aggregate bump from the highest impact in its fragments, group affected entries by category into that artifact's versioned section, and delete all consumed fragments. Never partially consume a cross-artifact fragment; leave unrelated fragments untouched. Consume all-`none` repository entries with the next root `githits` release.
- Treat dated, versioned sections as immutable historical records. Change one only for a blatant, demonstrable factual error and make the smallest correction that restores accuracy; wording improvements and omitted minor details do not qualify.
- Exclude purely internal refactors unless they affect users, agent behavior, performance, or reliability.
- Call out changes that require users or agents to adjust commands, flags, config, auth setup, environment variables, MCP setup, or skill usage.
- Mention known limitations or intentionally deferred skill updates when they affect current users.

## Guardrails

- Do not expose credentials while verifying release/auth flows.
- Do not force-push, amend, or rewrite release history unless explicitly requested.
- Refuse historical changelog cleanup or expansion unless the existing text is blatantly factually wrong.
- If fragment impacts, package manifests, or the verified package-visible delta disagree, stop and reconcile them before release signoff.
- If root package and plugin manifests disagree, stop and fix them before a root `githits` release.
- If `@githits/mcp` changed but its package version did not, stop and either bump it or document why the change is not MCP-package-visible.
