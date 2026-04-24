# Streamlined Signup Flow

## Purpose

This document captures the implementation checklist for a smoother first-run
authentication experience in the CLI. The goal is to let an unauthenticated
user invoke an auth-required command, complete browser sign-in or sign-up, and
then continue the original command without re-running it manually.

## Background

The underlying OAuth pieces already exist:

- `src/commands/login.ts` orchestrates the PKCE + browser flow.
- `src/services/auth-service.ts` serves the callback success page and exchanges
  the auth code for tokens.
- `src/container.ts` resolves token state at startup.
- `src/shared/require-auth.ts` currently blocks individual command actions when
  no valid token is present.

Today, auth-required commands fail fast and tell the user to run `githits
login`. That works, but it adds friction to first-run adoption and makes the
recommended one-shot entry point less compelling.

## Target Flow

1. User runs an auth-required interactive command such as
   `npx -y githits@latest example "..." -l typescript`.
2. CLI detects that no valid token is available.
3. CLI opens the browser to the sign-in / sign-up page.
4. User completes the GitHub-backed auth flow.
5. Browser shows the authenticated success page.
6. CLI resumes and executes the originally requested command.

## Scope Boundaries

The feature should not be phrased as "every command except help". Some commands
are informational, recovery-oriented, or host-driven, and auto-login would be
surprising or actively harmful.

### Commands that should stay exempt

| Command surface | Why exempt |
|---|---|
| `help`, `--help`, `-h` | Never trigger side effects for help output. |
| `login` | Already the explicit auth entry point. |
| `logout` | Must work even when auth is broken or absent. |
| `auth status` | Informational; should explain missing auth, not launch browser. |
| `init` | Already has its own login orchestration and fallback prompts. |
| `mcp` / `mcp start` | Agent hosts and stdio launches should not unexpectedly open a browser. |

### Phase 1 candidates

These are always-available, human-invoked commands where auto-login is a clear
UX improvement:

- `example`
- `languages`
- `feedback`

### Phase 2 candidates

These need extra work because they are not always registered when no auth state
is available at startup:

- `search`
- `search-status`
- `code ...`
- `pkg ...`

## Decision Criteria

Use these rules when implementing the feature:

- Keep `requireAuth()` as the final action-level invariant even after adding
  auto-login at the CLI boundary.
- Do not corrupt machine-readable output. Commands using `--json` or piping
  must not mix login progress logs into stdout.
- Avoid launching the browser from non-interactive or host-driven contexts.
- Reuse `loginFlow()` rather than duplicating OAuth orchestration.
- Keep startup registration behavior explicit for capability-gated command
  groups.

## Implementation Checklist

### Phase 1: interactive auto-login bootstrap

- [x] Add a shared auth-bootstrap helper that checks current auth state and,
      when appropriate, runs `loginFlow()` before dispatching the command.
- [x] Put the bootstrap decision at the CLI boundary in `src/cli.ts` rather
      than duplicating it in every command handler.
- [x] Add an explicit command policy helper that identifies exempt commands and
      auto-login-eligible commands.
- [x] Gate bootstrap on interactivity: no browser launch for non-TTY execution.
- [x] Keep automatic login progress off stdout when the invoked command
      requests `--json`.
- [x] Keep the current `requireAuth()` checks in command actions as a final
      invariant.
- [x] Wire the new bootstrap flow for `example`, `languages`, and `feedback`.

### Phase 1.1: login output hygiene

- [x] Refactor `src/commands/login.ts` so login progress can be reported via a
      small output interface instead of always writing directly to stdout.
- [x] Ensure automatic login can either write to stderr or stay quiet when the
      original command expects pipe-friendly stdout.
- [x] Preserve the current human-friendly standalone `githits login` output.

### Phase 1.2: docs and product guidance

- [x] Update `README.md` to show the promoted one-shot entry point:
      `npx -y githits@latest example "..." -l <language>`.
- [x] Update `src/cli.ts` help text if the product wants the one-shot example
      flow visible in `githits --help`.
- [x] Update `docs/implementation/auth.md` to describe the auto-login
      bootstrap path and its exemptions.
- [x] Update `docs/implementation/cli-commands.md` to explain which commands
      auto-trigger login and which do not.

### Phase 1.3: tests

- [ ] Add CLI-level tests for exempt commands never triggering auto-login.
- [ ] Add CLI-level tests for eligible commands triggering login when no valid
      token is available.
- [ ] Add tests for login failure preserving a clear error path.
- [ ] Add tests proving `--json` commands do not receive login chatter on
      stdout.
- [ ] Keep existing command-level `AuthRequiredError` tests to verify the final
      invariant still holds.

### Phase 2: capability-gated command registration

- [ ] Decide whether `search`, `code`, and `pkg` should be visible on a fresh
      unauthenticated machine purely to allow auto-login on first use.
- [ ] If yes, relax the startup registration gates in `src/commands/search.ts`,
      `src/commands/code/index.ts`, and `src/commands/pkg/index.ts` so the
      command surfaces can parse before auth exists.
- [ ] Re-check help output and discoverability once those command groups are
      visible without a token.
- [ ] Add tests covering first-run unauthenticated registration behavior.

## Open Decisions

- Should `mcp start` remain strictly manual-auth, or should there be a separate
  device-code or non-browser bootstrap for host-driven setups?
- Should the promoted example command keep the explicit `-l/--lang` flag, or do
  we want a separate feature for language inference/defaulting?

## Key Reference Files

| File | Why it matters |
|---|---|
| `src/cli.ts` | Best hook point for a single auto-login bootstrap policy. |
| `src/commands/login.ts` | Reusable login flow and current standalone login output. |
| `src/shared/require-auth.ts` | Final invariant for command actions after bootstrap. |
| `src/container.ts` | Startup token resolution and auth-state snapshot. |
| `src/commands/init/init.ts` | Existing example of composing `loginFlow()` into another command. |
| `src/commands/search.ts` | Top-level gated command registration. |
| `src/commands/code/index.ts` | `code` group registration gate. |
| `src/commands/pkg/index.ts` | `pkg` group registration gate. |
| `src/commands/example.ts` | Phase 1 command target. |
| `src/commands/languages.ts` | Phase 1 command target. |
| `src/commands/feedback.ts` | Phase 1 command target. |