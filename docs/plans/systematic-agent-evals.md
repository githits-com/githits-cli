# Systematic Agent Eval Runs And Metrics

## Status

- Overall: IN PROGRESS
- Current phase: Phase 3 — Daily Main Execution And Persistent Export (BLOCKED ON
  PRODUCT DECISIONS)
- Previous work: Phase 2 correction is COMPLETE. Its discovery, intent, full,
  scenario-aware comparison, metrics-compatibility, and Codex interactive
  isolation contracts are locally validated; daily execution and persistence
  remain Phase 3 work.
- Owner: repository maintainers
- Last verified: 2026-08-31
- Deployment: Phase 1 merged to `main`; local maintainer tooling is available.
  Scheduled execution and external persistence remain Phase 3 work.

## Problem And Expected Outcome

The repository has a real-agent eval harness and a useful workload corpus.
Phase 1 added schema-validated metrics and Phase 2 added named suites, paired
comparison, isolation validation, and measured local baselines. Subsequent live
evidence shows that a registered MCP server with descriptor-only exposure does
not reliably cause current lower-cost models to select GitHits. That is a useful
autonomous-discovery signal, but it makes descriptor/full across every workload
the wrong primary eval matrix. Codex `agent:session` now has a causal isolated
diagnostic contract; Claude and OpenCode sessions remain non-causal for
instruction-isolation evidence.

When this effort is complete:

- maintainers can run three explicitly different scenarios locally: neutral
  descriptor discovery, descriptor exposure plus one stable GitHits intent
  sentence, and full repository guidance;
- normal workload runs use the one-line intent scenario to measure tool choice,
  tool frequency, tokens, duration, cost, and answer evidence after the user has
  expressed intent, while neutral descriptor runs remain a small autonomous-
  discovery canary;
- every workload/agent execution emits a versioned, vendor-neutral metrics
  record containing harness identity, tool usage, token usage, duration, cost,
  status, and links to the raw evidence;
- a local paired run can compare a candidate checkout with a main baseline while
  holding agent harness versions and model settings constant;
- a clean automation runner executes the approved neutral discovery canary
  across the approved agent/model matrix and the normal Luna intent suite
  daily from `main`, preserves raw artifacts, and exports the same normalized
  records to the selected long-term service;
- daily results are observational and alert on material drift without becoming
  a flaky merge gate; and
- result quality can be added later through explicit workload rubrics without
  changing the execution or metrics contracts.

## Scope

In scope:

- MCP runs against the local checkout with guidance and prompt intent represented
  as separate dimensions;
- initial primary workload matrix: Codex `gpt-5.6-luna` with `low` reasoning,
  descriptor exposure, and one stable GitHits intent sentence;
- a neutral descriptor canary for autonomous tool discovery, with the local
  suite contract able to identify more than one agent/model cell without
  treating different agent CLIs as equivalent;
- full guidance as a manual/local diagnostic rather than a scheduled peer of
  every intent run;
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
- automated expansion to Claude or additional Codex models before their exact
  agent CLI, model, adapter, authentication, and budget are approved;
- the three experimental-tool workloads in the stable daily suite;
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
  event count, errors, self-reported issues, matched normalized metrics, and
  logical calls by normalized tool and surface. The Phase 2 suite layer adds
  persistent suite artifacts and matched-cohort token, cost, duration, and
  per-tool comparisons around those reports.
- There are 25 non-reporting workloads: 21 automation-safe stable workloads,
  one stateful onboarding workload, and three explicitly experimental-tool
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
- The corrected Codex workload and interactive paths require a caller-supplied
  dedicated eval home containing authentication and Codex-managed runtime
  state, keep fresh per-workload OS homes, and reject root-level global
  instruction files. Non-interactive `codex exec` retains its supported
  `--ignore-user-config`; interactive `agent:session` omits that exec-only flag,
  strictly validates direct skills/config inputs, and disables the external
  app/plugin surfaces. The clean scenario evidence and the 2026-08-31 manual
  Luna session now establish the local isolation contract; Phase 3 remains
  blocked on the service, runner, and budget decisions below.
- The accepted v4 Luna-low descriptor cell was clean but made zero GitHits calls;
  its paired full-guidance cell made three successful MCP calls. A separate
  clean Luna-high descriptor run on 2026-08-29 also made zero GitHits or CLI
  calls, performed seven built-in web searches, took 82.4 seconds, and cost an
  estimated \$0.01941716. Higher reasoning therefore did not make this workload
  a GitHits discovery success.
- The user separately observed in `claude.ai` that Sonnet required an explicit
  GitHits nudge while Opus selected the connected tools without one. This is
  useful product evidence but is not instrumented and is not equivalent to the
  Claude Code harness. Automated evidence must identify the existing `agent`,
  exact agent CLI version, and model rather than borrowing this hosted result.
- The Codex path in `bun run agent:session` now applies the workload runner's
  disposable acting-agent roots, validates the caller's dedicated
  `CODEX_HOME` and its direct skills/config contract before preparation, clears
  ambient MCP servers, and keeps only the intended local GitHits MCP target.
  Manual Luna validation confirms that caller-global skills do not appear;
  Claude and OpenCode remain non-causal for instruction-isolation evidence.

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

The original rollout estimate assumed every stable workload ran in both the
descriptor and full profiles. Naively scaling those measured Luna shards gives
historical capacity numbers, not the cost of the revised scenario policy:

| Suite                                                          | Executions | Approximate wall time at two shards |      Approximate cost |
| -------------------------------------------------------------- | ---------: | ----------------------------------: | --------------------: |
| Canary: 2 workloads × 1 agent × 2 profiles                     |          4 |                3.3 minutes measured | \$0.046 base estimate |
| Smoke: 6 workloads × 1 agent × 2 profiles                      |         12 |                          10 minutes |               \$0.139 |
| Stable full: 21 workloads × 1 agent × 2 profiles               |         42 |                          35 minutes |               \$0.485 |
| All current workloads, including stateful/experimental: 25 × 2 |         50 |                          42 minutes |               \$0.577 |

Workload mix, the one-line intent prompt, and provider behavior can move these
figures substantially. The corrected neutral canary and Luna intent suite
measurements below provide evidence for Phase 3's later budget and timeout
decisions. The
contaminated two-profile stable-full total cannot be divided in half and called
a verified intent-suite estimate.

### Verified instrumentation defect and resolution

The Codex descriptor-only package workload used a GitHits CLI fallback through
`npx -y githits@latest`, but `tool-calls.json` and the report recorded zero
calls. `extractToolCalls()` previously included CLI calls only for the Skills
surface or the full MCP profile. Phase 1 records the fallback in both MCP
profiles, and the isolation correction now makes any such MCP fallback a failed
validation. This keeps an accidental surface change visible rather than
mistaking it for successful MCP use. Skills runs continue to use the CLI
surface by design and remain valid.

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
  -> explicit scenario cells (agent + model + reasoning + guidance + intent)
  -> local suite orchestrator
  -> existing agent runner
  -> immutable raw workload artifacts
  -> provider-specific usage/tool adapters
  -> versioned normalized metrics.json
  -> derived per-tool counts + local report
  -> suite summary + compatible baseline comparison
  -> later: CI artifact retention + selected-service exporter
```

### Boundaries And Responsibilities

1. **Suite manifest**

   A repository-owned manifest defines every workload ID, path, safety class,
   and membership in `canary`, `smoke`, `stable-full`, `stateful-manual`, or
   `experimental`. Validation compares the manifest with every workload
   Markdown file except `REPORTING.md`, so an added or removed workload cannot
   remain silently unclassified. The manifest defines execution inputs, not
   thresholds or vendor configuration. Workload prompts remain guidance-free.
   Scenario policy separately decides whether a run receives no intent prompt,
   one stable GitHits intent sentence, or full guidance.

2. **Execution runner**

   `scripts/agent-eval.ts` continues to own isolated workspaces, process
   invocation, timeouts, redaction, and raw artifacts. A suite command expands
   the manifest into the existing repeated `--workload` contract. The runner
   captures the agent kind, exact agent CLI version, resolved model,
   reasoning setting, guidance profile, prompt-intent profile, git SHA/dirty
   state, and timestamps needed to explain drift.
   Paired execution separates the measurement-harness checkout from the target
   checkout: the candidate checkout owns the suite manifest, workload prompts,
   reporting/schema, adapters, comparison, and output for both sides. Each
   explicit target root owns the local MCP/CLI implementation, full-profile
   GitHits skill and project-guidance content, and git identity under test. The
   installed Codex CLI/model/version is the ambient agent harness and is held
   constant for a local pair. Existing one-off commands default the measurement
   and target roots to the current checkout. The Codex interactive session path
   reuses the same local-target construction and isolation boundary as the
   workload runner for its causal Luna diagnostic surface.

3. **Scenario identity**

   Guidance and user intent are recorded as separate identity dimensions, but
   the initial MCP policy is the following closed set rather than their full
   Cartesian product:

   - `discovery`: `guidanceProfile=descriptors`, `intentProfile=neutral`;
   - `intent`: `guidanceProfile=descriptors`, `intentProfile=githits`;
   - `full`: `guidanceProfile=full`, `intentProfile=neutral`.

   Reject full-plus-intent, Skills-plus-intent, non-MCP intent, and any unnamed
   combination before launch. Future combinations require an explicit policy
   change and become distinct comparison series.

   The initial `githits` intent fragment is exactly `Use GitHits for this task.`
   It names the product but gives no tool names, commands, schemas, routing, or
   recovery instructions. The fragment is harness-owned and stored by content
   hash in run and suite artifacts; it is not copied into workload
   Markdown. Changing it starts a new comparison series. `descriptors` means
   registered MCP tools and their schemas with no harness-installed GitHits
   guidance. It does not claim a blank model, absence of pretraining knowledge,
   or equivalence to Claude Desktop, `claude.ai`, or another host.

4. **Provider adapters**

   Small pure adapters parse provider event formats. Phase 1 implements Codex;
   the same contract accepts a Claude adapter in the broader-matrix phase.
   Adapters preserve the provider payload needed for audit and map it into
   common non-overlapping fields. Tool extraction records both the logical GitHits
   operation and its surface (`mcp` or `cli`) in every profile. CLI fallback is
   visible and invalidates an MCP workload; it is never counted as successful
   MCP use.

5. **Normalized metrics contract**

   One versioned `metrics.json` per run contains a record per
   workload/agent/profile execution. Each record includes:

   - stable run ID and workload ID;
   - target git SHA/dirty state, agent CLI version, requested and resolved model,
     reasoning effort, surface, server, guidance profile, prompt-intent profile,
     and prompt-fragment hash;
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
   The persisted logical `tools.sequence` remains the single source for tool
   frequency. Reports derive deterministic `callsByTool` entries grouped by
   normalized tool name and surface, with total and per-status counts. This
   makes frequency directly visible without duplicating it in schema-version-1
   metrics or requiring a migration of existing Phase 1 artifacts.

   A versioned parent `suite.json` owns suite name, measurement-harness Git
   identity, workload/content identity, matrix identity, child-run references,
   and suite aggregates. A paired `comparison.json` links two compatible suite
   artifacts. Suite context therefore stays with suite orchestration instead of
   being threaded into the single-run metrics adapter.

6. **Comparison**

   Local comparison accepts two run directories and compares only records with
   compatible workload, agent, model, reasoning, surface, server, guidance
   profile, prompt-intent profile and fragment hash,
   experimental-tool setting, and published-package spec when applicable. It
   shows absolute and percentage token/cost/duration deltas, per-tool logical
   call-count deltas, tool additions/removals, surface changes, ordered tool-use
   changes, failures, and harness-version changes. Incompatible dimensions are
   explicit warnings, not silently merged results.

7. **Persistence/export**

   In Phase 3, GitHub artifacts retain immutable raw evidence for replay and the
   selected service receives normalized records for long-term per-eval/per-agent
   trends. The exporter is a thin boundary around the service SDK or API. No
   repository-owned persistence infrastructure is introduced.

8. **Quality evaluation**

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
  `githits-onboarding`, `experimental-resolution-follow-up`,
  `experimental-site-resolution-follow-up`, and `experimental-code-diff`.
- **Stateful manual (1):** `githits-onboarding`. It is never included in a
  normal local or scheduled suite because the current harness inherits the real
  home/config roots and the workload can install or modify user-scoped agent/MCP
  state. Execution requires an explicit stateful acknowledgement and a verified
  disposable home/config environment.
- **Experimental (3):** the three experimental-tool workloads, run manually and
  with their required server flag.

Local policy:

- run the canary in neutral `discovery` mode while changing tool descriptors,
  the agent harness, or model versions;
- use `intent` mode for canary, smoke, and stable-full workload behavior;
- use smoke intent runs for broad agent-facing changes and paired
  baseline/candidate comparison;
- use targeted workloads from the existing routing table for tool-specific
  changes;
- run stable-full intent locally only when explicitly needed;
- run `full` only as an explicit local diagnostic of repository-installed
  guidance. Do not use it as a proxy for hosted connector behavior.

Automation policy after Phase 3:

- run the two-workload neutral descriptor canary from `main` across the approved
  agent/model cells to detect autonomous-discovery drift;
- run the normal Luna-low workload set with the one-line intent nudge, with the
  final daily suite size chosen from corrected timing and cost measurements;
- do not run neutral descriptors across the remaining stable workloads and do
  not schedule full guidance by default;
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
- The existing two-shard Luna validation is useful capacity evidence but does
  not define the corrected scenario matrix. Concurrency and cost must be
  remeasured for the neutral-canary plus intent-suite shape.
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
- **Budget and concurrency:** approve a daily dollar/quota ceiling before Phase
  3. The measured Luna-only stable-full run cost an estimated \$0.48549548 for
     both historical profiles, before service charges; it is contaminated capacity
     evidence, not the revised intent-suite budget.
- **Harness update policy:** confirm whether daily jobs intentionally install
  latest agent CLIs, use an approved moving version range, or run both floating
  and pinned controls. Latest-only is the smallest design that detects harness
  drift but makes upstream changes part of the daily variance.
- **Discovery matrix:** approve the exact agent CLI/model/reasoning cells and cadence
  for the neutral two-workload canary. The manual `claude.ai` observation does
  not authorize or configure Claude Code automation, and marketed model names
  alone are insufficient identity.

The following must be resolved before Phase 4:

- which additional Codex and Claude agent/model cells are worth retaining in the
  discovery canary after the Luna-only pipeline and service integration are
  stable, including their adapter, authentication, cadence, and budget policy.

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
- Resolve every imported suite/child artifact reference through the same
  realpath containment rule as existing run reports; reject traversal and
  symlink escape before reading referenced content.
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
- Existing schema-version-1 metrics and suite artifacts remain readable. The
  compatibility reader maps historical `descriptors` cells to `discovery` and
  historical `full` cells to `full`, because neither prompt contained an intent
  nudge. It never maps either profile to `intent`; existing isolation violations
  and contamination warnings remain attached to those artifacts.
- `report.json` can evolve by schema version; old run directories remain
  readable through tested compatibility fixtures or a clear version error.
- The new suite command composes the existing runner rather than creating a
  second execution implementation.
- Cross-agent metrics are stored together but direct baseline deltas are made
  only within compatible agent/configuration dimensions.

### Performance And Cost

- Phase 2 establishes timing and cost baselines using the same local source
  launch contract intended for the first daily pipeline before concurrency and
  timeouts are finalized. These measurements size agent work; they are not CLI
  performance benchmarks.
- Reports expose per-workload and aggregate duration/cost so slow or expensive
  workloads can be identified rather than hidden in one suite total.
- Mutable package/backend responses are a confounder for token trends. Preserve
  raw results and result byte counts where exposed so an alert can be
  investigated; do not claim that a token delta alone proves harness drift.
- Concurrency is bounded by the explicit configured scenario cells. No queue or
  scheduler is added in the repository.

### Testing

- Use `bun test` with captured, redacted Codex event fixtures in Phase 1; add
  Claude fixtures with any later Claude adapter.
- Test adapters independently from process execution.
- Cover repeated events, terminal aggregate selection, inclusive cached-token
  semantics, reasoning-token non-double-counting, absent/partial telemetry,
  CLI-fallback traces in both MCP profiles, failed calls, and secret redaction.
- Test suite expansion and compatible/incompatible comparison behavior without
  invoking paid agents.
- Test exact intent-fragment placement and hash, neutral prompt absence,
  discovery/intent/full scenario expansion, cross-agent incompatibility, and
  deterministic descriptor-to-discovery and full-to-full historical mapping.
- Test that Codex `agent:session` and workload execution share the same isolation
  and local MCP construction contract; a fixture global skill must not be
  visible to either surface.
- Run targeted live canary execution only after deterministic tests pass; paid
  runs are validation evidence, not unit tests.

### Documentation And Release

- Update `eval/agentic/README.md` as commands, artifact contracts, suite policy,
  and isolation guidance change.
- Keep the durable architecture/operations documentation in
  `docs/implementation/agentic-eval-metrics.md` current before this plan is removed;
  `docs/implementation/EVAL_HARNESS.md` already documents a separate prompt
  injection guardrail harness.
- Add an independent `changes/<slug>.changed.md` fragment with explicit
  `githits` and `@githits/mcp` impacts for each implementation increment. The
  Phase 1 metrics tooling is maintainer/operator-facing, so its fragment uses
  `none` for both public artifacts.
- After the complete effort is implemented and documented, delete this plan.

## Phase Map

1. **Phase 1 — trustworthy local metrics (MERGED):** every existing local run
   produces auditable per-workload tool/token/cost metrics, including visible
   fallback telemetry and explicit unknown telemetry.
2. **Phase 2 — systematic local suites and paired comparison (CORRECTION
   COMPLETE):** scenario-aware suites, metrics, comparisons, workload
   isolation, and Codex interactive isolation parity are implemented and
   validated; corrected discovery/intent evidence supersedes the two-profile
   behavior policy.
3. **Phase 3 — daily main execution and persistent export (BLOCKED ON PRODUCT
   DECISIONS):** a clean runner executes the approved neutral discovery canary
   and Luna intent suite daily from `main`, retains raw evidence, and exports
   normalized records to the selected service.
4. **Phase 4 — broader discovery matrix (PLANNED):** the proven metrics, suite,
   comparison, and persistence contracts add approved Codex/Claude agent-model
   cells to the neutral canary without changing Luna history.
5. **Phase 5 — trend policy and result quality (PLANNED):** historical variance
   supports calibrated drift alerts, and approved workload rubrics optionally
   assess answer quality without changing the execution contract.

## Phase 1 — Trustworthy Local Metrics

### Status

MERGED — implementation and validation complete. The durable behavior is
schema-validated local metrics, visible fallback telemetry, explicit unknown
telemetry, and compatibility with existing raw run artifacts. MCP fallback is
now rejected by the Phase 2 isolation correction.

### Expected Outcome

Every Luna-low workload run writes a versioned metrics artifact whose token,
cost, duration, and GitHits tool-use fields can be traced back to raw Codex
events. Fallback telemetry is visible in every guidance profile; an MCP
fallback is a validation failure, and missing telemetry cannot silently appear
as zero.

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
   calls, historical descriptor-profile CLI fallback, failed tool calls, and
   absent telemetry. Write failing adapter/extraction tests first.
2. **Completed:** Extract pure provider usage adapters and a common metrics schema. Document
   field semantics at the interface and validate written artifacts at runtime
   using the repository's existing Zod convention.
3. **Completed:** Correct CLI extraction so every GitHits fallback is recorded regardless of
   guidance profile, and update report warnings to identify the intended MCP
   surface versus observed CLI surface. The isolation correction rejects MCP
   fallback traces.
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
  historical fallback fixtures must remain non-zero and tagged `cli`; any live
  MCP fallback must fail validation.

### Deterministic Implementation Evidence

- `bun test scripts/agent-eval.test.ts scripts/agent-eval-metrics.test.ts`:
  94 tests passed with no failures on 2026-08-28.
- `bun run typecheck`, `bun run format:check`, `bun run lint`, and
  `bun run build`: passed on 2026-08-28.
- `bun test`: 3,338 tests passed with no failures, across 184 files, with
  10,762 expectations in 59.05 seconds on 2026-08-28.
- The implementation is covered by deterministic metrics, redaction,
  compatibility, and cross-platform path tests; typecheck, formatting, lint,
  and build validation passed during acceptance.

### Luna Validation Canary

The historical Luna-low two-workload canary completed successfully in all four
executions (2 workloads × 2 MCP guidance profiles) on 2026-08-28, but its
descriptor behavior was contaminated and is not acceptance evidence. Metrics
aggregates were:

| Guidance profile | Workloads | Summed workload duration | Logical calls | Uncached input | Cached input | Output | Reasoning detail | Base-rate estimate |
| ---------------- | --------: | -----------------------: | ------------: | -------------: | -----------: | -----: | ---------------: | -----------------: |
| descriptors      |         2 |                203.857 s |            14 |         62,329 |      279,296 |  3,063 |              561 |       \$0.02172732 |
| full             |         2 |                107.390 s |            13 |         66,823 |      278,528 |  2,225 |              452 |       \$0.02160516 |

Raw terminal usage matched metrics for all four executions. Raw tool
observations paired 2:1 by provider ID into logical calls. The descriptors
express workload used 10 MCP calls and the package workload used 4 CLI calls;
that fallback is contamination evidence and would now fail isolation
validation. The full profile used all 13 calls through MCP.

### Acceptance Criteria

- [x] Each of the four canary executions emits one valid metrics record with the
      complete compatible identity dimensions.
- [x] Codex token buckets match the terminal aggregate fixtures and reasoning tokens
      are not double-counted.
- [x] Current Codex cost is explicit as a base-rate estimate or unknown; the Luna
      rate snapshot makes the base calculation reproducible, and request-level
      long-context uncertainty remains visible. A future provider-reported cost
      kind requires a schema revision.
- [x] Descriptor-profile CLI fallback telemetry is visible and cannot be
      mistaken for MCP success or zero GitHits use; live MCP fallback now fails
      isolation validation.
- [x] Missing usage or cost is represented as unknown with a warning.
- [x] No credential value appears in committed fixtures or generated artifacts.
- [x] Existing local eval commands and raw artifacts continue to work.
- [x] Updated documentation accurately states what the metrics do and do not prove.

## Phase 2 — Systematic Local Suites And Paired Comparison

### Status

CORRECTION COMPLETE. The suite, metrics, comparison mechanics, workload
isolation, and Codex interactive-session parity are validated locally. The
original policy of running every workload across descriptor/full profiles is
superseded by the explicit discovery/intent/full scenario contract. This phase
remains local-only; paid CI scheduling, service persistence, broader model
automation, and quality judging remain later work.

The previous 42-cell paid descriptor/full behavior comparison was contaminated:
global skills were loaded in every descriptor workload and nine descriptor
workloads attempted the CLI fallback. Its measured timing and cost remain
provisional capacity/cost evidence only; it cannot support minimal-versus-full
conclusions. Exact findings are recorded in
`docs/implementation/agentic-eval-metrics.md`.

### Expected Outcome

Maintainers can run the neutral discovery canary, normal intent-nudged suites,
and an explicit full-guidance diagnostic locally, then compare a main target
with a candidate target using one candidate-owned measurement harness. Reports
show which GitHits tools were used, how many logical calls each tool received,
which surface handled them, and how those counts changed alongside token,
duration, cost, status, agent CLI identity, guidance, and intent. The Codex
interactive session command obeys the same isolation contract. Corrected clean
measurements replace the historical two-profile estimate before daily
automation is designed.

### Assumptions

- Phase 1's logical `tools.sequence` semantics remain the source for suite
  aggregation. The correction adds scenario identity through a new metrics
  schema version without changing or duplicating tool-call semantics.
- A dedicated eval `CODEX_HOME` is supplied by the caller for every live Codex
  surface; dry-runs do not require it. The home contains subscription/API-key
  authentication and Codex-managed runtime state, but no root-level
  `AGENTS.override.md` or `AGENTS.md`. Local subscription auth uses a dedicated
  `CODEX_HOME`, while CI will use API-key authentication. Non-interactive Codex
  eval commands disable `apps`, `plugins`, and `remote_plugin` while retaining
  supported `--ignore-user-config`; interactive sessions disable those surfaces
  but omit that exec-only flag and strictly validate direct skills/config keys.
- The bounded paid pair used the same installed agent CLI version on both sides;
  the comparison records this identity explicitly.
- The exact nudge text is a hashed harness input, not workload content:
  `Use GitHits for this task.`
- A user-observed `claude.ai` Sonnet/Opus difference is directional evidence
  only. It is not relabeled as Claude Code evidence or used as an automated
  baseline.

### Unknowns Or Product Decisions

The exact scheduled discovery model matrix remains a Phase 3 product decision.
Phase 2 supports explicit scenario/model identity and validates Luna locally;
it does not spend across an unapproved broad model matrix. The target service
and automation budget also remain later-phase decisions.

### Dependencies

- Phase 1 accepted and merged.
- Current workload routing table in `eval/agentic/README.md`.
- An explicit main worktree or equivalent read-only baseline checkout available
  to the local paired command; the implementation must not mutate, reset, or
  create user worktrees.
- Dependencies installed in both target checkouts so the candidate-owned
  harness can start each checkout's local MCP server.

### Likely Affected Components

- `eval/agentic/suites.json`
- `scripts/agent-eval-suite.ts` and focused tests
- `scripts/agent-eval.ts` target-root handling
- `scripts/agent-session.ts` isolation and local-target parity
- `scripts/agent-eval-report.ts` comparison logic
- existing agent-eval metrics/report tests
- `package.json` scripts
- `eval/agentic/README.md`
- `docs/implementation/agentic-eval-metrics.md`
- `changes/`

### Contracts And Failure Behavior

1. **Manifest and suite selection**

   `eval/agentic/suites.json` contains one entry for every workload Markdown
   file other than `REPORTING.md`. Each entry has a stable ID, repository-
   relative path, one safety class (`stable`, `stateful`, or `experimental`),
   and its named-suite memberships. Validation rejects duplicate IDs or paths,
   missing files, unclassified files, unknown suite names, a non-stable member
   in canary/smoke/stable-full, and violations of canary ⊆ smoke ⊆ stable-full.
   The verified starting inventory is 21 stable, one stateful, and three
   experimental workloads.

2. **Local commands and matrix**

   Add one documented entrypoint with explicit modes:

   - `bun run agent:e2e:suite run --suite <name>` runs one target checkout;
   - `bun run agent:e2e:suite pair --suite <name> --baseline-root <path>` runs
     the baseline target and then the current candidate checkout;
   - `bun run agent:e2e:suite compare --baseline-suite <path> --candidate-suite <path>` compares two existing suite artifacts without
     invoking an agent.

   The suite command accepts explicit `discovery`, `intent`, and `full`
   scenarios. Default policy runs `discovery` plus `intent` for canary, `intent`
   only for smoke/stable-full/stateful-manual/experimental, and `full` only when
   explicitly requested. The
   initial paid behavior cell is Codex `gpt-5.6-luna`, reasoning `low`, local
   MCP. Scenario cells are explicit records rather than an unconditional
   guidance-profile Cartesian product, so the canary can later include approved
   agent/model cells without applying them to all 21 workloads. Workloads remain
   sequential inside each cell; configured cells may run concurrently within
   the approved bound.

   The one-off runner accepts the same intent profile so targeted and suite
   evidence have identical prompt construction. It appends the exact harness-
   owned sentence `Use GitHits for this task.` to the acting prompt before the
   unchanged reporting contract. Neutral and full scenarios append nothing.
   Record the intent profile, fragment content hash, and final redacted prompt
   identity before launch. Specifically, full-plus-intent, Skills-plus-intent,
   non-MCP intent, and unnamed combinations fail before paid work.

   A paired comparison runs the baseline suite and candidate suite sequentially
   so only one configured suite matrix is active at once. The pair command must
   run from the candidate checkout; that checkout is both the measurement-
   harness root and candidate target, so a separate candidate-root flag cannot
   point execution at a different tree.

   The suite artifact's `dryRun` mode is an explicit comparison dimension:
   mixed dry-run/live evidence is incompatible and suppresses direct metric
   deltas. The experimental suite requires explicit selection and enables the
   required local experimental-tool flag. `stateful-manual` is manifest-visible
   and remains validation/dry-run-only in Phase 2 by policy; it is never
   included in another suite.

3. **Codex interactive isolation parity**

   The Codex path in `bun run agent:session` must construct the same isolated
   agent home/config, validate the same caller-supplied dedicated `CODEX_HOME`,
   disable the same Codex app/plugin inputs, and register the same target-owned
   local MCP command as Codex workload execution. The interactive working
   directory remains disposable.
   Interactive Codex omits the unsupported exec-only `--ignore-user-config`
   and `--ignore-rules` flags. Its live preflight rejects every direct
   `$CODEX_HOME/skills` entry except `.system` and every `config.toml` key except
   `model`, `model_reasoning_effort`, and project `trust_level`.
   Session startup must not copy repository full guidance unless explicitly
   requested and must not expose caller-global skills. Document that an
   interactive conversation is a diagnostic, not a persisted eval artifact.
   Claude and OpenCode sessions remain explicitly non-causal until their
   subscription authentication can be separated from user guidance safely.

4. **Measurement harness versus target checkout**

   Keep the current checkout as the measurement-harness root: it owns suite
   definitions, workloads, reporting instructions, result schema, adapters,
   normalization, comparison, and output. Add a target root that defaults to
   the harness root for existing one-off commands. The target root owns the
   local GitHits MCP/CLI launch, git-under-test identity, copied
   `skills/githits-mcp` content, and the `GITHITS_GUIDANCE_BLOCK` exported by its
   `src/commands/init/guidance-assets.ts`. The candidate harness continues to
   own the mechanics that install those target-owned inputs into the isolated
   workspace. This makes descriptor/runtime and full-guidance changes visible
   without comparing two different measurement implementations.

   Load the target guidance module through a file URL dynamic import and
   runtime-validate its `GITHITS_GUIDANCE_BLOCK` string export. The module is
   currently import-free; a missing module, import failure, or invalid export is
   a pre-run target validation error. Target skill copying reads the target
   root's `skills/githits-mcp` directory through the same explicit boundary.

   Preserve the current one-off CLI and `run.json.git` behavior, with `git`
   continuing to mean the target checkout. Suite artifacts record the
   measurement-harness Git identity separately from every target Git and target
   guidance identity. Absolute local roots are diagnostic run metadata and are
   not part of the later service-neutral metrics export.

5. **Per-tool frequency**

   A pure aggregation function reads the persisted logical
   `metrics.json.records[].tools.sequence` and emits deterministic
   `callsByTool` entries grouped by `(surface, normalized tool name)`. Each entry
   contains total logical calls plus `started`, `completed`, `failed`, and
   `unknown` status counts. Workload reports and suite aggregates expose these
   entries in stable surface/tool order. Raw provider event counts remain
   separate audit evidence and are never presented as call frequency. Missing
   or unsupported logical telemetry yields `callsByTool: null`, not an empty
   list or zeros. Existing Phase 1 artifacts remain readable because counts are
   derived from their persisted sequence.

6. **Suite and comparison artifacts**

   Each target execution writes a schema-validated `suite.json` containing a
   suite ID/name, timestamps, harness Git identity, target Git identity, explicit
   scenario cells with agent/version/model/reasoning/guidance/intent identity,
   workload/reporting/schema/prompt-fragment content hashes, cell statuses and
   relative run-artifact references, wall and cumulative agent time,
   workload/failure totals, normalized token/cost totals, aggregate
   `callsByTool`, and warnings. Raw workload artifacts and child `metrics.json`
   files remain authoritative. Introduce a scenario-aware suite schema version;
   preserve schema-version-1 reading through the deterministic historical
      descriptor-to-discovery and full-to-full mapping above. Only the exact
      historical `descriptors` and `full` profiles are valid; missing, null, or
      other profiles are rejected rather than inferred as `intent`.

   Live paired mode and offline compare mode call the same pure comparison and
   write a schema-validated `comparison.json` with one pair ID and references to
   its baseline and candidate suite artifacts. Agent, exact agent CLI version,
   model, effort, surface, server, guidance profile, prompt-intent profile and
   hash, workload, execution mode, experimental-tool,
   published-package, and measurement-content mismatches are checked before
   calculating direct deltas.
   An agent CLI version mismatch remains reportable: it produces a prominent
   warning and prevents the result from being labeled repository-only, but does
   not suppress otherwise compatible deltas.

   Measurement-content identity uses SHA-256 over exact file bytes and records
   forward-slash repository-relative paths in stable sorted order. Target
   guidance hashes are recorded separately as an intended repository-change
   dimension, not as a compatibility failure. A measurement-harness Git
   mismatch is an attribution warning and prevents a repository-only label.
   Measurement-content mismatches have narrower behavior: a workload-file hash
   mismatch excludes that workload's scenario cells from direct metric deltas,
   while a reporting-contract or result-schema mismatch suppresses direct
   deltas for the entire suite. Identity and status differences remain visible
   in both cases.

   Offline comparison writes by default under the current harness checkout's
   `.agent-eval/comparisons/<timestamp>/comparison.json`, with an explicit
   output override available. It records each input suite ID, the SHA-256 hash
   of that suite artifact, and its diagnostic absolute path. Each suite is
   loaded independently, and its child references are resolved and contained
   relative to that suite's own directory; the two suites need not share a
   parent directory.

   For each compatible workload, comparison reports show before/after/absolute
   delta for logical calls grouped by tool and surface, additions/removals,
   status-count changes, ordered sequence changes, token buckets, cost,
   duration, and process/final status. Suite aggregate deltas are calculated per
   metric over the intersection of compatible workload/scenario cells where
   that metric is known on both sides. The report lists the included and
   excluded cell identities for each aggregate family; full-matrix
   status/failure differences remain visible separately. Independently summing
   different baseline and candidate cohorts is forbidden.

   A zero baseline is labeled `added` or `removed`; it never produces an
   infinite percentage. Missing or unknown values remain unknown. A tool moving
   between MCP and CLI appears as separate removal/addition entries even when
   its combined count is unchanged. A single-suite aggregate `callsByTool` is
   `null` when any selected cell lacks logical tool telemetry, with the missing
   cell IDs listed, so it cannot silently undercount the suite.

7. **Partial failure and output**

   Reject manifest, option, root, and compatibility errors before paid work
   whenever they are knowable up front. Resolve referenced suite, child-run,
   metrics, and report artifacts within their owning suite directory using
   realpath containment; traversal or symlink escape is a validation error. A
   workload failure does not stop its shard; a shard setup failure does not
   erase a successful sibling shard. Partial suite artifacts list
   missing/failed cells and use the matched-cohort rule above rather than
   treating them as zero. Human output prints total execution count, wall time,
   cumulative agent time, token buckets, cost, failures, per-tool counts/deltas,
   and paths to raw and normalized artifacts.

   Phase 2 adds no GitHub Actions workflow, scheduled paid run, service SDK,
   exporter, repository database, queue, cache, lock, or retry mechanism.

### Original Ordered Implementation Steps (completed)

1. Write failing report tests for logical `callsByTool` aggregation and deltas:
   repeated calls, the same name across MCP/CLI, started-only/failed calls,
   missing telemetry, additions/removals, and zero baselines. Implement the
   pure derivation from `tools.sequence`, then expose it in JSON and terminal
   run reports without changing `metrics.json` schema version 1.
2. Add the complete 25-workload manifest and pure validation/expansion. Tests
   inventory the workload directory and prove exact classification, suite
   nesting, stable-only aggregate suites, and explicit stateful/experimental
   handling.
3. Separate harness and target roots in the existing runner. Write command/git
   identity and full-guidance source tests first, including Windows path
   semantics and a guidance-only difference between two target fixtures.
   Preserve current one-off defaults and artifact compatibility.
4. Add single-target suite orchestration with an injected shard executor for
   deterministic tests. Execute the two profile shards concurrently, preserve
   sequential workloads inside each runner, and write a validated partial or
   complete `suite.json` after both shards settle.
5. Add live pair mode from the current candidate checkout with one explicit
   baseline root, plus offline compare mode over two existing `suite.json`
   artifacts. Route both through the same pure comparison, validate compatible
   dimensions and content hashes, apply metric-specific matched cohorts,
   enforce containment for imported artifact references, and write the
   structured comparison plus readable per-tool, token, cost, duration, status,
   and identity deltas.
6. Update package scripts, agentic-eval documentation, and the existing durable
   implementation document, then add a maintainer-facing change fragment with
   `none` impact for both public artifacts.
7. Run deterministic validation, then dry-run every named suite. Run the live
   Luna-low canary, smoke, and stable-full suites once across both profiles, plus
   a bounded no-change paired canary. Record actual wall time, cumulative agent
   time, per-workload and total cost, failures, concurrency behavior, and
   per-tool counts in durable documentation. Do not execute onboarding live.

### Correction Ordered Implementation Steps

Keep this correction in the current eval increment. Scenario identity, suite
behavior, comparison compatibility, and live evidence must land together because
a split state would produce evidence whose inputs cannot be trusted or compared.
Codex interactive-session parity does not affect persisted artifacts, but it
stays in the increment because the user uses that session to inspect the same
Luna tool surface and explicitly rejected a split. This is a deliberate scope
choice, not a causal requirement of the suite schema.

1. Add failing pure tests for the three scenario definitions, exact nudge text
   and placement, neutral prompt absence, invalid combinations, scenario-cell
   expansion, and agent/intent/hash comparison compatibility. Include schema-v1
   fixtures proving the exact historical descriptor-to-discovery and
   full-to-full mappings and that neither becomes intent evidence.
2. Add a separately identified prompt-intent option to the existing one-off runner, bump
   the normalized metrics schema, and record its stable identity in run/metrics
   artifacts while retaining legacy readers. Keep workload Markdown neutral
   and keep full guidance target-owned. Do not encode tool names or routing
   advice in the nudge.
3. Replace the suite's hardcoded descriptor/full Cartesian matrix with explicit
   scenario cells and a scenario-aware artifact schema. Default canary to
   discovery plus intent, smoke/stable-full to intent, and full to explicit
   opt-in. Update pair/offline comparison and reports to include agent CLI,
   scenario, and fragment hash.
4. Make the Codex path in `agent:session` reuse the workload runner's existing
   disposable-home lifecycle and dedicated `CODEX_HOME` validation, and close
   the verified `buildCodexSessionCommand` flag gaps. The existing shared MCP
   and config builders remain the owners of command construction; the leak came
   from the session path bypassing workload isolation and omitting Codex flags,
   not from duplicated builders. Preserve each command's separate process
   lifecycle and artifact responsibilities. Claude and OpenCode sessions retain
   their current behavior but must be labeled non-causal until agent-specific
   subscription-auth isolation contracts are designed.
5. Update CLI help, README examples, durable implementation documentation, and
   the existing change fragment. Replace the README's blanket prohibition on
   appended guidance with the narrower contract: discovery/full append no
   intent, while the explicit intent scenario appends exactly the hashed
   one-line product nudge. State plainly that discovery is autonomous selection,
   intent is user-directed execution, full is repository-guided, and none
   simulates `claude.ai` or Claude Desktop. Keep the separate prompt-injection
   guardrail harness document unchanged unless its own contract actually changes.
6. Run focused tests, all agent-eval tests, the full unit suite, typecheck,
   format, lint, build, and dry-run every named suite/scenario. Manually start an
   isolated Codex Luna session and verify that normal global skills are absent while
   the intended local GitHits MCP remains connected.
7. After deterministic checks pass, run the bounded Luna-low package workload
   once in discovery and once in intent. Both must have zero CLI fallback and
   zero isolation violations; the intent cell must make a successful GitHits
   MCP call. If that pair passes, run the exact two-workload discovery canary and
   stable-full intent suite once to validate suite orchestration and establish
   actual time/cost; the smoke cohort is measured as the named subset of that
   stable run rather than rerun. This deliberately repeats only the bounded
   package cells after the safety check. Do not spend on a broader model matrix
   until Phase 3 approves it.

### Edge Cases And Boundaries

- Existing Phase 1 run directories have no suite parent but still derive
  per-tool counts from their logical sequence.
- Repeated start/completion provider events remain one logical call. Repeated
  calls with distinct provider IDs remain distinct and contribute separately to
  `callsByTool`.
- A guidance-only difference between target roots changes the installed
  full-profile skill/project guidance and its recorded target-guidance hashes;
  descriptor-only installation remains unaffected.
- Candidate and baseline workload/reporting content can differ only when
  opening externally produced suite artifacts. A workload hash mismatch excludes
  only that workload's cells; a reporting/schema mismatch suppresses all direct
  suite deltas. Paired execution uses candidate-owned measurement content for
  both targets by design.
- Offline comparison performs no agent or target launch and produces the same
  structured/readable deltas as the live pair for equivalent artifacts.
- Mixed dry-run/live suite artifacts are incompatible evidence; direct metric,
  logical-call, and ordered-sequence deltas are suppressed while status
  evidence remains visible.
- A dirty checkout is allowed for local exploration but must be labeled; the
  comparison cannot claim a reproducible git-only baseline.
- A profile or model missing from one side is a missing matrix cell, not a zero.
- An agent kind, model, intent profile, or intent-fragment mismatch is an
  incompatible cell, not a prompt delta to aggregate. An agent CLI version
  mismatch remains comparable harness-drift evidence but prevents a repository-
  only attribution. A hosted `claude.ai` observation is not a Claude Code cell
  at all.
- Neutral discovery may legitimately produce zero GitHits calls. That is the
  canary result, not a harness failure, provided MCP registration and isolation
  validate. An intent cell with zero GitHits calls is a behavioral failure to
  report.
- Experimental suites require the experimental server flag and never merge into
  stable-full by default.
- The onboarding workload is dry-run-only in the suite layer and never merges
  into stable-full by default.
- Concurrent shards must use distinct output and temporary workspace paths.
- Target roots may use POSIX or Windows paths. Artifact references remain
  portable forward-slash relative paths.
- User-supplied baseline and candidate roots are inspected and launched but are
  never reset, cleaned, checked out, created, or deleted.

### Original Verification

- [x] Deterministic tests for per-tool aggregation/deltas, manifest inventory and
      expansion, fixed Luna matrix identity, root separation, target-owned full
      guidance, content identity, partial failure, matched-cohort aggregate math,
      and traversal/symlink containment.
- [x] `bun test scripts/agent-eval*.test.ts`
- [x] `bun test`
- [x] `bun run typecheck`
- [x] `bun run format:check`
- [x] `bun run lint`
- [x] `bun run build`
- [x] Dry-run all named suites and inspect commands/output paths.
- [x] Historical live canary, smoke, and stable-full measurements using Luna-low
      and both descriptor/full profiles are preserved as contaminated capacity
      evidence; corrected scenario measurements are recorded below.
- [x] Run a no-change paired canary; it may show stochastic metric variance but no
      identity, harness, or content mismatch.

### Original Acceptance Criteria

- [x] One documented command runs each named suite and the default scenario-aware
      Luna matrix (canary discovery+intent; other named suites intent-only).
- [x] The manifest classifies exactly all 25 current workloads: 21 stable, one
      stateful, and three experimental. Adding an unclassified workload fails
      deterministic validation.
- [x] Every workload and suite report directly shows each normalized tool/surface
      pair and its logical call count; raw provider events cannot inflate it.
- [x] Comparison shows per-tool before/after counts and absolute deltas, including
      additions, removals, status changes, and MCP/CLI surface movement. Unknown
      telemetry remains unknown.
- [x] Normal canary/smoke/stable-full execution cannot invoke onboarding or an
      experimental workload. `stateful-manual` refuses live execution in Phase 2.
- [x] One documented local pair workflow compares an explicit main baseline with
      the current candidate checkout without mutating either checkout, and one
      offline workflow compares two existing suite artifacts without paid work.
- [x] Offline comparison writes a standalone validated artifact that identifies
      both input suites by ID/hash/path while containing each suite's child reads to
      that suite directory.
- [x] The paired workflow uses one candidate-owned measurement harness for both
      targets and records measurement-harness identity separately from each target
      checkout identity.
- [x] Each target supplies its own MCP/CLI implementation and full-profile GitHits
      skill/project guidance. A guidance-only target fixture produces different
      installed full guidance and target-guidance identity while using the same
      measurement harness.
- [x] Comparison exposes token and cost deltas, duration, failures, content
      identity, and exact agent CLI versions alongside tool-count deltas.
- [x] Aggregate deltas use only matched compatible cells with that metric known on
      both sides and list included/excluded cells; one-sided failures or unknown
      telemetry cannot create unlike-cohort deltas.
- [x] Workload-content mismatches exclude only affected workload cells;
      reporting/schema mismatches suppress all direct suite deltas; harness Git or
      agent CLI version mismatches remain prominent attribution warnings.
- [x] Complete and partial `suite.json` and `comparison.json` artifacts validate
      against their versioned schemas and reference the child raw/metrics evidence.
- [x] Imported child references cannot traverse or follow symlinks outside their
      owning suite directory.
- [x] Canary, smoke, and stable-full have measured wall-time and cost summaries;
      Phase 3 no longer relies on the two-workload linear estimate.
- [x] Local profile evidence is accepted as causal only after the run manifest
      and validation trace prove a clean instruction-isolated host.
- [x] Existing targeted `--workload` usage remains available.
- [x] No paid agent invocation is added to pull-request or `main` CI in this phase.

### Correction Verification And Acceptance

- [x] Pure tests cover scenario expansion, exact intent prompt identity,
      schema-v1 compatibility, cross-agent/model/intent incompatibility, and
      comparison cohorts; focused and full suites pass.
- [x] Codex `agent:session` and measured noninteractive workload execution share
      tested isolation/local-MCP construction and reject every direct
      `$CODEX_HOME/skills` entry except `.system`. Manual Luna validation on
      2026-08-31 with Codex CLI 0.151.0 listed only six bundled system skills
      and reported `githits: connected (18 tools)`; no GitHits/personal skills
      or Keychain access was needed. This closes the Opus F1 contamination gap.
- [x] Discovery runs receive no harness GitHits guidance or intent. Intent runs
      receive exactly `Use GitHits for this task.`. Full runs receive only the
      existing target-owned guidance and no additional nudge.
- [x] Default suite policy runs discovery+intent for canary, intent-only for
      smoke/stable-full/stateful-manual/experimental, and full only by explicit
      request.
- [x] Run, metrics, suite, comparison, and human reports identify agent, exact
      agent CLI version, guidance profile, intent profile, and intent-fragment
      hash. Historical descriptors map to discovery and historical full maps to
      full; missing/null/other profiles are rejected and never map to intent.
- [x] The bounded Luna-low discovery/intent package pair has zero CLI fallback
      and zero isolation violations; discovery completed successfully and intent
      recorded three MCP calls. The intent final was inconclusive/low confidence,
      so this proves tool execution/isolation, not answer quality.
- [x] The 2-cell discovery canary and 21-cell stable-full intent suite pass:
      canary wall/cumulative time is 267,221/266,375 ms; stable wall/cumulative
      time is 798,452/796,139 ms. Stable totals are 115 MCP calls, zero CLI
      calls, zero isolation violations, 655,840 uncached and 2,389,760 cached
      tokens, and an estimated $0.2030556. The named six-workload smoke subset
      is derived from those same stable metrics and is documented below.
- [x] Focused tests (178 pass, 1,004 expectations), full tests (3,579 pass,
      11,881 expectations), typecheck, format (442 files), lint (442 files),
      build, and all named-suite dry-runs pass. Dry-run coverage is canary
      discovery+intent (4 cells), smoke intent (6), stable-full intent (21),
      stateful-manual intent (1), experimental intent (3), and explicit canary
      full (2).
- [x] No workflow, exporter, service SDK, broad-model paid run, database, queue,
      cache, lock, or retry mechanism is added in this correction.

## Phase 2 Workload Isolation Correction

### Status

COMPLETE — the corrected workload and interactive Codex paths validate the
disposable acting-agent boundary, trusted MCP authentication, scenario identity,
and intended tool surface. Phase 3 remains blocked on product decisions.

### Canary evidence and correction history

On 2026-08-29, the corrected v2 canary used the dedicated local subscription
`CODEX_HOME` and passed isolation. The descriptor cell completed in 31.2
seconds with zero tools, CLI calls, or isolation violations. The full cell
completed in 35.0 seconds at an estimated $0.01069828 with two MCP calls and
zero CLI calls, but both GitHits calls returned `AUTH_REQUIRED` and the agent
fell back to web sources. The descriptor estimate was $0.00745976. This proves
the isolation boundary but not successful GitHits authentication or useful MCP
execution, so it was not acceptance evidence; at that point, the final
two-cell canary was pending.

The v3 rerun completed the authenticated MCP path: the descriptor cell took
30.9 seconds at an estimated $0.01057352 with zero tool calls, CLI calls, or
isolation violations; the full cell took 20.2 seconds at an estimated
$0.00726356 with three successful MCP calls and zero CLI calls. The full cell
was nevertheless marked failed because macOS `/var` and `/private/var` aliases
made the validator report the workspace-installed skill as external. Canonical
filesystem containment now addresses that false positive; this remains
root-cause validation history rather than accepted canary evidence. At that
point, the final canary was pending.

The v4 clean canary is accepted isolation and causal baseline evidence. The
descriptor cell succeeded in 27.8 seconds with 31,305 uncached input, 46,336
cached input, 934 output, and 237 reasoning-detail tokens; its base-rate
estimate was $0.00830852, with zero logical/MCP/CLI calls and no isolation
violations. The full cell succeeded in 24.3 seconds with 28,661 uncached
input, 67,584 cached input, 778 output, and 141 reasoning-detail tokens; its
base-rate estimate was $0.00801748, with three successful logical MCP calls
(`quick_start`, `pkg_info`, `pkg_vulns`), zero CLI calls, and no isolation
violations. Persisted MCP child `HOME` is `<redacted>` in `mcp.json` and
command metadata while `targetRoot` remains the real checkout for attribution.
After per-run workspace/output paths are normalized away, the command surfaces
are identical and both runs disable `apps`, `plugins`, and `remote_plugin`.
Sequential wall time was approximately 52.1 seconds and estimated cost was
\$0.016326. This is the clean causal baseline seed; it does not replace the
contaminated 42-cell stable-full capacity measurement.

The v4 live evidence covers MCP descriptor/full cells only. Skills-surface
isolation and authentication have deterministic injected-command coverage in
the test suite, but no live skills canary has run; Phase 2 acceptance does not
require one.

### Current corrected scenario evidence

The bounded Luna-low package pair was verified from the safe schema-v2 artifacts
on 2026-08-31. The discovery cell had one process/final success in 32,592 ms,
zero logical/MCP/CLI calls, 38,763 uncached input, 56,576 cached input, 842
output, 138 reasoning-detail tokens, and an estimated $0.00989452. The intent
cell had one process success and an inconclusive/low-confidence final in
275,327 ms, three logical MCP calls (`quick_start` completed;
`pkg_info` and `pkg_vulns` started), zero CLI calls, 51,445 uncached input,
207,360 cached input, 688 output, 121 reasoning-detail tokens, and an estimated
$0.0152618. Both cells had zero isolation violations. This proves tool
execution and isolation, not answer quality.

The discovery canary artifact recorded 2/2 process and final successes, 267,221
ms wall time, 266,375 ms cumulative agent time, two logical MCP `code_files`
calls (started), zero CLI calls, zero isolation violations, 77,831 uncached
input, 376,320 cached input, 2,971 output, 591 reasoning-detail tokens, and an
estimated $0.0266578 with `long_context_pricing_not_attributable` uncertainty.

The stable-full intent artifact recorded 21/21 process and final successes with
no failures, timeouts, or missing cells: 798,452 ms wall time, 796,139 ms
cumulative agent time, 115 logical MCP calls, zero CLI calls, and zero isolation
violations. It recorded 655,840 uncached input, 2,389,760 cached input, 20,077
output, 4,272 reasoning-detail tokens, and an estimated $0.2030556 using a
rate-based estimate with Codex CLI 0.151.0. One `code_grep` call failed and was
recovered within a successful workload; all other recorded tool calls
completed. The six-workload named smoke subset was derived from this same
stable artifact (not rerun): 6/6 process successes, 280,541 ms summed duration,
31 MCP calls, zero failed tool calls, 198,863 uncached input, 746,752 cached
input, 6,527 output, 1,187 reasoning-detail tokens, and an estimated
$0.06254004.

Stable `callsByTool` totals were `code_files` 5, `code_grep` 16 (15 complete,
one failed), `code_read` 31, `docs_list` 2, `docs_read` 14, `get_example` 1,
`pkg_changelog` 4, `pkg_deps` 4, `pkg_info` 2, `pkg_upgrade_review` 4,
`pkg_vulns` 8, `quick_start` 12, and `search` 12. The derived smoke subset
contained `code_files` 2, `code_grep` 5, `code_read` 8, `docs_read` 3,
`get_example` 1, `pkg_changelog` 2, `pkg_info` 1, `pkg_upgrade_review` 2,
`pkg_vulns` 1, `quick_start` 2, and `search` 4; all 31 calls completed.

On 2026-08-31, manual `bun run agent:session` validation with Codex CLI 0.151.0
and Luna high showed only six bundled system skills (Image Gen, OpenAI Docs,
Plugin Creator, Review Agent, Skill Creator, and Skill Installer), no GitHits or
personal skills, and `githits: connected (18 tools)`. No tool call or Keychain
access was needed for this diagnostic; the normal temporary-workspace trust
prompt required human approval. Two earlier stable intent attempts that waited
at an unattended macOS Keychain approval prompt are invalid/excluded evidence,
not a harness timeout defect. Local subscription/keychain-backed runs can
require operator presence; future daily CI must use separately provisioned
non-interactive API credentials without copying or reading credentials into
artifacts.

The trusted MCP child receives the caller's `HOME`, `USERPROFILE`,
`XDG_CONFIG_HOME`, and `APPDATA` for keychain- or file-backed GitHits
authentication, while the acting agent keeps disposable home/config paths.
Runtime MCP configs are consumed with the actual child auth roots and then
redacted in persisted artifacts.

### Acceptance criteria

- [x] Every workload gets fresh `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`,
      `APPDATA`, and temporary paths beneath a disposable root; persisted metadata
      contains only relative isolation labels.
- [x] Live Codex runs reject a missing or relative `CODEX_HOME`, and reject
      root-level `AGENTS.override.md`/`AGENTS.md`, before agent startup without
      reading auth material; Codex-managed nested state is allowed.
- [x] Full MCP installs only project guidance and `githits-mcp`; it does not
      install or prepend a GitHits CLI shim. Skills runs retain the CLI surface.
- [x] Acting prompts/results are product-neutral: `status`, `answer`, and
      `confidence`; offline reports remain compatible with legacy final artifacts.
- [x] External guidance reads, descriptor-profile guidance reads, and MCP CLI
      calls are persisted as redacted validation violations and fail the affected
      workload.
- [x] Clean Luna MCP descriptor/full canary confirms zero external guidance
      reads, zero CLI fallback, equal executable surface, and successful MCP
      authentication/execution.

Phase 2 correction is complete. The prior 42-cell behavior comparison remains
contaminated and must not be reinterpreted; v4 remains historical
discovery/full evidence, while the current scenario artifacts above establish
the corrected discovery canary and intent suite. Phase 3 remains blocked on the
existing service, runner, discovery-matrix, authentication, budget, concurrency,
and retention product decisions.

## Phase 3 — Daily Main Execution And Persistent Export

### Status

BLOCKED ON PRODUCT DECISIONS listed above. Detail this phase after the Phase 2
scenario/isolation correction and service/runner/budget/discovery-matrix
selection.

### Expected Outcome

A clean authenticated runner executes the two-workload neutral discovery canary
for each approved agent/model cell plus the approved Luna-low intent suite daily
from `main` and on manual dispatch. It retains immutable raw artifacts,
publishes a human-readable summary, and exports normalized per-workload/scenario
records to the selected long-term service. Full guidance remains local/manual.

### Assumptions

- Corrected Phase 2 discovery and intent measurements fit the approved daily
  budget and provider quotas.
- The selected service accepts the normalized dimensions or can be integrated
  through a thin mapping layer.
- The runner can install or provide the required agent CLIs without leaking
  credentials.

### Unknowns Or Product Decisions

- Service, retention, runner, authentication, daily intent-suite size, discovery
  agent/model cells and cadence, budget, concurrency, and harness-version policy
  must be approved before implementation details are added.

### Dependencies

- Phase 2 accepted and merged.
- Approved service and runner decisions.
- Provider and GitHits automation credentials provisioned outside the
  repository.

### Acceptance Criteria

- A scheduled run checks out the exact `main` SHA and produces all expected
  neutral-canary and intent-suite records or explicit partial-failure records.
- Exact agent CLI versions and resolved models make harness drift identifiable.
- Raw artifacts and normalized metrics survive the runner lifecycle for the
  approved retention period.
- The selected service shows persistent trends by workload, agent, exact agent
  CLI version, guidance, and intent for tool calls/tools used, token buckets, duration, cost,
  and failures.
- No credentials appear in artifacts, logs, workflow annotations, or exporter
  payloads.
- The workflow is advisory and does not block `main` or PR merges.
- A manual dispatch can reproduce the same suite/configuration.
- No scheduled full-guidance cells or neutral descriptor runs outside canary are
  present unless a later explicit policy change approves them.

## Phase 4 — Broader Discovery Matrix

### Status

PLANNED. Detail only after the Luna-only pipeline and selected service have been
validated in Phase 3 and the user approves specific additional cells.

### Expected Outcome

Approved additional Codex and Claude agent/model cells use the same neutral
two-workload discovery canary, normalized metrics, comparison, and persistence
contracts as Luna. This tracks which agents autonomously select registered
GitHits tools without rewriting Luna history or coupling service export to one
provider.

### Assumptions

- Phase 3 has exposed and resolved the initial harness, runner, authentication,
  and service-integration bumps.
- Each added agent CLI has a provider adapter sufficient for tool, token, duration,
  cost, and identity telemetry before it enters the scheduled matrix.

### Unknowns Or Product Decisions

- Exact agent/model/reasoning cells. Candidate names include Luna reasoning
  variants and Claude Code Haiku/Sonnet/Opus, but the manual `claude.ai`
  observation does not establish that list.
- Automation authentication, cadence, concurrency, and budget for each cell.
- Whether any added model later earns an intent-smoke workload; discovery
  expansion alone does not imply stable-full execution.

### Dependencies

- Phase 3 accepted and merged.
- Approved broader-matrix rollout and budget decision.

### Acceptance Criteria

- Usage, cost, tool, duration, agent CLI, and identity metrics conform to the same
  versioned contract without changing historical Luna records.
- Every new agent CLI's neutral prompt and isolation are verified on the automation
  runner before results are treated as causal discovery evidence.
- The selected service compares trends only within compatible agent/model/
  reasoning/scenario dimensions; cross-agent values remain explicitly
  non-equivalent.
- The approved canary matrix runs within its measured budget and preserves the
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
  broader discovery history if that rollout has been approved.
- Alerting thresholds are based on observed variance rather than the initial
  eight-run sample.

### Unknowns Or Product Decisions

- Alert destinations and thresholds.
- Quality workload subset, rubrics, judge model/service, budget, and whether
  quality is advisory or gating.

### Dependencies

- Phase 3 accepted and merged; Phase 4 is required only for additional-model
  trend or quality policy.
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
budget, concurrency, discovery agent/model cells, intent-suite size, and harness-
update decisions to the user with the corrected measurements. At the Phase 3
boundary, bring the broader discovery-matrix decision to the user with the
observed Luna pipeline evidence. Bring the quality/alerting policy at the Phase
4 or Phase 5 boundary with observed historical variance.

## Completion And Cleanup

The overall effort is complete when:

- local named suites and paired comparisons are documented and verified;
- the daily neutral discovery canary and approved Luna intent suite persist raw
  and normalized evidence;
- the selected service exposes the required per-workload/per-agent trends;
- the advisory drift policy is documented;
- any approved quality rubric is implemented or explicitly recorded as out of
  scope; and
- durable architecture, schema, operational, cost, isolation, and failure
  guidance is current under `docs/implementation/` and
  `eval/agentic/README.md`.

Then delete this temporary plan. Do not leave completed phase instructions as
permanent project documentation.
