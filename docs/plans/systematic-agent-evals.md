# Systematic Agent Eval Runs And Metrics

## Status

- Overall: IN PROGRESS
- Current phase: Phase 2 — systematic local suites and paired comparison (PLANNED)
- Previous phase: Phase 1 — trustworthy local metrics (MERGED)
- Owner: repository maintainers
- Last verified: 2026-08-28
- Deployment: Phase 1 merged to `main`; local maintainer tooling is available.
  Scheduled execution and external persistence remain Phase 3 work.

## Problem And Expected Outcome

The repository has a real-agent eval harness and a useful workload corpus. The
initial implementation was optimized for qualitative, human-driven inspection:
it did not persist normalized token or cost metrics, its comparison output was
too narrow for regression analysis, and one verified extraction rule could hide
GitHits CLI fallback in the minimal MCP profile. Phase 1 now adds local,
schema-validated metrics and report fields, while comparison breadth, suite
orchestration, and persistent history remain later work.

When this effort is complete:

- maintainers can run named eval suites locally with Codex Luna-low against both
  descriptor-only (minimal) and full guidance profiles, with Claude Haiku added
  only after the Luna pipeline and service integration are stable;
- every workload/agent execution emits a versioned, vendor-neutral metrics
  record containing harness identity, tool usage, token usage, duration, cost,
  status, and links to the raw evidence;
- a local paired run can compare a candidate checkout with a main baseline while
  holding agent harness versions and model settings constant;
- a clean automation runner executes the stable full suite daily from `main`,
  preserves raw artifacts, and exports the same normalized records to the
  selected long-term service;
- daily results are observational and alert on material drift without becoming
  a flaky merge gate; and
- result quality can be added later through explicit workload rubrics without
  changing the execution or metrics contracts.

## Scope

In scope:

- MCP runs against the local checkout using the existing `descriptors` and
  `full` guidance profiles;
- initial agent matrix: Codex `gpt-5.6-luna` with `low` reasoning across both
  guidance profiles;
- reliable extraction and normalization of tool events, token usage, duration,
  cost, harness versions, and run identity;
- named canary, smoke, stable-full, stateful-manual, and experimental suites;
- local baseline/candidate comparison;
- scheduled and manually dispatched execution from `main` after runner,
  authentication, budget, and persistence decisions are made;
- durable raw-artifact retention plus export to a service selected separately;
- an advisory drift policy and a later quality-evaluation extension point.

Out of scope for the initial phases:

- replacing the existing agent process runner with a vendor-owned runner;
- automatically running paid agent evals on every pull request;
- treating stochastic agent results as deterministic CI gates;
- OpenCode or the Agent Skills surface in the first scheduled matrix;
- Claude Haiku metrics, suites, or pipeline execution before the Luna-only
  pipeline has validated the harness and selected third-party service;
- the two experimental-tool workloads in the stable daily suite;
- an LLM judge, golden-answer corpus, or composite quality score before a
  workload rubric and judge policy are approved;
- a repository-owned database, queue, cache, lock, or dashboard;
- selecting the long-term eval service in this plan.

## Verified Current State And Evidence

### Repository behavior

- `scripts/agent-eval.ts` already launches Claude, Codex, or OpenCode in an
  isolated temporary workspace and persists raw stdout, stderr, tool calls,
  final JSON, discovery events, effective model settings, agent CLI versions,
  and git branch/SHA.
- `scripts/agent-eval-report.ts` derives status, duration, unique tools, raw
  event count, errors, self-reported issues, and matched normalized metrics.
  Comparison remains limited to status, tool names/counts, and self-reported
  issue strings; token/cost deltas remain Phase 2 work.
- There are 24 non-reporting workloads: 21 automation-safe stable workloads,
  one stateful onboarding workload, and two explicitly experimental-tool
  workloads.
- `.agent-eval/` is gitignored. Each run now writes a normalized `metrics.json`
  artifact, but no durable history exists.
- `.github/workflows/main.yml` runs the reusable build/test workflow on pushes
  to `main`. There is no scheduled live-agent workflow and no agent/provider
  authentication in CI.
- The current agentic eval documentation deliberately says the harness is
  human/agent-driven and not CI. This conflicts with the requested daily run.
  The resolution is to keep deterministic smoke tests as merge gates and make
  scheduled live-agent evals observational/advisory until measured evidence
  supports a different policy.
- Local Codex and Claude subscription runs cannot prove descriptor/full
  instruction isolation: Codex can load global `$CODEX_HOME/AGENTS.md`, and
  Claude bare mode disables subscription authentication. Local comparisons are
  diagnostic. Acceptance-quality profile comparisons require a clean,
  authenticated runner whose home and instruction sources are controlled.

### Bounded planning baseline

On 2026-08-28, two workloads were run against all four requested
agent/profile combinations using the current checkout:

- `package-overview-vulnerabilities` — focused package routing;
- `express-router` — multi-tool source investigation;
- Codex `gpt-5.6-luna`, reasoning `low`;
- Claude `haiku` (resolved by Claude Code to its current Haiku model);
- local MCP server, `descriptors` and `full` profiles.

The eight executions all completed at the process/harness level. Their total
sequential agent time was 839.9 seconds. With the four agent/profile shards run
concurrently, the slowest shard took about 4.5 minutes.

| Agent/profile              | Package duration | Express duration |  Two-workload cost |
| -------------------------- | ---------------: | ---------------: | -----------------: |
| Claude Haiku / descriptors |           54.4 s |          124.4 s |  \$0.1636 reported |
| Claude Haiku / full        |           58.1 s |          211.3 s |  \$0.1676 reported |
| Luna-low / descriptors     |          123.6 s |           75.1 s | \$0.0205 estimated |
| Luna-low / full            |           53.9 s |          139.0 s | \$0.0257 estimated |
| Total                      |                  |                  |       **\$0.3774** |

Claude Code supplied `total_cost_usd`; this is a list-price-equivalent value
despite the run using subscription authentication. Luna cost was estimated from
the captured usage and the current official rates of $0.20/M uncached input,
$0.02/M cached input, and \$1.20/M output. The rate source and effective rate
snapshot must be stored with future calculated costs:
<https://developers.openai.com/api/docs/models/gpt-5.6-luna>.

Luna requests over 272K input tokens use higher per-request rates. Codex's
terminal event exposes only turn-aggregate usage, so it cannot prove which
individual request crossed that boundary. Luna dollar figures in this plan are
base-rate estimates and can understate billed cost. Metrics must preserve this
uncertainty instead of presenting aggregate-derived cost as exact.

The initial rollout is Luna-only. Naively scaling the measured Luna shards gives
planning numbers, not a budget commitment:

| Suite                                                          | Executions | Approximate wall time at two shards |      Approximate cost |
| -------------------------------------------------------------- | ---------: | ----------------------------------: | --------------------: |
| Canary: 2 workloads × 1 agent × 2 profiles                     |          4 |                3.3 minutes measured | \$0.046 base estimate |
| Smoke: 6 workloads × 1 agent × 2 profiles                      |         12 |                          10 minutes |               \$0.139 |
| Stable full: 21 workloads × 1 agent × 2 profiles               |         42 |                          35 minutes |               \$0.485 |
| All current workloads, including stateful/experimental: 24 × 2 |         48 |                          40 minutes |               \$0.554 |

Workload mix and provider behavior can move these figures substantially. Phase
2 must report actual canary, smoke, and stable-full measurements before Phase 3
sets a daily budget or timeout.

### Verified instrumentation defect and resolution

The Codex descriptor-only package workload used a GitHits CLI fallback through
`npx -y githits@latest`, but `tool-calls.json` and the report recorded zero
calls. `extractToolCalls()` previously included CLI calls only for the Skills
surface or the full MCP profile. Phase 1 now records the fallback in both MCP
profiles and reports the effective profile, so a change from MCP use to CLI
fallback cannot look like no GitHits use at all. Skills runs continue to use the
CLI surface by design and do not receive the MCP fallback warning.

### Usage-source observations

- Codex emits one `turn.completed.usage` aggregate with input, cached input,
  cache-write input, output, and reasoning-output fields.
- The inclusive input partition is verified by the upstream Codex parser
  fixture `parses_cache_write_token_usage` (input 100, cached input 40,
  cache-write input 60, total tokens 110). The Luna canary had zero cache-write
  input, so it did not independently verify a nonzero cache-write case.
- The current Codex CLI does not expose a provider-resolved model. Phase 1
  writes `resolvedModel: null` and uses the requested model for cost
  calculation; the nullable field remains for later adapters.
- Claude emits a terminal `result` record with `modelUsage`, aggregate usage,
  duration, turns, and provider-reported cost. In the measured full-profile
  runs, `modelUsage.inputTokens` differed from `usage.input_tokens`; therefore
  adapters must preserve raw provider fields and explicitly choose/document the
  normalized source rather than summing repeated assistant-event usage.
- Reasoning tokens are a detail of output usage, not an extra amount to add to
  total output, unless a future provider contract explicitly says otherwise.

## Target Architecture

The repository remains the source of truth for workloads and execution. A
future service stores, visualizes, and optionally judges results; it does not
need to own the harness.

```text
suite manifest
  -> existing agent runner (one agent/profile shard)
  -> immutable raw workload artifacts
  -> provider-specific usage/tool adapters
  -> versioned normalized metrics.json
  -> local report + compatible baseline comparison
  -> later: CI artifact retention + selected-service exporter
```

### Boundaries And Responsibilities

1. **Suite manifest**

   A repository-owned manifest defines stable workload IDs and membership in
   `canary`, `smoke`, `stable-full`, `stateful-manual`, or `experimental`. It
   defines execution inputs, not thresholds or vendor configuration. Workload
   prompts remain guidance-free.

2. **Execution runner**

   `scripts/agent-eval.ts` continues to own isolated workspaces, process
   invocation, timeouts, redaction, and raw artifacts. A suite command expands
   the manifest into the existing repeated `--workload` contract. The runner
   captures the exact agent CLI version, resolved model, reasoning setting,
   profile, git SHA/dirty state, and timestamps needed to explain drift.
   Paired execution separates the measurement-harness checkout from the target
   checkout: the candidate checkout owns suite prompts, reporting/schema,
   adapters, and comparison for both sides, while an explicit target root owns
   the local MCP server process and git identity under test.

3. **Provider adapters**

   Small pure adapters parse provider event formats. Phase 1 implements Codex;
   the same contract accepts a Claude adapter in the later Haiku phase. Adapters
   preserve the provider payload needed for audit and map it into common
   non-overlapping fields. Tool extraction records both the logical GitHits
   operation and its surface (`mcp` or `cli`) in every profile. CLI fallback is
   visible but never counted as successful MCP use.

4. **Normalized metrics contract**

   One versioned `metrics.json` per run contains a record per
   workload/agent/profile execution. Each record includes:

   - stable run ID and workload ID;
   - git SHA/dirty state, suite name, agent CLI/harness version, requested and
     resolved model, reasoning effort, surface, server, and guidance profile;
   - start/end/duration, process/final status, timeout, turns when exposed;
   - raw tool events, logical call count, completed/failed count, unique tools,
     ordered tool sequence, MCP-versus-CLI surface, and tool-result byte counts
     when the harness exposes them;
   - provider-native usage plus normalized uncached input, cache-read input,
     cache-write input, output, and reasoning-output details;
   - provider-reported cost for a future adapter that exposes it, otherwise a
     calculated base-rate estimate plus the recorded rate-card snapshot and
     pricing uncertainty;
   - artifact-relative paths and warnings for missing/ambiguous telemetry.

   Missing telemetry is `unknown`, not zero. Raw artifacts remain authoritative.

5. **Comparison**

   Local comparison accepts two run directories and compares only records with
   compatible workload, agent, model, reasoning, surface, server, profile,
   experimental-tool setting, and published-package spec when applicable. It
   shows absolute and percentage token/cost/duration deltas, tool
   additions/removals, surface changes, ordered tool-use changes, failures, and
   harness-version changes. Incompatible dimensions are explicit warnings, not
   silently merged results.

6. **Persistence/export**

   In Phase 3, GitHub artifacts retain immutable raw evidence for replay and the
   selected service receives normalized records for long-term per-eval/per-agent
   trends. The exporter is a thin boundary around the service SDK or API. No
   repository-owned persistence infrastructure is introduced.

7. **Quality evaluation**

   The final JSON and evidence remain available for later scoring. Phase 5 may
   add deterministic workload rubrics first and an optional judge second. The
   agent's current self-reported usefulness/confidence is diagnostic metadata,
   not an authoritative quality score.

## Initial Suite Policy

The manifest starts with:

- **Canary (2):** `package-overview-vulnerabilities`, `express-router`.
  This is the measured cheap path and covers package routing plus multi-tool
  code navigation.
- **Smoke (6):** the canary plus `global-example`,
  `unified-search-investigation`, `docs-search-followup`, and
  `package-upgrade-safety`. This spans example discovery, package intelligence,
  unified search/status, documentation follow-up, and code navigation without
  duplicating every tool-specific edge case.
- **Stable full (21):** every current non-reporting workload except
  `githits-onboarding`, `experimental-resolution-follow-up`, and
  `experimental-code-diff`.
- **Stateful manual (1):** `githits-onboarding`. It is never included in a
  normal local or scheduled suite because the current harness inherits the real
  home/config roots and the workload can install or modify user-scoped agent/MCP
  state. Execution requires an explicit stateful acknowledgement and a verified
  disposable home/config environment.
- **Experimental (2):** the two experimental-tool workloads, run manually and
  with their required server flag.

Local policy:

- use canary while changing the harness or metrics adapters;
- use smoke for broad agent-facing changes and paired baseline/candidate
  comparison;
- use targeted workloads from the existing routing table for tool-specific
  changes;
- run stable-full locally only when explicitly needed.

Automation policy after Phase 3:

- run stable-full daily from `main` and on manual dispatch;
- retain the two Luna/profile combinations as separate shards;
- keep experimental workloads manual;
- do not run paid evals automatically on every PR initially;
- keep the scheduled workflow advisory. Deterministic tests remain the merge
  gate.

The current Phase 3 proposal is to allow daily agent CLI versions to advance so
harness drift is observable, while recording exact versions. That is not yet an
approved policy; a pinned control offers stronger attribution at additional
cost. Local PR comparisons must run baseline and candidate close together with
the same installed agent versions so repository changes are not confused with
harness changes.

## Assumptions

- The repository's current workload corpus is the starting definition of
  supported use cases; suite membership can be revised when execution evidence
  shows a workload is redundant, unsafe, or consistently non-diagnostic.
- MCP local mode is the initial scheduled surface because it evaluates the
  checkout on `main`.
- Two Luna/profile shards can run concurrently. The bounded local baseline
  exercised this shape without a verified backend issue; Phase 2 measurements
  will determine the automation limit.
- Daily evals are for regression detection and investigation, not deterministic
  correctness proof.
- A service-neutral JSON contract lets local work proceed before the team
  chooses the target service.

## Unknowns And Product Decisions

None block Phase 1 or Phase 2.

The following must be resolved before Phase 3 is detailed or implemented:

- **Long-term service and retention:** which service receives normalized
  metrics, whether it also stores raw traces, retention duration, dashboard and
  alert requirements, and available credits.
- **Automation runner and authentication:** GitHub-hosted clean Linux is the
  preferred isolation baseline, but Codex CLI installation and API-key
  authentication must be verified without exposing credentials. If policy or
  licensing requires a dedicated runner, that is a user-approved infrastructure
  decision.
- **Budget and concurrency:** approve a daily dollar/quota ceiling after Phase 2
  measures the real suites. The current Luna-only planning estimate is about
  $0.49/day for stable-full, or about $15 per 30-day month, before service
  charges.
- **Harness update policy:** confirm whether daily jobs intentionally install
  latest agent CLIs, use an approved moving version range, or run both floating
  and pinned controls. Latest-only is the smallest design that detects harness
  drift but makes upstream changes part of the daily variance.

The following must be resolved before Phase 4:

- when the Luna-only pipeline and service integration are stable enough to add
  Claude Haiku, and the separate Haiku budget/authentication policy.

The following must be resolved before Phase 5:

- which workloads need objective quality scoring;
- rubric ownership and acceptable reference-answer maintenance;
- whether a judge model/service is allowed and its separate cost budget;
- whether any metric becomes alerting-only, a PR annotation, or a merge gate.

## Cross-Cutting Requirements

### Security And Privacy

- Credentials enter automation only through the chosen runner's secret store
  and are never written to run metadata, raw artifacts, logs, annotations, or
  exporter payloads.
- Extend and fixture-test the existing redaction boundary for every new artifact
  and exporter field.
- Store sanitized commands/configuration sufficient to identify the harness;
  never store token values or credential-bearing environment variables.
- Keep agent execution in an empty controlled workspace with non-interactive
  permissions limited to the existing eval workload scope.

### Reliability And Failure Semantics

- Parser/schema failures, missing required telemetry, timeout, invalid final
  JSON, exporter failure, and agent failure remain distinguishable states.
- A missing metric is unknown. It must not become zero and distort trends.
- Raw artifacts are written before derived metrics so normalization can be
  replayed after parser fixes.
- Do not add retries or timer-based workarounds for model, backend, or exporter
  failures. Preserve evidence and fix observed root causes.
- Service export failure must not destroy the local/GitHub artifact. Phase 3
  decides whether it fails the advisory workflow or produces a visible partial
  result based on the selected service contract.

### Compatibility And Migration

- Existing `agent:e2e` commands and raw artifact filenames remain supported.
- `report.json` can evolve by schema version; old run directories remain
  readable through tested compatibility fixtures or a clear version error.
- The new suite command composes the existing runner rather than creating a
  second execution implementation.
- Cross-agent metrics are stored together but direct baseline deltas are made
  only within compatible agent/configuration dimensions.

### Performance And Cost

- Phase 2 establishes release-build-equivalent timing and cost baselines before
  pipeline concurrency/timeouts are finalized.
- Reports expose per-workload and aggregate duration/cost so slow or expensive
  workloads can be identified rather than hidden in one suite total.
- Mutable package/backend responses are a confounder for token trends. Preserve
  raw results and result byte counts where exposed so an alert can be
  investigated; do not claim that a token delta alone proves harness drift.
- Concurrency is bounded by the explicit two-shard Luna/profile matrix
  initially. No queue or scheduler is added in the repository.

### Testing

- Use `bun test` with captured, redacted Codex event fixtures in Phase 1; add
  Claude fixtures with the later Haiku adapter.
- Test adapters independently from process execution.
- Cover repeated events, terminal aggregate selection, inclusive cached-token
  semantics, reasoning-token non-double-counting, absent/partial telemetry,
  CLI fallback in both profiles, failed calls, and secret redaction.
- Test suite expansion and compatible/incompatible comparison behavior without
  invoking paid agents.
- Run targeted live canary execution only after deterministic tests pass; paid
  runs are validation evidence, not unit tests.

### Documentation And Release

- Update `eval/agentic/README.md` as commands, artifact contracts, suite policy,
  and isolation guidance change.
- Add durable architecture/operations documentation under the distinct name
  `docs/implementation/agentic-eval-metrics.md` before this plan is removed;
  `docs/implementation/EVAL_HARNESS.md` already documents a separate prompt
  injection guardrail harness.
- Add an independent `changes/<slug>.changed.md` fragment with explicit
  `githits` and `@githits/mcp` impacts for each implementation increment. The
  Phase 1 metrics tooling is maintainer/operator-facing, so its fragment uses
  `none` for both public artifacts.
- After the complete effort is implemented and documented, delete this plan.

## Phase Map

1. **Phase 1 — trustworthy local metrics (COMPLETE):** every existing local run
   produces auditable per-workload tool/token/cost metrics, including visible
   CLI fallback and explicit unknown telemetry.
2. **Phase 2 — systematic local suites and paired comparison (PLANNED):**
   maintainers can execute canary/smoke/full matrices locally, compare a
   candidate to a compatible main baseline, and see measured time/cost totals.
3. **Phase 3 — daily main execution and persistent export (BLOCKED ON PRODUCT
   DECISIONS):** a clean runner executes the stable full matrix daily from
   `main`, retains raw evidence, and exports normalized records to the selected
   service.
4. **Phase 4 — Claude Haiku expansion (PLANNED):** the proven metrics, suite,
   comparison, and persistence contracts add Haiku without changing Luna
   history.
5. **Phase 5 — trend policy and result quality (PLANNED):** historical variance
   supports calibrated drift alerts, and approved workload rubrics optionally
   assess answer quality without changing the execution contract.

## Phase 1 — Trustworthy Local Metrics

### Status

MERGED — implementation and validation complete; live canary passed. PR #321
merged as `e9ccdabec02cdc9c544ef9959c3a886d868e12a6` on 2026-08-28.

### Expected Outcome

Every Luna-low workload run writes a versioned metrics artifact whose token,
cost, duration, and GitHits tool-use fields can be traced back to raw Codex
events. MCP-to-CLI fallback is visible in every guidance profile, and missing
telemetry cannot silently appear as zero.

### Assumptions

- The captured Codex `turn.completed` record remains the terminal aggregate
  source for the currently installed CLI version.
- Provider-specific raw usage remains persisted so an adapter can be corrected
  without re-running a paid workload.
- Existing raw artifacts and `report.json` remain supported.

### Unknowns Or Product Decisions

None.

### Dependencies

- Current `scripts/agent-eval.ts`, `scripts/agent-eval-report.ts`, and their Bun
  tests.
- The redacted Codex raw fixtures from the bounded baseline, reduced to the
  smallest representative event records before committing.
- Official Luna rate snapshot cited above.

### Likely Affected Components

- `scripts/agent-eval.ts`
- `scripts/agent-eval-report.ts`
- a small provider-adapter/metrics module under `scripts/` if separation keeps
  parsing pure and independently testable
- `scripts/agent-eval.test.ts` and report/adapter tests
- `eval/agentic/README.md`
- `changes/`

### Contracts And Failure Behavior

- Introduce a schema-versioned run-level `metrics.json` with one workload
  record per execution, following the target contract above.
- Preserve both `providerUsage` and normalized token buckets. Normalization
  documents whether an input field is inclusive of cached/cache-write tokens.
- Use the terminal Codex usage aggregate once; derive uncached input only under
  the verified event semantics, while preserving the raw inclusive input.
- Codex exposes no provider-reported cost here, so current cost kinds are
  `base_rate_estimate` and `unknown`. Calculate Luna cost as a
  `base_rate_estimate` and embed the rate snapshot. A future provider-reported
  kind requires a schema revision. When request-level long-context pricing
  cannot be reconstructed from the turn aggregate, emit a
  `long_context_pricing_not_attributable` warning. Never present an estimate as
  a billed value or upper bound.
- Extract GitHits CLI commands from every agent/profile. Store them with
  `surface: cli`; MCP calls remain `surface: mcp`.
- A run with successful process status but missing a required terminal usage
  aggregate receives a telemetry warning and unknown usage fields. It is not a
  zero-token run.
- Until their provider adapters are implemented, Claude and OpenCode runs remain
  executable and emit unknown normalized usage/cost with an explicit
  `adapter_not_implemented` warning. This is distinct from a supported Codex
  run whose expected terminal telemetry is missing.
- Continue redacting known secrets before any new artifact is written.

### Ordered Implementation Steps

1. **Completed:** Add minimal redacted fixtures for the verified Codex terminal usage, MCP
   calls, descriptor-profile CLI fallback, failed tool calls, and absent
   telemetry. Write failing adapter/extraction tests first.
2. **Completed:** Extract pure provider usage adapters and a common metrics schema. Document
   field semantics at the interface and validate written artifacts at runtime
   using the repository's existing Zod convention.
3. **Completed:** Correct CLI extraction so every GitHits fallback is recorded regardless of
   guidance profile, and update report warnings to identify the intended MCP
   surface versus observed CLI surface.
4. **Completed:** Generate `metrics.json` from completed raw artifacts and enrich the console
   and JSON report with per-workload and aggregate duration, tokens, tool calls,
   and cost.
5. **Completed:** Capture missing run identity needed for interpretation: start/end timestamp,
   resolved model when exposed, and git dirty state. Propagate the already
   captured exact agent CLI versions into normalized metrics and reports.
   Preserve sanitized existing command/config evidence.
6. **Completed:** Update the agentic eval documentation and add the required change fragment.
7. **Completed:** Run deterministic tests, typecheck/format/lint/build, then
   rerun the two-workload canary once for Luna-low across both profiles.
   Compare emitted metrics manually to the raw terminal records and report
   actual duration/cost. Deterministic coverage includes provider-ID pairing
   for Codex MCP and CLI start/completion observations, started-only calls, and
   repeated calls to one tool under distinct IDs.

### Edge Cases And Boundaries

- Reasoning output is a subset/detail of output unless the provider contract
  explicitly changes.
- Tool start/completion events must not inflate logical call count. Codex raw
  observations carry the provider `item.id`; metrics pair only observations
  with the same surface, ID, and normalized tool, preserve first-call order,
  and use the latest status. Started-only observations count once, distinct IDs
  remain distinct calls, and observations without IDs are not paired by
  heuristics. Preserve raw event count separately. Unsupported agents retain
  an unknown logical count until their provider semantics are implemented.
- CLI commands with `npx`, the local shim, or `bun run ... githits` normalize to
  the logical GitHits operation without persisting secret-bearing arguments.
- Non-GitHits shell commands remain outside GitHits tool metrics.
- Older run directories without usage events produce a readable report with
  unknown metrics and a schema warning.
- When run metadata includes `runId`, a validated metrics artifact with a
  different run ID is rejected as unknown; legacy metadata without a run ID
  remains compatible with valid metrics artifacts.

### Verification

- `bun test scripts/agent-eval.test.ts scripts/agent-eval-metrics.test.ts`
- `bun run typecheck`
- `bun run format:check`
- `bun run lint`
- Targeted two-shard canary: both workloads and both Luna guidance profiles.
- Inspect each `metrics.json` against its raw terminal aggregate and tool events;
  specifically verify the descriptor-profile Codex CLI fallback is non-zero and
  tagged `cli`.

### Deterministic Implementation Evidence

- `bun test scripts/agent-eval.test.ts scripts/agent-eval-metrics.test.ts`:
  94 tests passed with no failures on 2026-08-28.
- `bun run typecheck`, `bun run format:check`, `bun run lint`, and
  `bun run build`: passed on 2026-08-28.
- `bun test`: 3,338 tests passed with no failures, across 184 files, with
  10,762 expectations in 59.05 seconds on 2026-08-28.
- Pull request #321 merged to `main` as
  `e9ccdabec02cdc9c544ef9959c3a886d868e12a6`. Its final pull-request workflow
  run (`33167102840`) passed build and checks, Ubuntu and Windows tests, Bun
  compatibility, and Node 20, 22, 24, and 26 compatibility.

### Luna Validation Canary

The Luna-low two-workload canary completed successfully in all four executions
(2 workloads × 2 MCP guidance profiles) on 2026-08-28. Metrics aggregates were:

| Guidance profile | Workloads | Summed workload duration | Logical calls | Uncached input | Cached input | Output | Reasoning detail | Base-rate estimate |
| ---------------- | --------: | -----------------------: | ------------: | -------------: | -----------: | -----: | ---------------: | -----------------: |
| descriptors       |         2 |                 203.857 s |            14 |         62,329 |      279,296 | 3,063 |             561 |          $0.02172732 |
| full              |         2 |                 107.390 s |            13 |         66,823 |      278,528 | 2,225 |             452 |          $0.02160516 |

Raw terminal usage matched metrics for all four executions. Raw tool
observations paired 2:1 by provider ID into logical calls. The descriptors
express workload used 10 MCP calls and the package workload used 4 CLI calls
with the expected MCP-to-CLI fallback warning. The full profile used all 13
calls through MCP.

### Acceptance Criteria

- [x] Each of the four canary executions emits one valid metrics record with the
  complete compatible identity dimensions.
- [x] Codex token buckets match the terminal aggregate fixtures and reasoning tokens
  are not double-counted.
- [x] Current Codex cost is explicit as a base-rate estimate or unknown; the Luna
  rate snapshot makes the base calculation reproducible, and request-level
  long-context uncertainty remains visible. A future provider-reported cost
  kind requires a schema revision.
- [x] Descriptor-profile CLI fallback is visible and cannot be mistaken for MCP
  success or zero GitHits use.
- [x] Missing usage or cost is represented as unknown with a warning.
- [x] No credential value appears in committed fixtures or generated artifacts.
- [x] Existing local eval commands and raw artifacts continue to work.
- [x] Updated documentation accurately states what the metrics do and do not prove.

## Phase 2 — Systematic Local Suites And Paired Comparison

### Status

PLANNED; detailed now, implemented after Phase 1.

### Expected Outcome

Maintainers can invoke a named suite for the requested model/profile matrix and
can run a compatible main-versus-candidate comparison locally. Output shows
per-workload and aggregate tool, token, duration, and cost drift, and records
actual canary/smoke/full sizing evidence for the pipeline decision.

### Assumptions

- Phase 1's metrics schema is stable enough to serve as the suite result
  contract.
- Local profile comparisons remain diagnostic because of the documented global
  instruction isolation limits.
- Baseline and candidate can use the same installed agent CLI versions during a
  paired run.

### Unknowns Or Product Decisions

None. The target service and automation budget remain later-phase decisions.

### Dependencies

- Phase 1 accepted and merged.
- Current workload routing table in `eval/agentic/README.md`.
- A clean main worktree or equivalent read-only baseline checkout available to
  the local paired command; the implementation must not mutate or reset user
  worktrees.
- Dependencies installed in both target checkouts so the candidate-owned
  harness can start each checkout's local MCP server.

### Likely Affected Components

- a typed manifest under `eval/agentic/`
- `scripts/agent-eval.ts` or a thin suite orchestration script that calls its
  existing execution API
- `scripts/agent-eval-report.ts` comparison logic
- deterministic suite/compare tests under `scripts/`
- `package.json` scripts
- `eval/agentic/README.md`
- `changes/`

### Contracts And Failure Behavior

- Named suites expand to explicit workload lists and reject unknown, duplicate,
  missing, or profile-incompatible entries before invoking an agent.
- The stateful-manual suite is excluded from all aggregate suites. It refuses a
  live run without explicit acknowledgement and a verified disposable
  home/config environment.
- Matrix defaults are exactly Luna-low across descriptors/full; all dimensions
  remain overridable for targeted local investigation.
- A paired comparison records one pair ID and verifies compatible agent/model/
  effort/surface/server/profile/workload, experimental-tool, and
  published-package dimensions before calculating deltas.
- The paired command runs from the candidate checkout. Candidate suite prompts,
  reporting contract, result schema, usage adapters, and comparison code are
  used for both sides. Separate explicit target roots select the main-baseline
  and candidate MCP server checkouts and their git-under-test metadata. This
  holds the measurement contract constant instead of comparing two different
  harness implementations.
- Harness version differences are prominent. A local paired command refuses to
  label results as a repository-only comparison when versions differ.
- Partial suite results remain reportable. Failed/missing workloads are listed
  and excluded from aggregate percentage calculations rather than converted to
  zero.
- The command prints total execution count, wall time, cumulative agent time,
  token buckets, cost, failures, and the paths to raw and normalized artifacts.

### Ordered Implementation Steps

1. Add and validate the initial suite manifest exactly as defined in the suite
   policy. Keep experimental workload requirements explicit.
2. Add named-suite execution that reuses the existing runner and produces one
   parent suite summary over two Luna/profile run directories. Bound concurrency
   to those two shards; workloads remain sequential within a shard for simple
   artifact ownership and rate behavior.
3. Separate measurement-harness root from target-repository root in the runner.
   Add an explicit target-root option used only for the local MCP launch and
   git-under-test identity; keep workloads, reporting/schema, normalization, and
   output ownership in the candidate harness checkout.
4. Extend comparison to token/cost/duration deltas, logical tool sequence and
   surface changes, status/failure differences, and harness version changes.
   Add compatible-dimension and partial-result tests.
5. Add a local paired workflow that runs a main baseline and candidate with the
   candidate-owned harness and suite settings. Require explicit target checkout
   paths or verified worktrees; never reset or clean a user's working tree.
6. Document canary/smoke/full selection and the difference between a paired
   repository comparison and a daily harness-drift comparison.
7. Run canary, smoke, and stable-full once in a controlled local environment.
   Record actual wall time, per-workload cost, failures, and concurrency behavior
   in the durable implementation documentation and use it to prepare the Phase
   3 budget decision. Validate stateful-manual through deterministic guard tests
   and a dry run; do not execute onboarding against a maintainer's real home.

### Edge Cases And Boundaries

- Candidate and baseline workload/reporting content can differ. Record content
  hashes and flag the comparison rather than pretending they are identical
  tests. The default paired workflow avoids this by using the candidate-owned
  workload/reporting contract for both targets.
- A dirty checkout is allowed for local exploration but must be labeled; the
  comparison cannot claim a reproducible git-only baseline.
- A profile or model missing from one side is a missing matrix cell, not a zero.
- Experimental suites require the experimental server flag and never merge into
  stable-full by default.
- The onboarding workload requires the stateful-manual guard and never merges
  into stable-full by default.
- Concurrent shards must use distinct output and temporary workspace paths.

### Verification

- Deterministic tests for manifest validation, expansion, matrix identity,
  partial failure, compatibility checks, and aggregate math.
- Existing agent-eval tests plus `bun run typecheck`, `bun run format:check`, and
  `bun run lint`.
- Dry-run all named suites and inspect commands/output paths.
- Live canary, smoke, and stable-full measurements using Luna-low and both
  profiles.
- Run a no-change paired comparison; it should show stochastic metric variance
  but no identity or content mismatch.

### Acceptance Criteria

- One documented command runs each named suite and the default two-cell Luna
  matrix.
- Normal local/full execution cannot invoke the onboarding workload, and the
  stateful-manual command refuses an unisolated live run.
- One documented local workflow compares a main baseline to a candidate without
  mutating either checkout.
- The paired workflow uses one candidate-owned measurement harness for both
  targets and records measurement-harness identity separately from each target
  checkout identity.
- Comparison exposes tool additions/removals and MCP/CLI surface changes, token
  and cost deltas, duration, failures, content identity, and agent CLI versions.
- Canary, smoke, and stable-full have measured wall-time and cost summaries;
  Phase 3 no longer relies on the two-workload linear estimate.
- Local profile evidence is labeled diagnostic unless the run manifest proves a
  clean instruction-isolated host.
- Existing targeted `--workload` usage remains available.

## Phase 3 — Daily Main Execution And Persistent Export

### Status

BLOCKED ON PRODUCT DECISIONS listed above. Detail this phase after Phase 2
reorientation and service/runner/budget selection.

### Expected Outcome

A clean authenticated runner executes the stable-full two-cell Luna matrix daily
from `main` and on manual dispatch, retains immutable raw artifacts, publishes a
human-readable summary, and exports normalized per-workload/profile records to
the selected long-term service.

### Assumptions

- Phase 2 measurements fit the approved daily budget and provider quotas.
- The selected service accepts the normalized dimensions or can be integrated
  through a thin mapping layer.
- The runner can install or provide the required agent CLIs without leaking
  credentials.

### Unknowns Or Product Decisions

- Service, retention, runner, authentication, daily budget, concurrency, and
  harness-version policy must be approved before implementation details are
  added.

### Dependencies

- Phase 2 accepted and merged.
- Approved service and runner decisions.
- Provider and GitHits automation credentials provisioned outside the
  repository.

### Acceptance Criteria

- A scheduled run checks out the exact `main` SHA and produces all expected
  stable-full matrix records or explicit partial-failure records.
- Exact agent CLI versions and resolved models make harness drift identifiable.
- Raw artifacts and normalized metrics survive the runner lifecycle for the
  approved retention period.
- The selected service shows persistent trends by workload, agent, and profile
  for tool calls/tools used, token buckets, duration, cost, and failures.
- No credentials appear in artifacts, logs, workflow annotations, or exporter
  payloads.
- The workflow is advisory and does not block `main` or PR merges.
- A manual dispatch can reproduce the same suite/configuration.

## Phase 4 — Claude Haiku Expansion

### Status

PLANNED. Detail only after the Luna-only pipeline and selected service have been
validated in Phase 3.

### Expected Outcome

Claude Haiku uses the same normalized metrics, suite, comparison, and persistence
contracts as Luna, adding a second change-sensitive agent without rewriting Luna
history or coupling service export to one provider.

### Assumptions

- Phase 3 has exposed and resolved the initial harness, runner, authentication,
  and service-integration bumps.
- The normalized provider adapter boundary remains sufficient for Claude's
  terminal `result` and `modelUsage` shapes already observed during planning.

### Unknowns Or Product Decisions

- Haiku automation authentication and budget.
- Whether Haiku starts with canary/smoke only or joins stable-full immediately.

### Dependencies

- Phase 3 accepted and merged.
- Approved Haiku rollout and budget decision.

### Acceptance Criteria

- Claude usage, cost, tool, duration, and identity metrics conform to the same
  versioned contract without changing historical Luna records.
- Haiku profile isolation is verified on the automation runner before results
  are treated as causal minimal/full evidence.
- The selected service can compare Haiku trends within compatible dimensions
  while keeping cross-agent comparisons explicitly non-equivalent.
- The approved Haiku suite runs within its measured budget and preserves the
  same raw-artifact and credential-redaction guarantees.

## Phase 5 — Trend Policy And Result Quality

### Status

PLANNED. Detail after the pipeline has produced enough real history to
characterize normal variance and after the user approves the quality policy.

### Expected Outcome

Maintainers receive calibrated signals for abnormal harness/tool/token/cost
changes, and selected workloads can be scored against explicit result-quality
rubrics with the score and judge provenance stored beside operational metrics.

### Assumptions

- Phase 3 provides queryable Luna history and raw evidence; Phase 4 provides
  Haiku history if that rollout has been approved.
- Alerting thresholds are based on observed variance rather than the initial
  eight-run sample.

### Unknowns Or Product Decisions

- Alert destinations and thresholds.
- Quality workload subset, rubrics, judge model/service, budget, and whether
  quality is advisory or gating.

### Dependencies

- Phase 3 accepted and merged; Phase 4 is required only for Haiku-specific trend
  or quality policy.
- Approved quality and alerting decisions.

### Acceptance Criteria

- Alerts distinguish harness-version changes, repository changes, and ordinary
  stochastic variance using recorded dimensions.
- Thresholds and comparison windows are documented and justified by retained
  history.
- Quality-enabled workloads have versioned rubrics and judge provenance; a
  rubric change starts a new comparable series rather than rewriting history.
- Operational metrics remain usable without the quality evaluator or selected
  judge.
- No merge gate is introduced without a separate explicit user decision and
  demonstrated false-positive rate.

## Phase-Boundary Reorientation

After each phase merges, run `$next-steps` against current `origin/main` before
detailing or implementing the next phase. Update this plan with changed
assumptions, decisions, measured timing/cost evidence, architecture, and scope.
Do not proceed when `$next-steps` reports `REPLAN` or `PRODUCT INPUT NEEDED`.

At the Phase 2 boundary, explicitly bring the service, runner/authentication,
budget, concurrency, and harness-update decisions to the user with the measured
suite evidence. At the Phase 3 boundary, bring the Haiku rollout decision to the
user with the observed Luna pipeline evidence. Bring the quality/alerting policy
at the Phase 4 or Phase 5 boundary with observed historical variance.

## Completion And Cleanup

The overall effort is complete when:

- local named suites and paired comparisons are documented and verified;
- the daily stable-full `main` run persists raw and normalized evidence;
- the selected service exposes the required per-workload/per-agent trends;
- the advisory drift policy is documented;
- any approved quality rubric is implemented or explicitly recorded as out of
  scope; and
- durable architecture, schema, operational, cost, isolation, and failure
  guidance is current under `docs/implementation/` and
  `eval/agentic/README.md`.

Then delete this temporary plan. Do not leave completed phase instructions as
permanent project documentation.
