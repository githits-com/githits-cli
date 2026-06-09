# Agent Onboarding Skill

## Purpose

The `githits-onboarding` skill lets an agent guide a user from discovery to a usable GitHits setup with the current CLI surface. The skill orchestrates detection, MCP installation, sign-in/signup startup, verification, and recovery guidance.

## Current Flow

GitHits setup is currently split across existing CLI commands:

- `npx -y githits@latest init --detect-agents --json` scans supported coding tools and reports MCP configuration state.
- `npx -y githits@latest init --install-agents <ids> --json` installs GitHits MCP configuration for selected tools.
- `npx -y githits@latest login` starts OAuth PKCE sign-in/signup, opens a browser when possible, waits for the local callback, exchanges the authorization code, and stores credentials through the existing auth storage layer.
- `npx -y githits@latest auth status` reports whether local auth is active, expired, missing, or provided by `GITHITS_API_TOKEN`.

The onboarding skill uses `npx -y githits@latest` for normal onboarding so new users get the latest published CLI behavior. Installed global `githits` binaries may be stale and are only used when the user explicitly asks to test a local, dev, or pinned CLI build. This may be slower or require network access, but the latest published onboarding behavior is the product requirement.

## User Experience Contract

The agent can safely handle:

- Checking auth state.
- Detecting supported coding tools.
- Asking which detected tools to configure.
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
3. Recommend configuring all detected installable tools first.
4. Offer individual tool selection only as a secondary path for users who want a smaller setup.
5. Install the approved IDs with the matching staged install command.
6. Start sign-in/signup as part of onboarding, skipping login only when `auth status` already reports an active session.
7. Verify auth and tool configuration.

The skill still requires approval before writing MCP config or launching browser OAuth. It should not present "configure none" or "skip login" as normal onboarding choices, because those paths leave a new user without a working GitHits setup.

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

Agent detection may call read-only third-party CLI probes such as `which codex`, `codex mcp list`, `claude plugin list`, `gemini extensions config githits`, and Pi package-manager bin lookups. These probes are bounded so one slow or stuck agent CLI cannot prevent `init --detect-agents --json` from returning. Binary lookups use a short timeout, package-manager global-bin probes use a short timeout, and read-only configuration checks use a slightly longer timeout. Timed-out probes are treated as non-fatal probe failures: binary lookup timeouts make that agent not detected, while configuration-check timeouts leave an already-detected agent installable instead of blocking the whole detection response.

Set `GITHITS_INIT_TRACE=1` to diagnose detection hangs. Trace mode writes progress to stderr only and keeps JSON stdout parseable. It reports scan start/end, per-agent probe start/end, elapsed time, exit codes, and probe timeouts without logging environment values or secrets.

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
