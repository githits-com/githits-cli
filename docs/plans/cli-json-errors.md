# CLI JSON errors

## Objective and status

Status: IMPLEMENTED; validation passed, external implementation review pending. One implementation phase; no product decisions.
When an invocation requests `--json`, parser and top-level failures return one
JSON error envelope on stderr and exit nonzero, without text diagnostics mixed
into that envelope. Existing command-specific JSON envelopes remain unchanged.

## Verified state

- `src/cli.ts` wraps startup and actions with `runCliMain`, but Commander uses
  its default write-and-exit behavior, bypassing that boundary on parse errors.
- Reproduced `pkg info --json` and `pkg info npm:express --not-a-real-flag --json`:
  exit 1, empty stdout, plain-text stderr.
- `src/cli/errors.ts` handles some configuration errors as JSON, but auth,
  storage, and unexpected top-level errors still take terminal-only branches.
- `src/commands/format-mapped-error.ts` and command handlers already implement
  `{error, code, retryable, details?}`. `UNKNOWN`, `INVALID_ARGUMENT`, and
  `AUTH_REQUIRED` are existing codes. Auth has an existing payload builder.
- Routine update notices can run with JSON when stderr is a TTY and flush plain
  text in `finally`. Exclude JSON invocations from advisory eligibility so they
  cannot contaminate the error stream; required-update JSON enforcement stays.
- Commander 14 inherits exit callbacks and output configuration when children
  are constructed. Its help/version exits carry exit code zero; error-help uses
  `commander.help` with a placeholder message and a nonzero exit.

## Ownership and design

The root CLI owns parsing, process exits, and stderr formatting. Configure
Commander before child registration for JSON invocations only: suppress its
direct error stream and throw its exit objects into the existing boundary.
Preserve successful help/version output by checking `exitCode === 0`, not
the Commander code string (help uses the same code for success and failure). Convert parser
failures to `INVALID_ARGUMENT`; replace the error-help placeholder with useful
missing-command guidance: `Unknown or missing command. Run githits --help for usage.`
No command-path inference or exit callback binding is needed. Reuse the auth payload builder; retain current config
classification. Other top-level failures use `UNKNOWN`, `retryable: false`,
and an error message, without stack traces even when debug logging is enabled.
Do not serialize arbitrary thrown objects.

No new service, dependency, infrastructure, MCP behavior, auth policy, or API
fetching. Terminal rendering remains unchanged. Existing command-owned errors,
progress output, explicit debug/telemetry streams, and successful output schemas
are not redesigned. No performance claim or benchmark is warranted.

## Assumptions and unknowns

- Compatibility: use existing envelope names and exit 1 for failures; consumers
  of previously plain-text JSON failures gain a structured response.
- The existing argv `--json` detection identifies error-output intent even
  before Commander successfully parses. Preserve that convention in this slice.
- Missing-command help must not write a usage page into JSON stderr.
- Unknowns/product decisions: none. No migration; rollback is reverting this PR.
- Secrets: use isolated test homes and synthetic credentials only; never print
  credentials or arbitrary thrown-object properties. Preserve existing message
  policy; this is not a general secret-redaction or terminal-sanitization project.

## Phase 1 — consistent CLI JSON failures

Status: IMPLEMENTED; external implementation review pending. Dependencies: reviewed plan only.
Assumptions and unknowns: as above; no additional product decisions.

1. Add failing unit tests for parser-error classification, successful Commander
   exits, auth/storage/unexpected boundary errors, non-Error throws, and debug
   behavior. Add process cases for missing arguments, unknown options/commands,
   missing option values, missing subcommands, and help/version compatibility.
2. Configure JSON-only Commander interception before children are registered.
   Extend the existing root handler without changing normal terminal branches
   or command-specific error semantics.
3. Exclude JSON invocations from routine update-check eligibility and verify
   with focused eligibility and root update-task tests; preserve mandatory
   update enforcement and its existing JSON response.
4. Update the real-process startup-failure test and add unauthenticated CLI smoke
   cases asserting the complete stderr parses as one envelope, empty stdout,
   and exit 1. Retain normal terminal and success help/version checks.
5. Document the boundary contract in `docs/implementation/cli-commands.md`,
   update the skip list in `docs/implementation/update-check.md`, and
   add an independent CLI patch / MCP none change fragment mentioning both
   structured errors and suppression of advisory update notices.

Acceptance: all covered failures produce a single parseable JSON envelope with
the expected stable code and `retryable: false`; stdout stays empty for these
pre-output failures. Help/version exit zero; non-JSON diagnostics remain human
readable. Tests include late-created grouped commands to prove inheritance.

Validation: `bun test src/cli/errors.test.ts src/commands/auth-json.test.ts
src/commands/format-mapped-error.test.ts src/services/update-check-service.test.ts
src/cli/update-check.test.ts`; relevant smoke-script tests;
`bun run typecheck`; changed-file Biome checks; `bun run build`;
`bun run smoke:cli` and `bun run smoke:mcp` (use their isolated unauthenticated
modes if inherited credentials are present); built CLI/MCP smoke because smoke
product validation changes. No authenticated production queries are needed.
Run the full unit suite if practical for the repository review gate.

## Review and completion

Internal pre-flight and one external Claude reviewer per round for plan and
implementation; fix accepted findings, repeat code review until clean or the
three-round limit. Keep this plan through implementation review. Once review is
clean, ensure durable behavior is in implementation docs and delete the plan in
a final commit in this PR. Push and open a draft PR; merging is not authorized.
There is no later phase or reorientation boundary. Record any genuine major
deferral in the backlog; none is currently expected.

Plan pre-flight: direction sound. Accepted the update-notice finding as a
small contract fix (bounded parse failure, triggered by JSON plus a TTY and an
available update; one eligibility condition and focused tests). No infrastructure.

External plan round 1: direction sound; three minor documentation clarifications
accepted and applied (update-check docs/fragment, zero-exit classification and
successful help-command coverage, generic missing-command guidance). Clean.

Implementation evidence: focused suite passed 198 tests; typecheck and build
passed; source CLI unauthenticated, source MCP registration, built CLI
unauthenticated and built MCP registration smoke passed. Internal implementation
pre-flight found no issues. Full unit suite passed: 5793 tests across 238 files, zero failures; external
implementation review pending.

External implementation round 1: direction sound; accepted LOW unknown-help
guidance finding. Root cause: Commander error-help uses one placeholder for
unknown help topics and missing commands. Updated the sole root rendering
branch and its unit assertion; added an exact-envelope process regression for
`help nonexistent --json`. Bounded sibling scan across root errors/tests, CLI
docs, plan and smoke found no other rendering branches. Preserved the existing
Commander `error:` prefix inside JSON messages (acceptable, no change needed).
Internal revised-delta pre-flight clean. Affected tests: 38 passed, zero failed;
rebuild passed; Node CLI smoke rerun pending, then external round 2.
