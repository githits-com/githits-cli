# Plan: Reliable `init` install and uninstall state handling

## Overall status

Implementation of Phases 1 and 2, durable documentation, the release
fragment, and full validation are complete. External Claude Opus review and
deletion of this temporary plan remain pending in Phase 3.

## Problem

The original `githits init` and `githits init uninstall` flow inferred Claude
Code MCP state from human-readable CLI output. A Claude wording change caused
two user-visible failures:

- guided setup treated an already-absent user MCP entry as a hard cleanup
  failure and stopped before `claude mcp add`;
- uninstall ran the removal command successfully, then classified the
  post-uninstall probe as inconclusive.

The same reports exposed independent uninstall defects:

- a legitimate `~/.claude/skills/githits-mcp` symlink to the shared
  `~/.agents/skills/githits-mcp` directory caused `rmdir` to return `ENOTDIR`
  after `SKILL.md` was already removed, turning successful file removal into a
  failure and stopping later guidance cleanup;
- already-absent cleanup steps became warnings after another step removed
  something, even though absence was the desired state;
- global guidance results were counted as agents and all missing guidance paths
  were printed individually, producing misleading counts and noisy output;
- guidance cleanup stopped at the first failed target instead of attempting the
  remaining independent targets.

## Expected outcome

User-level Claude Code setup and uninstall determine MCP state from Claude's
documented structured user configuration, never from prose diagnostics. GitHits
continues to use Claude's CLI for every mutation. Setup must not mutate Claude
MCP state when structured inspection is unavailable or malformed.

Uninstall must treat already-absent state as a successful no-op, remove
GitHits-owned guidance through supported symlink layouts, continue across
independent guidance targets, and report agents separately from guidance.

Normal successful output remains concise and audit-friendly. Genuine command,
parse, permission, and verification failures remain visible and keep a nonzero
exit status.

## Verified current state and evidence

1. Claude's former MCP inspection surface was human-readable and offered no
   stable machine-readable contract. The implemented flow avoids that surface
   and reads the documented user configuration instead.
2. Anthropic documents user-scoped MCP servers in the top-level `mcpServers`
   object of `~/.claude.json`. Local verification showed that a non-empty
   `CLAUDE_CONFIG_DIR` moves the file to
   `$CLAUDE_CONFIG_DIR/.claude.json`; an empty value retains the home-directory
   location.
3. A current user-scoped stdio entry written by Claude has structured
   `type`, `command`, and `args` fields. Anthropic documents a missing `type` as
   stdio compatibility behavior, so inspection must accept both omitted and
   explicit `"stdio"` types.
4. `~/.claude.json` is a multipurpose Claude-managed file that can contain
   session state and secret-bearing MCP fields. GitHits must extract only the
   narrow state needed for decisions and must never log, serialize into an
   outcome, or include in trace output the complete document or arbitrary
   server values.
5. Claude exposes structured `plugin list --json` and
   `plugin marketplace list --json`, but GitHits defines no minimum Claude
   version and official upstream reports document invalid or truncated plugin
   JSON in recent releases. Migrating legacy plugin cleanup to those commands
   is therefore not a verified compatibility improvement for this increment
   ([invalid control characters](https://github.com/anthropics/claude-code/issues/60269),
   [truncated output](https://github.com/anthropics/claude-code/issues/67656)).
6. The reported Claude skill directory is a symlink to the shared Agent Skill
   directory, and its `SKILL.md` content matches the packaged GitHits skill.
   Before implementation, `deleteDirIfEmpty` ignored missing/non-empty
   directories but not `ENOTDIR`; it now treats `ENOTDIR` as the same cleanup
   no-op class while preserving other errors.
7. Before implementation, both `executeCliUninstall` and
   `executeCompositeUninstall` turned a later `not_configured` result into a
   warning after an earlier removal. The implemented behavior treats desired
   absence as an unchanged no-op and retains warnings for genuine failures.
8. User-level guidance cleanup receives all agent definitions by design so it
   can remove guidance even when no MCP tool is detected. The implemented
   global cleanup attempts independent targets best-effort, reports failures
   separately, and excludes guidance from agent counts.
9. Targeted baseline validation before planning passed 337 tests across
   `filesystem-service.test.ts`, `setup-handlers.test.ts`, and `init.test.ts`.
   Phase implementation added regressions for the symlink layout, structured
   Claude state, guidance traversal, and compact reporting.

Primary local evidence:

- `src/commands/init/agent-definitions.ts`
- `src/commands/init/setup-handlers.ts`
- `src/commands/init/init.ts`
- `src/services/filesystem-service.ts`
- `docs/implementation/cli-commands.md`
- `docs/implementation/init-setup-output.md`
- `docs/implementation/init-guidance-and-expanded-agent-support.md`

External contract evidence:

- <https://code.claude.com/docs/en/mcp#user-scope>
- <https://code.claude.com/docs/en/settings#settings-files-and-who-they-affect>

## Scope

### Included

- Structured, read-only inspection of Claude's user-scoped `githits` MCP entry.
- `CLAUDE_CONFIG_DIR`-aware path resolution.
- Canonical, non-canonical, absent, and probe-failed Claude state
  classification without exposing unrelated configuration.
- State-dependent execution that skips `claude mcp remove` when the structured
  user entry is absent.
- Pre-mutation blocking when Claude state inspection fails.
- Structured post-setup and post-uninstall verification.
- Symlink-compatible empty-directory cleanup.
- Best-effort global guidance uninstall across independent targets.
- Correct no-op/warning aggregation in CLI and composite uninstall executors.
- Separate agent and guidance accounting plus compact unchanged guidance
  rendering.
- Focused implementation documentation and one root CLI patch fragment.

### Non-goals

- Writing or rewriting `~/.claude.json` directly. Claude remains the only
  writer and backup owner.
- Parsing or exposing Claude sign-in state, project trust state, other MCP
  servers, environment variables, headers, OAuth fields, or plugin data stored
  in the same file.
- Establishing a minimum supported Claude Code version.
- Migrating legacy plugin or marketplace cleanup to their JSON list commands
  until their compatibility floor and valid-output contract are verified.
- Changing direct GitHits init transport: Claude Code remains user-scoped
  stdio, while packaged plugins remain hosted remote MCP.
- Changing project-scoped Claude setup in `.mcp.json`.
- Changing global guidance cleanup into selected-agent-only cleanup. The
  existing `--keep-guidance` opt-out remains the product control.
- Hardening ownership or trust policy for arbitrary skill-directory symlinks.
  This increment covers the verified tool-specific symlink layout and does not
  broaden what files guidance uninstall targets.
- Rolling back successfully installed guidance when MCP setup fails; existing
  resumable partial-progress behavior remains.
- Adding locks, retries, polling, caches, feature flags, or new dependencies.

## Target architecture

### Claude user-state adapter

The focused module under `src/commands/init/` has a deliberately narrow
boundary between three owners:

1. The adapter resolves Claude's user config path with injected filesystem path
   semantics and exposes a pure parser. The parser receives JSON text plus an
   explicitly injected expected invocation and returns only a narrow status:
   `configured`, `non_canonical`, `not_configured`, or `probe_failed`.
2. The generic setup-check dispatcher owns filesystem reads and maps `ENOENT`,
   other IO errors, and parse results into the reusable setup-check contract.
   The adapter does not read Claude's file or classify filesystem errors.
3. Agent definitions own the canonical GitHits invocation and inject it into
   the adapter, keeping GitHits command constants out of the Claude-specific
   parser.

The pure parser fixes the server identity to lowercase `githits` and checks only
that entry's effective stdio type, injected command, and exact injected args.
It ignores unrelated top-level fields, other MCP servers, and extra fields on
the GitHits entry. A structurally valid but non-canonical entry remains
distinguishable from an absent or malformed entry so the dispatcher can make
the later replacement decision.

The adapter never returns raw parsed objects, arbitrary values, or parse input.
Parser diagnostics contain only a bounded reason category such as missing or
invalid structure; the dispatcher owns any resolved-path context.

### Reusable setup-check boundary

Replace the CLI-only setup check assumption with an internal discriminated
setup-check contract:

- command checks retain the existing timeout, isolated-cwd, and result
  evaluator behavior used by Codex, Gemini, Pi, and Amazon Q;
- file checks contain a resolved path and a pure content evaluator.

`CliSetup` uses one optional discriminated check rather than coupled
`checkCommand`/`checkFile` flags. Generic scan, uninstall inspection, and
post-action verification call one check dispatcher. Friendly unchanged rows
describe either `checked via <command>` or the collapsed structured config
path; trace output records the command or path and result category, never file
contents.

CLI commands may declare an optional precondition using the same check
contract. A precondition runs immediately before mutation:

- `configured` means execute the command;
- `not_configured` means record an unchanged/no-op command and skip it;
- `probe_failed`, `disabled`, or another indeterminate state fails safely
  before running the command.

Claude's setup and uninstall `mcp remove` commands use the structured presence
check. This prevents the observed already-absent failure without accepting
arbitrary nonzero exits. Plugin and marketplace cleanup retain their current
compatibility behavior in this increment.

### Mutation and verification flow

```text
resolve Claude config path (adapter)
        |
generic dispatcher reads the resolved file
        |
adapter parses only mcpServers.githits state
        |
        +-- unreadable/invalid --> fail before Claude MCP mutation
        |
        +-- absent -------------> skip remove; run Claude add during setup
        |
        +-- canonical ----------> already configured / removable
        |
        +-- non-canonical ------> remove through Claude CLI; add canonical entry
                                        |
                              reread structured state
                                        |
                              success or sanitized failure
```

No direct config write or health check occurs. A successful Claude mutation is
still verified from persisted structured state.

### Guidance and summary boundaries

- `FileSystemService.deleteDirIfEmpty` owns filesystem path-type cleanup. A
  missing path, non-empty directory, or non-directory/symlink path is a no-op;
  unexpected permission and IO errors still propagate.
- Skill uninstall owns removal of the expected `SKILL.md`; optional parent
  cleanup cannot turn an already-completed file removal into failure merely
  because the parent is a symlink.
- Guidance orchestration attempts every independent verified target, retains
  successful changes, and aggregates sanitized failures for the final error
  result.
- Uninstall executors distinguish desired absence from genuine failure. A
  later absent step does not warn; a hard failure retains current required vs
  best-effort semantics.
- Agent counts include only agent outcomes. Guidance has its own row and error
  detail and still affects the overall exit status. Text output prints changed
  or failed guidance paths and collapses an all-absent result to one unchanged
  guidance row.

## Cross-cutting considerations

### Security and privacy

- Never print or trace `~/.claude.json` contents.
- Tests use sentinel secret values and prove they do not reach outcome messages,
  trace output, or rendered rows.
- Do not include raw `JSON.parse` input in parse errors.
- Mutations continue through Claude's CLI so its backup and write behavior are
  preserved.

### Compatibility

- Preserve omitted `type` as effective stdio according to Claude's documented
  config behavior.
- Preserve non-canonical entry migration and the current exact canonical
  command contract.
- Preserve custom `CLAUDE_CONFIG_DIR`, default home behavior, and platform path
  semantics.
- Preserve all non-Claude command checks and project-scoped setup.
- Do not depend on plugin JSON output or introduce a Claude version gate.

### Performance

This is not an optimization. Structured file reads replace Claude subprocesses
and health checks for MCP inspection, so the normal path should do less work.
No benchmark is required. Tests should assert that Claude MCP inspection no
longer invokes a Claude MCP inspection command.

### Migration and rollback

There is no stored-data migration. Existing canonical and non-canonical Claude
entries are interpreted in place. Reverting the code restores command probes
without changing config format. No feature flag or phased rollout is needed.

### Release impact

This changes the published root CLI only:

```yaml
"githits": patch
"@githits/mcp": none
```

The root CLI change is recorded in
`changes/init-uninstall-reliability.fixed.md`; it does not change the MCP
package. Do not bump package versions or edit `CHANGELOG.md` outside release
preparation.

### Implementation workflow

Use the repository-internal `githits-plugin-maintenance` skill throughout this
increment because direct init behavior is an agent-facing installation surface.
Change canonical inputs only, never generated plugin assets directly; run
`bun run plugins:generate` and `bun run plugins:check` to prove whether generated
outputs remain unchanged.

## Assumptions and unknowns

### Overall assumptions

1. The documented top-level `mcpServers` user entry remains the supported
   persisted user MCP contract even though the surrounding `.claude.json` file
   is Claude-managed.
2. Claude CLI mutation commands honor `CLAUDE_CONFIG_DIR` consistently with the
   verified read location.
3. Exact lowercase `githits` remains the server identity used by GitHits and
   Claude CLI commands.
4. Global guidance cleanup remains independent of the selected MCP tools.

### Overall unknowns or product decisions

No unresolved product decisions block the remaining review.
Plugin JSON compatibility remains outside this plan.

## Phase map

| Phase | Status | Expected outcome |
|---|---|---|
| 1. Structured Claude MCP lifecycle | Complete | Claude setup, detection, and uninstall use structured user state and fail safely before mutation when that state is unavailable. |
| 2. Uninstall cleanup and reporting | Complete | Symlinked guidance removes cleanly, all guidance targets are attempted, absence is not warned, and summaries distinguish agents from guidance. |
| 3. Completion and durable handoff | In progress | Durable documentation, release metadata, and validation evidence are complete; external Claude Opus review and temporary-plan cleanup remain. |

## Phase 1: Structured Claude MCP lifecycle

### Status

Complete. Structured Claude inspection, generic file checks, preconditions,
safe setup blocking, and lifecycle regressions are implemented. External review
remains in Phase 3.

### Expected outcome

The implemented Claude setup detects an absent entry before cleanup and skips
`claude mcp remove`. The implemented uninstall verifies absence structurally,
and Claude prose changes cannot affect MCP state classification.

### Assumptions

- The documented and locally verified Claude user config shape is the correct
  read boundary.
- Existing command-check behavior for other agents remains unchanged.

### Unknowns or product decisions

None.

### Dependencies

- Existing `FileSystemService`, `ExecService`, setup result types, and agent
  definition scan flow.
- The agent-definition-owned canonical GitHits invocation, injected into the
  pure adapter parser.

### Implemented files

- new `src/commands/init/claude-user-config.ts`
- new `src/commands/init/claude-user-config.test.ts`
- `src/commands/init/agent-definitions.ts`
- `src/commands/init/agent-definitions.test.ts`
- `src/commands/init/setup-handlers.ts`
- `src/commands/init/setup-handlers.test.ts`
- `src/commands/init/init.ts`
- `src/commands/init/init.test.ts`
- Trace coverage is in `src/commands/init/setup-handlers.test.ts` alongside
  the unified check dispatcher tests.

### Completed implementation steps

1. Added pure-parser and path-resolution tests covering default home,
   non-empty `CLAUDE_CONFIG_DIR`, empty-variable fallback, POSIX and Windows
   joining, malformed JSON, invalid root/`mcpServers` shapes, canonical entries,
   omitted stdio type, non-canonical entries, unrelated servers, alternate
   injected invocations, and secret-bearing extra fields. File absence and IO
   classification belong to the generic dispatcher, not these adapter tests.
2. Implemented the narrow Claude user-config adapter. Path resolution remains
   filesystem-injected but read-free; the expected invocation is an explicit
   parser input and the adapter returns status and sanitized reason only.
3. Introduced the discriminated command/file setup-check contract and one
   dispatcher. It owns file reads, ENOENT/other IO classification, and the
   adapter parser call. Existing command checks were migrated mechanically
   without changing their evaluators or output.
4. Updated CLI check-detail rendering, uninstall inspection, and trace metadata
   to support file checks without content disclosure.
5. Added the optional command precondition to setup and uninstall execution.
   Executed and skipped change rows are preserved, and an indeterminate
   precondition stops before mutation.
6. Replaced Claude's prose-based inspection with the structured canonical check and
   attached the structured presence precondition to both user-scope removal
   commands. The obsolete Claude prose evaluator and Claude-specific probe
   timeout/temp-cwd behavior were removed. The Claude-only prose absence pattern
   was removed from `ALREADY_ABSENT_PATTERNS`; generic plugin, extension,
   marketplace, Pi, and other cleanup patterns remain.
7. Made `executeAgentSetupWithVerification` reject an initial `probe_failed`
   state before running setup commands; intentional non-canonical migration is
   preserved.
8. Added orchestration regressions for the exact reported sequence: absent MCP
   state skips remove and reaches add; canonical state is unchanged;
   non-canonical state removes then adds; malformed/unreadable state runs no MCP
   mutation; setup and uninstall post-verification reread structured state; no
   path invokes a Claude MCP inspection command.
9. Re-read all other command-check definitions and call sites to confirm the
   mechanical contract migration did not change Codex, Gemini, Pi, or Amazon Q
   behavior.

### Edge cases and failure behavior

- `ENOENT` for the config file or absent `mcpServers.githits` is definitive
  absence.
- Malformed JSON, non-object root, or non-object `mcpServers` is
  `probe_failed`, not absence.
- Extra fields and secret-bearing values are ignored and never surfaced.
- An existing valid entry with the wrong transport, command, or arguments is
  non-canonical and remains eligible for replacement.
- A remove/add command that fails after a positive structured precondition is
  a genuine command failure; do not add retries or infer success from prose.
- A state change by another process between the check and command is not given
  a lock or fallback in this increment; no such concurrent-write contract is
  documented or observed.

### Targeted phase verification

The targeted phase verification was:

```text
bun test src/commands/init/claude-user-config.test.ts
bun test src/commands/init/agent-definitions.test.ts
bun test src/commands/init/setup-handlers.test.ts
bun test src/commands/init/init.test.ts
bun run typecheck
```

Use a disposable `HOME` and `CLAUDE_CONFIG_DIR` with the locally installed
Claude CLI to validate an actual absent -> add -> configured -> uninstall ->
absent cycle. Print only status, selected non-secret command/argument fields,
and command exit results; never print the complete config file.

### Completed documentation updates

- Updated `docs/implementation/cli-commands.md` to replace Claude's read-only CLI
  probe description with structured user-config inspection and clarify that
  Claude still owns mutations.
- Updated `docs/implementation/init-setup-output.md` for file-backed check detail
  on a CLI-configured agent.

### Acceptance criteria

- Exact reported Claude absence wording is irrelevant because no MCP prose is
  parsed.
- Absent setup reaches `claude mcp add` without running `claude mcp remove`.
- Uninstall post-verification recognizes persisted absence.
- Invalid or unreadable Claude config causes no Claude MCP mutation.
- Canonical and non-canonical behavior matches the existing documented
  contract.
- No sensitive Claude config value appears in output or trace tests.
- Other agent checks retain their existing behavior and targeted tests pass.

## Phase 2: Uninstall cleanup and reporting

### Status

Complete. Symlink-compatible cleanup, absence-vs-failure aggregation,
best-effort guidance traversal, and guidance-owned reporting are implemented.
External review remains in Phase 3.

### Expected outcome

The implemented cleanup handles the reported symlink layout without error;
one target failure does not prevent later independent guidance cleanup, desired
absence is quiet, and final counts/headlines accurately describe agent and
guidance outcomes.

### Assumptions

- Removing the expected `SKILL.md` through a tool-specific directory symlink to
  the shared skill directory is valid existing behavior.
- The symlink itself is not owned by GitHits and must remain untouched.

### Unknowns or product decisions

None.

### Dependencies

- Phase 1's unified setup/uninstall check and result behavior.
- Existing guidance target enumeration and `--keep-guidance` semantics.

### Implemented files

- `src/services/filesystem-service.ts`
- `src/services/filesystem-service.test.ts`
- `src/commands/init/setup-handlers.ts`
- `src/commands/init/setup-handlers.test.ts`
- `src/commands/init/init.ts`
- `src/commands/init/init.test.ts`
- `docs/implementation/init-setup-output.md`
- `docs/implementation/init-guidance-and-expanded-agent-support.md`

### Completed implementation steps

1. Added a POSIX-only real-filesystem regression with a skill directory symlink.
   It is guarded on Windows, where creating symlinks may require privileges and
   `rmdir` path behavior differs. The regression proves that `SKILL.md` is
   removed through the symlink, the symlink remains, and optional parent
   cleanup does not fail.
2. Updated `deleteDirIfEmpty` to treat `ENOTDIR` as the same cleanup no-op class
   as missing or non-empty paths. Permission and other unexpected IO errors
   still propagate.
3. Changed CLI and composite uninstall aggregation so `not_configured` after a
   removal remains an unchanged change without a warning. Warnings for genuine
   later hard failures and required/best-effort behavior remain unchanged.
   Claude and Pi sibling tests were scanned and updated for the same invariant.
4. Made guidance uninstall continue after individual target failures,
   preserving successful/unchanged changes and collecting sanitized failure
   details for the final result and exit status.
5. Separated MCP agent counts from the guidance outcome. Guidance still affects
   the overall success/error headline and exit status but is never called an
   agent in counts.
6. Compacted text rendering: show changed and failed guidance paths; when every
   target is absent, print one unchanged guidance row rather than every verified
   path. The global cleanup attempt set remains complete internally.
7. Added summary matrices for agent-only, guidance-only, mixed, absent, and
   failure outcomes, including the two supplied report shapes.
8. Re-read project uninstall output to ensure user-level changes did not alter
   its separate file-based reporting path.

### Edge cases and failure behavior

- A symlink parent returning `ENOTDIR` is not deleted and is not reported as a
  failure.
- A permission or IO error deleting `SKILL.md` remains a failure, but later
  independent guidance targets are still attempted.
- A hard cleanup command failure after an earlier removal remains a warning or
  failure according to the existing step's failure mode.
- When only guidance is removed, the completion headline must not claim an MCP
  server was removed.
- When guidance alone fails, the summary must not claim an agent failed.
- `--keep-guidance` bypasses guidance reads and writes exactly as today.

### Targeted phase verification

The targeted phase verification was:

```text
bun test src/services/filesystem-service.test.ts
bun test src/commands/init/setup-handlers.test.ts
bun test src/commands/init/init.test.ts
bun run typecheck
```

### Completed documentation updates

- Documented absence-vs-failure warning semantics and compact global guidance
  reporting in `docs/implementation/init-setup-output.md`.
- Documented symlink-compatible skill cleanup and best-effort target traversal in
  `docs/implementation/init-guidance-and-expanded-agent-support.md`.

### Acceptance criteria

- The reported symlink layout completes guidance uninstall without `ENOTDIR`.
- All verified guidance targets are attempted despite one target failure.
- Already-absent Claude/plugin/marketplace and Pi cleanup steps do not warn.
- Genuine hard failures remain visible.
- Agent counts exclude guidance, and guidance-only headlines are accurate.
- All-absent guidance output is one concise row rather than a path dump.
- User-level and project-level uninstall regression tests pass.

## Phase 3: Completion and durable handoff

### Status

In progress. Implementation, durable documentation/release metadata, and full
validation are complete; external Claude Opus review and temporary-plan
deletion remain.

### Expected outcome

The full increment is validated, reviewed, documented durably, and ready for a
draft PR without leaving a stale plan.

### Assumptions

- Phases 1 and 2 remain one root CLI patch increment.

### Unknowns or product decisions

None currently. Add tactical detail only after reorientation against the
implemented Phase 2 delta.

### Dependencies

- Phases 1 and 2 accepted and merged into the working increment.
- Durable implementation documentation accurately reflects final behavior.

### Validation evidence

The required validation passed. `bun run plugins:generate` and
`bun run plugins:check` were clean, with generated assets unchanged. The full
test suite passed with 3141 tests passing and 0 failing. `bun run typecheck`,
`bun run format:check`, `bun run lint`, `bun run build`, and
`bun run validate:packages` all passed.

The first parallel smoke attempt was invalidated: package validation replaced
shared `dist` output while concurrent live corpora requests hit
`RATE_LIMITED`. The smoke suites were then rerun serially and
`bun run smoke:cli` plus `bun run smoke:mcp` passed. After rebuilding,
`bun run smoke:cli:built` and `bun run smoke:mcp:built` also passed when run
sequentially.

The disposable Claude CLI 2.1.245 lifecycle passed with isolated `HOME` and
`CLAUDE_CONFIG_DIR`: absent state, install, canonical `npx` invocation,
uninstall, and absent state again. The real config was not read or printed.

The targeted Claude skills `agent:e2e` workload was attempted with disposable
home/config isolation. It exited 1 before tool execution because Claude was
unauthenticated (`apiKeySource: none` and no tool calls); isolation was not
weakened.

### Remaining review and cleanup

- External Claude Opus review remains.
- Delete this temporary plan after review confirms all durable information is
  transferred.

### Acceptance criteria

- One valid `changes/*.fixed.md` fragment records `githits: patch` and
  `@githits/mcp: none`.
- `bun run plugins:generate` produces only explained output; generated assets
  remain unchanged unless canonical inputs require a change.
- Required validation passed; external review remains before final handoff.
- Durable behavior is captured in `docs/implementation/`.
- This temporary plan is deleted after implementation review and before final
  handoff, once all durable information has been transferred.

## Full validation evidence

The validation command set was:

```text
bun run plugins:generate
bun run plugins:check
bun test
bun run typecheck
bun run format:check
bun run lint
bun run build
bun run validate:packages
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
```

The disposable real-Claude lifecycle described in Phase 1 was run against
`dist/cli.js`. The targeted Claude onboarding workload was also attempted only
with disposable `HOME` and `CLAUDE_CONFIG_DIR`; its unauthenticated limitation
is recorded above.

```text
bun run agent:e2e --agent claude --surface skills --server local \
  --workload eval/agentic/workloads/githits-onboarding.md
```

Do not expose or inject credentials into logs. If the isolated qualitative
workload cannot authenticate without broadening credential access, record that
limitation and rely on deterministic setup tests plus the disposable Claude CLI
lifecycle; do not weaken isolation.

## Phase-boundary reorientation

After each implementation phase and before detailing or starting the next:

1. Run `$next-steps` against current `origin/main` and the complete phase delta.
2. Record actual outcomes and validation evidence in this plan.
3. Recheck the structured Claude contract, affected call sites, documentation,
   release impact, and changed-line size.
4. Resolve new contradictions or product decisions before proceeding.
5. Add tactical detail only for the next one or two phases.

Stop and replan if implementation friction requires Claude-specific conditionals
through multiple orchestration layers, introduces a new compatibility fallback,
or approaches the repository's 1.5-2k implementation-line threshold. The
Claude adapter owns Claude state; generic setup handlers own check execution;
the init command owns sequencing and user output.

## Completion and plan cleanup

The implementation and validation portions are complete. The overall effort
is complete when the observed install and uninstall reports pass as
regressions, external Claude Opus review has no unresolved valid findings, and
this plan is deleted after its durable information is transferred.

Keep this plan through implementation review. Then transfer every durable
contract and operational detail to `docs/implementation/`, delete this plan,
and ensure the final draft PR contains no stale planning artifact.
