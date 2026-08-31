---
name: githits-onboarding
description: >-
  Use when the user asks to install, connect, configure, sign in to, sign up
  for, or start using GitHits. Covers agent detection, MCP and guidance
  installation, authentication, verification, and setup recovery.
compatibility: Requires shell access, internet access, and npx. Use a local githits binary only for explicit local/dev/pinned testing.
---

Use this skill when the user wants to start using GitHits from their agent.
This is a new-user onboarding skill: assume the user wants to create or connect
a GitHits account and configure GitHits unless they explicitly say otherwise.

## Current Boundary

- GitHits account sign-in/signup currently uses browser OAuth. You can start and monitor the flow, but the user may need to approve GitHits in a browser tab.
- Do not promise browserless account creation or that everything happens inside chat.
- Never ask the user to paste passwords, OAuth codes, cookies, access tokens, refresh tokens, or API keys into chat.

## Command Style

- Use `npx -y githits@latest ...` for every normal onboarding command. This guarantees the latest published GitHits CLI behavior for new users.
- Do not use a globally installed `githits` binary for onboarding unless the user explicitly asks to test a local, dev, or pinned CLI build.
- If the user explicitly asks for local/dev/pinned testing, preserve the command and environment they provide.
- Prefer `--json` for staged `init` commands because agents need stable fields.
- Do not start `npx -y githits@latest` as a background task. If `npx` fails because of network, DNS, or package-fetch errors, stop and report that GitHits CLI is unavailable.

## Execution Mode

- Run onboarding commands inline in the current agent session.
- For Codex and other agents with background/subagent capabilities, do not use subagents, background agents, background terminals, or long-running background tasks for onboarding.
- Do not delegate `githits`, `npx`, `npm`, `codex`, `claude`, detection, login, or setup commands to subagents or background agents.
- Do not start `npx -y githits@latest init --detect-agents --json` as a background task. Run it directly, wait for the result, and only continue after it returns.
- Do not run `pkill`, `ps`, process inspection, or package-source inspection as part of normal onboarding. If a command appears stuck, stop and report that official detection did not return.
- These are short setup probes and must stay visible and sequential so the user can approve side effects and failures are easy to diagnose.
- If official detection fails or appears stuck, do not inspect package internals, manually probe tools to infer install IDs, or ask the user to type inferred IDs. Report that official GitHits detection failed and offer to retry, switch setup scope, or stop.

## Onboarding Flow

1. Choose setup scope with a structured choice.

Use the agent's structured choice UI when available. Do not ask the user to type a freeform response for setup scope.

Ask: `Where should GitHits be configured?`

Options:

- `My user account (Recommended)` — configures detected tools globally/user-level on this machine. Best for onboarding because GitHits will be available wherever the user works with those agents.
- `This project only` — writes project-local MCP files into the current repo. Good for repo-specific or team setup. These files may be committed.

2. Detect supported coding tools and GitHits MCP configuration state for the selected scope:

Project-level detection:

```bash
npx -y githits@latest init --project --detect-agents --json
```

User-level detection:

```bash
npx -y githits@latest init --detect-agents --json
```

Run detection inline, not in a background terminal. Wait for JSON before continuing.

Use the JSON fields to summarize detected tools. `agents[].status` describes MCP state and can be `needs_setup`, `already_configured`, `unsupported_project_config`, or `not_detected`. `agents[].guidanceStatus` describes supporting guidance. `installableIds` remains MCP-only; use `actionableIds` for tools needing either MCP setup or requested guidance repair.

If `actionableIds` is absent because the installed CLI predates guidance-aware detection, use `installableIds` for MCP setup and do not infer guidance-only repair from missing fields.

For project-level setup, do not offer tools with `unsupported_project_config`. Explain only if needed: those detected tools do not have verified project-level MCP support.

Before showing the review, classify the detection result:

- If every agent is `not_detected`, explain that no supported coding tool was found and stop before review, installation, or authentication. Tell the user to install or open a supported tool, then rerun detection.
- In project scope, if no agent is `needs_setup` or `already_configured` and at least one is `unsupported_project_config`, explain that project-level setup is unavailable, offer user-level detection, and stop the project flow before review or authentication.
- If supported agents are mixed with `unsupported_project_config`, explain the unsupported tools but continue only with supported agents.
- If no effective actionable IDs remain but at least one supported agent is `already_configured`, continue to the review, skip installation after acknowledgment, and then check authentication.

Follow the CLI JSON `instructions` remediation for these states rather than replacing it with generic authentication guidance.

3. When setup can proceed, show the install review before asking for tool approval or starting browser authentication, including the already-configured supported-tool case.

Tell the user:

- GitHits queries and public package, repository, and documentation targets are sent to GitHits services for processing.
- Feedback submission is an outbound write that sends feedback data to GitHits services.
- Installing GitHits does not itself upload the local workspace.
- After installation, open a new coding-agent session so it loads MCP configuration and any supporting instructions. The terminal and machine do not need to be restarted.

Ask the user to acknowledge this review before continuing.
If the user does not acknowledge it, stop onboarding without installing or starting authentication.

4. Recommend the simplest actionable setup choice with structured options.

If `actionableIds` is non-empty, use structured choices when available. Do not ask the user to type comma-separated tool IDs unless the current agent interface has no structured choice mechanism. Explain whether each ID needs MCP setup, guidance repair, or both.

Ask: `Which tools should I configure?`

Options:

- `Configure all actionable tools (Recommended)` — the recommended default option; after approval execute `suggestedCommand` exactly so scope and guidance intent are preserved.
- One selective setup option per actionable tool, using the tool display name and ID.

Do not present "configure none" as a normal onboarding choice; if the user does not want any tool configured, pause and clarify whether they want to stop onboarding.

Ask before writing configuration. A good prompt is: `I recommend configuring all detected tools so GitHits works wherever you use an agent. Proceed with all, or choose specific tools?`

Only install user-approved IDs. Do not run `init -y` or `init --yes` unless the user explicitly asks to configure every detected tool.

For selective setup, build the matching scoped `--install-agents` command and preserve `--no-guidance` when `guidanceRequested` is `false`. Follow the CLI-emitted verification instruction instead of constructing a separate detect command.

If no effective actionable IDs remain and at least one supported tool is already configured, skip installation and continue to authentication only after the user acknowledges the install review.

5. Install GitHits MCP and supporting guidance for approved tools using the selected scope.

Guidance is installed by default. It adds the `githits-mcp` skill and a short instruction pointer for tools with verified guidance paths. Add `--no-guidance` only when the user explicitly asks for plain MCP without supporting instructions.

Project-level install:

```bash
npx -y githits@latest init --project --install-agents <comma-separated-approved-ids> --json
```

User-level install:

```bash
npx -y githits@latest init --install-agents <comma-separated-approved-ids> --json
```

Treat `success` and `already_configured` outcomes as usable. Report any `failed` outcome with the tool name and message. For project-level setup, remind the user that project-local MCP files may be committed.

Cursor is configured with the remote MCP at `https://mcp.githits.com`, not a local stdio command. An existing Cursor entry that runs `npx ... githits ... mcp start` is legacy and should become `needs_setup`; installing it migrates the entry to the remote URL.

6. Start GitHits sign-in/signup during onboarding.

Do not ask whether the user wants to log in. Login creates or connects the GitHits account, so it is part of onboarding. Ask before launching browser OAuth, then run login unless `auth status` already shows an active session.

This CLI authentication step applies to local GitHits CLI/stdio integrations. Cursor remote MCP authentication is managed separately by Cursor. If Cursor is the only approved tool, skip local CLI login and continue to the Cursor verification below. For a mixed install, use this CLI login step for the non-Cursor tools, but do not treat it as evidence that Cursor is authenticated.

Check auth state:

```bash
npx -y githits@latest auth status
```

Treat `Authenticated.` and `Authenticated via environment variable.` as already signed in and skip launching login. Treat `Not authenticated.` and `Token expired.` as requiring login.

Explain: `I can start GitHits sign-in now. It may open a browser tab where you approve or create your GitHits account. I will not ask you to paste secrets into chat.`

Then run:

```bash
npx -y githits@latest login
```

Normal login opens the browser when possible and also prints a fallback sign-in URL. If command output is hidden from the user, relay the URL verbatim.

If the browser cannot open automatically, or the session appears to be SSH/container/headless, use:

```bash
npx -y githits@latest login --no-browser
```

With `--no-browser`, surface the printed sign-in URL clearly so the user can open it in a browser. If command output is hidden from the user, relay the URL verbatim. Do not ask them to paste passwords, tokens, cookies, or OAuth codes back into chat.

7. Verify setup after login and installation.

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

Confirm auth is active and selected tools are `already_configured` for the selected scope. If MCP configuration or supporting guidance changed, tell the user to open a new coding-agent session in the project or user environment so the tool reloads its MCP configuration and any supporting instructions. The terminal and machine do not need to be restarted.

For Cursor, `already_configured` verifies only that the remote URL is present. It does not verify Cursor-managed OAuth or tool discovery. Do not report Cursor as ready based on `githits auth status` or init detection alone.

If `cursor-agent` is available, verify Cursor directly:

```bash
cursor-agent mcp list
cursor-agent mcp list-tools GitHits
```

If Cursor reports that authentication is required, run `cursor-agent mcp login GitHits`, let the user complete browser OAuth, then rerun both verification commands. Do not ask the user to paste OAuth data into chat.

Whether or not `cursor-agent` is available, tell the user to open a new Cursor Agent chat after installation. In the Cursor MCP tools UI, confirm that GitHits is enabled, complete its OAuth prompt if shown, and confirm that GitHits tools are listed. If the CLI checks cannot run, require the user's confirmation from that new chat before reporting Cursor ready.

## Completion Response

Report:

- Which tools were configured or already configured.
- Whether local GitHits CLI auth and Cursor-managed OAuth are active, require browser approval, or could not be verified, keeping those states separate.
- Whether the user needs to restart/open a new agent session.
- Any failed tool setup with the exact tool name and error message.

## Safety Rules

- Do not collect or display secrets.
- Do not write secrets into MCP config.
- Do not ask the user to run commands manually unless you lack shell access.
- Do not retry broad setup with `init --yes` after a failure; use the staged JSON flow and approved IDs.
- If auth storage fails, read `references/troubleshooting.md` before suggesting recovery.

Read `references/troubleshooting.md` for recovery paths when setup, login, storage, or verification fails.
