# Cross-Host Plugin Surface Consolidation

## Status

Repository implementation complete on `chore/plugin-surface-consolidation`.
Release, marketplace verification, legacy-repository migration releases, and
repository archiving remain rollout tasks after merge.

## Objective

Make `githits-com/githits-cli` the only maintained source for GitHits agent
skills, plugin metadata, agent guidance, and MCP integration configuration across
Claude Code, Codex, Cursor, Gemini CLI, Google Antigravity, and VS Code/GitHub
Copilot OpenPlugin hosts.

Retire and archive these standalone repositories after their users have a
verified migration path:

- `githits-com/githits-claude-code-plugin`
- `githits-com/githits-gemini-cli`

## Problems Being Solved

- Cursor currently discovers legacy skills and Markdown commands that do not
  match the current GitHits offering.
- `plugins/claude/skills/onboarding/SKILL.md` is a shortened, divergent fork of
  `skills/githits-onboarding/SKILL.md`.
- Claude packaging copies only part of the canonical skill surface during
  `prepack`; Git-based marketplace installs do not run that lifecycle.
- Gemini guidance is manually maintained in `GEMINI.md` instead of sharing the
  repository guidance used by Claude.
- Versions, metadata, MCP configuration, skills, and command surfaces can drift
  between host manifests.
- Two obsolete standalone repositories remain installable even though the
  Claude community marketplace and Gemini extension gallery already point to
  `githits-cli`.

## Decisions

### Canonical authored inputs

The following are the only manually maintained sources for shared agent/plugin
behavior:

- `skills/githits-onboarding/**`
- `skills/githits-mcp/**`
- `skills/githits-code/**`
- `skills/githits-package/**`
- `AGENTS.md`
- `package.json` for the root release version and package identity
- `server.json` for MCP registry metadata and supported transports
- A typed generator configuration for host capabilities and shared plugin
  metadata

Host-specific files may be generated from these inputs, but generated copies
must never become authoring locations.

### Shared repository guidance

Keep both host context files as real Git symlinks:

```text
CLAUDE.md -> AGENTS.md
GEMINI.md -> AGENTS.md
```

Tests must verify the link type and target. Packaging and installation must also
be tested on Windows, where Git symlink handling can differ.

### Shared skill surface

Every supported host receives the same four skills:

- `githits-onboarding`
- `githits-mcp`
- `githits-code`
- `githits-package`

Use the canonical skill names, descriptions, bodies, and references. Allow a
host-specific name transformation only when required by that host's schema; do
not maintain a separate body.

Delete the Claude-specific `onboarding` and `search` skill forks after the root
Claude installation path has been validated.

### MCP transport matrix

Plugin packages consistently use hosted remote MCP. Direct CLI installation is
the separate local-stdio path:

| Surface | MCP transport |
|---|---|
| Cursor plugin | Remote Streamable HTTP at `https://mcp.githits.com` |
| Claude Code plugin | Remote Streamable HTTP at `https://mcp.githits.com` |
| Gemini CLI extension | Remote Streamable HTTP through `httpUrl` at `https://mcp.githits.com` |
| Google Antigravity plugin | Remote Streamable HTTP through `serverUrl` at `https://mcp.githits.com` |
| Codex plugin | Remote Streamable HTTP through root `.mcp.json` |
| VS Code/GitHub Copilot OpenPlugin | Remote Streamable HTTP through root `.mcp.json` |
| Manual CLI setup | Stdio through `githits mcp start` |
| MCP registry | Both hosted remote and version-pinned npm stdio package |

Root `.mcp.json` is the remote configuration shared by Claude, Codex, Cursor,
and OpenPlugin packages. Gemini and Antigravity retain dedicated host-native
files, also using the hosted remote MCP. Direct CLI setup continues installing
stdio except for Cursor. `server.json` continues advertising both supported MCP
transports.

The onboarding skill must preserve the distinction between Cursor-managed OAuth
and local CLI authentication for stdio integrations.

### Commands

Remove plugin Markdown command payloads from:

- `commands/`
- `plugins/claude/commands/`

These files create the misleading marketplace command surface. This removal
does not affect real TypeScript CLI commands under `src/commands/**`.

Do not generate plugin slash commands unless a future command is intentionally
designed and tested as a supported cross-host capability.

### Marketplace source layout

Keep the Anthropic community marketplace entry pointed at the `githits-cli`
repository root. Do not migrate it to `git-subdir`; its current repository
source already resolves the root Claude plugin and root component locations.

Keep the Gemini extension gallery pointed at the `githits-cli` repository root.
It already advertises the consolidated repository.

Change the first-party Claude marketplace to use the public HTTPS Git URL
pointing at the same repository root. Validate this with
`claude plugin validate .` and an actual local marketplace installation before
removing `plugins/claude`.

If Claude cannot install the marketplace and plugin from the same root, retain
only a minimal, fully generated `plugins/claude` adapter. It may contain
generated copies required for cache isolation, but no manually maintained skill
or command content.

## Target Structure

```text
.agents/
  skills/
    githits-plugin-maintenance/
      SKILL.md
.claude-plugin/
  marketplace.json              # generated
  plugin.json                   # generated
.codex-plugin/
  plugin.json                   # generated
.cursor-plugin/
  plugin.json                   # generated
.plugin/
  plugin.json                   # generated
skills/                         # canonical authored skills
  githits-onboarding/
  githits-mcp/
  githits-code/
  githits-package/
AGENTS.md                       # canonical authored guidance
CLAUDE.md -> AGENTS.md
GEMINI.md -> AGENTS.md
.mcp.json                       # generated shared remote configuration
gemini-extension.json           # generated Gemini remote extension manifest
plugin.json                     # generated Antigravity plugin marker
mcp_config.json                 # generated Antigravity remote configuration
server.json                     # MCP registry manifest; validated by generator
scripts/
  generate-plugin-assets.ts
  generate-plugin-assets.test.ts
```

`plugins/claude` and the root Markdown `commands/` directory disappear after
root Claude installation validation succeeds.

## Generator Design

Replace `scripts/sync-claude-skill-assets.ts` and its `prepack`/`postpack`
lifecycle with a deterministic cross-host generator modeled after the
Hugging Face skills repository.

Add package scripts equivalent to:

```json
{
  "plugins:generate": "bun run scripts/generate-plugin-assets.ts",
  "plugins:check": "bun run scripts/generate-plugin-assets.ts --check"
}
```

The generator must:

1. Read canonical version and identity data from `package.json`.
2. Read the MCP endpoint and registry transport contract from `server.json`.
3. Read a typed host-capability configuration.
4. Discover and validate the canonical skill set.
5. Produce host manifests and MCP configuration with stable key ordering and
   formatting.
6. Preserve stdio for direct non-Cursor CLI setup.
7. Emit the remote MCP URL in the host-native schema for every plugin and
   extension package.
8. Source generated plugin keywords from the publisher-provided MCP registry
   metadata in `server.json` and enforce package keyword parity.
9. Fail on unknown hosts, duplicate skills, invalid transport combinations, or
   missing canonical inputs.
10. Support `--check` without writing files and print the stale output paths.
11. Be idempotent: generating twice must produce no diff.

Keep transformation and validation logic in exported pure functions. Restrict
filesystem reads and writes to a thin command entrypoint so unit tests can use
in-memory inputs and deterministic expected outputs.

Generated files are committed because marketplaces inspect Git content without
running npm lifecycle scripts. Remove `postpack` cleanup of generated plugin
assets.

## Internal Maintenance Skill

Add `.agents/skills/githits-plugin-maintenance/SKILL.md` as a concise,
project-local procedural skill.

Its description must trigger for changes to:

- `skills/**`
- `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`
- Plugin, extension, marketplace, and MCP manifests
- Root package version or shared plugin metadata
- `server.json` transport metadata
- Generator configuration, templates, or implementation
- Agent-facing setup, authentication, or plugin-installation behavior

The skill must require agents to:

1. Identify the canonical input that owns the requested change.
2. Avoid manually editing generated files.
3. Run `bun run plugins:generate` after editing canonical inputs.
4. Run `bun run plugins:check` and inspect the generated diff.
5. Run the affected manifest, packaging, skill-parity, smoke, and agent-eval
   checks.
6. Stop when a generated diff cannot be explained by the canonical change.

Add a matching mandatory rule to `AGENTS.md`. Update the existing
`githits-release` skill so release preparation runs both generator commands and
checks the generated diff before version signoff.

## Implementation Phases

### Phase 1: Characterize the current contract

- Add tests capturing the current root manifests, Claude marketplace source,
  Gemini extension, skills, commands, and transports.
- Add an explicit host capability matrix to the implementation documentation.
- Record which files are generated and which are canonical.
- Confirm that the current Anthropic community entry and Gemini extension
  gallery both resolve `githits-cli` root.

### Phase 2: Build the generator

- Implement typed configuration and pure render/validation helpers.
- Generate manifests and MCP configurations.
- Add `plugins:generate` and `plugins:check`.
- Remove the Claude-only sync script and npm lifecycle cleanup.
- Add CI drift enforcement using `plugins:check` and a clean Git diff.

### Phase 3: Consolidate skills and guidance

- Replace `GEMINI.md` with a symlink to `AGENTS.md`.
- Keep the existing `CLAUDE.md` symlink.
- Make the root `skills/` tree the only authored skill tree.
- Delete divergent Claude skills and stale Gemini guidance.
- Delete Markdown plugin commands while preserving TypeScript CLI commands.
- Add the internal `githits-plugin-maintenance` skill and update the release
  skill.

### Phase 4: Validate and simplify Claude packaging

- Generate the root Claude manifest and first-party marketplace entry.
- Run `claude plugin validate .`.
- Install the first-party marketplace from a local checkout and from GitHub.
- Confirm all four canonical skills and the remote MCP server are visible.
- Confirm no legacy Markdown commands are visible.
- Remove `plugins/claude` after the root path passes these checks.
- If root self-reference is unsupported, replace the directory only with a
  generated adapter and document the verified limitation.

### Phase 5: Add and validate Cursor packaging

- Add the native Cursor manifest.
- Point Cursor's manifest at the shared remote-only `.mcp.json` generated from
  the canonical endpoint.
- Expose the same four root skills and no Markdown commands.
- Verify Cursor marketplace presentation, tool discovery, OAuth, and a new
  Agent chat after installation.
- Confirm Cursor does not invoke the stdio package configuration.

### Phase 6: Validate Gemini, Codex, and OpenPlugin packaging

- Generate `gemini-extension.json` with remote MCP and `GEMINI.md` context.
- Install Gemini directly from `githits-cli` and confirm all canonical skills
  and current MCP tools are visible.
- Validate the root `.plugin/plugin.json` and remote `.mcp.json` contract for
  generic hosts.
- Generate and validate `.codex-plugin/plugin.json` against the shared root
  skills and remote `.mcp.json` contract.
- Confirm the MCP registry still advertises both remote and npm stdio options.
- Generate root `plugin.json` and `mcp_config.json` so the repository root is a
  native Antigravity plugin using the same root skills.
- Use Antigravity's current global `~/.gemini/config/mcp_config.json` and
  workspace `.agents/mcp_config.json` paths for direct CLI setup.

### Phase 7: Release and marketplace verification

- Run the root release workflow with generated manifests aligned to the root
  package version.
- Verify the released npm CLI before validating direct stdio CLI installs.
- Confirm the Anthropic community marketplace advances to the release through
  its existing pinned-SHA process; do not change its source layout.
- Confirm the Gemini extension gallery reflects the new CLI repository release.
- Refresh or resubmit the Cursor marketplace entry as required.
- Run targeted Claude, Cursor, Gemini, Codex, and MCP agent evaluations.

### Phase 8: Retire standalone repositories

#### Claude repository

For `githits-com/githits-claude-code-plugin`:

1. Publish a final README and marketplace notice pointing to
   `githits-com/githits-cli`.
2. Update CLI detection to distinguish current CLI-repository installs, legacy
   standalone-repository installs, and unknown sources with the same plugin
   name.
3. Provide and test an explicit uninstall/reinstall or marketplace migration
   command for legacy users.
4. Verify the migration without losing a working plugin installation.
5. Archive the repository. Do not delete it.

#### Gemini repository

For `githits-com/githits-gemini-cli`:

1. Ensure the new repository has a released, validated Gemini extension.
2. Increment the old manifest version.
3. Add:

   ```json
   {
     "migratedTo": "https://github.com/githits-com/githits-cli"
   }
   ```

4. Replace the README with a migration notice.
5. Publish the migration commit/release.
6. Verify that `gemini extensions update githits` migrates an existing legacy
   installation and preserves its settings.
7. Archive the repository. Do not delete it.

## Test Plan

### Deterministic unit tests

- Manifest rendering from typed canonical input.
- Host transport selection.
- Stable formatting and key ordering.
- Skill discovery and exact skill-set validation.
- Detection of duplicate, missing, or unexpected skills.
- `--check` stale-file reporting.
- Version and metadata parity.
- Unsupported host and invalid transport errors.

No network mocks or service injection are needed for generator rules. Use
temporary directories only for the filesystem command-edge tests.

### Repository integration tests

- Every host exposes exactly the four canonical skills.
- Generated skill content, when unavoidable, matches canonical hashes and
  includes references.
- Cursor configuration contains only the remote URL.
- Claude, Codex, Cursor, Gemini, Antigravity, and generic plugin configurations
  use the hosted remote through their host-native fields.
- Direct CLI setup retains stdio except for Cursor.
- `server.json` retains both transports.
- No plugin Markdown commands are packaged.
- `CLAUDE.md` and `GEMINI.md` are symlinks to `AGENTS.md`.
- All manifest versions match the root release version where required.
- `bun run plugins:generate` followed by `bun run plugins:check` succeeds.
- Generation followed by `git diff --exit-code` is clean.
- `npm pack --dry-run --json` includes the intended plugin and skill assets and
  excludes removed legacy payloads.

### Product validation

- `bun test`
- `bun run build`
- `bun run smoke:cli`
- `bun run smoke:mcp`
- `bun run smoke:cli:built`
- `bun run smoke:mcp:built`
- Targeted `bun run agent:e2e` workloads for broad skill and instruction
  changes, using Claude and Codex when practical
- `claude plugin validate .` and real Claude marketplace installation
- Real Cursor plugin installation, OAuth, tool listing, and marketplace review
- Real Gemini extension install/update and legacy `migratedTo` migration

Inspect agent-eval tool calls and final reports for actual tool use,
`toolIssues`, `instructionIssues`, and usefulness; harness completion alone is
not sufficient.

## Documentation Updates

- Rewrite `docs/implementation/plugin-packaging.md` around the generated
  cross-host contract.
- Update `docs/implementation/agent-onboarding-skill.md` for the single
  canonical onboarding skill.
- Update `AGENTS.md` release boundaries and generator requirements.
- Update `.agents/skills/githits-release/SKILL.md`.
- Add `.agents/skills/githits-plugin-maintenance/SKILL.md`.
- Update public installation instructions to use only
  `githits-com/githits-cli`.
- Remove documentation references to both standalone repositories after their
  migration releases are available.

## Rollout and Failure Handling

- Do not merge the Cursor remote-MCP migration as an isolated configuration
  change. Fold it into the generator-backed transport matrix.
- Do not remove `plugins/claude` until root marketplace installation is proven.
- Do not archive either standalone repository until the consolidated release is
  live and its migration path has been tested from an existing installation.
- If a host cannot consume canonical root skills directly, generate the
  smallest self-contained adapter required by that host and enforce byte-level
  parity. Do not create another authored fork.
- If generator output changes unexpectedly, stop and resolve the canonical
  ownership or renderer behavior before release.
- Archiving is preferred over deletion so old URLs, clones, and migration
  metadata remain available.

## Acceptance Criteria

- `githits-cli` is the only non-archived repository maintaining GitHits plugin
  and skill surfaces.
- Root `skills/` is the only authored public skill tree.
- Claude, Codex, Cursor, Gemini, Antigravity, and VS Code/GitHub Copilot
  OpenPlugin surfaces expose the same four current skills.
- All plugin and extension packages use the hosted remote MCP configuration.
- Direct non-Cursor CLI setup continues using the CLI package over stdio.
- Marketplace listings no longer show the six legacy Markdown commands.
- `CLAUDE.md` and `GEMINI.md` both resolve to `AGENTS.md`.
- CI rejects stale generated manifests and packaging assets.
- The internal maintenance and release skills require generator validation.
- Anthropic and Gemini listings continue sourcing `githits-cli` root.
- Existing Gemini installs can migrate through `migratedTo`.
- Existing Claude standalone installs have a tested migration path.
- Both obsolete standalone repositories are archived, not deleted.
