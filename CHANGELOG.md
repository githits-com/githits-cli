# Changelog

All notable GitHits CLI and public package changes are recorded here. Unreleased
changes use independent files under [`changes/`](changes/README.md) and are
consolidated here only during release preparation. Dated, versioned sections
are historical records and change only to correct blatant factual errors.

## [githits 0.10.0] - 2026-08-19

Minor release: introduces opt-in local experimental tools for target resolution
and exact source diffs while keeping the default CLI, hosted MCP, plugins, and
extensions on the stable tool inventory.

### Added

- **Local experimental tools** - adds config-gated `resolve_target` and
  `code_diff` to the local stdio MCP server alongside the matching `githits
  resolve` and `githits code diff` commands. Enable the hidden-by-default suite
  with `[experimental] tools = true`; hosted MCP, plugins, extensions, and the
  public MCP API remain unchanged.
- **Documentation source evidence** - search and search-status now identify the
  repository and published-site documentation behind results. Healthy sources
  render as compact references, while stale, incomplete, pending, or unavailable
  sources explain what was searched and what the published evidence covers.

### Changed

- **Experimental CLI defaults** - `resolve` and `code diff` are hidden and
  disabled unless the experimental suite is enabled. Optional
  `report_tool_issues = "experimental"` or `"all"` adds redacted local agent
  feedback guidance without sending feedback automatically.
- **Authoritative documentation site identities** - discovery search and status
  now carry canonical docpack URLs and show their host and path even when no
  hits are returned.
- **Human release merge gate** - release preparation now stops at an open PR;
  merging requires separate explicit human approval after that PR exists.

### Fixed

- **Confident target resolution** - Resolve guidance now emits direct canonical
  next actions only for non-ambiguous exact or high-confidence matches; weaker
  and empty results require explicit correction or selection.
- **Repository-wide code diff guidance** - CLI help, legacy-scope diagnostics,
  and public client documentation now explain that package targets resolve
  repository and commit identity while raw diffs remain repository-wide and
  bounded results may contain only sibling paths.
- **Diff terminal output** - CodeDiff now aligns wide Unicode paths by terminal
  cell width and colors patches, stat bars, summary markers, and change statuses
  when supported; verbose code-file rows use the same alignment.

## [@githits/mcp 0.10.0] - 2026-08-19

Coordinated minor release: aligns the public MCP package with the CLI 0.10 line
while improving stable documentation-source and code-diff evidence. The
experimental `resolve_target` and `code_diff` tools remain local to `githits`
and are not exported by the public MCP server API.

### Added

- **Documentation source evidence** - search and search-status now identify the
  repository and published-site documentation behind results. Healthy sources
  render as compact references, while stale, incomplete, pending, or unavailable
  sources explain what was searched and what the published evidence covers.

### Changed

- **Authoritative documentation site identities** - discovery search and status
  now carry canonical docpack URLs and show their host and path even when no
  hits are returned.

### Fixed

- **Repository-wide code diff guidance** - public client documentation now
  explains that package targets resolve repository and commit identity while
  raw diffs remain repository-wide and bounded results may contain only sibling
  paths.

## [githits 0.9.3] - 2026-08-18

Patch release: adds an unpromoted CodeDiff CLI dogfood surface and improves
CLI recovery, validation guidance, and search diagnostics.

### Added

- **Silent CodeDiff CLI dogfooding** - adds `githits code diff` with bounded
  Git-like views, repository-relative glob filtering, reversible path quoting,
  apply-safe patch handling, structured completeness diagnostics, and JSON
  output without exposing an MCP tool or agent guidance yet.

### Changed

- **Independent changelog fragments** - notable changes now record release
  notes and per-artifact SemVer impact in independently owned files, avoiding
  conflicts in `CHANGELOG.md` during normal development.

### Fixed

- **Code validation guidance** - client-side `INVALID_ARGUMENT` errors from
  shared code-read and grep request builders now name CLI commands,
  positionals, and options on the CLI while MCP keeps MCP-native tool and
  argument syntax.
- **Remove obsolete ref suggestions** - waited searches no longer recommend an
  older ref after reaching the requested commit.
- **Explain unavailable exact paths** - CLI and MCP now return
  `FILE_PATH_EXCLUDED` for excluded files and
  `SOURCE_FILE_INVENTORY_UNKNOWN` when the index cannot verify a path, with
  actionable path and resolution details.
- **Standalone-site search recovery** - CLI and MCP search now preserve ordered
  backend site suggestions, distinguish truncated candidate lists, and direct
  active crawls through search status without guessing or rewriting targets.
  Help text also distinguishes atomic interim evidence from opted-in partial
  target/source subsets.

## [@githits/mcp 0.9.2] - 2026-08-18

Patch release: adds an opt-in CodeDiff client capability and improves search
and exact-path recovery without exposing a new remote MCP tool.

### Added

- **CodeDiff client support** - adds the transport-neutral package and
  repository diff adapter as an additive `CodeDiffService` capability without
  exposing a remote MCP tool.

### Fixed

- **Remove obsolete ref suggestions** - waited searches no longer recommend an
  older ref after reaching the requested commit.
- **Explain unavailable exact paths** - MCP tools now return
  `FILE_PATH_EXCLUDED` for excluded files and
  `SOURCE_FILE_INVENTORY_UNKNOWN` when the index cannot verify a path, with
  actionable path and resolution details.
- **Standalone-site search recovery** - MCP search now preserves ordered
  backend site suggestions, distinguishes truncated candidate lists, and
  directs active crawls through search status without guessing or rewriting
  targets. Help text also distinguishes atomic interim evidence from opted-in
  partial target/source subsets.

## [githits 0.9.2] - 2026-08-14

Patch release: improves CLI exact-path recovery and makes Claude Code and Codex
CLI initialization checks more reliable.

### Fixed

- **Exact-path recovery** - typed `FILE_NOT_FOUND` responses from CLI code read
  and grep commands now name `githits code files`, `githits code grep`, and
  `githits code read` in path-discovery guidance. Extensionless exact files use
  their containing directory, and generic `NOT_FOUND` errors do not receive
  file-path guidance.
- **Claude Code and Codex CLI init setup** - user-scoped MCP checks now run
  outside project configuration, use targeted server probes with host-specific
  timeouts, distinguish missing, non-canonical, disabled, and failed checks,
  preserve enabled customized Codex entries, and avoid reporting cleanup no-ops
  as successful setup when a later command fails.

## [@githits/mcp 0.9.1] - 2026-08-14

Patch release: improves surface-native recovery from exact-path read and grep
failures.

### Fixed

- **Exact-path recovery** - typed `FILE_NOT_FOUND` responses from `code_read`
  and `code_grep` now name `code_files`, `code_grep`, and `code_read` in
  path-discovery guidance. Extensionless exact files use their containing
  directory, and generic `NOT_FOUND` errors do not receive file-path guidance.

## [githits 0.9.1] - 2026-08-13

Patch release: silently launches a CLI-only target-resolution dogfood surface,
corrects packaged Agent Skill syntax, and improves release visibility.
`@githits/mcp` remains at 0.9.0 because this release adds no MCP tool or public
MCP package surface.

### Added

- **Target resolution CLI dogfood surface** - `githits resolve` ranks canonical
  package and GitHub repository targets with compact terminal and diagnostic
  JSON output, discoverable registry help, and terminal-safe text errors. This
  silent launch is CLI-only and is not promoted through Agent Skills or an MCP
  tool.

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
