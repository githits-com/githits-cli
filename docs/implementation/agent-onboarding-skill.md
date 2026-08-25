# Agent Onboarding Skill

## Purpose

The `githits-onboarding` skill lets an agent guide a user from discovery to a usable GitHits setup with the current CLI surface. The skill orchestrates detection, MCP installation, sign-in/signup startup, verification, and recovery guidance.

The root `skills/githits-onboarding` directory is the only authored onboarding
skill. Claude, Cursor, Gemini, and generic/Codex packaging expose this same
content; host-specific onboarding forks are not supported.

## Current Flow

GitHits setup is currently split across existing CLI commands:

- `npx -y githits@latest init --detect-agents --json` scans supported coding tools and reports MCP configuration state.
- `npx -y githits@latest init --install-agents <ids> --json` installs GitHits MCP configuration for selected tools.
- `npx -y githits@latest login` starts OAuth PKCE sign-in/signup, opens a browser when possible, waits for the local callback, exchanges the authorization code, and stores credentials through the existing auth storage layer.
- `npx -y githits@latest auth status` reports whether local auth is active, expired, missing, or provided by `GITHITS_API_TOKEN`.

Cursor is the remote-MCP exception. Its user and project config entries point to `https://mcp.githits.com`, and existing local stdio entries are migrated. Cursor manages OAuth separately, so local CLI auth does not establish Cursor readiness. Onboarding verifies Cursor with `cursor-agent mcp list` and `cursor-agent mcp list-tools GitHits` when available, uses `cursor-agent mcp login GitHits` when needed, and always requires a new Cursor Agent chat plus confirmation that GitHits tools were discovered.

The onboarding skill uses `npx -y githits@latest` for normal onboarding so new users get the latest published CLI behavior. Installed global `githits` binaries may be stale and are only used when the user explicitly asks to test a local, dev, or pinned CLI build. This may be slower or require network access, but the latest published onboarding behavior is the product requirement.

Claude detection checks for the user-scoped stdio MCP entry installed by the
CLI. Legacy plugin and marketplace state is actionable setup: after approval,
init removes it, replaces any existing user-scoped GitHits MCP entry, and adds
`npx -y githits@latest mcp start`. Already-absent cleanup steps are treated as
safe no-ops. Direct Claude marketplace installs remain a separate, remote-MCP
path.

Claude's user entry is read from `$CLAUDE_CONFIG_DIR/.claude.json` when the
variable is non-empty or `~/.claude.json` otherwise. Inspection is limited to
the lowercase `mcpServers.githits` entry and classifies it as canonical,
non-canonical, absent, or probe-failed. Malformed or unreadable state blocks
Claude MCP mutation; canonical and non-canonical state remains removable
through Claude's CLI, and post-mutation verification rereads the structured
file state.

Gemini detection likewise checks for the user-scoped stdio MCP entry installed
by the CLI. Direct setup removes a legacy GitHits extension and any existing
user-scoped GitHits MCP entry before adding `npx -y githits@latest mcp start`.
Gemini extension installs remain a separate remote-MCP path.

## User Experience Contract

The agent can safely handle:

- Checking auth state.
- Detecting supported coding tools.
- Asking which detected tools to configure.
- Showing and obtaining acknowledgment of the outbound-data install review before setup or authentication.
- Installing MCP configuration for approved tools.
- Starting login/signup.
- Verifying auth and MCP configuration.
- Reporting failures and restart requirements.

The agent must not claim that account creation is fully browserless. Current login uses browser OAuth, so the user may need to approve or create their account in a browser tab. The skill explicitly forbids asking users to paste passwords, OAuth codes, cookies, access tokens, refresh tokens, or API keys into chat.

## Simplified New-User Flow

The onboarding skill is intentionally more opinionated than generic setup diagnostics. When the user asks to start using GitHits, the skill assumes they want to create or connect a GitHits account and configure GitHits unless they explicitly say otherwise.

The preferred setup path is:

1. Ask whether setup should be project-level or user-level.
2. Detect supported tools with the matching staged command.
3. Show the install review before installation approval or browser authentication, including when no setup IDs are actionable.
4. Recommend configuring all actionable tools first. `actionableIds` includes MCP setup and requested guidance-only repair, while `installableIds` remains MCP-only.
5. Offer individual tool selection only as a secondary path for users who want a smaller setup.
6. Install the approved IDs with the matching staged install command.
7. Start local CLI sign-in/signup for selected non-Cursor integrations, skipping login when `auth status` already reports an active session. Cursor-only setup defers authentication to Cursor-managed OAuth.
8. Verify local auth, MCP configuration, supporting guidance, and Cursor-managed OAuth/tool discovery when Cursor is selected.

The skill classifies staged detection before review or authentication: no detected tools stop with installation guidance, unsupported-only project results offer user-level detection, and already-configured supported tools may continue to review and auth. For configure-all, the emitted `suggestedCommand` is authoritative and always includes `--json`, allowing the skill to read structured `outcomes`, `guidance`, `auth`, and `instructions`; selective setup and verification preserve `guidanceRequested`, including `--no-guidance` for plain MCP. Structured install instructions distinguish intentional guidance opt-out, installed, already configured, unsupported/skipped, and failed outcomes. The skill still requires review acknowledgment before writing MCP config or launching browser OAuth. The review states that GitHits queries and public package, repository, and documentation targets are sent to GitHits services, explains outbound feedback and local-workspace behavior, and says that only a new coding-agent session is needed after changes; the terminal and machine do not need restarting. It should not present "configure none" as a normal onboarding choice. Local login is not offered as a Cursor readiness check because Cursor owns the remote MCP OAuth session.

## Project And User Setup Scope

The current CLI supports both user-level and project-level staged setup.

User-level setup configures detected tools globally for the current user account on the machine:

```bash
npx -y githits@latest init --detect-agents --json
npx -y githits@latest init --install-agents <ids> --json
```

Project-level setup writes project-local MCP files into the current repo:

```bash
npx -y githits@latest init --project --detect-agents --json
npx -y githits@latest init --project --install-agents <ids> --json
```

User-level setup should be offered first and marked recommended for onboarding because it makes GitHits available wherever the user works with the detected agents. Project-level setup remains available for repo-specific or team setup, and the skill must explain that project-local MCP files may be committed. It must not offer tools with `unsupported_project_config` for project-level installation.

Agents should use structured choice UI for both setup scope and tool selection whenever available. The desired scope choices are `My user account (Recommended)` and `This project only`. The desired tool choices are `Configure all detected tools (Recommended)` followed by individual installable tools. Agents should not ask users to type comma-separated tool IDs unless no structured choice mechanism is available.

## Codex Execution Guardrails

Codex has been observed delegating onboarding shell commands to subagents or background tasks. The skill requires inline execution because setup commands need sequential user approval and visible failure handling.

Onboarding commands such as `npx -y githits@latest`, detection, login, and setup should run in the current agent session. The skill intentionally keeps `npx -y githits@latest` inline rather than allowing background package fetches. If official detection fails or appears stuck, agents should stop and report the detection failure instead of inspecting package internals, manually probing tools, killing processes, or inferring install IDs.

## Detection Probe Reliability

Agent detection may call read-only third-party CLI probes such as the platform binary lookup for Codex, Codex MCP inspection, `gemini mcp list`, and Pi package-manager bin lookups. Claude Code is different: its user-scoped MCP state is inspected structurally from `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is non-empty, otherwise `~/.claude.json`; only `mcpServers.githits` is classified. The Claude file check returns `configured`, `non_canonical`, `not_configured`, or `probe_failed` and does not invoke a Claude MCP inspection command. Command probes retain their bounded timeout behavior so one slow or stuck agent CLI cannot prevent `init --detect-agents --json` from returning. File reads map missing state to `not_configured` and unreadable or malformed state to `probe_failed`; setup blocks mutation when the initial state is inconclusive. Setup and verification reread structured state rather than parsing human-readable MCP output.

Set `GITHITS_INIT_TRACE=1` to diagnose detection hangs. Trace mode writes progress to stderr only and keeps JSON stdout parseable. It reports scan start/end, per-agent probe start/end, elapsed time, exit codes, and probe timeouts without logging environment values or secrets. File probes include only their resolved path and sanitized result category; they never include file contents, parsed values, or read/evaluator error text.

## Why Fully In-Agent Signup Is Future Work

The current OAuth flow starts a local callback server and relies on browser authorization. That is appropriate for secure CLI login, but it means an agent cannot complete the entire account creation flow without user approval outside chat.

A future perfect-state flow should add a structured agent-native command, for example:

```bash
githits onboard --json
```

or an OAuth Device Authorization implementation. A future command should return machine-readable state for:

- already authenticated
- waiting for user approval
- authorized and stored
- expired or denied
- storage failure

The backend could create the GitHits account during the authorization step, then the CLI would store tokens using the same auth storage path as `githits login`.

## Testing Strategy

Static tests protect the skill contract by checking that onboarding files exist, required commands are present, and auth safety guardrails remain in place.

Agentic evals exercise whether real agents discover and follow the skill. The onboarding workload asks the agent to set up GitHits without giving command instructions, so command choice should come from the skill itself.

Agentic eval results are qualitative. Review `tool-calls.json`, `final.json`, `report.json`, `toolIssues`, and `instructionIssues` rather than treating a live-agent pass/fail as deterministic CI evidence.
