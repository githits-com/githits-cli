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
- `packages/mcp/src/shared/require-auth.ts` currently blocks individual command actions when
  no valid token is present.

Today, auth-required commands fail fast and tell the user to run `githits
login`. That works, but it adds friction to first-run adoption and makes the
recommended one-shot entry point less compelling.

## Target Flow

1. User runs an auth-required interactive command such as
      `npx -y githits@latest init`.
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
| `mcp` / `mcp start` | Agent hosts and stdio launches should not unexpectedly open a browser. |

### Phase 1 candidates

These are human-invoked commands where auto-login is a clear UX improvement:

- `init`
- `init --skip-login` remains an explicit opt-out
- `example`
- `languages`
- `feedback`
- `search` / `search-status`
- `code files` / `code read` / `code grep`
- `docs list` / `docs read`
- `pkg info` / `pkg vulns` / `pkg deps` / `pkg changelog`

### Package/source registration note

Package/source commands (`search`, `search-status`, `code`, `docs`, and `pkg`)
register through the normal package-service URL configuration path. The signup
bootstrap can therefore run for their interactive invocations before the command
action reaches the final `requireAuth()` check.

## Decision Criteria

Use these rules when implementing the feature:

- Keep `requireAuth()` as the final action-level invariant even after adding
  auto-login at the CLI boundary.
- Do not corrupt machine-readable output. Commands using `--json` or piping
  must not mix login progress logs into stdout.
- Avoid launching the browser from non-interactive or host-driven contexts.
- Reuse `loginFlow()` rather than duplicating OAuth orchestration.
- Keep startup registration behavior explicit for package/source command groups:
      registration follows package-service URL configuration.

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
- [x] Wire the new bootstrap flow for `init` and interactive user-facing
      commands that require authentication.

### Phase 1.1: login output hygiene

- [x] Refactor `src/commands/login.ts` so login progress can be reported via a
      small output interface instead of always writing directly to stdout.
- [x] Ensure automatic login can either write to stderr or stay quiet when the
      original command expects pipe-friendly stdout.
- [x] Preserve the current human-friendly standalone `githits login` output.

### Phase 1.2: docs and product guidance

- [x] Document the signup bootstrap behavior and command scope in this
      implementation note.

### Phase 1.3: tests

- [x] Add CLI-level tests for exempt commands never triggering auto-login.
- [x] Add CLI-level tests for eligible commands triggering login when no valid
      token is available.
- [x] Add tests for login failure preserving a clear error path.
- [x] Add tests proving `--json` commands do not receive login chatter on
      stdout.
- [ ] Keep existing command-level `AuthRequiredError` tests to verify the final
      invariant still holds.

### Phase 2: package/source command registration

- [x] Decide whether `search`, `code`, `docs`, and `pkg` should trigger browser
      login on first use. Decision: yes for interactive CLI use, while keeping
      action-level auth checks as the final invariant.
- [x] Keep startup registration in `src/commands/search.ts`,
      `src/commands/code/index.ts`, and `src/commands/pkg/index.ts` aligned
      with the package-service URL configuration path.
- [x] Re-check help output and discoverability with the package/source command
      registration policy in place.
- [x] Add tests covering URL-configured registration behavior.

## Open Decisions

- Should `mcp start` remain strictly manual-auth, or should there be a separate
  device-code or non-browser bootstrap for host-driven setups?

## Key Reference Files

| File | Why it matters |
|---|---|
| `src/cli.ts` | Best hook point for a single auto-login bootstrap policy. |
| `src/commands/login.ts` | Reusable login flow and current standalone login output. |
| `packages/mcp/src/shared/require-auth.ts` | Final invariant for command actions after bootstrap. |
| `src/container.ts` | Startup token resolution and auth-state snapshot. |
| `src/commands/init/init.ts` | Advertised onboarding command; `--skip-login` remains the explicit opt-out. |
| `src/commands/search.ts` | Top-level package/source registration and auth-required action. |
| `src/commands/code/index.ts` | `code` group package-service URL registration. |
| `src/commands/docs/index.ts` | `docs` group package-service URL registration. |
| `src/commands/pkg/index.ts` | `pkg` group package-service URL registration. |
| `src/commands/example.ts` | Auth-required command action still protected by `requireAuth()`. |
| `src/commands/languages.ts` | Auth-required command action still protected by `requireAuth()`. |
| `src/commands/feedback.ts` | Auth-required command action still protected by `requireAuth()`. |
