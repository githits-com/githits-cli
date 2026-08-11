# Changelog

All notable GitHits CLI and public package changes are recorded here. The
`Unreleased` section is updated with each notable change so pending releases and
package-version impact remain visible during development. Dated, versioned
sections are historical records and change only to correct blatant factual
errors.

## [Unreleased]

### Release impact

| Public artifact | Current release | Pending bump | Reason |
|---|---:|---:|---|
| `githits` | 0.9.0 | minor | Adds the `githits resolve` target-resolution command and clarifies packaged Agent Skill syntax for search-status waits |
| `@githits/mcp` | 0.9.0 | none | No MCP-package-visible changes |

### Added

- **Target resolution CLI dogfood surface** - `githits resolve` ranks canonical
  package and GitHub repository targets with compact terminal and diagnostic
  JSON output. Do not publish the command until the documented production
  relevance, latency, rate-limit, and trust-evidence gates clear.

### Changed

- **Continuous release visibility (repository)** - notable changes now update
  this unreleased section as they land, with explicit SemVer impact for every
  public artifact, immutable historical release sections, and version-boundary
  validation during release preparation.

### Fixed

- **Search-status skill syntax (`githits`)** - agent guidance now presents
  `--wait <seconds>` as a placeholder with the valid 0-60 integer range instead
  of resembling a literal `--wait 0-60` invocation.
- **Cross-platform changelog validation (repository)** - release-boundary tests
  accept both LF and CRLF Markdown while enforcing identical package-version
  content.

## [githits 0.9.0] - 2026-08-11

Minor release: adds canonical account settings and Terms of Service commands,
improves bounded search recovery, and fixes browser login completion in proxied
or sandboxed environments. `@githits/mcp` is released alongside the CLI at
0.9.0 for the shared terms-remediation and search-recovery behavior.

### Added

- **Account settings commands** - `githits settings` now supports showing,
  reading, updating, and clearing canonical account preferences with aligned
  terminal and JSON output.
- **Terms acceptance flow** - `githits settings terms` reports acceptance state,
  while `githits settings terms accept` performs explicit confirmation and
  refreshes OAuth credentials after acceptance.

### Fixed

- **Search and grep recovery** - terminal search sessions use bounded status
  waits, deferred work provides an explicit continuation, and empty results no
  longer encourage identical retry loops across CLI text and JSON output.
- **OAuth callback completion** - browser login completes when a sandbox or
  proxy retains or closes the callback connection, without waiting for
  temporary listener teardown before token exchange and credential storage.
- **Forward-compatible settings** - newer account APIs can add fields without
  breaking older CLI settings parsing.

### Security

- **HTTP client advisories** - updated the bundled HTTP client to a patched
  release while retaining the supported Node.js 20 runtime boundary.

## [@githits/mcp 0.9.0] - 2026-08-11

Minor release: adds shared Terms of Service remediation and bounded,
agent-oriented search recovery while preserving structured errors.

### Added

- **Terms remediation** - shared REST and GraphQL failures preserve structured
  authentication errors and direct callers to the canonical terms-acceptance
  flow for both OAuth and static API-token authentication.
- **Bounded search status waits** - search status exposes backend progress
  waiting through the shared bounded default and reports explicit deferred
  continuations.

### Fixed

- **Agent retry guidance** - search, search status, and grep responses stop
  suggesting futile identical retries, retain backend diagnostics, and provide
  accurate case-sensitive and truncation-aware pivots.
- **Public declarations** - error metadata constructors remain usable from the
  standalone published declarations without changing runtime behavior.

## [githits 0.8.0] - 2026-08-07

Minor release: adds portable Agent Plugins support and improves local auth
storage reliability. `@githits/mcp` remains at 0.6.4 because this release does
not change its public package surface.

### Added

- **Portable Agent Plugins support** - the repository root can be installed as
  an Agent Plugins 1.0.0 package while retaining native Claude, Codex, Cursor,
  Gemini, Antigravity, and VS Code/GitHub Copilot adapters.
- **File-storage guidance** - authentication documentation now explains system
  keychain prompts, the explicit file-storage alternative, and its plaintext
  credential trade-off.

### Fixed

- **Auth lock identity reuse** - repeated credential operations in one process
  reuse the verified process identity instead of resolving it for every lock
  acquisition.

## [githits 0.7.0] - 2026-08-05

Minor release: consolidates the cross-host plugin packages around one canonical
skill and guidance surface. `@githits/mcp` remains at 0.6.4 because the reusable
MCP package surface is unchanged.

### Added

- **Codex and Cursor plugin packages** - generated host manifests add native
  package entry points for Codex and Cursor alongside the existing Claude,
  Gemini, and VS Code/GitHub Copilot surfaces.
- **Antigravity package** - the repository root includes the native plugin and
  remote MCP configuration required by Google Antigravity.

### Changed

- **Canonical plugin assets** - root `skills/` and `AGENTS.md` now drive every
  host package through deterministic generation, replacing duplicated Claude
  skills, commands, and payload metadata.
- **Transport boundaries** - plugin and extension installs use the hosted
  remote MCP. Direct `githits init` setup remains local stdio except for Cursor,
  which uses the hosted remote MCP.
- **MCP directory discoverability** - added repository ownership metadata and a
  README link for the Glama MCP server listing.

## [@githits/mcp 0.6.4] - 2026-08-04

Patch release: improves site-targeted search and agent-facing recovery guidance.

### Added

- **Explicit site search targets** - search requests can target supported
  documentation sites directly and render site results through the shared
  response surface.

### Fixed

- **Partial documentation coverage** - documentation reads report incomplete
  coverage instead of presenting partial results as complete.
- **Agent tool guidance** - MCP instructions better direct agents between
  search, documentation, and source-navigation tools.
