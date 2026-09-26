# Rename experimental Ask entrypoints to Research

Status: **PHASE COMPLETE — awaiting merge**. Planning baseline: clean
`origin/main` at `27fde598b1eb2f5a4a3718c7c7dc664d9a405a39` on 2026-09-23.

## Objective and decision

The name `ask` suggests a quick lookup, while the experimental tool investigates
indexed public evidence and may take time. Expose `research` as the local MCP
tool and `githits research` as the canonical CLI command. The user explicitly
chose to retain `githits ask` as a CLI alias. The local MCP catalog has only
`research`; it does not retain an `ask` alias. The service, backend route, and
structured response contract continue to use their existing Ask names.

## Verified current state

- `packages/mcp/src/mcp/local-agentic-ask.ts` defines the local MCP descriptor,
  schema, handler, and text output. `local-server.ts` registers `ask` only when
  local experimental tools are enabled. `mcp/instructions.ts` composes the same
  name into the local `quick_start` appendix. Neither the hosted server nor the
  public `@githits/mcp` entrypoints register the experimental tool.
- `src/commands/ask.ts` registers `githits ask`; `src/cli.ts` conditionally adds
  it. `src/services/experimental-cli-policy.ts` recognizes direct experimental
  invocations before startup. `src/shared/command-metadata.ts` uses the canonical
  Commander name for auto-login and JSON auth output. Installed Commander 15 resolves
  an alias invocation to `command.name() === "research"`; the current direct-path
  policy still needs both spellings to catch disabled and malformed-config cases.
- `packages/core-internal/src/services/agentic-ask-service.ts` calls `/ask`.
  The service's `ask()` method and the JSON fields `tool_call_id`, `thread_id`,
  `answer_markdown`, and `sources` are backend contracts. Renaming them would
  require a different cross-repository change and gives no user-facing benefit.
- The local catalog, instructions, CLI gate, smoke runner, focused tests,
  `docs/experimental-tools.md`, and current implementation docs name `ask`.
  Historical plans, changelogs, and evaluation results also mention it; those
  remain historical evidence. The existing agent workloads are worded as user
  questions, so their IDs need not be renamed to exercise the new descriptor.
- Five focused MCP/CLI suites pass at baseline: 48 tests, zero failures.
  No performance path is changing; no benchmark is needed or claimed.

## Scope and boundaries

**In scope:** Rename the local MCP tool and its agent-facing descriptor, schema
prose, and local guide; make `githits research` canonical with `githits ask` as
its only compatibility alias; update client-authored display labels and error
messages, entrypoint-specific internal names, and current documentation;
update tests, smoke assertions, and one changelog fragment.

**Out of scope:** Backend `/ask` and `AgenticAskService` contracts, JSON field
names, request/answer semantics, experimental opt-in, hosted MCP, public
`@githits/mcp` server API, stable guide/public skill, historical records, and
release preparation or deployment. The structured `targetError.message` and
`targetError.hint` are backend-authored; pass them through without rewriting.

**Ownership:** The local MCP descriptor owns its tool name and selection text;
the local composer owns registration and matching local guidance. The CLI
registration owns its canonical command and alias; the CLI policy owns both
direct spellings, while auth/telemetry use Commander's canonical name. The
backend service owns `/ask` and typed response fields. A service-wide rename
would cross the backend boundary without improving this entrypoint change.
The CLI and MCP entrypoint modules naturally own their own Research naming;
the shared `AgenticAskService` and backend-shaped helpers keep Ask names.

```text
local MCP: research -> existing MCP adapter -> AgenticAskService.ask -> /ask
CLI: research (ask alias) -> existing CLI action -> AgenticAskService.ask -> /ask
```

**Compatibility and release:** Enabled local MCP clients must discover and use
`research` after upgrading and restarting their local server; calls to MCP
`ask` then fail as unknown tool. The CLI alias preserves old scripts. No state
migration or rollout flag is needed. If a shipped rename must be reversed, a
subsequent root CLI release restores the prior MCP name; no stored data changes.
Both CLI spellings emit the `command.research` telemetry span after the rename;
queries keyed to `command.ask` would need to use the new span name.
Add a `changes/*.changed.md` fragment with
`githits: minor` for the new canonical command and local MCP name and
`@githits/mcp: none`, since the latter's public entrypoints remain unchanged.
State the telemetry-name migration in that fragment. The release process will
consume it later; this plan does not bump versions or release artifacts.

**Security and failure behavior:** Public-OSS privacy guidance, local opt-in,
auth requirements, error codes, cancellation, and source validation remain
unchanged. CLI-disabled errors name the spelling the caller typed (`research`
or `ask`), with the existing config remedy. Both spellings must fail before
auth/network work when disabled or when direct experimental config is malformed.
Client-authored timeout, protocol, HTTP-status, and unexpected-error prose use
Research; backend-provided target-error prose stays verbatim. Do not add retries,
aliases to MCP, or other fallback machinery.

## Phase map

### Phase 1 — Both enabled surfaces expose Research with a CLI Ask alias

- **Status:** Complete; verification and review passed. Keep this plan until merge.
- **Expected outcome:** The local MCP inventory contains `research` and no
  `ask`; CLI help leads with `research`, and both CLI spellings execute the same
  command. Existing request, answer, and failure semantics still work.
- **Assumptions:** The explicit user decision applies only to the CLI alias;
  the MCP rename is direct because the tool is experimental. Existing backend
  `/ask` remains available. The root artifact owns local experimental tools.
- **Unknowns/product decisions:** None. The requested scope and alias behavior
  are explicit; the observed code and Commander behavior resolve placement.
- **Dependencies:** Current clean branch; no backend or hosted-server work.

Implementation sequence:

1. Change the MCP descriptor name to `research`, update its first selection
   sentence to “Research a public repository or package to answer a question
   with sources.” (74 characters), and replace agent-facing `ask` references
   in its argument prose and local `quick_start` appendix. Update the local
   registration list and `LocalExperimentalToolName` together. Rename the
   local tool adapter module and factory to Research names while retaining
   backend-shaped projection helpers. Keep the stable guide byte-for-byte
   unchanged.
2. Register the CLI command as `research` with `.alias("ask")`. Update root
   help, usage, summary, pre-action validation, experimental command detection,
   auth metadata, spinner key, and client-authored output labels. Rename the CLI
   command module, registration/action/validation functions, and command-level
   types to Research names. Keep one action and one handler path for both
   spellings. Put `research` and `ask` in the experimental direct-command paths,
   with `research` first; register only the canonical command. The disabled
   error echoes the detected path. Retain `ask()`, `AgenticAsk`, and shared
   backend response/error helper names where they describe the backend contract.
   Update client-generated messages in the core service and shared error mapper,
   including status-derived errors; preserve any backend-provided target message.
3. Update exact catalog, first-sentence/first-80, enabled/disabled policy,
   alias, help, auth, text/JSON, client-authored errors, and `quick_start` tests.
   Update MCP smoke calls and expected inventory to `research`; preserve a
   negative assertion for MCP
   `ask`. Keep CLI smoke coverage for both `research` and its alias, including
   disabled and unauthenticated paths. Verify the JSON shape stays identical.
4. Update current `docs/experimental-tools.md` and relevant active sections in
   `docs/implementation/tools.md`, `cli-commands.md`,
   `mcp-tool-annotations.md`, `ask-target-clarification.md`, the current
   catalog wording in `unified-read.md`, and active selection guidance in
   `eval/agentic/README.md`. Make `research` canonical in command examples
   and document the `ask` alias. Leave historical evaluation IDs, prior plans,
   and dated release notes unchanged.
   Add the independent change fragment. Run plugin generation and check, and
   inspect that stable/hosted generated assets do not change.

Verification:

- Focused: `bun test` on the MCP adapter, local server, instructions, CLI
  command/policy/metadata, smoke-script contract, and current docs contracts.
- Required: `bun test`, `bun run build`, `bun run plugins:generate`,
  `bun run plugins:check`, `bun run smoke:mcp`, and `bun run smoke:cli`. The
  smoke suites must pass their unauthenticated cohorts; authenticated live
  requests are additional evidence only when a session is already available.
  Built smoke is required only if launch behavior or CI product validation
  changes beyond the expected tool/command inventory.
- Agent selection: run targeted `bun run agent:e2e` local experimental
  descriptor-only question-only and thread-follow-up workloads, using Claude
  and Codex where practical. Inspect `tool-calls.json` for actual `research`
  selection and arguments, `final.json` for answer/confidence, `metrics.json`
  for call/duration data, and `isolation-violations.json` for trace failures.
  An auth failure is not evidence of successful routing. No broad workload
  sweep or performance comparison is required.

Acceptance criteria:

- With experimental tools enabled, local MCP lists and documents `research`
  exactly once, never registers `ask`, and both text and JSON calls retain the
  existing validated response and source behavior.
- With experimental tools enabled, `githits research` is the primary help
  entry; `githits ask` remains an equivalent alias. Both spellings obey the
  same opt-in, validation, authentication, errors, and output contracts. A
  disabled direct invocation names the spelling typed by the caller.
- With experimental tools disabled, neither CLI spelling nor either MCP name
  is available; the stable/hosted MCP inventory and public guide are unchanged.
- Current documentation and the change fragment explain the rename and the
  CLI-only alias. Required tests, build, plugin check, and smoke pass; targeted
  agent results are reported with their actual limits.

## Reorientation and completion

This is one implementation phase. Before starting it, compare `origin/main`,
the existing fragment set, and affected contracts with this baseline; update
the plan if they changed. After implementation review, record verification and
review findings here and transfer enduring entrypoint and alias details to
`docs/implementation/`. Keep this plan until the increment merges, then delete
it after the permanent docs contain the final behavior. Release, publishing,
and deployment require their separate workflow and authorization.

## Plan review

The internal technical pass found missing current documentation sections;
those are now included and its revised-plan pass was clean. Claude plan round 1
found four gaps: client-authored error text, disabled alias behavior, active
evaluation guidance, and entrypoint identifier placement. The full revised
plan closed all four. Round 2 found only a minor telemetry-name wording gap;
the compatibility and change-fragment instructions now state it. Under the
review rule, round 2 is clean after that wording correction. No production
changes or implementation verification were performed during planning.

## Implementation record (2026-09-23)

- The local MCP inventory registers `research` and omits `ask`. The CLI registers
  `research` with `ask` as a Commander alias. The direct CLI policy recognizes
  both spellings, while auth metadata and telemetry use the canonical name.
  Backend `/ask`, `AgenticAskService.ask`, structured response fields, and
  backend-authored target diagnostics remain unchanged.
- Current experimental-tool and implementation docs, including the unified-read
  compatibility section, describe the new names,
  alias, restart boundary, and telemetry-name change. The release fragment is
  `changes/rename-experimental-research.changed.md` with root minor impact and
  no public `@githits/mcp` package impact. Plugin generation produced no asset
  diff.
- Verification: 318 focused tests passed; `bun run typecheck` passed; all
  4,887 unit tests passed before integration. `bun run build`,
  `bun run plugins:generate`, and `bun run plugins:check` passed. Source CLI
  smoke passed stable and experimental
  live cohorts. Source MCP smoke passed stable and experimental live cohorts,
  including `research` text and thread-follow-up URL JSON calls. Built CLI
  unauthenticated smoke and built MCP registration smoke passed.
- Targeted descriptor-only agent evaluation has limited qualitative evidence.
  Claude failed authentication before tool use. Codex neutral question-only and
  follow-up runs made zero MCP calls; the first also violated isolation by
  reading an external skill. With a GitHits intent prompt, Codex completed
  `quick_start` and `research` calls and returned a high-confidence answer, but
  the harness failed the run for the same external-skill isolation violation.
  That `research` call supplied an explicit `github:openai/codex` target, so it
  does not verify question-only inference. Deterministic tests and live MCP
  smoke cover that behavior; no agent-answer quality claim follows from these
  runs.
- Internal pre-flight found stale active wording in `unified-read.md`, which was
  corrected. The internal code review found no actionable issues. Claude review
  round 1 found one minor Getting started layout issue; the canonical CLI example
  was shortened to align with neighboring help rows, and 85 affected tests plus
  the 35-step source CLI unauthenticated smoke passed. Under the review rule,
  this wording-only round is clean after correction. No code findings remain.
- `origin/main` advanced during review to `c992035898b40396769163863b08139d340f9506`.
  The branch rebased cleanly onto that commit. On the combined tree, all 4,900
  unit tests, build, built CLI/MCP smoke, public-package validation, and plugin
  check passed. The working tree remained clean after the rebase.
