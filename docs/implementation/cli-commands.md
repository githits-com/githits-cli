# CLI Commands

## Purpose

The CLI exposes setup/auth commands, `doctor`, `example`, `languages`, `feedback`, top-level indexed `search` / `search-status`, and the `code`, `docs`, and `pkg` command groups by default. `resolve` and `code diff` are experimental, host-config-gated commands. MCP-parity commands share business logic with the MCP tools through the same service interfaces and shared utilities. Unified search also shares its presentation model and text formatter with MCP; the CLI supplies ANSI enablement and executable CLI action syntax.

## Experimental CLI commands

Enable the experimental CLI surface in the shared host config:

```toml
[experimental]
tools = true
report_tool_issues = "experimental" # optional: "experimental" or "all"
```

`experimental.tools` is a strict boolean and defaults to `false` when absent.
`experimental.report_tool_issues` is optional; accepted values are
`"experimental"` (the local `resolve_target` and `code_diff` tools) and
`"all"` (any GitHits tool while the experimental suite is active). Omission
means reporting is off. A reporting value is dormant when `tools = false`, but
invalid values and types are still rejected by strict config-consuming paths.
Reporting changes agent guidance only: it never sends feedback automatically;
when explicitly enabled, an agent may make one concise, redacted negative
feedback call per distinct observed issue with `accepted: false` and the exact
tool name. Credentials, personal/private data, proprietary content, full file
bodies, and large outputs must not be included.

GitHits reads `$XDG_CONFIG_HOME/githits/config.toml` (or
`~/.config/githits/config.toml` when `XDG_CONFIG_HOME` is unset) on Unix-like
platforms and `%APPDATA%\githits\config.toml` on Windows. Existing macOS
installations may also be read from the legacy Application Support path when
the canonical file is absent.

Without the setting, or with `tools = false`, root and `code` help omit
`resolve` and `diff`. Direct invocations fail before authentication or network
startup with the resolved config path and the snippet above. Terminal failures
retain that exact path/snippet; `--json` failures write only the structured
`INVALID_ARGUMENT` envelope to stderr and keep stdout empty. Malformed config
falls back to the stable help/version and recovery surfaces; direct
experimental invocations report the path-qualified config error using the same
terminal/JSON split. Stable commands that need authentication likewise render
malformed auth/config failures as the same stderr-only `INVALID_ARGUMENT` JSON
envelope when `--json` is requested; terminal output remains human-readable.

## Commands

| Command | Required Args | Options | Description |
|---|---|---|---|
| `init` | — | `-y, --yes`, `--skip-login`, `--no-browser`, `--port <port>`, `--project`, `--detect-agents`, `--install-agents <ids>`, `--guidance`, `--no-guidance`, `--json` | Authenticate and set up MCP server for coding agents; interactive setup asks whether to configure user-level or project-level MCP where supported; guided setup installs supporting instructions unless opted out; staged flags support agent-safe non-interactive onboarding |
| `uninstall` | — | `-y, --yes`, `--project`, `--keep-guidance` | Canonically remove GitHits MCP configuration and guidance from coding agents or supported project-local MCP files; `init uninstall` remains a compatibility alias with identical options and behavior |
| `init uninstall` | — | `-y, --yes`, `--project`, `--keep-guidance` | Compatibility alias for the top-level `uninstall` command |
| `login` | — | `--no-browser`, `--port <port>`, `--force` | Authenticate with browser OAuth using a loopback callback on the machine running GitHits |
| `example <query>` | `<query>` | `-l, --lang <language>`, `--license <mode>`, `--explain`, `--json` | Search for code examples |
| `search <query>` | `--in <target>` | `--source <source>`, `--kind <kind>`, `--category <category>`, `--path-prefix <prefix>`, `--intent <intent>`, `--public`, `--name <name>`, `--lang <language>`, `--allow-partial`, `--limit <n>`, `--offset <n>`, `--wait <seconds>`, `--json` | Unified indexed search across dependency/repository code, docs, and symbols. Defaults to 10 results. |
| `search-status <search-ref>` | `<search-ref>` | `--wait <seconds>`, `--json` | Check progress, fetch partial hits, or fetch final results for a prior unified search; waits up to 20 seconds by default |
| `languages [query]` | — | `--json` | List or filter supported languages |
| `feedback [solution_id]` | `--accept` or `--reject` | `-m, --message <text>`, `--tool <name>`, `--json` | Submit solution-tied or generic session feedback |
| `doctor` | — | `--json` | Print redacted diagnostics for GitHits runtime, environment, service URLs, config, and auth storage |
| `resolve <name>` *(experimental; config-gated)* | package or GitHub repository name | `--query`, `--registry`, `--prefer-kind`, repeatable `--intent-hint`, `--limit`, `--verbose`, `--json` | Resolve a human-provided name to ranked concrete targets for follow-up commands |
| `settings` | — | `--json` | Show canonical preferences, privacy and terms, and account limits |
| `settings show` | — | `--json` | Explicit form of `settings` for showing all account settings |
| `settings get <key>` | setting key | `--json` | Read one writable setting using its public CLI name |
| `settings set <key> <values...>` | setting key and typed value(s) | `--json` | Selectively update one writable account setting |
| `settings clear <key>` | clearable setting key | `--json` | Clear the default language or replace blocked license IDs with an empty list |
| `settings terms` | — | `--json` | Show the current Terms of Service acceptance state |
| `settings terms accept` | — | `--yes`, `--json` | Confirm and accept the current Terms of Service |
| `pkg info <spec>` | package spec | `--verbose`, `--json` | Show a package overview (latest version, downloads, license, vulnerabilities) |
| `pkg vulns <spec>` | package spec (optional `@version`) | `--severity`, `--scope`, `--include-withdrawn`, `--verbose`, `--json` | List known vulnerabilities for a package (npm/pypi/hex/crates/nuget/maven/packagist/rubygems/go/swift) |
| `pkg deps <spec>` | package spec (optional `@version`) | `--lifecycle`, `--depth`, `--issues`, `--verbose`, `--json` | Analyse dependencies: direct runtime deps, structured groups, optional capped transitive graph, and opt-in dependency issue analysis (npm/pypi/hex/crates/vcpkg/zig/rubygems/go/swift) |
| `pkg changelog [spec]` | package spec OR `--repo-url` | `--from`, `--to`, `--limit`, `--git-ref`, `--no-body`, `--verbose`, `--json` | Release notes / changelog entries for a package or GitHub repo (GitHub Releases, CHANGELOG.md, or HexDocs). Default shows each entry with a 10-line body preview; `--verbose` uncaps, `--no-body` drops. |
| `pkg upgrade-review [spec]` | single package spec with current version plus `--to`, OR repeatable `--package` ranges | `--to`, repeatable `--package`, `--no-transitive-security`, `--dependency-issues`, `--min-severity`, `--verbose`, `--json` | Compare current and target versions for upgrade evidence: vulnerabilities, changelog entries, deprecation metadata, peer changes, dependency changes, and transitive security evidence by default. Reports facts only. |
| `docs list <spec>` | package spec (optional `@version`) | `--limit`, `--after`, `--verbose`, `--json` | List hosted/crawled and repository-backed documentation pages for a package. Entries include page IDs for `docs read`; JSON includes exact repo-file follow-up metadata when available. |
| `docs read <page-id>` | page ID from `docs list` or search results | `--lines`, `--verbose`, `--json` | Read a documentation page by page ID. Default output is content-only; `--lines` fetches a bounded range for long pages. |
| `code diff <target> <from>..<to>` *(experimental; config-gated)* | unversioned package/repository target and exact range, or `--repo-url` and range | `--patch`, `--stat`, `--name-only`, `--name-status`, `--max-files`, `--max-patch-bytes`, `--verbose`, `--json`, one glob after `--` | Silently dogfood bounded repository-wide tree diffs resolved from package versions or repository refs; local-only MCP `code_diff` is available when experimental tools are enabled, while public/remote MCP and shared Agent Skill guidance remain unchanged |
| `code files [spec] [path-prefix]` | package spec OR `--repo-url` with optional `--git-ref`; optional `[path-prefix]` | `--path`, repeatable `--glob`, repeatable `--ext`, repeatable `--file-type`, repeatable `--language`, repeatable `--file-intent`, repeatable `--exclude-intent`, `--exclude-docs`, `--exclude-tests`, `--hidden`, `--limit`, `--wait`, `--verbose`, `--json` | List files in an indexed dependency. Selectors (`[path-prefix]`, `--path`, `--glob`) are OR-ed; the other flags filter that scope down further. Plain output is one path per line; `--verbose` adds language / type / size annotations. Indexing errors include elapsed/expected duration when available plus retry via `--wait` or indexed refs/versions from the error detail. |
| `code read <spec?> <path>` | package spec OR `--repo-url` with optional `--git-ref`; plus `<path>` | `--lines`, `--start`, `--end`, `--wait`, `--verbose`, `--json` | Read a file's contents. Plain output is the raw file bytes (pipe-friendly); `--verbose` adds a header and a line-number gutter. `--lines 10-40` concise form; `--start`/`--end` equivalent. Binary files show a sentinel line. |
| `code grep [spec] <pattern> [path-prefix]` | package spec OR `--repo-url` with optional `--git-ref`; plus `<pattern>` and optional `[path-prefix]` | `--path`, repeatable `--glob`, repeatable `--ext`, `--regex`, `--case-sensitive`, `-C/-A/-B`, `--exclude-docs`, `--exclude-tests`, `--limit`, `--per-file-limit`, `--cursor`, `--symbol-field`, `--wait`, `--verbose`, `--json` | Deterministic text grep over indexed dependency or repository source. Defaults to whole-target, literal, ASCII case-insensitive matching; `--per-file-limit` defaults to `--limit`. Narrow with `[path-prefix]`, `--path`, `--glob`, or `--ext`. Plain output is `file:line:text`; `--verbose` groups matches by file. |

### `githits init`

```
githits init                                      # Interactive: authenticate, scan, configure unconfigured agents
githits init --yes                                # Interactive shortcut: configure all detected unconfigured agents
githits init --skip-login                         # Skip authentication, configure tools only
githits init --no-browser                         # Print sign-in URL instead of opening a browser
githits init --no-browser --port 8765             # Fix the callback port for an SSH tunnel
npx -y githits@latest init --detect-agents        # Agent-safe discovery: scan and print detected agent IDs/statuses
npx -y githits@latest init --detect-agents --json # Machine-readable discovery output for agents
npx -y githits@latest init --install-agents cursor # Agent-safe install: configure only explicit detected IDs
npx -y githits@latest init --install-agents cursor --no-guidance # Agent-safe plain-MCP install
npx -y githits@latest init --project --detect-agents # Agent-safe project discovery for current repo
npx -y githits@latest init --project --install-agents cursor # Agent-safe project install for explicit IDs
githits uninstall                                 # Interactive: choose user-level or project-level uninstall
githits uninstall -y                              # Non-interactive: remove all detected user-level GitHits MCP configs
githits uninstall --project                       # Explicit project-level uninstall
githits uninstall --project --yes                 # Non-interactive project-level uninstall
githits uninstall --yes --keep-guidance           # Remove MCP config but retain GitHits guidance
githits init uninstall --yes                      # Compatibility alias for the root command
```

Authenticates with GitHits (via OAuth in the browser), then scans for available coding agents, checks which are already configured, and sets up selected agents with your confirmation. `--no-browser` suppresses browser launching but leaves the OAuth callback on the GitHits machine. `--port` selects that loopback callback port so an SSH tunnel can be prepared before authentication starts. All agents are pre-checked before any setup begins, so the status display is fully resolved. CLI agents are considered available only when their executable is on `PATH`; Codex additionally must exit successfully from a bounded `codex --version` probe. Related dot-directories alone do not count for CLI agents, while config-file agents remain filesystem-detected using their known app/config directories. If already authenticated, the login step is skipped automatically. If login fails, the user is prompted to continue with tool setup anyway. If all detected agents are already configured, init shows a verification-only review and summary without confirmation, authentication, or writes.

### Browser authentication over SSH

The callback listener binds to `127.0.0.1` on the host running GitHits. A
browser on a different host cannot reach that listener through its own
loopback address. Use the same fixed port on both sides of an SSH local
forward.

On the computer that has the browser:

```sh
ssh -N -L 8765:127.0.0.1:8765 user@remote-host
```

On the remote GitHits host:

```sh
githits init --no-browser --port 8765
# or, after setup:
githits login --no-browser --port 8765
```

Keep the tunnel open until sign-in completes. Without an explicit port, the
login flow preserves its existing stored-client or random-port behavior and
prints forwarding instructions for the selected port. CLI port values are
strict integers from 1 to 65535.

This callback flow requires a person to complete sign-in. CI and other
unattended workloads should use `GITHITS_API_TOKEN` from a secret manager.

Interactive MCP setup asks where GitHits should be configured. User-level setup preserves the existing global/user config behavior for all supported tools except Cursor, which uses the remote MCP URL `https://mcp.githits.com` and migrates legacy local stdio entries. Project-level setup is partial because MCP project config conventions differ by tool; GitHits only offers project setup for tools with verified project-local MCP support: Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json` with the remote URL), VS Code / Copilot (`.vscode/mcp.json` with `type = "stdio"` server entries), Codex CLI (`.codex/config.toml`), Pi (`.mcp.json` with `pi-mcp-adapter` installed when needed), Gemini CLI (`.gemini/settings.json`), and OpenCode (`opencode.json`). Detected tools without verified project-local MCP support are shown as skipped with a reason. Project config contains no secrets, but it may be committed to source control like other project tooling configuration. Gemini may ignore project settings in untrusted workspaces.

When `init` is run without a TTY, it prints agent onboarding guidance and exits without scanning, writing config, prompting, or authenticating. Non-interactive `--yes` is rejected for safety because it can configure tools without explicit per-tool user approval. Interactive setup uses five setup steps: detect tools, choose tools, review and confirm, sign in, then install and verify. Selection separates MCP mutation targets, guidance-repair targets, and configured reporting-only agents: an unselected configured agent is reported unchanged and is never retargeted. Guidance-only or stale-skill cleanup selections perform guidance work without MCP mutation or authentication; an empty selection prints `Nothing selected, no changes made` and exits before review, authentication, or writes. The review separately identifies MCP tools to configure and only agents with verified guidance targets; states that GitHits queries and public package, repository, and documentation targets are sent to GitHits services, feedback submission is an outbound write, and installing MCP does not itself upload the local workspace; and explains that changed MCP configuration or supporting instructions require a new coding-agent session. The terminal and machine do not need to be restarted. The user must confirm before authentication when selected MCP or guidance mutations are pending. A fully configured verification-only run needs no confirmation, authentication, or writes. Declining or interrupting confirmation exits without setup side effects, while interactive `--yes` displays the review and acts as acknowledgment. After selection, review and final summaries describe local stdio, Cursor's hosted remote MCP at `https://mcp.githits.com`, or both based only on the selected usable targets. Cursor readiness always requires separate Cursor OAuth and tool discovery; mixed runs qualify local CLI authentication as applying only to non-Cursor integrations. Agentic onboarding must use the staged flow instead: ask whether the user wants user-level install or project-level install for the current repo, run `npx -y githits@latest init --detect-agents` or `npx -y githits@latest init --project --detect-agents`, then route empty actionable results by status: stop when no tool is detected, offer user-level detection when project tools are unsupported, or continue to auth only when a supported tool is already configured. When setup is actionable, show the install review and detected tools, then run the emitted `suggestedCommand` only after approval. Staged JSON keeps `installableIds` MCP-only and adds per-agent `guidanceStatus`, `guidanceRequested`, and `actionableIds` so guidance-only repair remains available. Generated install and verification commands preserve `--no-guidance` for plain-MCP flows. Project staged detection marks detected tools without verified project config as `unsupported_project_config` with a reason; agents must not offer those IDs for project install. Agent-facing guidance explicitly forbids `githits init -y` / `githits init --yes` unless the user asks to configure every detected tool, and tells agents to verify successful staged installs with the matching scoped detect command instead of running init again. `--install-agents` rescans, rejects unknown, unsupported-project, or currently undetected IDs before writing, installs only the requested agents, verifies setup, and does not authenticate. Cursor instructions distinguish local CLI auth from Cursor-managed OAuth and require direct MCP tool discovery checks in a new Cursor Agent chat. Cursor-only staged JSON reports `auth.status = "managed_by_cursor"` with Cursor login and verification commands instead of inspecting or recommending local CLI auth. If every install fails, init reports installation errors and suppresses auth guidance. `--json` is supported only for staged detect/install modes so agents do not need to scrape prose.

Every non-null staged-detection `suggestedCommand` includes `--json` so agents receive stable `outcomes`, `guidance`, `auth`, and `instructions` fields. Both non-interactive entry points preserve explicit `--no-guidance` intent in every generated detect, install, and verification command. Staged install instructions distinguish intentional guidance opt-out, successful installation, existing configuration, unsupported/skipped targets, and failures; guidance remediation remains visible even when MCP installation fails.

Global setup supports Claude Code, Cursor, Windsurf, VS Code / Copilot, Cline, Claude Desktop, Codex CLI, Pi, Gemini CLI, Google Antigravity, OpenCode, Hermes Agent, Zed, Junie, Qwen Code, Kiro, Kilo Code, Factory Droid, and Amazon Q CLI. It uses structured file inspection for Claude's user MCP state, CLI MCP commands for Codex and Gemini CLI, Amazon Q CLI commands, Pi adapter setup plus Pi-owned MCP config writes (Pi), and atomic config file writes (Cursor, Windsurf, VS Code, Cline, Claude Desktop, Google Antigravity, OpenCode, Hermes Agent, Zed, Junie, Qwen Code, Kiro, Kilo Code, Factory Droid). Claude setup removes legacy GitHits plugin and marketplace state, while Gemini setup removes legacy extension state; both then install the user-scoped stdio entry. Other command-based agents use read-only checks to determine global configuration status before prompting. Claude's file check and Codex's command check target only the `githits` server; Codex runs from a temporary directory so a project-local MCP entry cannot shadow user configuration. Existing non-canonical Claude entries remain installable and removable. A disabled Codex entry is never overwritten by setup: init reports an actionable failure until the user re-enables or removes it, while uninstall can remove it. Probe failures remain distinct from confirmed missing or non-canonical entries during setup and verification.

The command uses `createContainer()` lazily for the login step. Tool detection and configuration use lightweight dependencies that don't require auth.

The top-level `githits uninstall` command reverses the tool configuration performed by init; `githits init uninstall` remains a compatibility alias with the same flags and behavior. In interactive mode it first asks whether to remove user-level config or project-level config. User-level uninstall scans the same supported agents, removes only GitHits MCP/plugin entries, and leaves authentication credentials untouched. Unless `--keep-guidance` is passed, interactive user uninstall also removes the four canonical GitHits skill files and exact historical Cline/Junie `githits-mcp/SKILL.md` files owned by the selected tools. Guidance usable by an unselected detected tool is retained, including shared targets, and a selected tool retains its guidance when its MCP removal fails. Non-interactive `--yes` and user uninstall with no configured MCP target clean every verified user guidance target; project uninstall cleans every verified project guidance target. Unrelated skills and directories are preserved. Use `npx githits@latest logout` separately to remove stored credentials. For Claude Code, user-level inspection reads `$CLAUDE_CONFIG_DIR/.claude.json` when `CLAUDE_CONFIG_DIR` is non-empty, otherwise `~/.claude.json`; it inspects only `mcpServers.githits`, skips an already-absent removal, and rereads the structure after mutation. Malformed or unreadable Claude state blocks MCP mutation. Config-file uninstall removes `GitHits`/case-variant server entries while preserving other MCP servers and user settings; MCP host-config cleanup preserves the host config files and directories. Project uninstall uses the verified project config paths above, removes only GitHits entries from project-local files, preserves unrelated servers/settings, and best-effort removes legacy `.githits/init/project-setup.json` markers from earlier versions. Project uninstall does not remove global tools or Pi's global `pi-mcp-adapter` package because they can be shared by other projects; legacy, pre-existing, and GitHits-installed global Pi adapters are left installed. User-level Pi uninstall removes the `GitHits` entry from Pi's MCP config and runs `pi remove npm:pi-mcp-adapter` when the Pi CLI is available; if Pi is no longer installed, stale Pi MCP config entries are still removable without attempting adapter cleanup. Project uninstall is best-effort across supported config paths: missing files and files without GitHits are skipped, malformed/read-only/write-failing files are reported in the final summary, and the command exits 1 only after all possible removals have been attempted. JSONC-style files are accepted on read and rewritten as canonical JSON only when changed, matching setup behavior. Codex project setup rewrites `.codex/config.toml` as TOML and does not preserve existing TOML comments or formatting.

Guidance cleanup attempts each in-scope skill and managed-block target independently. Already-absent targets are quiet, supported skill-directory symlinks remain in place after `SKILL.md` removal, and hard failures keep their target path while later targets continue. Guidance is rendered separately from MCP agents: changed or failed paths are shown, protected targets collapse to one unchanged row stating how many targets tools may still use, all-absent guidance collapses to one unchanged row, guidance affects the headline and exit status, and agent counts exclude it.

For automation, `githits uninstall --yes` is user-level only and never touches project files. Use `githits uninstall --project --yes` for non-interactive project-level removal. The nested `githits init uninstall` form remains supported for compatibility.

**File structure:** The init command uses a subdirectory (`src/commands/init/`) because it has distinct submodules (agent definitions, setup handlers, orchestrator). This is an accepted variation for commands with significant internal complexity.

### `githits settings`

```sh
githits settings
githits settings --json
githits settings show
githits settings get license-mode
githits settings set license-mode safe
githits settings set marketing-emails disabled
githits settings set blocked-license-ids 0198a7d0-6750-7ace-a68c-418062117d95 0198a7d0-6750-7ace-a68c-418062117d96
githits settings clear blocked-license-ids
githits settings terms
githits settings terms accept
githits settings terms accept --yes --json
```

Settings calls the self-scoped account API with the active credential. The root
command and `show` display all settings. `get`, `set`, and `clear` use a
whitelisted public key schema: `default-language-id`, `license-mode`,
`blocked-license-ids`, and `marketing-emails`. The schema validates each value
and maps it to the canonical API field, so the CLI does not expose the negative
`marketing_email_opted_out` storage name. `marketing-emails` accepts
`enabled`/`disabled`; `license-mode` accepts `safe`/`yolo`/`custom`; blocked
license IDs are an atomic list replacement. `clear blocked-license-ids` sends
an explicit empty list, while `clear default-language-id` sends null.

JSON overview and update output remains the canonical settings object.
`settings get <key> --json` returns `{key, value}` using the public key and
value. Every mutation sends exactly one selective PATCH. JSON batch input is
intentionally omitted until an atomic multi-setting workflow is required.

Terms acceptance prompts unless `--yes` is supplied. OAuth sessions are
force-refreshed after the write so subsequent requests receive the updated JWT
claim. Static `GITHITS_API_TOKEN` credentials are not refreshed; their terms
state is re-evaluated server-side without token refresh. If acceptance succeeds but
OAuth refresh fails, output reports the saved acceptance and instructs the user
to run `githits login --force`.

Downstream REST and GraphQL clients recognize the structured
`TERMS_ACCEPTANCE_REQUIRED` response, refresh OAuth at most once, and retry at
most once. A still-gated request returns the stable
`githits settings terms accept` remediation plus the authenticated web
acceptance URL; `ghi-*` credentials never enter a refresh loop.

### `githits example`

```
githits example "how to use express middleware"
githits example "how to use express middleware" --lang javascript
githits example "async file reading" -l python --license yolo
githits example "react hooks patterns" -l typescript --explain
githits example "react hooks patterns" -l typescript --json
```

Default output is markdown (the API response). `--lang` is optional; when omitted, the backend infers the language from the query. With `--explain`, an AI-generated explanation is included alongside the code example. With `--json`, output is `{ "result": "<markdown>", "solution_id": "<uuid>" }` (`solution_id` is omitted only if the markdown lacks a solution URL — pass it back to `feedback`). The MCP `get_example` tool always sends `include_explanation: false` since LLMs don't need the extra context.

API rate-limit and timeout responses use the shared structured error envelope.
Example requests use a longer client deadline than shorter metadata operations.
When the API supplies `Retry-After`, JSON output preserves it as
`details.retryAfterSeconds`; terminal output provides the same retry timing in
plain language. The client returns the error immediately and does not retry it
automatically.

### `githits search`

```
githits search "router middleware" --in npm:express
githits search '"body parser" OR multer' --in npm:express --source docs
githits search "compose" --in npm:lodash --source code --kind function
githits search "debounce" --in npm:lodash --source symbol
githits search "middleware" --in site:expressjs.com --source docs
githits search "composeArgs" --in npm:lodash --name composeArgs --json
```

Unified search spans indexed dependency and repository code, docs, and explicit symbols. The positional query is the backend discovery syntax, not a raw pass-through to a per-source search engine. It supports implicit `AND`, uppercase `OR`, parentheses, unary `-`, quoted phrases, semantic qualifiers (`kind:`, `category:`, `path:`, `lang:`, `name:`, `intent:`), and routing qualifiers (`registry:`, `package:`, `version:`, `repo:`). Structured flags are compiled together with the query using `AND` semantics before the request reaches the backend.

**Decision guide.** Use `githits example` for canonical cross-project examples. Use `githits search` for indexed dependency/repository search. Use `githits search --source symbol` when you want symbol-shaped unified search.

**Targets.** `--in <target>` is repeatable and required. Package targets require explicit `registry:name[@version]` (for example `npm:express`, `pypi:requests@2.32.3`) and inspect an indexed artifact/manifest root. Swift package targets use `swift:github.com/<owner>/<repo>`; Zig package targets use `zig:gh/<owner>/<repo>`. Use public GitHub repository targets for full repositories or sibling packages. Repo targets use `github:org/repo[#ref|@ref]`, `github.com/org/repo[#ref|@ref]`, or `https://github.com/org/repo[#ref|@ref]`; omitted refs request the backend default-branch intent. Exact standalone documentation sites use `site:<host[/path]>` and normally pair with `--source docs`. User-facing output canonicalizes repo targets as `github:org/repo#ref` so refs can contain `@` safely. Exact duplicate targets are deduplicated while preserving order. Mixing target kinds in the same request is supported.

**Sources and filters.** `--source docs|code|symbol` restricts results to one evidence type; omit it to let GitHits select the best sources. Use `--source symbol` when you want symbol-shaped search results. `--category` is the broad filter (`callable`, `type`, `module`, `data`, `documentation`); `--kind` is the precise taxonomy. `--path-prefix`, `--intent`, and `--public` narrow the result set further. For docs-only search, code/symbol-only filters (`category`, `kind`, `file_intent`, `public_only`) are ignored client-side because the backend docs source rejects them. `--name` and `--lang` compile into query qualifiers instead of becoming separate backend fields.

**Intent filter.** When `--intent` is omitted, unified search sends no file-intent filter. Pass `--intent production` or another specific intent only when you want to narrow the result set. Some sources can still ignore `fileIntent`; when they do, the JSON `sourceStatus` block and terminal notes report that explicitly.

**Complete-by-default results.** The CLI sends `allowPartialResults: false` unless `--allow-partial` is passed. Every result-bearing initial JSON payload includes the backend's exact `partialResults` Boolean; a response with no result snapshot omits that field. CLI `--json` and MCP `format: "json"` share this additive structured truth. If required indexing, crawling, or refresh work does not complete within the wait window, an active response returns a `searchRef` and progress summary. Stale-but-serveable or provisional-but-queryable evidence can accompany the reference while background refresh continues. The rendered `search-status` action is the concise way to continue; reissuing the same search is also valid and waits on the same underlying work. Ordinary cases are a known active status (`PENDING`, `INDEXING`, or `SEARCHING`) and a completed result with an evidence notice. Provisional results remain visibly marked as still indexing and retain exact served identity. With `--allow-partial`, evidence from other ready target/source pairs can also be included while remaining work continues. Terminal `DEFERRED` retains any disclosed evidence and exact progress but stops advancing the reference; use that evidence now and start a new search later for a fresher snapshot. Future backend status values remain readable rather than failing response validation. The CLI keeps unknown lifecycle output conservative and does not poll an unrecognized reference. A missing or ambiguous standalone site can instead return target-local recovery without a reference; callers can retry an explicit suggested site label when present. `--limit` defaults to 10 results. `--wait` is in seconds (0-60, default 20).
**Terminal target recovery and provenance.** The CLI renders one target-state list. Exact `NOT_FOUND` and `UNRESOLVABLE` source states become readable lane-specific reasons such as `package not found: code`, `version unavailable: code`, or `repository ref unresolved: code`. If the target also has searched or indexing evidence, the reason is bare (`not found: symbols`) and coordinate recovery is omitted. A target with no searched/indexing lane gets at most one inline `Fix:` or replayable `Try:` line; package guidance points to its public GitHub repository for full-repository or sibling-package evidence. Site suggestions and indexed alternatives stay on the affected target, and package refs remain informational rather than replayable package targets. Completed-empty and terminal site suggestions remain `Try:`-eligible even when the site lane was searched empty. `SYMBOL` readiness is presented as `symbols`, separately from `code`. Target-owned constraints stay inline with their lane; query-wide warnings and unowned source constraints remain one global block. Structured JSON keeps source-status, target-resolution, warning, and hit values unchanged.

The original unified-search plan envisaged hiding partial mode entirely in v1 to make results trustworthy by default. We kept the flag exposed because some agent and CLI flows benefit from "show me what you have so far." The trust contract is preserved by keeping the default atomic across runnable target/source pairs: callers must explicitly opt into a serveable subset, while any unflagged interim evidence still covers every runnable pair and carries its `searchRef` and freshness signals.

**Output.** CLI human output and MCP `text-v1` use one shared outcome-first formatter. The headline combines result count/type breakdown, active or terminal lifecycle, aggregate readiness, and pagination when applicable. Ordinary completed current results collapse to one `Sources: <target> - <sources>` row: code and symbols use compact lane names, while documentation contributors retain canonical `site:<host[/path]>` and `github:<owner>/<repo>#<revision>` locators. A source identical to its standalone target is written once; a sole pinned repository source replaces its less-specific ref-less repository target, while an already-pinned target remains beside its resolved commit. Compact repository provenance requires both the repository URL and commit. Documentation without concrete provenance stays in detailed target-state form. Any stale, provisional, coverage, constraint, alternative, suggestion, terminal, or other trust fact keeps every requested target in the same detailed list. Each target identity is followed by deterministic `using`, `searched`, `indexing`, terminal/unavailable, `available`, `indexed`, and constraint segments as applicable. Detailed lanes are `code`, `symbols`, `repository docs`, concrete site docs, and docs. Hits remain a separate numbered ranked evidence list with their follow-up locators: `[1] npm:express@5.2.1 History.md:169-179 [repo doc] - 5.0.0-alpha.4 / 2017-03-01` or `[2] 386050 [docs page] npm:express - expressjs.com/en/4x/api/router/#routerroute - router.route()`. Repository code and symbol hits use one header shape: the path suffix is the focused evidence range, while a meaningful qualified symbol identity retains signature detail from the hit title and is followed by its kind and any differing definition range. A differing indexed range without a definition is labelled as a chunk; equal ranges are printed once. Documentation headers retain the actual page ID required by `docs_read`; formatter-authored punctuation is ASCII and Unicode in backend payloads passes through unchanged. Executable read command lines and qualified internal IDs stay omitted from default text. Active empty output is `No results yet | indexing | 0/1 ready`; no-snapshot output is `No result snapshot yet | indexing | 0/1 ready`, with the corresponding lower-case lifecycle for other active states. Terminal no-snapshot output is `No result snapshot | failed | 0/1 ready`, and completed output omits lifecycle/readiness. Query-wide warnings appear once after target rows and before hits. There is no separate session row: at most one `Next:` line follows the hit list, and an active `searchRef` appears exactly once there. CLI uses `Next: githits search-status <ref> --wait 20`; MCP uses its own `search_status` syntax. CLI enables ANSI emphasis when supported, but removing ANSI leaves the same hierarchy and wording apart from surface-native actions; line breaks can differ because CLI uses terminal width while MCP defaults to 80 columns. `--json` emits the shared stable success/error envelope used by MCP `search`, including the full initial `query` echo and exact result-bearing `partialResults` Boolean. Repository hit locators preserve legacy target-relative evidence coordinates plus `commitSha`, `repositoryFilePath`, `evidenceRange`, `indexedRange`, and relation-aware `symbolContext`; the preferred `followUp` uses the proven definition or focused evidence at the exact served repository snapshot. JSON remains lossless while text is optimized for agent decisions.

The representative CLI n8n active-empty output shape is:

```text
No results yet | indexing | 0/1 ready

- npm:n8n
  indexing: code, repository docs; available: n8n.io docs (<pages> pages; capped);
  indexed: versions 2.26.9, 2.26.5, 2.23.2 +2, refs HEAD, master

Next: githits search-status <search-ref> --wait 20
```

**Highlighting and width.** The shared formatter applies backend-provided title and summary spans and uses a small semantic color hierarchy on CLI: active/degraded outcomes and warnings are yellow, failed outcomes are red, primary identities and exact actions receive emphasis, and target details remain plain. Color never carries meaning or changes wording. CLI target details and hit summaries wrap to the current terminal width; MCP uses the shared 80-column fallback.

**Trust signals.** The JSON `sourceStatus` block remains lossless. Shared text groups structured readiness and trust facts under each target, including searched, waiting, unavailable, stale, provisional, and capped coverage. Exact requested/fresh/served divergence appears once only when identities differ; `using:` omits the arrow when it already explains the served snapshot. Raw reason codes, indexing references, promoted duplicate warnings, opaque evidence prose, and the exact `evidenceNotice` remain in JSON. Constraint and warning text retains separate raw lane and target provenance, such as `ignored filter (docs): fileIntent`; known lanes are lowercased and unknown non-empty lanes pass through lowercased. Empty output distinguishes a searched empty snapshot from no result snapshot and selects only an applicable target-local or global action. Hits remain separate from target-state diagnostics.

Contributor-bearing rows omit redundant pair-level `resultCount`, pair-level `coverage`, and healthy resolution metadata from the compact JSON projection. Other source-status signals remain unchanged: ignored / incompatible filters and query features, terminal indexing notes, promoted freshness warnings, and ordered standalone-site recovery targets. Site suggestions come from `suggestedSiteTargets`; the exact `suggestedSiteTargetsTruncated` Boolean is retained whenever suggestions are present. They are advisory labels to retry explicitly, not aliases, and the client never selects or retries one automatically.

When pending or required work can change the disclosed snapshots, the result carries one backend-owned `evidenceNotice`. JSON preserves it exactly; default human output uses concrete target-grouped stale, provisional, or coverage facts and does not render the notice as a generic slogan. A known-active search with a `searchRef`, or a completed result whose evidence notice retains that reference, points to `search-status`; reissuing the same search is valid and waits on the same underlying work. Terminal `DEFERRED`, `TIMEOUT`, and `FAILED` responses preserve disclosed evidence and direct callers to a later new search when appropriate. Unrecognized statuses retain their raw value without inferred lifecycle semantics. This notice is independent of `allowPartialResults`: pair-level partial results and partial/capped docpack coverage remain separate concepts.

### `githits search-status`

```
githits search-status ref_abc123
githits search-status ref_abc123 --json
```

Follow-up for a prior unified search. Use the `searchRef` only when `githits search` emits the explicit action, including when the initial request could not complete inside the wait window or a completed result carries an evidence notice. Before completion, `search-status` can return an atomic interim result when every runnable target/source pair is serveable; if the original request used `--allow-partial`, it can instead return a serveable subset while other pairs remain unavailable. Its human output uses the same single target-state list as `search`: the headline carries lifecycle/readiness, target-local state and recovery stay with each identity, hits remain separate, and one final continuation can follow.

`PENDING`, `INDEXING`, and `SEARCHING` are active incomplete states and can be checked again with the same reference. `DEFERRED` is terminal even though JSON keeps `completed: false`: the session has stopped following lifecycle work, any stored `result` and progress remain usable, and a later `search` starts a fresh session when needed. `TIMEOUT` and `FAILED` are also terminal.

`search-status` deliberately does **not** reconstruct the original structured request echo. The backend status API exposes progress, final results, and the backend-normalized query string, but it does not expose the original target/filter/defaulting inputs. The JSON payload therefore contains only fields the follow-up endpoint can actually know: `{completed, searchRef?, progress?, result?}`.

With `includeResults: true`, the stored `result` retains the same documentation
contributors and `evidenceNotice` as the initial search result. The CLI uses the
same projection and documentation-source formatter for both commands; contributors are not
duplicated onto generic progress targets. JSON remains the stable, lossless
follow-up contract even when text collapses healthy sources or groups recovery inline.

### `githits languages`

```
githits languages              # list all supported languages
githits languages python       # filter by name/alias (top 5)
githits languages type --json  # JSON output for piping
```

Without a query, lists all languages. With a query, filters to top 5 matches using the same logic as the `search_language` MCP tool (case-insensitive substring match on name, display_name, and aliases). Default output uses colored terminal formatting. JSON output is `[{ "name": "...", "display_name": "...", "aliases": [...] }, ...]`.

### `githits feedback`

```
githits feedback abc123 --accept
githits feedback abc123 --reject -m "Example was outdated"
githits feedback abc123 --accept --message "Solved my problem" --json
githits feedback --reject --tool search -m "missing kotlin support"
```

Passing `[solution_id]` anchors feedback to a prior `githits example` result. Omitting it creates generic feedback for the current CLI/MCP session via the `x-githits-session-id` header; `--tool` records the command or MCP tool that produced the result being rated. `--accept` and `--reject` are mutually exclusive (enforced by Commander's `.conflicts()` API). At least one must be provided (validated in the action function). JSON output is `{ "success": true, "message": "..." }`.

### `githits doctor`

```
githits doctor
githits doctor --json
```

Prints redacted diagnostics for comparing GitHits behavior across terminals or agents. The report includes CLI/runtime identity, selected environment variables, service URL sources, config file status, active and legacy auth storage locations, token/client/metadata presence and timestamps, and recommendations. Secret-bearing values such as tokens, client secrets, API tokens, and proxy credentials are never printed; presence is reported as `set` / `present` only. JSON output uses `schemaVersion: 1` for support tooling.

### `githits resolve`

```text
githits resolve express
githits resolve codex --prefer-kind repository
githits resolve guava --registry maven --limit 3
githits resolve lodahs --prefer-kind package --verbose
githits resolve "pi agent" --query "coding agent CLI" --json
```

Resolves a human-provided package, GitHub repository, or standalone
documentation-site name to canonical targets such as `npm:express`,
`github:openai/codex`, or `site:expressjs.com`. The backend supplies one ordered
presentation list containing direct ranked matches and bounded relation-only
package, repository, and site context. The CLI preserves that order and groups
only contiguous targets with the same non-null `groupKey`; null keys always
remain singleton groups. Each group is numbered once and every additional
identity appears under one `Related targets:` heading. Canonical keys stay
copyable and every member is explicitly direct (with confidence) or related.

Each target keeps its normalized description, capped at 240 characters. Compact
text puts evidence on the same line as the target identity. Packages own
downloads and license, repositories own stars, and sites own documentation
evidence. Package and repository code snapshots remain on their respective
identity lines because they establish different indexed scopes. When a group
has no repository or site target, its package line retains the corresponding
projected stars or documentation fallback, including the compact
linked-repository identity when applicable.
Repository license appears only when no package supplies one. The verified
lowercase `mit` spelling renders canonically as `MIT`; other license strings are
preserved. JSON remains lossless and does not apply presentation ownership.
Human text renders docs/code evidence only when the corresponding availability
flag is true. Positive counts render when supplied; missing counts produce no
placeholder. Available package and repository code renders as an indexed
snapshot at that identity's scope, with a file count in parentheses when
present. Unavailable or unknown docs/code evidence is omitted even if a recorded
count is present: resolver availability is not a decision about whether a later
docs or code command can follow up. Structurally inapplicable evidence dimensions
are also omitted. `targetsTruncated` produces one note
that additional related targets were omitted and direct matches are complete.
The backend bounds the complete presentation list to 40 entries: up to 20 ranked
direct matches, 12 additional protected matches, and 8 related targets. CLI and
MCP text render that complete bounded list; only backend `targetsTruncated`
signals omitted relations.

Default text omits lexical similarity. `--verbose` renders nullable backend
`nameSimilarity` as a whole percentage on each applicable target and adds one
qualification: it is coarse lexical support, not a client ranking rule.
Candidate order follows broader backend policy and the client never reranks by
similarity. Local MCP text follows the same contract with `verbose: true`;
explicit `false` is equivalent to the default. JSON always preserves the numeric
fraction when present.

The shared CLI/local-MCP request boundary rejects an already-canonical package
or GitHub repository target before the resolver service is called. Recognition
reuses the compact parser used by downstream code-navigation tools, including
registry-prefixed package targets and supported GitHub shorthand, host, URL,
and ref forms. The mapped `INVALID_ARGUMENT` guidance tells the caller to pass
that target directly to the next GitHits tool. Unprefixed human names such as
`@types/node`, punctuated names, and slash-separated names remain resolver
input.

Terminal and MCP compact text share one actionability rule. A best result is a
copyable/direct canonical next action only when it is non-ambiguous and has
`EXACT` or `HIGH` confidence. All non-empty terminal lists use the neutral
`Targets:` heading. Non-ambiguous `MEDIUM` and `LOW` results still require the
caller to narrow the name or filters, or choose a canonical target explicitly;
the confidence tag and next-action guidance carry that policy. Ambiguous results
retain their existing choose-or-narrow guidance and literal `<target>`
placeholder. Empty results ask for corrected spelling or adjusted
registry filters; query, preferred-kind, and intent hints are ranking-only and
cannot create targets. No targets is a valid JSON/text result but exits 1
because the command did not resolve a target. The backend guarantees that
`best` is absent only when there are no candidates, so the terminal no-result
message and exit status key off `best`.

`--registry` accepts a comma-separated package-registry list, constrains package
candidates only, and leaves repository candidates eligible. The command help
enumerates every accepted value.
`--prefer-kind package|repository` is a soft preference, not a filter.
`--intent-hint` is repeatable. `--limit` controls direct ranked matches from
1-20 (default 8); protected exact-name and related targets can be additional.
`--query` and
`--intent-hint` are sent to the service as ranking context. They rank retrieved
candidates and do not expand candidate retrieval, and must not contain
credentials, personal data, private code, or proprietary content. Terminal
errors sanitize untrusted service and option text while JSON errors preserve
the structured value through JSON escaping.

`--json` keeps the stable compact diagnostic envelope
`{best?, ambiguous, ambiguousReason?, candidates, protectedMatches}` and adds
root `targetsTruncated`. The `candidates` array now contains the backend-ordered
presentation targets once. Every entry has `direct`; grouped entries have
`groupKey`; counts and license are included when present. Direct entries retain
the existing flattened confidence, alias, tier, and score fields from their
non-null `match`; relation-only entries omit those fields. Nullable
`nameSimilarity` is preserved as the backend's numeric fraction when present
and omitted when null. The client does not select, parse, or project the
backend's ranking `reason`. Array position
is presentation-group order, not pure rank order. Optional nulls are omitted,
zero counts are preserved, and enum values are lowercase. CLI JSON and MCP JSON
use the same payload builder and remain deeply equal. Errors use the standard
JSON envelope on stderr with clean stdout.

Terminal and local MCP text omit `CLEAR` and `NOT_APPLICABLE` decisions. They
render concise warnings only for affected, uncertain, unsupported, or blocking
unavailable evidence; terminal warnings are red. Reference-only best/protected
entries never synthesize or reorder presentation targets. A best reference
missing its matching presentation target remains non-actionable.
The backend contract guarantees every direct ranked and protected match is in
`targets`; GitHits relies on that superset so text, JSON, and MCP all consume the
same ordered list rather than reconstructing missing references client-side.
Affected and uncertain warnings link every returned status-relevant advisory at
`https://osv.dev/vulnerability/<percent-encoded-osv-id>`. Uncertain warnings also
summarize the backend classification reasons; truncated evidence reports the
number of omitted advisories. The warning never restores a normal cross-tool
handoff.
`CLEAR` means only that no persisted active MAL evidence affects the displayed
latest version; it is not a vulnerability-free claim. `AFFECTED` means active
malicious evidence affects that version. `UNKNOWN` means active malicious
evidence exists but the displayed version or ranges cannot be classified
reliably. `NOT_APPLICABLE` is the non-package state. Direct continuation requires
the existing non-ambiguous `EXACT`/`HIGH` identity decision and a matching
target, located by both kind and canonical key, whose status is exactly `CLEAR`
or `NOT_APPLICABLE`. Affected, unknown,
missing, and unrecognized future values fail closed and emit no normal cross-tool
next action. A relation-only affected or unknown package still renders its
member-local warning but cannot block an otherwise actionable matched best
target. Aggregate ambiguity checks consider direct targets only. Ranking,
relations, presentation order, and filtering remain backend-owned.

Human text renders package `codeAvailable` as `indexed package snapshot` and
repository `codeAvailable` as `indexed repository snapshot`. Package evidence
means some certified package artifact is indexed; it does not establish exact
latest-version readiness. Repository evidence likewise does not establish exact
ref readiness. Code commands independently establish whether they can resolve
and serve a commit SHA; compact resolver text does not add a trailing readiness
disclaimer or render negative availability labels.

The command and local experimental MCP adapter use an internal service and do
not change the public `@githits/mcp` service interface. Its GraphQL selection
keeps `best` and `protectedMatches` to `kind`, `canonicalKey`, and `confidence`;
one ordered `targets` selection always includes compact identity, presentation,
security, grouping, count, and license fields, while JSON-only identity and
detailed `match` fields remain conditional. Because the grouped target type does
not expose lexical evidence, one conditional legacy `candidates` sidecar is
limited to `canonicalKey` and nullable `nameSimilarity`; it is selected only for
verbose text or JSON. The client joins it to direct target matches by canonical
identity without reordering. Default text omits the entire sidecar. No other
legacy candidate fields or per-target follow-ups are requested. The malicious-content
decision and bounded evidence remain compact fields because every text surface
consumes them. Detailed ranking `reason` is deliberately not selected. This
keeps the operation below production's GraphQL complexity limit while
preserving all fields consumed by each output mode. The CLI deliberately does
not select expensive per-target `inspection` metadata. HTTP, transport,
GraphQL, auth refresh, and client-version error classification are shared with
the package intelligence service. The shared GraphQL classifier treats the backend's
documented `AUTHENTICATION_REQUIRED` code and the legacy `UNAUTHORIZED` code as
server-auth failures, so both enter the normal token-refresh and `AUTH_REQUIRED`
error path.

Selecting `nameSimilarity` while retaining detailed-only `reason` made the
production operation complexity 517 against the limit of 500. The client does
not consume backend rationale, so removing the `reason` selection and projection
restored verbose/JSON operation without a second query or weaker evidence.
Default text additionally skips the similarity sidecar. Authenticated production
CLI smoke and direct MCP production replay cover both selection modes.

#### Standalone-site target kind

`ResolveTargetKind` includes `SITE`, `--prefer-kind site` maps to it, and the
terminal/JSON formatters render a `site` target whose canonical key parses
straight back into `search --in`, closing the resolve-then-search loop for
standalone documentation sites.

`resolveTarget` returns `SITE` targets for standalone documentation sites.
Without `KNOWN_KIND_VALUES` carrying `site`, those targets would render with
the unknown-kind `target` label. Site targets report `docsAvailable` true
and `codeAvailable` false, so terminal output shows docs evidence without code,
stars, or downloads. `--prefer-kind site` is a soft ranking preference rather
than a filter, matching the package/repository kind contract.

The config-gated CLI help, local `resolve_target` description/schema, and local
experimental server instructions advertise the site kind. Cross-tool guidance
routes a selected `site:` candidate to `search` with `source:"docs"`, then to
`docs_read`; already-canonical `site:<host[/path]>` targets skip resolution.

#### Release posture and next phase

The command remains a dogfood surface. The initial 36-case production audit
selected the expected package in 25 cases. After backend ranking work, a
113-case dev audit across all 12 supported registries matched 102 exact
expectations; ten actionable population, alias, or current-module ranking gaps
and one explicit family ambiguity were recorded in the backend relevance
corpus. Those findings do not block landing the CLI dogfood surface. The earlier
`guava` and `symfony/framework-bundle` mismatches now resolve correctly on dev.

The command is part of the config-gated experimental CLI surface. When
`[experimental] tools = true` is enabled in the canonical host config,
`resolve` and `code diff` are available; otherwise they remain hidden and
explicit calls are rejected with the config path and enable snippet. The same
opt-in exposes the local-only MCP `resolve_target` adapter. Its compact text,
JSON contract, privacy guidance, and structured error mapping reuse the shared
resolver request/service contracts; local experimental instructions are
composed only for the enabled local tool inventory. Reporting guidance is
opt-in and remains dormant when tools are disabled.

Remote/public MCP, generated transports, and Agent Skill promotion remain
blocked pending dogfood and evaluation evidence: the expanded production
corpus must have no known wrong exact-package result, ambiguity wording must be
accepted, fuzzy latency and rate limiting must be validated for expected
CLI/MCP volume, and shipping without linked-repository popularity evidence must
be explicitly accepted or exposed cheaply. The reduced query has been
validated below production's GraphQL complexity limit; roughly 50 dogfood calls
completed without protocol, schema, complexity, or rate-limit errors, but that
is not a volume test. Combined MCP quick-start guidance, smoke coverage, and Claude and
Codex evaluations are completed later in this phase.

This increment exceeded its original rough 1,500-line review threshold under an
explicit 2026-08-10 exception: most of the delta is isolated tests and durable
documentation, while splitting the service and CLI contracts would create
dependent review slices. The exception does not extend to the repository-wide
terminal sanitization work retained in its separate plan.

### Proxy Support

CLI-originated HTTP traffic uses `src/services/proxy-fetch.ts`. This includes OAuth discovery, client registration, token exchange/refresh, REST API calls, code/package service calls, local MCP tool calls started through `githits mcp start`, and npm update checks. The fetch factory supports `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` plus lowercase aliases; lowercase values win when both cases are set, matching undici's env proxy precedence.

Native Node env proxy support is used only when the user explicitly opted in and the running Node version is known to support that opt-in. `NODE_USE_ENV_PROXY=1` is treated as native on Node `22.21.0+` and `24.0.0+`; `--use-env-proxy` / `NODE_OPTIONS=--use-env-proxy` is treated as native on Node `22.21.0+` and `24.5.0+`. Older or unknown versions use the fallback so the Node `20.18.1` floor remains supported.

Fallback proxy support uses the installed `undici` runtime dependency and per-request `ProxyAgent` dispatchers rather than mutating global fetch or the global dispatcher. Proxy URL validation and runtime proxy failures are sanitized before surfacing to CLI/MCP callers: credentials, path, query, and fragments are never printed. `doctor` remains presence/status-only for proxy environment variables.

`bun run smoke:proxy-node` builds the proxy fetch module and runs a Node process against local target/proxy servers. It verifies that fallback mode really sends HTTP traffic through a local proxy, that `NO_PROXY` bypasses it, and that proxy URL redaction stays intact.

### `githits pkg info`

```
githits pkg info npm:express
githits pkg info pypi:requests --verbose
githits pkg info crates:serde --json
githits pkg info npm:@types/node
```

Shows a concise latest-version overview for dependency triage: license, description, repository popularity (stars/forks/issues and `[ARCHIVED]` when applicable), homepage, publication date, download count, and explicit vulnerability status. Default output is compact and labels vulnerability scopes separately as `Latest: ...` and `History: ...`. Latest is the count affecting the returned version; history is the package-wide non-withdrawn, deduplicated advisory count across all versions. History remains available when the nullable latest count is unavailable. The vulnerability field contains evidence only and does not print an inline follow-up or historical advisory rows; CLI help routes full-history inspection to `githits pkg vulns <registry>:<name> --scope all`. In color-enabled terminals, repository and homepage URL substrings use non-bold cyan while surrounding statistics retain the normal foreground color; removing ANSI leaves the same content and hierarchy.

`--verbose` adds GitHub language/topics/last-pushed, `Versions <N> published`, a download refresh date appended to the download value when a download count exists, package-wide advisory rows under `Advisory history (all versions)`, and a recent-changes list. `--json` emits the lean hand-crafted envelope and always requests the detailed fields; null scalars and empty blocks/arrays are omitted, while a download block may contain only `refreshedAt`. Vulnerability data is emitted whenever the backend reports a numeric latest-version count, including zero.

**Package spec.** `<registry>:<name>`. Registries: `npm`, `pypi`, `hex`, `crates`, `nuget`, `maven`, `zig`, `vcpkg`, `packagist`, `rubygems`, `go`. Scoped npm names (`npm:@types/node`) are supported.

**Always latest.** `pkg info` returns the latest published version regardless of input. Passing `<spec>@<version>` is rejected with `INVALID_ARGUMENT` and a clear message — the tool never silently swaps to latest. Use `pkg vulns` or `pkg deps` for version-pinned queries.

**`--verbose` + `--json`.** `--verbose` has no effect under `--json` — the JSON envelope always carries every field the verbose terminal view exposes (and more). The flag only affects human-readable output.

**Output envelope.** Success payload is hand-crafted for agent token efficiency: `{registry, name, version, versionCount?, description?, license?, homepage?, repository?, publishedAt?, downloads?: {lastMonth?, total?, refreshedAt?}, github?, vulnerabilities?: {total, affectsLatest, recent?}, advisoryHistory?: {total}, recentChanges?}`. `vulnerabilities.total` and `affectsLatest` retain their latest-version meanings; `advisoryHistory.total` is package-wide history and is independent of the nullable latest count. Omitted fields reflect backend nulls, not dropped data. Error envelope: `{error, code, retryable, details?}` — shared classifier family. Under `--json` the error envelope is written to **stderr** so stdout stays clean for `jq`.

**Troubleshooting.** `GITHITS_DEBUG=pkg-intel` emits PII-safe classified-error diagnostics (area, event, code, error class, detail keys). Use `GITHITS_DEBUG=*` to enable all non-sensitive package/source diagnostics.

### `githits pkg vulns`

```
githits pkg vulns npm:express
githits pkg vulns npm:express@4.17.0
githits pkg vulns pypi:requests --severity high
githits pkg vulns crates:serde --json
githits pkg vulns npm:minimatch --include-withdrawn --verbose
githits pkg vulns npm:express --scope non_affecting
```

Lists known CVE / OSV advisories for a package: severity, affected version ranges, fix versions, and upgrade targets. Default text is capped at 5 advisory rows for readability; use `--verbose` for all selected rows or `--json` for the complete structured envelope. Malicious-package advisories (supply-chain attacks flagged by OSV) surface in a separate `MALWARE` bucket that sorts above all CVE advisories.

**Package spec.** `<registry>:<name>[@<version>]`. Unlike `pkg info`, `pkg vulns` supports `@<version>` so callers can inspect older pinned releases. `npm`, `pypi`, `hex`, `crates`, `nuget`, `maven`, `packagist`, `rubygems`, `go`, and `swift` support vulnerability data; vcpkg and Zig are rejected client-side with `pkg vulns only supports npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift. Got: ${registry}.` Swift accepts `v`-prefixed release tags because SwiftPM packages commonly publish them.

**Filtering and scope.** `--severity low|medium|high|critical` maps to a CVSS float threshold (`low=0.1, medium=4, high=7, critical=9`) and is applied by the service. The returned `summary.total` always means advisories affecting the inspected version. Advisory rows default to `--scope affected`; use `--scope non_affecting` for historical package advisories that do not affect the inspected version, or `--scope all` for affected + historical rows. Active filters and non-default scope are echoed in text and under top-level JSON `filter`. `--include-withdrawn` includes retracted advisories; withdrawn advisories bucket below active ones in the terminal list.

**Zero-vulns hot path.** The common case (clean package) renders as header + one-line summary body (`No active vulnerabilities affect this version.`) — no breakdown, no advisory list, no footer. Filtered zero-results say `No vulnerabilities matching the filter affect this version.` so callers do not confuse a thresholded query with a clean package.

**Version validation.** `pkg vulns` expects canonical package versions. Tag-style inputs such as `@v4.18.0` are rejected client-side with `INVALID_ARGUMENT` and an actionable message telling the caller to drop the leading `v`, instead of forwarding the request and surfacing an opaque upstream failure.

**Malware marker.** Advisories with `isMalicious: true` render with a red/bold `MALWARE` column (optionally combined as `MALWARE | crit` when both flags exist). Count surfaces in the summary breakdown line as `N MALWARE | N crit | ...`. Buckets partition every returned advisory: `MALWARE + crit + high + medium + low + unrated = advisories.length`, which equals `summary.total` when the upstream count and list stay consistent. Non-malicious advisories without a CVSS score bucket under `unrated` so the breakdown reconciles with the header total (common for PyPI / Rust advisories where CVSS may be absent).

**Affected-range truncation (terminal-width aware).** The `affected` detail row under each advisory caps at 4 ranges on narrow terminals (≤119 cols), 6 on standard-wide (120–159 cols), and 8 on ultrawide (≥160 cols). The remainder collapses into a dim `... (+N more; use -v)` hint. Verbose mode (`-v`) shows every range. JSON output is never truncated — machine consumers get the full list.

**Unrated severity column.** Advisories with no CVSS score (common on RUSTSEC / PYSEC upstreams) render with a dim `unrated` label in the severity column rather than an empty gutter, matching the header-breakdown vocabulary. They sort below banded advisories within the active bucket.

**Placeholder summary stripping.** When the upstream advisory feed returns the literal string `No summary available` (an OSV convention), both the JSON envelope and the terminal row drop the field entirely — absence of `summary` is the signal, and the advisory row is shorter as a result.

**Upgrade-path ordering.** `upgradePaths` are de-duplicated and sorted ascending by semver-ish comparison (pre-release suffixes rank below the matching base release), so the footer presents the minimum-churn upgrade first: `Upgrade options: 3.11.0, 4.0.0-rc1, 4.5.0, 4.19.2, …` rather than the backend's advisory-iteration order.

**Output envelope.** `{registry, name, version, requestedVersion?, filter?, summary: {total, affected?, bySeverity?}, advisories?, upgradePaths?}`. `filter` echoes only explicit caller filters and non-default advisory scope. Each advisory: `{id?, aliases?, summary?, severity?, severityLabel?, affectedRanges?, affectsInspectedVersion?, matchedAffectedVersionRanges?, fixedIn?, publishedAt?, modifiedAt?, withdrawnAt?, isMalicious?}`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Exit codes.** 0 on success including zero-vulns; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

**Troubleshooting.** Same debug areas as `pkg info`.

### `githits pkg deps`

```
githits pkg deps npm:express
githits pkg deps npm:express --lifecycle all
githits pkg deps crates:tokio --lifecycle optional
githits pkg deps npm:express --lifecycle runtime,development
githits pkg deps npm:express --depth 2
githits pkg deps npm:express --issues
githits pkg deps npm:express --issues --depth 2
githits pkg deps npm:express --issues --verbose
githits pkg deps npm:express --json
githits pkg deps npm:express --issues --json
```

Analyses dependencies for a package on npm, PyPI, Hex, Crates, vcpkg, Zig, RubyGems, Go, or Swift. Default terminal output is a flat list of direct runtime dependencies with a hint summarising hidden groups. `--issues` is an explicit opt-in for deprecated, outdated, duplicate, and conflict analysis across the resolved dependency graph; it does not expose the ordinary transitive block unless `--depth` is also supplied.

**Package spec.** `<registry>:<name>[@<version>]`. `@<version>` is accepted (same as `pkg vulns`); defaults to latest. Tag-style inputs such as `@v4.18.0` are rejected client-side with `INVALID_ARGUMENT` except for Swift, where `v`-prefixed release tags are accepted. Only `npm`, `pypi`, `hex`, `crates`, `vcpkg`, `zig`, `rubygems`, `go`, and `swift` are supported; other registries are rejected client-side with `pkg deps only supports npm, pypi, hex, crates, vcpkg, zig, rubygems, go, swift. Got: ${registry}.`

**Two views.** The default runtime view renders a labelled `Runtime dependencies:` list from `dependencies.direct` — the flat answer to "what does this pull in?". The structured groups view (`--lifecycle all` or a concrete non-runtime lifecycle) renders a labelled `Dependency groups:` block and preserves registry-specific condition metadata (PyPI extras, Crates features). Dev / peer / build / optional deps live only in the groups view — the wire's `direct[]` is always runtime-only. The groups view does not repeat the resolved runtime list above the group block; runtime group rows include resolved versions when available.

**Lifecycle filter.** `-l, --lifecycle <phases>` accepts a comma-separated list of canonical lowercase tokens (`runtime`, `development`, `build`, `peer`, `optional`). Uppercase and whitespace are tolerated. The filter only affects `dependencyGroups`; `direct[]` and `transitive[]` are returned regardless. Unknown tokens are rejected with `INVALID_ARGUMENT` and the canonical list.

**Groups view (`--lifecycle all` or a concrete non-runtime lifecycle).** Headings collapse to `name` when `conditionType === "always"` (e.g. `runtime`, `development`). Feature / TFM groups render `name (lifecycle, conditionType[: conditionValue])` — `conditionValue` is omitted when it equals `name` (the common case on Crates features and PyPI extras). Within each group, entries sort alphabetically. Duplicate `{name, constraint}` tuples inside a group collapse in the terminal for scannability; the JSON envelope preserves every duplicate the backend emitted.

**Transitive view (`--depth <n>`).** Replaces the runtime list with a labelled `Transitive packages:` block containing the unique transitive closure up to the requested depth (alphabetical, `name@version`, one per line). Summary row carries the aggregate counts + conflict / cycle counts and `(max depth N)`. `--depth <n>` is both the transitive-output request and the traversal cap (1-10); omitting it shows direct dependencies only. With `--issues` and no depth, issue analysis still traverses the full resolved graph, but the ordinary `transitive` output remains omitted. `--issues --depth <n>` bounds issue analysis to that depth and includes the transitive block.

**Verbose (`--verbose`).** In both plain and transitive modes, each dep expands to a multi-line block: the first line is `name@version`, followed by indented `- <constraint> required by <importer>@<importer-version>, ...` bullets. Importers that share a constraint are collapsed onto one bullet with a comma-separated list. In plain mode each direct dep has exactly one importer (the root package itself); in transitive mode a popular leaf may list many importers grouped by constraint. Conflicts expand into a `Conflicts (N):` table (`name: range1, range2, ...`, one row per package) with importer requirement bullets; circular dependencies expand into a `Circular dependencies (N):` list (`a -> b -> a` chain). When `--issues` is selected, verbose output also renders every selected deprecated, outdated, duplicate, and issue-conflict row, including resolved versions, severity/reasons/latest evidence, and all conflict requirement importers. Compact issue output is bounded to three examples per category and three constraint groups/importers per conflict; when evidence is omitted, the CLI prints `Use --verbose for complete issue details.`.

**JSON envelope.** Preprocessed: `runtime.items[].version` surfaces the resolved version alongside the constraint. Under `--depth`, `transitive.packages[]` carries `{name, version}` records by default; `--verbose` opts each entry into an `importers[]` array with importer name / version / constraint (roughly quadruples envelope size on heavy graphs, so it's off by default). `transitive.conflicts[]` and `transitive.circularDependencies[]` are typed (`{name, requiredVersions, requirements}` / `{cycle: string[]}`). The raw DAG itself is deliberately **not** in the envelope. With `--issues`, JSON adds an `issues` block containing `total`, `scope` (`{mode: "full"}` or `{mode: "depth_limited", maxDepth}`), and `deprecated`, `outdated`, `duplicates`, and `conflicts` category records with backend counts and complete item arrays. Registry identities use canonical lowercase values; issue rows preserve names, versions, reasons, latest version, severity, and repository evidence. Issue and transitive conflicts preserve one `requirements` item per backend edge, with exact constraint/dependency type and complete importer/target identities; synthetic-root edges identify the inspected package with `root: true`. Issue analysis selects the companion graph internally, but raw graph nodes/edges and indices never appear in JSON.

**Output envelope.** `{registry, name, version, requestedVersion?, runtime?, groups?, transitive?, issues?, filter?}`. Data-first: the `runtime` block emits whenever the backend returned `dependencies.direct` (including `{count: 0, items: []}` for zero-dep packages); the `groups` block emits whenever the backend returned `dependencyGroups` (including `{items: []}` when a lifecycle filter matched nothing, so agents distinguish "backend has no groups concept" from "filter excluded everything"). Each group carries its members under `items` (matches the top-level `runtime.items` naming so dependency lists share one key throughout the envelope). `filter.lifecycles` echoes the canonicalised, deduplicated, display-order-sorted list the backend received — not the raw CSV input.

**Exit codes.** 0 on success including zero-dep packages; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

**Troubleshooting.** Same debug areas as `pkg info` / `pkg vulns`.

### `githits pkg changelog`

```
githits pkg changelog npm:express
githits pkg changelog npm:express --from 4.0.0
githits pkg changelog npm:express --to 4.18.0 --limit 5
githits pkg changelog --repo-url https://github.com/expressjs/express --git-ref main
githits pkg changelog npm:express --json
githits pkg changelog pypi:requests --no-body --json       # lean timeline
```

Fetches release notes or changelog entries for a package or GitHub repository. Output preserves source ordering, which may interleave maintained release lines, and includes a summary header identifying the source (GitHub Releases, CHANGELOG.md, or HexDocs).

**Addressing.** `<spec>` (`registry:name`, same parser as `pkg info` / `pkg vulns` / `pkg deps`) **or** `--repo-url <url>`, mutually exclusive. Unlike the other `pkg` commands, `pkg changelog` is intrinsically repo-level, so repo-URL addressing is a first-class peer mode.

**`<spec>@<version>` rejected.** `pkg vulns` and `pkg deps` both treat `@version` as "for this exact version", but `pkg changelog` has no single-version query: all entries live on a timeline. Remapping `@version` to `--to` would be a silent semantic shift. CLI rejects with `INVALID_ARGUMENT` and a hint pointing to `--to <version>` (or `--from <version>` for range mode).

**Two modes.** Latest mode is the default; `--limit <n>` (1–50, default 10) caps entry count. `--from <version>` switches to range mode — returns every entry after `--from` through `--to` (or latest), `(from, to]`, with no count cap. The lower bound is exclusive, so use latest mode with `--to <version> --limit 1` for one exact release. `--to <version>` works in either mode. `--from` + `--limit` together is rejected client-side with a hint.

**Pre-release versions.** Normalised versions flow through unchanged (`5.0.0-rc.1`, `2.32.0.dev0`, `1.7.0-rc.5` round-trip cleanly on `--from` / `--to`). Tag-style `v`-prefixed inputs are rejected on any version flag, consistent with `pkg vulns` / `pkg deps`.

**Default terminal output.** Summary header (`name | registry | source | mode | entry count`) followed by each entry's `version  date  url` header plus the first 10 lines of its markdown body, indented and dimmed. Bodies longer than the cap show a footer `... (+N more lines - use --verbose for the full body)`. Missing dates render as `-`; missing versions render as `(unversioned)`. The version column is padded to the longest entry in the current response (no fixed width).

**`--verbose`.** Uncaps the body preview — every entry's full markdown body renders, indented and dimmed, with no truncation footer. Terminal-only — does not change `--json` output.

**`--no-body`.** Drops body fields from entries. Affects both terminal output (no body preview, no footer) and `--json` (entry objects lose the `body` field). Mirrors MCP's `omit_bodies: true`. Default `--json` keeps full markdown bodies; use `--no-body` when you only need the version / date / URL timeline (drops 10 KB+ per entry on large release notes — measured 5.13× size reduction on `npm:typescript --limit 20`).

**JSON envelope.** `{registry?, name?, repoUrl?, source, mode, entries: {count, items}, filter?}`. `source` is always present (the null-source case is promoted to `NOT_FOUND` at the service boundary and never reaches this shape). `entries.count` is computed client-side from `items.length`. `filter` emits only when the caller explicitly supplied one of `--from`, `--to`, `--limit`, `--git-ref`; backend defaults don't round-trip as caller intent.

**Per-entry shape.** `{version, normalizedVersion?, publishedAt?, htmlUrl?, body?}`. `version` is kept even when null so agents can map `items.map(e => e.version)` without guarding; other nullable fields are stripped. The backend's opaque per-entry `metadata` GenericJSON is deliberately dropped from the envelope — revisit via agent feedback.

**Errors.** `NOT_FOUND` covers both the backend's "package not found" case and the distinct "package exists but no changelog source resolved" case (typed `PackageIntelligenceChangelogSourceNotFoundError`; message names the sources that were tried). `VERSION_NOT_FOUND` enriches with structured `package` / `requested` / `available` detail lines from the shared `promoteGenericVersionNotFound` helper — which was extended in this PR to recognise `--from` and `--to` as promotable version inputs.

**Troubleshooting.** Same debug areas as the rest of the `pkg` family.

### `githits pkg upgrade-review`

```
githits pkg upgrade-review npm:express@5.0.0 --to 5.2.1
githits pkg upgrade-review --package npm:zod@4.3.6..4.4.3 --package npm:lint-staged@16.2.7..16.4.0
githits pkg upgrade-review npm:express@5.0.0 --to 5.2.1 --verbose
githits pkg upgrade-review npm:express@5.0.0 --to 5.2.1 --json
```

The human-readable CLI and MCP `pkg_upgrade_review` output use one shared
formatter. It starts with `Upgrade review - N package(s)`, adds one
`Across packages:` line only for batches, and groups each package as identity,
security, deprecation, changes, compatibility, dependencies, dependency
issues, and unknown evidence. Empty optional groups are omitted, but a returned
zero-valued dependency comparison remains visible. Missing target security
evidence renders `Target: deprecation unknown` so absence is not confused with
verified non-deprecation. The formatter reports evidence and missing evidence;
it does not make an approval, safety, or risk claim.

The shared formatter wraps free prose to the caller width (minimum 20 columns).
The CLI passes `process.stdout.columns` and enables ANSI only when supported;
MCP disables ANSI and uses the 80-column default. Outcome and section headings
are bold, package identity is bold cyan, and yellow is limited to compact
attention summaries, labels, and matched signal terms. Heuristic section labels
remain plain; only the matched keyword and excerpt marker are yellow. Detail
prose and locators remain plain. Color never carries information that is absent
from the words. Formatter-authored punctuation stays ASCII while backend
Unicode is preserved. `--verbose` expands the bounded evidence rows in place.
`--json` remains the structured, lossless machine surface and is shared with MCP
`format: "json"`; `text-v1` is an in-place evolving presentation, not a
byte-stable prose contract.

**Troubleshooting.** Same debug areas as the rest of the `pkg` family.

### `githits docs list`

```
githits docs list npm:express
githits docs list npm:express --limit 20
githits docs list npm:express --json
```

Lists hosted/crawled and repository-backed documentation pages for a package. Each row includes a stable page ID for `docs read`, a source badge, and the source location. JSON output also includes repo URL / git ref / file path for repository-backed docs so callers can follow up with `code read` when source context is needed.

**Pagination.** `--limit <n>` accepts 1-500. When `hasMore` is true, pass the returned `nextCursor` to `--after`.

**Output envelope.** `{registry, name, version?, pages, total?, hasMore, nextCursor?, stale?, filter?}`. Each page has `{pageId, title, sourceKind, sourceUrl?, linkName?, repoUrl?, gitRef?, filePath?, lastUpdatedAt?}`.

**Troubleshooting.** Same debug areas as the `pkg` family.

### `githits docs read`

```
githits docs read <page-id>
githits docs read <page-id> --lines 10-80
githits docs read <page-id> --verbose
githits docs read <page-id> --json
```

Reads a documentation page returned by `docs list` or search results. Default output is content-only for easy piping; `--verbose` adds a metadata header.

**Line ranges.** `--lines 10-40`, `--lines 10-`, and `--lines -40` are supported. Use ranges to inspect long pages incrementally.

**Output envelope.** `{pageId, title?, sourceKind?, sourceUrl?, repoUrl?, gitRef?, filePath?, totalLines?, startLine?, endLine?, content}`. Repo-backed docs include exact source metadata for `code read` follow-up.

**Troubleshooting.** Same debug areas as the `pkg` family.

### `githits code diff`

```sh
githits code diff npm:express 4.18.1..4.18.2
githits code diff npm:express 4.18.1..4.18.2 --stat
githits code diff npm:express 4.18.1..4.18.2 --name-status -- 'lib/**/*.js'
githits code diff --repo-url https://github.com/expressjs/express v4.18.1..v4.18.2 --name-only
```

Compares repository trees resolved from package versions or repository refs,
left-to-right. Package targets must omit a version and repository targets must
omit a ref because both endpoints belong in the required two-dot range.
Package addressing resolves package, repository, version, and exact-commit
identity, but every raw diff is repository-wide. It does not discover or filter
to a package directory. Sibling package paths may therefore appear, and a
bounded relevance-ranked result may contain no files from the addressed
package. That absence does not prove the package is unchanged.

Three-dot merge-base syntax and `--git-ref` are rejected. The optional value
after `--` is one caller-supplied repository-relative bounded glob, not a full
Git pathspec or verified package scope. It narrows repository paths without
changing the effective scope. A backslash escapes one following non-slash
character according to the backend grammar.

Patch output is the default. `--stat`, `--name-only`, and `--name-status`
select cheaper views and are mutually exclusive with `--patch` and each other.
`--max-files` applies to every view after deterministic repository-relative
relevance ranking; `--max-patch-bytes` is patch-only. The CLI does not send
client defaults for either bound.

The selected Git-like view stays on stdout. Exceptional completeness,
truncation, legacy-`UNKNOWN` scope, content-safety, and display-only path
warnings stay on stderr; normal repository scope is not a warning.
`--verbose` adds exact resolutions and `scope: repository` there. JSON keeps
package target identity, exact resolutions, effective repository scope, caller
filters, completeness, and truncation as separate facts in the lean
selected-view envelope, including authoritative paths in normalized patch
headers. Text paths use reversible Git-style quoting rather than deleting
control characters. Stat columns use terminal-cell width, so wide Unicode and
emoji filenames remain aligned. Interactive color-capable terminals use
red/green patch lines, stat bars, and summary direction markers, cyan hunk
headers, and colored change status letters; redirected output and `NO_COLOR`
remain plain. Empty
authoritative diffs exit 0. Caller-selected
`--max-files` and `--max-patch-bytes` bounds may intentionally produce partial
patches and still exit 0 with warnings. Unexpectedly incomplete or non-applicable
plain patches are suppressed and exit 1; name, stat, and JSON views preserve
their structured partial evidence. Suppression diagnostics name binary and
metadata-only causes and direct terminal users to stat/name views. Patch output
is applicable unified-diff content but may omit Git metadata such as index and
mode headers. Request, auth, resolution, and backend errors also exit 1.

This is a config-gated experimental CLI dogfood surface. The matching
`code_diff` MCP adapter is local-only and requires the same opt-in; it is not
promoted through remote/public MCP `quick_start`, Agent Skills, or plugin
guidance yet.

### `githits code files`

```
githits code files npm:express
githits code files npm:express lib                      # scope by prefix
githits code files npm:express lib --verbose            # + language / type / size
githits code files --repo-url https://github.com/expressjs/express --git-ref main lib
githits code files npm:express --json
```

Lists files in an indexed dependency. `[spec] [path-prefix]` positionals mirror `code read` / `code grep` so the three commands chain without friction. `[path-prefix]` is a literal directory prefix; glob / extension filtering is not supported by the backend today (tracked as an upstream ask).

**Plain output (default).** One bare path per line on stdout — pipe-friendly. No header, no annotations. `code files npm:express lib | xargs -I{} …` works cleanly.

**`--verbose`.** Adds a contextual header (`<identity> · <count>`), the resolution line (`indexed at <ref> · commit <sha>`), and per-row language / file-type / byte-size annotations.

**`stdout` vs `stderr` routing (plain mode).** Truncation warnings (`More files available — pass --limit higher …`) and empty-result hints go to **stderr**, not stdout, so they stay visible to humans without polluting pipes. In `--verbose` the same text renders inline.

**Addressing ambiguity guard.** In `--repo-url` mode, a positional that matches a known registry prefix (`npm:`, `pypi:`, `hex:`, `crates:`, `nuget:`, `maven:`, `zig:`, `vcpkg:`, `packagist:`, `rubygems:`, `go:`, `swift:`) is rejected with a "looks like a package spec" error — catches `code files npm:express --repo-url …` typos that would otherwise silently interpret the spec as a path prefix. This list mirrors `PKGSEER_REGISTRY_ARGS`.

**Exit codes.** `0` on success (including empty results — absence of files is not an error). `1` on error (authentication, indexing, invalid arguments, backend failures).

### `githits code read`

```
githits code read npm:express lib/express.js
githits code read npm:express lib/express.js --lines 1-40
githits code read npm:express lib/express.js --verbose  # + header + gutter
githits code read --repo-url https://github.com/expressjs/express --git-ref main lib/express.js
githits code read npm:express lib/express.js --json
```

Reads a file from an indexed dependency. `<path>` is package-relative in spec mode, repo-relative in `--repo-url` mode.

**Plain output (default).** Raw file bytes, verbatim (preserves the backend's trailing newline). Piping `code read … | grep …` or `code read … > file` round-trips cleanly.

**`--verbose`.** Adds the `<path> · <language> · lines <N-M> of <total>` header and a right-aligned line-number gutter. No stderr routing — `read` has no truncation path.

**Line ranges.** `--lines 10-40` (concise form), `--lines 10-` (open end), `--lines -40` (open start), or append the range directly to the path as `lib/express.js:10-40`. `--start <n>` / `--end <n>` are the verbose equivalents. Combining forms is rejected. Unified top-level `search` prints file-backed hits in the same `path:range` form so users can copy directly into `code read`.

**Binary files.** Plain mode writes `Binary file — cannot display as text.` to stdout (consistent with `grep`'s binary-file convention). `--verbose` adds the header above the sentinel. `--json` exposes the classification via `isBinary: true` with `content` omitted — agents branch on the flag, not a null check.

**Exit codes.** `0` on success. `1` on error. Exact paths are classified as missing (`FILE_NOT_FOUND`), excluded from the index (`FILE_PATH_EXCLUDED`), or unverifiable by the source inventory (`SOURCE_FILE_INVENTORY_UNKNOWN`); terminal output directs users to `code files` to inspect indexed paths. With `--json`, those codes and legacy `NOT_FOUND` messages that specifically describe a missing file path add a structured `details.action`. It names `githits code files`, the applicable positional path-prefix narrowing (or its omission at repository root), and `githits code read` so callers can retry without translating MCP tool names. Client-side `INVALID_ARGUMENT` errors likewise name the CLI positional and option syntax; for example, a directory-shaped read path points to `githits code files` and `githits code read` rather than MCP tools.

### `githits code grep`

```
githits code grep npm:express middleware
githits code grep npm:express middleware src/ -C 2
githits code grep npm:express "router\\.(use|get)" --regex --glob 'lib/**/*.js'
githits code grep --repo-url https://github.com/expressjs/express --git-ref main export lib/
githits code grep npm:express middleware --path lib/express.js --json
```

Deterministic text grep over indexed dependency or repository source. Defaults to ASCII case-insensitive literal matching across the whole target; non-ASCII letters match case-sensitively. Pass `[path-prefix]`, `--path`, `--glob`, or `--ext` to narrow scope. `--regex` switches to RE2 regex mode. Whole-target regexes must include at least one literal substring the index can use for pre-filtering. Max pattern 200 UTF-8 bytes. For discovery and ranking, use top-level `githits search` instead. Repeat `--symbol-field` to hydrate enclosing symbol metadata; supported values are `symbol_ref`, `name`, `qualified_path`, `kind`, `category`, `arity`, `is_public`, `file_path`, `start_line`, `end_line`, `content_hash`, and `parent_path`. Hints appear under each `--verbose` match, with the full payload in `--json`.

**Plain output (default).** One `file:line:text` record per match on stdout, pipe-friendly and deterministic. `-C/--context`, `-A/--after-context`, and `-B/--before-context` add surrounding lines. Distinct match groups are separated by `--`.

**`--verbose`.** Adds a summary header and grouped file sections with a `>` marker on match lines.

**`stdout` vs `stderr` routing (plain mode).** Pagination and zero-match decision guidance go to **stderr** so stdout stays machine-friendly. Empty guidance reports scanned/in-scope counts and the served ref/version when known. A completed scan with zero files in scope recommends loosening selectors; otherwise it recommends changing the pattern or using conceptual `search`, and explicitly rejects an unchanged repeat. When the failed call enabled `--case-sensitive`, it also recommends dropping that flag. An incomplete empty page instead preserves truncation or `--cursor` continuation guidance.

**Exit codes (grep-compatible).**

- `0` — at least one match.
- `1` — zero matches. Fires in both plain and `--json` modes so scripting (`if code grep X file; then …`) behaves consistently across surfaces.
- `2` — error (missing file, indexing, invalid arguments, backend failure). Distinguished from "no match" so scripts can branch correctly.

This is still the standard `grep(1)` contract even though the output includes file paths by default.

For exact `--path` errors, terminal output distinguishes missing, excluded, and source-inventory-unverifiable paths and directs users to `code files`. With `--json`, `details.action` names `githits code files`, the applicable positional path-prefix narrowing (or its omission at repository root), and `githits code grep --path`.
Client-side `INVALID_ARGUMENT` errors use CLI positionals/options and name `githits code files` when file listing is the recovery.

**Pattern note.** The `GREP_REPO_PATTERN_NOTE` string is shared verbatim across the CLI help text, the MCP tool description, and the MCP `pattern` argument's `describe` so the three surfaces never disagree about literal-vs-regex semantics.

## Architecture

```
CLI command (src/commands/search.ts)
  └─ searchAction(query, options, deps)
       ├─ requireAuth(deps)
       └─ deps.codeNavigationService.search(params)
            └─ CodeNavigationServiceImpl makes package/source API call
```

Each command follows this pattern:

1. **Focused dependency interface** — Only the deps the action needs (e.g., `SearchDependencies`), not the full `Dependencies` container
2. **Testable action function** — Pure logic that accepts deps via parameter injection
3. **Registration function** — `registerXxxCommand(program)` handles Commander setup with lazy `createContainer()` inside the action callback

### Shared Code with MCP Tools

| Shared Module | Used By |
|---|---|
| `GitHitsService` (via container) | `example`, `languages`, `feedback`, and always-on MCP tools |
| `CodeNavigationService` (via container) | top-level unified `search` / `search-status`, MCP indexed-search tools (`search`, `search_status`, `code_files`, `code_read`, `code_grep`), and the `githits code` command group |
| `filterLanguages()` from `packages/mcp/src/shared/language-filter.ts` | `search_language` MCP tool + `languages` CLI command |
| `requireAuth()` from `packages/mcp/src/shared/require-auth.ts` | all CLI commands and auth-required MCP tool handlers |

## Adding a New CLI Command

1. **Create command file** — `src/commands/new-command.ts` with `XxxDependencies` interface, `xxxAction()`, and `registerXxxCommand()`
2. **Create test file** — `src/commands/new-command.test.ts` testing action directly via deps injection
3. **Export from barrel** — Add to `src/commands/index.ts`
4. **Register in CLI** — Import and call `registerXxxCommand(program)` in `src/cli.ts`
5. **Update help text** — If the command is a primary workflow, add it to the `addHelpText("after", ...)` block

For complex commands with multiple submodules, a subdirectory (`src/commands/xxx/`) with an `index.ts` barrel is acceptable (see `init` command for example).

## Error Handling

- **Auth errors** — `requireAuth()` prints instructions and calls `process.exit(1)`
- **Service errors** — Caught in action, printed to stderr via `console.error("Failed to <operation>: <message>")`, then `process.exit(1)`. REST transport errors distinguish connection failures from timeouts, and HTTP errors never print raw HTML/plain-text response bodies.
- **Validation errors** — Checked before service call (e.g., feedback's neither-flag check), printed to stderr, `process.exit(1)`
- **Unexpected errors** — All asynchronous startup, registration, pre-action, and action failures terminate through the root CLI boundary. The default output is a normalized single-line message plus doctor/issue guidance, never a Node stack trace.
- **Debug stacks** — Set `GITHITS_DEBUG=cli` or `GITHITS_DEBUG=*` to include the original stack for diagnostics.
- **JSON errors** — Under `--json`, REST-backed commands emit `{error, code, retryable, details?}` on stderr for auth, transport/backend, and validation failures.

## Output Modes

All commands support two output modes:

- **Default** — Human-readable terminal output (markdown for `example`, formatted result blocks for unified `search`, colored list for `languages`, plain text for `feedback`)
- **`--json`** — Machine-readable JSON for piping to `jq`, other tools, or agent consumption

## Global Flags

- **`--no-color`** — Disables colored output by setting `NO_COLOR=1` env var via a root-level `preAction` hook. All downstream `shouldUseColors()` calls pick it up automatically.

## Runtime Diagnostics

- **`GITHITS_TELEMETRY=1`** — Emits an end-of-run timing summary to stderr without polluting normal stdout. Current spans cover command registration, container creation, token loading/refresh, and the outbound API/package-intelligence request.

## Product Smoke

`bun run smoke:cli` is the local live-capable suite. It launches source through
`bun run dev`, verifies separate isolated stable and experimental cohorts, and
runs the stable live corpus plus CLI/MCP JSON parity when local credentials are
available. Experimental live probes run only in a temporary opt-in config and
are skipped with an explicit `AUTH_REQUIRED` message when credentials are not
available.

`bun run smoke:cli:built` is the secret-free CI product check. After
`bun run build`, its Bun harness launches `node <absolute dist/cli.js>` and:

- parses the root `Commands:` table and requires the exact stable top-level
  product command set, then separately checks the experimental opt-in cohort;
- verifies JSON and terminal authentication failures under isolated file auth;
- strips inherited credentials and redirects all config roots and GitHits URLs;
- exits before live probes or parity calls.

The shared launch target remains an argument vector at every subprocess layer,
including paths containing spaces. `--cli-entry <path>` selects a built target;
omitting it preserves source-mode behavior. CI runs the built CLI and MCP smoke
commands in one step with a two-minute combined timeout.

## Key Reference Files

| File | Purpose |
|---|---|
| `src/commands/example.ts` | Example-search command implementation |
| `src/commands/search.ts` | Unified search and search-status command implementation |
| `src/commands/languages.ts` | Languages command with colored output |
| `src/commands/feedback.ts` | Feedback command with accept/reject validation |
| `packages/mcp/src/shared/language-filter.ts` | Pure `filterLanguages()` shared with MCP tool |
| `packages/mcp/src/shared/require-auth.ts` | Auth guard shared with MCP server |
| `packages/mcp/src/shared/colors.ts` | ANSI color utilities and `shouldUseColors()` |
| `src/container.ts` | Dependency container with `githitsService` |
| `src/commands/init/init.ts` | Init command orchestrator |
| `src/commands/init/agent-definitions.ts` | Agent detection and setup config |
| `src/commands/init/setup-handlers.ts` | CLI exec and config file merge logic |
| `src/services/prompt-service.ts` | Interactive prompt abstraction |
| `src/services/exec-service.ts` | CLI command execution abstraction |
| `scripts/smoke-launch-target.ts` | Source/built CLI argument-vector selection shared by smoke harnesses |
| `scripts/cli-smoke.ts` | Local live and secret-free built CLI product smoke |

## Related Documentation

- [`tools.md`](./tools.md) — MCP tools that share business logic with these commands
- [`mcp-cli-parity.md`](./mcp-cli-parity.md) — rules for dual-surface tools (CLI ↔ MCP)
- `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` — DI and testing patterns
