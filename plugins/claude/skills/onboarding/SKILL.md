---
name: onboarding
description: >-
  Set up GitHits from Claude Code: detect supported tools, install GitHits MCP,
  start sign-in/signup, verify auth, and recover from setup issues.
metadata:
  internal: true
---

Use this skill when the user asks to install, connect, set up, sign up for, or start using GitHits. This is a new-user onboarding skill: assume the user wants to create or connect a GitHits account and configure GitHits unless they explicitly say otherwise.

## Current Boundary

- GitHits sign-in/signup currently uses browser OAuth. You can start and monitor login, but the user may need to approve GitHits in a browser tab.
- Never ask the user to paste passwords, OAuth codes, cookies, access tokens, refresh tokens, or API keys into chat.

## Execution Mode

- Use `npx -y githits@latest ...` for every normal onboarding command. This guarantees the latest published GitHits CLI behavior for new users.
- Do not use a globally installed `githits` binary for onboarding unless the user explicitly asks to test a local, dev, or pinned CLI build.
- If the user explicitly asks for local/dev/pinned testing, preserve the command and environment they provide.
- Run onboarding commands inline in the current agent session.
- Do not use subagents, background agents, background terminals, or long-running background tasks for onboarding.
- Do not delegate `githits`, `npx`, `npm`, `codex`, `claude`, detection, login, or setup commands to subagents or background agents.
- Do not start `npx -y githits@latest init --detect-agents --json` as a background task. Wait for the result before continuing.
- Do not run `pkill`, `ps`, process inspection, or package-source inspection as part of normal onboarding.
- If `npx -y githits@latest ...` fails because of network, DNS, or package-fetch errors, stop and report that GitHits CLI is unavailable.
- If official detection fails or appears stuck, do not inspect package internals, manually probe tools to infer install IDs, or ask the user to type inferred IDs. Report the detection failure and offer to retry, switch setup scope, or stop.

## Flow

1. Choose setup scope with a structured choice. Do not ask the user to type a freeform response.

Ask: `Where should GitHits be configured?`

Options:

- `My user account (Recommended)` — configures detected tools globally/user-level on this machine so GitHits is available wherever the user works with those agents.
- `This project only` — writes project-local MCP files into this repo; files may be committed.

2. Detect supported tools and current MCP state for the selected scope.

Project-level detection:

```bash
npx -y githits@latest init --project --detect-agents --json
```

User-level detection:

```bash
npx -y githits@latest init --detect-agents --json
```

Run detection inline, not in a background terminal. Wait for JSON before continuing.

Do not offer tools with `unsupported_project_config` for project-level setup.

Use `actionableIds` when present. If it is absent because the installed CLI predates guidance-aware detection, use `installableIds` for MCP setup and do not infer guidance-only repair from missing fields.

Before showing the review, classify the detection result:

- If every agent is `not_detected`, explain that no supported coding tool was found and stop before review, installation, or authentication. Tell the user to install or open a supported tool, then rerun detection.
- In project scope, if no agent is `needs_setup` or `already_configured` and at least one is `unsupported_project_config`, explain that project-level setup is unavailable, offer user-level detection, and stop the project flow before review or authentication.
- If supported agents are mixed with `unsupported_project_config`, explain the unsupported tools but continue only with supported agents.
- If no effective actionable IDs remain but at least one supported agent is `already_configured`, continue to the review, skip installation after acknowledgment, and then check authentication.

Follow the CLI JSON `instructions` remediation for these states rather than replacing it with generic authentication guidance.

3. When setup can proceed, show the install review before asking for tool approval or starting browser authentication, including the already-configured supported-tool case.

Tell the user:

- Queries and targets leave this machine and are sent to GitHits services for processing.
- Feedback submission is an outbound write that sends feedback data to GitHits services.
- Installing GitHits does not itself upload the local workspace.
- After installation, open a new coding-agent session so it loads MCP configuration and any supporting instructions. The terminal and machine do not need to be restarted.

Ask the user to acknowledge this review before continuing.
If the user does not acknowledge it, stop onboarding without installing or starting authentication.

4. Use `actionableIds` for tools needing MCP setup or requested guidance repair. If `actionableIds` is non-empty, use structured choices for tool selection. Do not ask the user to type comma-separated tool IDs unless no structured choice UI is available.

Present `Configure all actionable tools (Recommended)` as the first option, then list individual actionable tools for selective setup. After configure-all approval, execute `suggestedCommand` exactly so scope and guidance intent are preserved. Do not present "configure none" as a normal onboarding choice.

Ask before writing configuration: `I recommend configuring all detected tools so GitHits works wherever you use an agent. Proceed with all, or choose specific tools?`

Do not run `init -y` or `init --yes` unless the user explicitly asks to configure every detected tool.

For selective setup, build the matching scoped `--install-agents` command and preserve `--no-guidance` when `guidanceRequested` is `false`. Follow the CLI-emitted verification instruction instead of constructing a separate detect command.

If no effective actionable IDs remain and at least one supported tool is already configured, skip installation and continue to authentication only after the user acknowledges the install review.

5. Install only approved IDs using the selected scope.

Guidance is installed by default. It adds the `githits-mcp` skill and a short instruction pointer for tools with verified guidance paths. Add `--no-guidance` only when the user explicitly asks for plain MCP without supporting instructions.

Project-level install:

```bash
npx -y githits@latest init --project --install-agents <comma-separated-approved-ids> --json
```

User-level install:

```bash
npx -y githits@latest init --install-agents <comma-separated-approved-ids> --json
```

6. Start GitHits sign-in/signup as part of onboarding. Do not ask whether the user wants to log in; login creates or connects the GitHits account.

Check whether login can be skipped because auth is already active:

```bash
npx -y githits@latest auth status
```

If not authenticated or expired, ask before launching browser login, then run:

```bash
npx -y githits@latest login
```

Normal login opens the browser when possible and also prints a fallback sign-in URL. If command output is hidden from the user, relay the URL verbatim.

Use this only when browser launch fails or the environment is headless:

```bash
npx -y githits@latest login --no-browser
```

With `--no-browser`, surface the printed sign-in URL clearly so the user can open it in a browser. If command output is hidden from the user, relay the URL verbatim. Do not ask them to paste secrets or OAuth codes back into chat.

7. Verify with the selected scope.

Project-level verification:

```bash
npx -y githits@latest auth status
npx -y githits@latest init --project --detect-agents --json
```

User-level verification:

```bash
npx -y githits@latest auth status
npx -y githits@latest init --detect-agents --json
```

Report configured tools, auth state, failures, and whether the user should open a new Claude Code session so MCP configuration and any supporting instructions load. The terminal and machine do not need to be restarted.
