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
| `githits` | 0.8.0 | patch | OAuth callback reliability and HTTP client security fixes |
| `@githits/mcp` | 0.6.4 | none | No MCP-package-visible changes |

### Changed

- **Continuous release visibility (repository)** - notable changes now update
  this unreleased section as they land, with explicit SemVer impact for every
  public artifact, immutable historical release sections, and version-boundary
  validation during release preparation.

### Fixed

- **OAuth callback completion (`githits`)** - browser login now completes when
  a sandbox or proxy retains or closes the callback connection, without waiting
  for temporary listener teardown before token exchange and credential storage.
- **HTTP client security updates (`githits`)** - updated the bundled HTTP client
  to a patched release that retains the supported Node.js 20 runtime boundary.

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
