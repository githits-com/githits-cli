# Plan: Local experimental tools and agent dogfooding

> Overall status: ready for implementation. The existing `resolve` and
> `code diff` CLI dogfood contracts are merged and released. This plan replaces
> their deferred direct-to-GA MCP rollout with a reusable local experimental
> surface.
>
> Reoriented: 2026-08-18 against `origin/main` at `3540f1f` (`githits`
> `0.9.3`, `@githits/mcp` `0.9.2`).

## Problem and expected outcome

GitHits currently has two deliberately unpromoted CLI commands:
`githits resolve` and `githits code diff`. Keeping them out of MCP prevents
agents from exercising their primary intended use, so shortcomings in schemas,
descriptions, output, and multi-tool workflows are found too late.

The completed effort provides a long-lived local experimental-tool mechanism:

- a host-wide config opt-in enables the current experimental CLI commands and
  local MCP tools;
- stable CLI commands/help remain unchanged by default while the two
  experimental CLI entries become hidden; the stable MCP tool inventory and
  MCP instructions remain byte-for-byte unchanged;
- local MCP exposes agent-quality `resolve_target` and `code_diff` tools when
  enabled, without changing hosted/remote MCP;
- an optional instruction policy asks agents to report concrete problems with
  experimental tools or all GitHits tools through the existing `feedback` tool;
- isolated agent evals can enable the experimental MCP surface without editing
  the user's host config; and
- individual tools can later graduate or be removed without replacing the
  general opt-in.

This is an incubation surface, not a weaker implementation tier. Experimental
tools still require complete schemas, bounded output, typed errors, tests,
smoke coverage, and durable usage guidance.

## Verified current state and evidence

- `origin/main` and the current branch both point to `3540f1f`; the worktree was
  clean before this plan update.
- `githits resolve` is registered at the root and is advertised in root help.
  It uses `ResolveTargetService`, shared request normalization, a stable compact
  JSON projection, and a CLI-specific terminal formatter. It has no MCP tool.
- `githits code diff` is registered under `code` and is described in the code
  group help. Its released service adapter supports inventory, stats, and patch
  selections; its shared request/response/text helpers preserve exact resolved
  identities, package/repository scope, inventory completeness, content
  coverage, omissions, path safety, and bounded output. It has no MCP tool.
- The public `McpToolServices` interface intentionally contains only
  `GitHitsService`, `CodeNavigationService`, and `PackageIntelligenceService`.
  It does not require `ResolveTargetService` or `CodeDiffService`.
- `packages/mcp/src/mcp/server.ts` has one unconditional list of 15 stable tool
  factories. `createMcpServer`, `registerMcpTools`,
  `getMcpToolDescriptors`, `EXPECTED_MCP_TOOLS`, public-package validation, and
  the hosted MCP integration all assume that stable inventory.
- `buildMcpInstructions()` is a stable public composer whose package/code tool
  bullets are tested against the registered stable tool set. Local CLI startup
  currently calls the same public `createMcpServer()` as remote integrations.
- The root dependency container already constructs both experimental services:
  `resolveTargetService` separately and `codeNavigationService` intersected with
  `CodeDiffService`. The public MCP service interface should not be widened to
  satisfy local-only tools.
- `~/.config/githits/config.toml` (or the platform-equivalent path) currently
  owns `auth.storage`. Parsing lives in `src/services/auth-config.ts`, uses
  `FileSystemService`, accepts additive unknown fields, and supports the legacy
  macOS config path. There is no general experimental config reader.
- The agentic eval harness starts local MCP from the checkout and persists the
  exact Claude, Codex, and OpenCode MCP configs. Its reporting contract already
  captures `toolIssues` and `instructionIssues`; it does not yet have workloads
  for resolution or source diff and has no experimental-server switch.
- The existing `feedback` MCP tool accepts generic negative feedback with
  `accepted: false`, `feedback_text`, and `tool_name`. No new reporting API,
  queue, telemetry event, or storage mechanism is needed.
- Generated plugin/extension transports use hosted remote MCP. Direct init uses
  local stdio for supported hosts, but the generated host configs need no
  experimental field because the local process reads the global GitHits config.

### Reorientation contradictions and resolutions

1. The previous CodeDiff plan made Phase 3 a public MCP/agent rollout after CLI
   dogfooding. The 2026-08-18 product decision instead requires a reusable,
   opt-in experimental stage. This plan supersedes that Phase 3.
2. Existing durable CLI docs and smoke tests describe and advertise `resolve`
   and `code diff` as normally available silent-dogfood commands. The new
   decision gates their CLI availability and documentation examples behind the
   same experimental config; those baselines must be updated.
3. A feedback-reporting setting can change instructions even if tool exposure
   is disabled. To preserve the stated invariant, the reporting policy is
   active only when experimental tools are enabled. With experimental tools
   disabled, local MCP uses the exact stable instruction composer regardless of
   a dormant reporting value.

## Scope

### In scope

- A reusable, host-wide experimental settings section in GitHits' existing
  platform config file.
- Config-gated CLI registration/help/execution for the currently experimental
  `resolve` and `code diff` commands.
- Local-stdio-only registration of `resolve_target` and `code_diff`.
- Experimental-only server instructions and tool descriptions designed for
  actual agent decision-making.
- Optional agent instructions to report distinct tool defects through the
  existing `feedback` tool.
- A session-only local MCP override used by the eval harness.
- CLI/MCP parity tests, stable-baseline invariants, smoke tests, package-boundary
  checks, two targeted workloads, and qualitative Claude/Codex evaluation.
- Durable config, CLI, MCP tool, CodeDiff, and eval-harness documentation.

### Non-goals

- Enabling experimental tools on hosted/remote MCP, generated remote plugin
  transports, public Agent Skills, or shared `AGENTS.md` guidance.
- Publishing experimental service requirements through public
  `McpToolServices` or changing stable public descriptor/smoke inventories.
- Automatically sending feedback, recording prompts/tool bodies, adding a
  feedback queue, retrying failed feedback, or adding telemetry infrastructure.
- Per-tool user config flags in this increment. The membership list is owned by
  the release and may change; the user controls one long-lived suite flag.
- Compatibility, semantic-version, safety, rename, or merge-base conclusions
  from raw CodeDiff evidence.
- Local/private repository, working-tree, staged, arbitrary Git-host, or
  unbounded diff support.
- Promoting either tool to GA. Graduation is a later per-tool decision based on
  dogfood evidence.
- Typed changelog-to-diff steering; it remains dependent on a committed backend
  action contract and a stable diff invocation.

## Target architecture and contracts

### User configuration

The canonical host-wide opt-in is:

```toml
[experimental]
tools = true
report_tool_issues = "experimental"
```

- `experimental.tools` is a strict boolean and defaults to `false` when absent.
- `experimental.report_tool_issues` is optional. Accepted values are
  `"experimental"` and `"all"`; omission means off.
- The reporting value is dormant while `tools` is false. It does not alter
  instructions or cause side effects by itself. The value must still be one of
  the accepted enum values: invalid reporting config is rejected on strict
  config-consuming invocations even when `tools` is false.
- Unknown config keys remain tolerated for forward compatibility. Invalid TOML,
  invalid types, and invalid reporting values produce a path-qualified config
  error on invocations that consume the setting.
- Existing `auth.storage` environment precedence and legacy macOS config lookup
  remain unchanged. A shared config reader prevents auth and experimental
  parsing from diverging.
- No command writes this file in this increment. Documentation gives the exact
  platform path and snippet; users edit it deliberately.

### Surface policy

One normalized local policy drives CLI and local MCP behavior:

```text
config.toml
  -> experimental tools enabled?
      false -> stable CLI surface + stable local MCP tools/instructions
      true  -> stable surface + current experimental CLI/MCP tools
                -> report issues: off | experimental | all
```

The current experimental membership is data, not control flow duplicated across
help, registration, and instructions:

- CLI: `resolve`, `code diff`
- MCP: `resolve_target`, `code_diff`

Graduating `code_diff` before `resolve_target` means moving only `code_diff`
from the experimental factory/instruction inventory to the stable inventory and
removing it from the experimental membership tests. The global config schema
does not change.

### CLI gating and recovery

- With valid config and `tools = true`, root/code help and direct execution show
  and run both experimental commands.
- With absent config, `tools = false`, or an omitted experimental section, root
  and code help do not advertise them. Explicit invocation fails before auth or
  network work with a concise message naming the config path and enable snippet;
  it must not degrade to an unexplained Commander `unknown command` error.
- Stable `code files`, `code read`, and `code grep` remain usable regardless of
  the experimental setting.
- `--help`, `--version`, `doctor`, `logout`, and auth cleanup remain available
  when the config is malformed. Help falls back to the stable surface and does
  not claim experimental tools are enabled; `doctor` remains the diagnostic
  path. Executing an experimental command or starting local MCP consumes the
  setting strictly and reports the config error.
- Root getting-started text and code-group descriptions are composed from the
  same resolved policy so hidden commands are not mentioned indirectly.

### Local versus public MCP boundary

- Public `createMcpServer()`, `registerMcpTools()`,
  `getMcpToolDescriptors()`, `McpToolServices`, `buildMcpInstructions()`,
  `EXPECTED_MCP_TOOLS`, and hosted remote behavior remain stable and unchanged.
- A workspace-internal local server composer reuses the stable factories and
  adds experimental factories only when enabled. Its dependency shape extends
  the stable services with `ResolveTargetService` and `CodeDiffService` without
  exporting those requirements from `@githits/mcp`.
- `src/commands/mcp.ts` is the only production entry point that supplies the
  local policy and experimental services. No generated remote transport opts
  in.
- Experimental tool modules may live with the MCP tool adapters for reuse and
  testing, but are exported only through the workspace-only internal boundary.
  Public package validation must prove they are unreachable through supported
  `@githits/mcp` exports.
- A hidden local `githits mcp start --experimental-tools` override enables the
  suite for that server process only. It exists for isolated eval/development
  runs, is omitted from normal CLI help, does not mutate config, and is not a
  second supported beta-user opt-in path. Published-server evals reject or omit
  it. Normal host dogfooding uses `config.toml`.

### Stable-instruction invariant

- Disabled/default local startup calls the existing stable instruction composer
  with no experimental options. Tests compare the resulting string exactly to
  `buildMcpInstructions()` and compare the registered names exactly to the
  stable descriptors.
- Experimental instructions are an additive section composed only for the
  local experimental server. Stable blocks and stable per-tool descriptions are
  not rewritten as a side effect of enabling the suite.
- A dormant `report_tool_issues` value with `tools = false` does not change the
  server instruction string.

### `resolve_target` agent contract

- Use when a user supplied a fuzzy, ambiguous, misspelled, or human-friendly
  dependency/repository name and a canonical `registry:name` or
  `github:owner/repo` target is needed for follow-up tools. Do not call it for an
  already canonical target.
- Inputs mirror the exercised request contract with MCP-native names: required
  `name`; optional `query`, registry list, preferred kind, intent hints, limit,
  and `format` (`text-v1` default, `json` for exact fields).
- Empty strings/arrays and explicit false-like values are normalized or rejected
  deliberately by the shared builder; raw Zod errors do not escape.
- The service request selects detailed ranking fields only for JSON. Compact
  text shows ranked candidates, ambiguity, protected exact-name matches, cheap
  evidence, and an MCP-native follow-up. An ambiguous result never tells the
  agent to select candidate one automatically.
- Descriptions state that query and intent hints leave the machine and must not
  contain credentials, personal data, private code, or proprietary content.
- No-candidate and ambiguous results remain successful evidence envelopes; the
  text tells the agent whether human judgment or a changed query is required.
  Transport/auth/service failures use the established structured MCP errors.

### `code_diff` agent contract

- Use for exact source changes between two explicit package versions or public
  GitHub refs, especially when a changelog is missing/insufficient or the user
  asks what code changed. Do not infer compatibility or upgrade safety from raw
  diffs alone.
- The target is one union-shaped argument: an unversioned compact target or an
  exact package/repository object. `from` and `to` are separate required fields,
  avoiding CLI range parsing and coupled optional addressing flags.
- Optional inputs are `view`, `path_glob`, `max_files`,
  `max_patch_bytes`, and `format`. The initial MCP default view is
  `name-status`, a bounded inventory projection; instructions steer agents to
  `stat` for magnitude and scoped `patch` only when content is needed.
- `name-only` and `name-status` fetch inventory only, `stat` fetches stats only,
  and `patch` fetches patches. Wire-selection regression tests prove that view
  changes do not over-fetch.
- Text output is MCP-native and compact. It carries exact resolved endpoints,
  scope/completeness warnings, primary file evidence, and a precise next action.
  It must not reuse CLI-only flags in hints. JSON reuses the released data-first
  envelope and preserves exact identity, summary, scope, coverage, per-file
  safety/omission status, and `hasMoreFiles`.
- Unsafe or incomplete patch evidence is not presented as fully applicable.
  Authoritative inventory with partial/failed content remains a successful
  result with explicit warnings; root resolution/inventory/service errors are
  structured MCP errors. Empty and identical diffs succeed.

### Opt-in issue reporting

The instruction-only policy uses the existing `feedback` tool:

- `experimental`: report distinct defects observed in `resolve_target` or
  `code_diff` only.
- `all`: report distinct defects observed in any GitHits tool while the
  experimental suite is active.
- off: retain existing feedback guidance only.

When active, instructions ask the agent to submit one concise negative feedback
item per distinct concrete issue, with `accepted: false`, the exact
`tool_name`, and redacted expected-versus-observed context or stable error code.
They prohibit credentials, personal data, private/proprietary content, full file
bodies, and large tool outputs. Agents do not report mere empty-but-valid
results, expected bounded truncation, or a user decision as a defect. A failed
feedback call is not retried or recursively reported. No additional
issue-reporting feedback is prompted without an observed issue and the explicit
config opt-in; the existing general feedback tool behavior remains available.

## Overall assumptions and unknowns

### Assumptions

1. Host-wide config is the canonical beta/dogfood opt-in; all local agents that
   launch `githits mcp start` on the host should inherit it.
2. The eval-only server flag is acceptable because the user explicitly allowed
   a separate flag for eval isolation; it does not replace the host config.
3. Existing released CLI request/JSON contracts are the starting truth for MCP;
   experimental adaptation should change agent-specific defaults and text hints,
   not fork service semantics.
4. `name-status` is the safest initial CodeDiff MCP default because it is
   inventory-only and bounded. Agent eval evidence may change this while the
   tool remains experimental.
5. Existing generic feedback storage is sufficient for tool dogfooding; issue
   routing uses `tool_name` and structured concise text rather than a new API.

### Unknowns and decisions to resolve from evidence

- Whether agents reliably call `resolve_target` only for ambiguous names and
  carry canonical targets into follow-up tools. Resolve through the targeted
  workload before either tool graduates.
- Whether `name-status` plus instructions leads agents to request `stat` or
  scoped `patch` efficiently, or creates unnecessary extra calls. Resolve from
  raw Claude/Codex tool traces and output size observations during this phase.
- Whether opt-in issue-report instructions cause useful, non-duplicative
  `feedback` calls rather than noise. Validate first with controlled mocked or
  deliberately failing eval cases; do not enable reporting in ordinary evals
  that would submit synthetic feedback.
- Whether either tool should graduate independently. This is explicitly a later
  product decision based on accumulated dogfood evidence, not a blocker for the
  experimental phase.

There are no blocking product decisions for the next implementation phase.

## Cross-cutting considerations

### Security and privacy

- No credential value is read into logs, fixtures, plan text, eval artifacts, or
  feedback. Existing auth and token-provider paths remain unchanged.
- Resolve ranking context and feedback text are outbound data. Descriptions and
  opt-in instructions prohibit secrets, personal data, private code, and
  proprietary content.
- CodeDiff remains public-package/public-GitHub only. Paths and backend text use
  existing sanitization/content-safety projections. Experimental instructions
  never encourage local/private targets.
- Eval metadata retains existing secret redaction. The harness override is a
  boolean command argument, not a credential or copied host config.

### Performance and data fetching

- No optimization claim is made and no benchmark-driven optimization is in
  scope. Existing mode-minimal CodeDiff wire behavior is a functional contract,
  not a new performance project.
- Resolve detailed fields remain JSON-only. CodeDiff inventory/stats/patch
  selections follow the requested view exactly. Omitted bounds remain omitted
  rather than pinning new client defaults.
- No local Git checkout, fallback compare API, cache, queue, polling, or
  background reporting is introduced.

### Compatibility, migration, and rollback

- Default/absent config preserves the exact stable MCP baseline and every
  non-experimental CLI command/help entry. The two dogfood CLI commands become
  unavailable and unadvertised as explicitly requested.
- Existing users who deliberately used the CLI dogfood commands must add the
  config snippet. Durable docs and the disabled-command error provide the
  migration path.
- Removing or graduating an experimental tool requires no user config migration;
  suite membership changes with the release.
- Rollback is disabling `experimental.tools` or removing the section. No stored
  data cleanup is required.
- The implementation adds a new root `githits` feature and changes access to
  the existing dogfood commands, so it requires a root minor fragment.
  `@githits/mcp` remains `none` if all new registration,
  dependencies, instructions, schemas, and exports remain workspace-internal
  and the public/remote package contract is byte-for-byte stable. Reassess the
  fragment if implementation requires any supported public MCP API change.

### Documentation and packaging

- Update `docs/implementation/config.md` with schema, defaults, platform paths,
  invalid-value behavior, and the eval-only override distinction.
- Update `docs/implementation/cli-commands.md` so `resolve` and `code diff` are
  documented as config-gated experimental commands rather than default CLI.
- Update `docs/implementation/tools.md` and
  `docs/implementation/code-diff.md` with local experimental MCP contracts and
  an explicit hosted/remote exclusion.
- Update `eval/agentic/README.md` with experimental runs, workloads, artifact
  inspection, and the rule against sending synthetic feedback.
- Do not modify root Agent Skills, `AGENTS.md`, hosted transport metadata, or
  generated plugin manifests. Run generation/checks and inspect that no
  unexplained generated diff appears.

## Phase map

| Phase | Status | Expected outcome |
|---|---|---|
| 1. CodeDiff transport adapter | Complete and released | Exact-tree service contract with mode-minimal selections and typed results/errors |
| 2. Resolve and CodeDiff CLI dogfood | Complete and released | Exercised CLI requests, JSON projections, terminal UX, smoke coverage, and durable docs |
| 3. Local experimental tools | Ready | Config-gated CLI plus local-only `resolve_target`/`code_diff`, optional issue reporting, smoke/eval coverage, unchanged stable/remote baseline |
| 4. Per-tool graduation | Pending evidence | Independently promote, revise, retain, or remove each experimental tool without changing the suite flag |
| 5. Changelog steering | Blocked on backend contract and stable diff invocation | Typed sparse-changelog actions mapped to the active stable invocation |

## Phase 1: CodeDiff transport adapter

**Status:** complete and released.

**Expected outcome:** transport-neutral exact-tree inventory, stats, and patch
requests with runtime validation and typed errors.

**Assumptions:** the committed exact-tree backend contract is authoritative.

**Unknowns/product decisions:** none remaining.

**Dependencies:** completed backend CodeDiff schema.

**Acceptance/observed outcome:** mode-minimal variables/selections, public
client exports, fixtures, package validation, and durable documentation shipped
without a user tool.

## Phase 2: Resolve and CodeDiff CLI dogfood

**Status:** complete and released in `githits` `0.9.3` or earlier.

**Expected outcome:** deliberate CLI users can exercise stable request and
result projections before agent exposure.

**Assumptions:** silent CLI registration was sufficient for initial human
dogfooding.

**Unknowns/product decisions:** resolved by the new decision to gate both CLI
commands behind the experimental suite.

**Dependencies:** Phase 1 plus the separately released target-resolution
service and request/result helpers.

**Acceptance/observed outcome:** `resolve` and `code diff` have focused unit
tests, CLI smoke, structured JSON, terminal formatting, auth/error handling,
and permanent implementation docs. CodeDiff live package smoke and patch-header
corrections shipped. Neither command has an MCP adapter.

## Phase 3: Local experimental tools

**Status:** ready for implementation.

**Expected outcome:** one explicit host config enables both experimental CLI and
local MCP surfaces; optional reporting improves dogfooding; stable/remote
surfaces remain unchanged; targeted real-agent runs produce inspectable evidence.

**Assumptions:** the overall assumptions above hold; the existing service and
JSON projections need no backend redesign.

**Unknowns/product decisions:** none blocking implementation. Default-view,
tool-selection, and reporting quality are empirical questions to record from
evals, not reasons to defer the experimental surface.

**Dependencies:** released CLI/service contracts; existing config path and
filesystem abstraction; local MCP internal boundary; feedback tool; smoke and
agent-eval harnesses.

### Likely files and components

- `src/services/` config parser/loader modules and focused tests, refactoring
  `auth-config.ts` only as needed to share file discovery/parsing;
- `src/cli.ts`, `src/commands/index.ts`, `src/commands/code/index.ts`, and
  registration/help tests for config-gated CLI membership;
- `src/commands/mcp.ts` and tests for local policy/service wiring plus the
  session-only override;
- `packages/mcp/src/mcp/` internal local server/instruction composition and
  baseline-invariant tests;
- new `packages/mcp/src/tools/resolve-target.ts` and `code-diff.ts` adapters with
  focused schema, handler, text, error, and wire-mode tests;
- existing shared resolve/CodeDiff request/response/text modules where a small
  surface-neutral extension avoids duplication;
- `packages/mcp/src/internal.ts` for workspace-only exports, with no supported
  public export addition;
- `src/tools/` CLI/MCP parity tests for both tools;
- `scripts/mcp-smoke.ts`, `scripts/cli-smoke.ts`, and built-mode coverage with
  stable and experimental profiles;
- `scripts/agent-eval.ts`, `scripts/agent-eval.test.ts`, two new workloads under
  `eval/agentic/workloads/`, and workload routing docs;
- durable implementation docs listed above and one release fragment.

### Ordered implementation

1. Add failing config tests for missing/default config, explicit true/false,
   both reporting modes, invalid values/types/TOML, existing auth storage,
   environment precedence, canonical/legacy paths, and Windows path semantics.
   Implement one shared parsed config source and typed experimental policy.
2. Add CLI registration/process tests for disabled, enabled, and malformed
   config. Gate `resolve` and only the `diff` member of the `code` group; compose
   help/getting-started text from the policy; ensure explicit disabled calls
   return the enable snippet before auth/network work; keep diagnostic/recovery
   paths operable.
3. Refactor MCP server composition behind a private/shared factory seam. Keep
   every existing public function on the stable factory list and composer. Add
   a workspace-internal local composer accepting the extended services,
   experimental policy, and optional session override.
4. Add exact invariant tests before tool adapters: disabled/default tool names
   equal the current 15-name stable list; disabled instructions equal
   `buildMcpInstructions()` byte-for-byte; public descriptors/smoke inventory do
   not expose either experimental name; dormant reporting changes nothing.
5. Implement `resolve_target` test-first. Reuse the shared request and success
   projection, add compact MCP-native text/hints and `format`, preserve minimal
   wire selections, map validation/service errors consistently, and test
   ambiguous/protected/no-result/privacy cases.
6. Implement `code_diff` test-first. Add union-shaped target plus separate
   endpoint normalization, agent-bounded schema/defaults, MCP-native text,
   structured errors, and success projection reuse. Assert every view's service
   mode/selection, omitted limits, scope/truncation/content-safety behavior,
   empty/identical diffs, and patch suppression/recovery.
7. Compose the experimental instruction section from the actual enabled tool
   inventory. Add exact tool-routing, cheapest-evidence, unsupported-conclusion,
   public-target, privacy, and follow-up guidance. Add conditional reporting
   instructions for off/experimental/all and tests for scope, redaction wording,
   duplicate avoidance, and no feedback retry loop.
8. Add CLI/MCP parity fixtures for equivalent normalized calls, JSON success
   envelopes, and mapped errors. Agent-specific defaults/text may differ, but
   the same explicit request must produce the same service params and facts.
9. Extend CLI and MCP smoke suites with a default baseline cohort and an
   experimental cohort. Cover source/built launch, tool inventory,
   instructions, unauthenticated error envelopes, disabled CLI errors, and
   local-only override behavior. Keep public smoke constants stable.
10. Add the hidden `--experimental-tools` server option to local MCP
    eval/session setup, reject it with published mode, persist it in generated
    run artifacts, and test Claude, Codex, and OpenCode config generation. Assert
    that normal `githits mcp start --help` does not advertise it. Do not mutate
    the host config.
11. Add two guidance-neutral workloads: fuzzy/ambiguous target resolution with
    a canonical follow-up, and exact version source-change investigation where
    bounded diff evidence is necessary. Update the workload selection table.
12. Run targeted local evals with issue reporting off: Claude and Codex on both
    new workloads, plus the broad `express-router` workload to detect stable
    routing regressions. Inspect raw tool calls, final reports, schema errors,
    output volume, follow-up correctness, `toolIssues`, and
    `instructionIssues`; tune descriptions/schemas only from concrete evidence.
13. Validate reporting instructions in controlled tests or a mock failure that
    cannot submit production feedback. Do not generate synthetic backend
    feedback during eval. Record whether agents formed the intended bounded
    report and avoided duplicates/private content.
14. Update durable docs and add the release fragment. Run plugin generation and
    check; explain every generated diff and expect none unless canonical plugin
    inputs actually changed.
15. Run focused tests, `bun test`, `bun run build`, `bun run smoke:cli`,
    `bun run smoke:mcp`, both built smoke modes, `bun run validate:packages`,
    `bun run plugins:generate`, `bun run plugins:check`, format, and lint.
    Authenticated live calls are reported accurately when credentials/deployment
    are available without exposing credentials; unavailable live validation is
    not reported as passed.

### Edge cases and failure behavior

- Config absent, empty, false, true, reporting value without tools, invalid
  enum/type, malformed TOML, canonical path, legacy macOS path, XDG path, and
  Windows path semantics.
- Root/code help, direct disabled invocation, stable sibling code commands,
  local MCP start, eval override, remote/public construction, doctor/logout,
  and unauthenticated calls.
- Empty strings/arrays and explicit optional values in both tool schemas.
- Resolve: no candidates, ambiguous candidates, duplicate protected matches,
  exact-name protection, unsupported registry, limit bounds, private context
  warning, no automatic candidate selection.
- CodeDiff: package/repository XOR, embedded version/ref rejection, equal
  endpoints, reverse/diverged pairs, unknown/moved package scope, empty
  inventory, truncation, unprojectable/byte-escaped paths, binary/metadata-only
  changes, content omission/failure, explicit versus default budgets, unsafe
  patches, and bounded error recovery metadata.
- Reporting: off, experimental, all, no issue, repeated same issue, feedback
  failure, and an issue containing material that must be redacted rather than
  forwarded.

### Acceptance criteria

- Default and explicitly disabled config produce exactly the stable 15 MCP
  tools and exact baseline instruction string; `resolve_target` and `code_diff`
  are absent from public descriptors, public smoke inventory, remote server
  construction, generated remote transports, root skills, and shared guidance.
- Enabled config exposes both experimental CLI commands in help and execution
  and both experimental MCP tools/instructions in every local stdio client on
  the host.
- Disabled CLI help does not mention the commands indirectly; explicit calls
  fail locally with the exact enable path/snippet and no auth/network call.
- Stable CLI commands and recovery paths continue working when experimental
  tools are off; malformed config does not lock users out of help/version,
  doctor, logout, or credential cleanup.
- `resolve_target` preserves the released ranking/ambiguity contract, never
  auto-selects an ambiguous candidate, fetches detailed fields only when needed,
  and provides MCP-native follow-ups and privacy guidance.
- `code_diff` defaults to bounded inventory evidence, fetches exactly the mode
  requested, preserves exact identity/completeness/safety facts, and never
  presents incomplete/unsafe patch evidence as authoritative or infers semantic
  conclusions.
- Explicit equivalent CLI/MCP requests yield equivalent service params, JSON
  success facts, and stable error classifications.
- Reporting off adds no new reporting instruction. `experimental` names only
  the two experimental tools; `all` covers the full GitHits tool set. No mode
  sends feedback automatically or leaks sensitive/local content.
- The session-only override is absent from normal MCP CLI help and documented
  only as eval/development infrastructure; host users enable the suite through
  `config.toml`.
- Eval artifacts prove Claude and Codex can discover and use both experimental
  tools, choose sensible follow-ups, and produce useful answers without stable
  workload regressions. Any observed issues are fixed in this phase when minor;
  major findings are recorded in this plan before deferral.
- Required unit, parity, full, build, CLI/MCP smoke, built smoke, package,
  plugin, format, and lint checks pass, with live validation status stated
  truthfully.

## Phase 4: Per-tool graduation

**Status:** pending Phase 3 dogfood evidence.

**Expected outcome:** each experimental tool is independently promoted to the
stable local/remote/public MCP inventory, revised for further incubation, or
removed. `code_diff` may graduate before `resolve_target` without changing the
user config schema.

**Assumptions:** dogfood and eval artifacts provide enough evidence to decide
per tool; hosted backend capacity and public API boundaries are ready for any
tool selected for GA.

**Unknowns/product decisions:** graduation order, final default view and limits,
whether resolve ranking quality is sufficient, whether reporting remains useful,
and whether public Agent Skill guidance should change. Resolve from Phase 3
artifacts and production feedback before detailing this phase.

**Dependencies:** merged/released Phase 3, representative dogfood period,
backend readiness, and explicit product approval for each promotion.

**Acceptance criteria:** each tool has an evidence-backed disposition; promoted
tools move cleanly into stable public descriptors/instructions/smoke/API with
the correct MCP release impact; retained experimental tools remain local-only;
removed tools leave no stale guidance. Tactical files and steps are intentionally
deferred until reorientation.

## Phase 5: Changelog steering

**Status:** blocked on a stable CodeDiff invocation and committed/deployed
backend changelog-action contract.

**Expected outcome:** sparse or missing changelogs carry typed package-only diff
arguments that map to the active CLI/MCP CodeDiff syntax without parsing prose.

**Assumptions:** the future action is transport-neutral and package-addressed.

**Unknowns/product decisions:** discriminator, fields, placement, and fallback
behavior. Resolve from the future backend SDL/implementation during
reorientation.

**Dependencies:** CodeDiff disposition from Phase 4 and backend action schema.

**Acceptance criteria:** empty/partial/missing changelog outcomes steer to valid
diff calls in their supported contexts; unrelated outcomes remain truthful;
structural diff stays unexposed. Tactical detail is intentionally deferred.

## Phase-boundary reorientation

After each phase merges and before detailing or implementing the next phase:

1. run `$next-steps` against current `origin/main`;
2. inspect the merged delta, tests actually passed, release state, backend
   readiness, dogfood feedback, and raw agent-eval artifacts;
3. record changed assumptions, decisions, dependencies, release boundaries,
   minor fixes, major deferrals, and contradictions in this plan;
4. classify the next phase as `READY`, `REPLAN`, or `PRODUCT INPUT NEEDED`; and
5. add tactical detail only for the next one or two phases.

Do not carry experimental defaults or instruction wording into GA merely because
they shipped in incubation. Promotion requires evidence and an explicit product
decision.

## Completion and plan cleanup

The overall effort is complete when the experimental framework is released,
both initial tools have an explicit final disposition, any selected GA tools are
documented and validated on their public surfaces, and changelog steering is
either implemented or explicitly removed from scope by product decision.

Before deleting this plan, transfer lasting config schema, local/public MCP
boundaries, tool contracts, dogfood findings, reporting policy, and graduation
decisions into `docs/implementation/`. Then delete this temporary plan; do not
leave a stale completed rollout plan beside permanent documentation.
