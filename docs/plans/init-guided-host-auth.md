# Guided hosted-MCP sign-in during init

## Status and outcome

**IN PROGRESS — implementation started 2026-11-16.** One implementation increment is
planned. Interactive init will offer to finish hosted-MCP authentication in
the user's installed CLIs, showing and confirming each command before running
it sequentially. Already authenticated hosts are skipped. Manual instructions
remain for every unresolved host. MCP configuration and authentication remain
separate outcomes.

## Verified current state

- Branch `jlitola/feat-remote-mcp-init`, starting at `5109e7b`, PR 505. The
  existing remote-default flow is implemented and user-tested. This increment
  adds guided authentication; it does not reopen connection/guidance choices.
- `src/commands/init/init.ts` currently prints host authentication instructions
  after installation. Its local GitHits login flow cannot authenticate a host's
  hosted-MCP connection. Staged setup and JSON output have separate paths.
- `AgentDefinition` and `resolveInitAgent()` own host-specific configuration,
  executable resolution and remote instructions. That is the natural owner of
  native authentication capabilities too. The init coordinator owns consent,
  sequencing and completion reporting.
- `ExecService.exec()` ignores stdin and captures stdout/stderr. It cannot run
  native browser/callback interactions correctly. The process service should own
  a small inherited-terminal execution method, reusing Windows command
  normalization. Init should not spawn processes directly.
- Installed Codex 0.167.1 supports `codex mcp list --json` and
  `codex mcp login githits`. A disposable-home, file-store probe against the
  canonical endpoint returned `auth_status: "not_logged_in"`. `mcp get --json`
  has no authentication status. List JSON can contain configuration secrets:
  capture it internally, validate narrowly, and never print it.
- Codex source pinned to `rust-v0.167.1` (`0a94398f`),
  `codex-rs/cli/src/mcp_cmd.rs` and `rmcp-client/src/auth_status.rs`, confirms
  list checks stored credential usability / OAuth discovery, not an end-to-end
  successful GitHits tool call. It does not start stdio MCP servers to list them.
- Installed Claude Code 2.1.311 supports `claude mcp login githits` and
  `claude mcp get githits`. In an isolated home with only a canonical hosted
  entry, get returned `Needs authentication` without opening an auth flow.
  Current repository changelog records standalone MCP login since 2.1.186.
  Get performs a per-server health check; output is human-readable and can
  include configuration. Capture and parse only recognized status/endpoint
  fields; never echo its output or errors. Unknown output is not signed out.
- A second disposable-home probe with a local-scoped stdio `githits` entry
  shadowing the hosted user entry started that stdio process during get. The
  fixture's project key had to use the real cwd path (macOS symlink spelling
  otherwise did not match). External probes additionally show git-root local
  entries applying from subdirectories and approved ancestor `.mcp.json` entries
  applying even outside git repositories. A narrow copied resolver is insufficient.
  An isolated temp cwd returns the user entry without starting either fixture.
- Cursor documents `agent mcp login GitHits`, but its list command is an
  interactive menu, with no documented machine-readable auth check. The
  `agent` executable is absent here. Editor-only Cursor installs remain manual.
- OpenCode and Kilo document `mcp auth GitHits`. Their executables are absent
  from PATH here. Source confirms named finite login commands. Kilo can return exit 0
  after reporting failed authentication, so exit status alone cannot prove
  successful sign-in. Generic connection-list output is not an auth probe.
- A disposable published Kilo 7.8.28 binary confirms `kilo mcp auth list`
  returns the canonical GitHits row as `not authenticated` with exit 0. Its
  pinned `MCP.getAuthStatus` source reads native URL-bound token/expiry state
  without initializing MCP connections. This dedicated command is suitable for
  the narrow native-state probe, unlike `kilo mcp list`.
- Disposable published OpenCode binaries distinguish two live command families:
  `opencode-ai` 1.19.5 declares `mcp auth list` in help and reports GitHits as
  `not authenticated`, without starting an unrelated configured stdio fixture.
  `@opencode/cli` 2.2.7 does not declare that subcommand. Check command help before
  using the dedicated probe: on 2.x, `list` could instead be interpreted as a
  server name by `auth [name]`. That family keeps manual instructions. The
  1.x implementation at `810c0eba` shares Kilo's dedicated native-state contract.
- OpenCode current source (`5bc39c70`,
  `packages/core/src/config/normalize.ts:250-305`) converts our legacy direct
  MCP map to the current schema. The newer documentation does not require a
  configuration migration in this increment.
- Gemini and Pi currently have verified in-session commands only. Desktop and
  editor integrations use host UI. Do not start an agent session or submit a
  model prompt to simulate authentication.

Primary references: [Codex implementation](https://github.com/openai/codex/blob/0a94398f/codex-rs/cli/src/mcp_cmd.rs),
[Claude changelog](https://github.com/anthropics/claude-code/blob/ab49b896/CHANGELOG.md),
[Cursor CLI MCP](https://cursor.com/docs/cli/mcp),
[OpenCode auth implementation](https://github.com/anomalyco/opencode/blob/5bc39c70/packages/cli/src/commands/handlers/mcp/auth.ts),
[Kilo auth implementation](https://github.com/Kilo-Org/kilocode/blob/62272026/packages/opencode/src/cli/cmd/mcp.ts).

## Scope and non-goals

Only the human interactive hosted-MCP completion flow changes, including hosted
Cursor in the local-first route. Keep existing local CLI authentication,
configuration ownership, guidance, host selection, directory handoff, staged
JSON and non-interactive behavior. No direct OAuth implementation, credential
file reading, token copying, new dependency, cache, retries or background service.
No tool descriptors, public skills or MCP-package behavior changes.

## Assumptions, unknowns and dependencies

- User approval of each displayed command authorizes launching that host's native
  login; the host owns browser interaction and credential storage.
- Native capabilities can differ by installed version. Unsupported commands,
  missing binaries, malformed output, disabled entries, unavailable endpoints
  and timeouts produce unknown status, never a fabricated signed-out result.
- Product decision: the user requested final instructions for CLIs that cannot
  be handled automatically. Only hosts with a reliable status check and native
  login participate in the automatic flow. Unknown status, unsupported versions,
  absent executables and in-app-only authentication remain manual. Do not offer
  an unverified re-login as though sign-in were known to be missing.
- Open product decisions: none.
- Dependencies: existing prompt/exec/file-system interfaces and canonical host
  definitions. No infrastructure or package changes are needed.

## Target behavior and ownership

1. Finish configuration first. Derive the hosted-auth targets from exactly the
   same usable target set that feeds final instructions; deduplicate by host.
   Selected guidance-only usable hosts are included. A true no-selection no-op
   retains its existing all-configured reporting scope, allowing an init rerun
   to finish previously skipped sign-in without rewriting configuration. Failed
   installs and unselected hosts in a selected run are excluded. Scope is
   explicit in the status list; checks never authorize running login commands.
2. First confirm the installed native command's capability with bounded help
   probes. In particular, require `claude mcp --help` to list `login <name>`
   before get or automatic login; older Claude versions retain the current
   in-session `/mcp` instruction. Gate both participation and human instruction
   text on that result. Unknown help stays manual. Apply equivalent native
   login-capability checks to the other executable command families.
   Run bounded, non-interactive native status checks only where verified. Codex
   uses list JSON, narrowed to the exact server and canonical effective URL;
   Claude uses named get and known status text. Kilo and supported OpenCode 1.x
   use `mcp auth list` after help confirms that exact status subcommand,
   matching the exact name, canonical URL and native auth-state label.
   Normalize to authenticated,
   required or unknown. Do not interpret credential presence or arbitrary success
   exit codes as a working GitHits connection. Disable browser startup in probes
   by using status commands, never login commands.
3. Preserve the host's native home overrides and setup's resolved executable.
   For user-level setup, run checks and login from an isolated temporary cwd,
   using the existing `FileSystemService.createTempDir()` / `deleteDirIfEmpty()`
   pattern in setup-handler `useIsolatedCwd`. This keeps project/local entries
   out of the user-level operation without copying native resolution rules.
   Resolve relative native home/config path overrides against the original cwd
   before changing child cwd, then pass absolute child-only overrides. In
   particular, setup already resolves relative `CODEX_HOME` this way; auth must
   use that same location. Apply the same rule to supported relative Claude and
   XDG/host configuration paths without mutating the parent environment.
   Keep that cwd through the sequence and clean it in finally. Require Claude's
   parsed `Scope:` to be user config, plus the canonical URL and status. Keep
   project-level Claude manual: a newly written unapproved `.mcp.json` can make
   get silently report the user entry. Other supported project commands use the
   selected project cwd and require the effective canonical name/URL.
   Before Claude get, check presence of platform `managed-mcp.json`
   (`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on
   Linux/WSL, `C:\Program Files\ClaudeCode\` on Windows) and stay manual there.
   Native managed/blocked/disabled/pending-approval statuses also stay manual.
   Verify the effective named entry before login; unidentified or different
   entries retain instructions. Do not add a second native configuration resolver.
4. If any eligible hosts need attention, show a brief status list and selector:

   ```text
   Sign in to GitHits

   Claude Code  Sign-in required
   Codex CLI   Already signed in

   Complete sign-in now?
   > Sign in now
     Show instructions
   ```

   Unknown-status and UI/slash-command hosts remain in next steps; no empty
   global prompt. Claude Code, Codex, Kilo and OpenCode 1.x participate in
   automatic sign-in when their native help and status checks support it.
   Cursor and OpenCode 2.x keep their existing commands in instructions.
   Use the existing selector style, concise one-line option descriptions and
   width-aware prose. Do not ask a second time about already authenticated tools.
5. If accepted, process each eligible host separately. Show its bold tool name,
   status and standalone copyable command before a selector:

   ```text
   Claude Code
     claude mcp login githits

   Run this command?
   > Run command
     Skip this tool
   ```

   Confirming the global choice never authorizes all commands. There is no
   "always" choice. Declining the global choice immediately retains today's
   instructions. Skipping one tool continues to the next.
6. Native login inherits the terminal; captured status output is never replayed.
   Suspend/dispose the selector before launching the child and await its exit
   before another prompt. Do not impose a short status-probe timeout on browser
   approval. During the child's lifetime, temporarily handle parent SIGINT so
   the parent awaits the child's exit instead of dying before completion output;
   remove that listener on every exit/error path. Return exit code and signal.
   Signal termination or exit 130 stops the sequence and prints unresolved
   instructions plus the footer; never say "no changes made" after setup.
   A child that consumes raw-mode Ctrl-C and exits 1 is indistinguishable from
   ordinary failure: report unresolved and proceed to the next explicit selector,
   where Ctrl-C can cancel normally. Preserve written configuration. Test signal
   and raw-exit paths and terminal/listener restoration. Document Windows `.cmd`
   shims potentially asking "Terminate batch job (Y/N)?".
7. Recheck status after each command. Report authenticated only when the host
   supports that conclusion. Failure/nonzero/unknown after a probe retains that
   tool's instructions. Do not retry automatically or turn a skipped optional
   sign-in into an MCP installation failure. Continue to the next tool after
   an ordinary failed command; cancellation stops the sequence.
8. Print concise results, then the existing formatted instructions only for
   unresolved hosts, plus the single troubleshooting footer. Retain local CLI
   authentication and directory actions in mixed runs. A successful native auth
   check is not proof that a new agent session has loaded the config or tools.
   With all hosted targets authenticated, show the sign-in result without an
   empty Next Steps block or falling through to unrelated local-CLI guidance.
9. `--skip-login` skips hosted checks and commands. `--yes` still skips prompts
   and therefore never grants per-command consent: leave manual instructions.
   Detect/staged install/JSON and non-TTY modes never launch native sign-in.

Host command descriptors and narrow parsers belong with init's host definitions
or a focused host-auth module beside them. A small init-only coordinator owns
the interaction. Do not parse display instructions to discover executable
commands, add a plugin framework or thread auth through every setup handler.
The process service owns inherited stdio and child lifecycle only, not auth.

## Phase map

1. **Guided hosted-MCP sign-in — READY:** selected supported CLI users can finish
   authentication during init, with explicit consent per command and honest
   final instructions for anything unresolved.

## Phase 1: implementation and verification

Status, assumptions, unknowns and dependencies are those above. The next phase
is ready to implement. Open phase product decisions: none.

1. Add narrow host-auth capability/status tests and coordinator tests before
   implementation. Likely files: `src/commands/init/host-auth.ts` and its test,
   existing `agent-definitions.ts`, `init.ts` and `remote-init.test.ts`.
2. Add inherited-terminal execution to `ExecService` and its mock factory.
   Reuse Windows normalization; return exit/signal information without captured
   stdout/stderr. Test real child stdin/stdout inheritance, exit/error/cancel and
   Windows argument normalization with platform-correct paths.
3. Integrate the optional sequence at the human completion boundary, retaining
   installation outcomes and existing selection scope. Update Claude's human
   sign-in instructions when standalone login is available, preserving the
   in-session route for older versions. Keep structured output compatibility.
4. Update `docs/implementation/init-setup-output.md`, relevant setup guidance and
   `TROUBLESHOOTING.md` with consent, support and failure behavior. Add an
   independent `githits: minor`, `@githits/mcp: none` change fragment.
5. Verify behavior, run internal preflight and one external reviewer per round,
   fix accepted findings, then commit and update PR 505. No merge or release.

Acceptance and test coverage (small text/JSON fixtures, no credentials/corpus):

- Already-authenticated, required and unknown states have distinct UI behavior;
  missing/expired status is offered only when the native evidence supports it.
- Only selected usable hosted targets are checked. Unselected/failed/local,
  staged/JSON, non-TTY, `--yes` and `--skip-login` cases cannot launch native
  authentication. No-op and guidance-only runs retain their existing final
  instruction scope and still require both levels of consent.
- Global decline launches nothing; every accepted command requires its own
  confirmation; skips/failures preserve instructions and remaining order.
- Effective endpoint/name checks prevent project shadowing from authenticating
  a different entry; native home/executable overrides remain effective.
  Relative native home/config overrides resolve from the original cwd and remain
  identical across setup, isolated check and login; include relative CODEX_HOME.
  A user-level run from a git subdirectory with local or approved ancestor
  stdio shadow fixtures executes checks/login only in the isolated cwd and never
  starts the fixtures. Claude project scope never runs get or login.
- OpenCode 2.x help without `mcp auth list`, and unrecognized help, never execute
  that ambiguous command. Kilo/OpenCode 1.x login exit 0 followed by a
  not-authenticated recheck stays unresolved and retains instructions.
- Claude help without standalone `login` never runs get or login and retains
  the current in-session `/mcp` instruction. Other unsupported command families
  likewise remain manual rather than executing a known-unsupported login.
- Authenticated hosts disappear from unresolved instructions; unknown command
  completion never becomes a false success. Mixed local/UI/directory actions,
  selection scope, colors and one final troubleshooting link survive.
- Status stdout/stderr containing a synthetic secret marker never reaches
  terminal output, diagnostics, structured responses or exception messages.
- Interactive subprocess testing proves terminal handoff and cancellation with
  disposable fake host CLIs, not just mocked command calls. Inspect built PTY
  output at 80 and 40 columns for selector descriptions and command readability.
- Run focused `bun test` for init/exec, then `bun test`, typecheck, format/lint,
  `bun run build`, plugins generate/check, source CLI/MCP smoke suites, and built
  CLI/MCP smoke suites. Do not launch real user OAuth during automated tests.
  Native help/disposable-home probes already establish installed capability;
  Kilo and both OpenCode families were verified separately in disposable homes;
  report the absence of other CLIs rather than claiming native validation.

## Completion and cleanup

Ready means internal plus external plan review is adjudicated. Complete means
implemented, verified, reviewed and delivered on
PR 505. Keep durable behavior in implementation docs and troubleshooting; keep
execution evidence on the PR. Delete this plan with the final reviewed increment
before its final push, following the repository plan-retirement rule.

## Plan review disposition

Internal technical review: direction sound. Accepted two concrete gaps and
closed them across the plan: derive auth scope from the existing final-instruction
set so reruns can finish sign-in; isolate user-level auth instead of implementing
a partial Claude config resolver. External round 1 demonstrated git-root and
ancestor resolution gaps and missing Ctrl-C lifecycle handling. Both accepted:
isolation reuses the current process/filesystem boundary, and the inherited
runner owns temporary signal handling; cancellation prints unresolved actions.
The second external delivery arrived while those edits were pending and repeated
the open findings; it also requested explicit ambiguous-help and false-success
fixtures. Accepted those small test criteria. External round 3 confirmed all
closures and found one bounded compatibility gap: older Claude supports get but
not standalone login. Added explicit help gating before get/login and the old
in-session instruction fallback, with a no-exec fixture. Also clarified the
automatic Kilo/OpenCode wording. All findings are addressed in the plan; the
three-round limit prevents another external round, so the final small edit has
internal closure verification only. That closure pass found no findings and
confirmed implementation readiness. The last external round itself was not
clean; no additional external clean round is claimed. No production files changed.


## Implementation slice sequence

Coordinator owns auth capability checks, execution context, inherited-terminal
lifecycle, prompt sequencing, init integration and final validation. One Luna
worker receives mechanical slices serially:

1. Pure native-status classification and fixture tests in host-auth-status.ts /
   host-auth-status.test.ts; one criterion: exact target/status classification
   without false positives or raw data escape.
2. Documentation of the completed behavior, only after coordinator implementation
   settles; exact file ownership/wording supplied then if delegation saves work.

Current runtime grants full filesystem/network access; worker has that same
access. No infrastructure, external writes, user OAuth or credential inspection
is authorized. Reoriented against origin/main 57e3f9d: its two new commits do not
change init boundaries; branch remains at 5109e7b before implementation.


Implementation review closure: a real PTY child that enables raw mode and dies
proved the parent's cached isRaw flag and setRawMode(false) cannot reliably
restore shared POSIX terminal flags. ExecService now snapshots/restores exact
flags through standard stty (private capture, inherited stdin, no shell), keeping
SIGINT handling through restoration. Windows keeps native console restoration.
This replaces the ineffective cached-mode fix, without another auth layer.
A permanent script(1)-based regression checks canonical input and echo before
parent exit. Windows path fixtures now use win32 semantics. Internal reviewer
endorsed this boundary fix.
