# Systematic Agent Eval Runs And Metrics

## Status

- Overall: IN PROGRESS
- Current phase: Phase 4 — Braintrust Persistence Proof Of Concept
  (IMPLEMENTED LOCALLY; CI VALIDATION PENDING)
- Previous work: Phase 2 correction is COMPLETE. Phase 3 is merged and its
  same-repository label path is live-validated; Phase 4's exporter, CI wiring,
  and local Braintrust readback are complete while the first qualifying CI
  export/readback remains pending because the required repository secret is not
  currently visible/effective in the Actions context.
- Owner: repository maintainers
- Last verified: 2026-08-31
- Deployment: Phases 1 through 3 are merged to `main`. The Phase 3
  same-repository label path is live-validated; the scheduled path is waiting
  for its first default-branch execution. Phase 4's exact-pinned exporter and
  post-report CI step are implemented, with local 23-row persistence/readback
  proven; qualifying CI validation remains blocked until the required
  repository secret is visible/effective. A push to `main` deliberately does
  not trigger the workflow, and cadence changes remain deferred until
  persistent evidence is visible.

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
- a clean automation runner executes the two-workload neutral discovery canary
  and normal Luna intent suite daily from `main`, or on an explicitly
  maintainer-authorized pull request, preserves raw artifacts, and renders a
  concise report without manufacturing a baseline comparison;
- the Braintrust integration persists the same normalized records for
  per-workload/per-agent history without changing the runner contract;
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
- scheduled and manually dispatched execution from `main`, plus a
  maintainer-label-triggered same-repository pull-request path;
- short-lived CI raw-artifact retention for diagnosis, followed by a separate
  Braintrust proof of concept for durable normalized history;
- an advisory drift policy and a later quality-evaluation extension point.

Out of scope for the initial phases:

- replacing the existing agent process runner with a vendor-owned runner;
- automatically running paid agent evals on every pull request or on fork pull
  requests;
- treating stochastic agent results as deterministic CI gates;
- OpenCode or the Agent Skills surface in the first scheduled matrix;
- automated expansion to Claude or additional Codex models before their exact
  agent CLI, model, adapter, authentication, and budget are approved;
- the three experimental-tool workloads in the stable daily suite;
- an LLM judge, golden-answer corpus, or composite quality score before a
  workload rubric and judge policy are approved;
- a repository-owned database, queue, cache, lock, or dashboard;
- baseline or `main` comparison inside the CI workflow;
- SDK tracing or a vendor-owned runner inside agent execution.

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
  artifact. The user created the Braintrust project
  `githits-cli-agent-evals`, installed `bt` 0.18.0, and authenticated it with
  `bt setup`; SDK instrumentation was intentionally skipped. The exact-pinned
  exporter now persists normalized history without making agent execution
  depend on Braintrust. Local `.bt/` state is repository-ignored and is not an
  input to the eval harness.
- `.github/workflows/main.yml` runs the reusable build/test workflow on pushes
  to `main`, and `.github/workflows/agent-evals.yml` now defines the scheduled,
  manual, and same-repository label-authorized Luna workflow. Repository
  administrators verified the required secret names `OPENAI_API_KEY` and
  `GITHITS_API_TOKEN` on 2026-08-31 without reading their values. The
  same-repository label path is live-validated; the first default-branch
  scheduled/manual execution has not happened yet.
- The agentic eval documentation now distinguishes local human/agent-driven
  inspection, the dedicated CI workflow, and Braintrust persistence.
  Deterministic smoke tests remain merge gates, while scheduled live-agent
  evals and their persistence are observational/advisory until qualifying CI
  evidence supports a different policy.
- The corrected Codex workload and interactive paths require a caller-supplied
  dedicated eval home containing authentication and Codex-managed runtime
  state, keep fresh per-workload OS homes, and reject root-level global
  instruction files. Non-interactive `codex exec` retains its supported
  `--ignore-user-config`; interactive `agent:session` omits that exec-only flag,
  strictly validates direct skills/config inputs, and disables the external
  app/plugin surfaces. The clean scenario evidence and the 2026-08-31 manual
  Luna session now establish the local isolation contract.
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

### Phase 3 concurrency baseline

The corrected Luna-low intent suite took 798,452 ms wall time with workloads
executed sequentially. Replaying its recorded per-workload durations through a
deterministic input-order pool gives 411,742 ms at concurrency 2, 280,622 ms at
3, and 213,885 ms at 4. The corrected discovery canary took 267,221 ms
sequentially; its two workloads project to 234,795 ms when run together because
the slower workload dominates. Running discovery and intent as two concurrent
CI jobs, with workload concurrency 2 and 4 respectively, therefore projects the
paid-agent critical path at about 3.9 minutes. The corrected same-repository
label run later measured about 2 minutes 42 seconds end to end, superseding the
provisional 5–6 minute target for the validated path. Intent concurrency above
4 would not shorten the current critical path, so it would add provider load
without useful runtime improvement.

The two scheduled suites used an estimated \$0.2297134 in the accepted local
evidence (\$0.0266578 discovery plus \$0.2030556 intent). This is a base-rate
estimate with recorded long-context uncertainty, not a billing guarantee.
Concurrency changes wall time, not the workload count or expected model cost.

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
measurements below are the evidence used for Phase 3's concurrency, budget, and
timeout decisions. The
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

7. **Automation and reporting**

   Phase 3 composes the existing suite runner in one dedicated GitHub Actions
   workflow. Discovery and intent are separate jobs, each using a bounded
   workload pool; a final job reads their validated `suite.json` artifacts and
   renders one concise GitHub step summary. The workflow never reads a baseline
   or calculates deltas. Short-lived GitHub artifacts preserve raw evidence for
   diagnosis, and exact checkout and Codex CLI versions identify the run.

8. **Persistence/export**

   Phase 4 maps the same normalized suite records into Braintrust for long-term
   per-eval/per-agent trends. The exporter remains a thin boundary around the
   verified Braintrust SDK or API contract. No repository-owned persistence
   infrastructure is introduced, and the runner does not depend on Braintrust
   to produce valid local or GitHub artifacts.

9. **Quality evaluation**

   The final JSON and evidence remain available for later scoring. Phase 6 may
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

- run the two-workload neutral descriptor canary with Luna-low to detect
  autonomous-discovery drift;
- run the 21-workload Luna-low stable-full suite with the one-line intent nudge;
- do not run neutral descriptors across the remaining stable workloads and do
  not schedule full guidance by default;
- keep experimental workloads manual;
- run daily from the default branch and when a maintainer adds the exact
  `agent-eval` label to a same-repository pull request; later commits require
  removing and re-adding the label rather than silently reusing authorization;
- keep the scheduled workflow advisory. Deterministic tests remain the merge
  gate.

Phase 3 intentionally installs the current Codex CLI on each clean runner so
harness drift is observable, records the exact installed version, and does not
add a pinned control. Local paired comparisons continue to run baseline and
candidate close together with the same installed agent version so repository
changes are not confused with harness changes.

## Assumptions

- The repository's current workload corpus is the starting definition of
  supported use cases; suite membership can be revised when execution evidence
  shows a workload is redundant, unsafe, or consistently non-diagnostic.
- MCP local mode is the initial scheduled surface because it evaluates the
  checkout on `main`.
- The accepted corrected discovery and intent artifacts are the capacity and
  cost baseline for the first workflow.
- Daily evals are for regression detection and investigation, not deterministic
  correctness proof.
- A service-neutral JSON contract lets local work proceed before the team
  chooses the target service.

## Unknowns And Product Decisions

None block Phase 3 implementation. The same-repository label path is
live-validated; scheduled/manual activation and final acceptance remain pending
external workflow execution after merge using the verified `OPENAI_API_KEY` and
`GITHITS_API_TOKEN` secret names. This is an operational validation dependency,
not a product decision.

The following must be resolved before Phase 4 is detailed:

- Braintrust project/account ownership, available credits, retention, and the
  accepted SDK/API ingestion path;
- whether Braintrust should store raw traces or only normalized records and
  GitHub artifact links;
- required dashboard grouping and any Phase 4 notification destination.

The following must be resolved before Phase 5:

- which additional Codex and Claude agent/model cells are worth retaining in the
  discovery canary after the Luna-only pipeline and service integration are
  stable, including their adapter, authentication, cadence, and budget policy.

The following must be resolved before Phase 6:

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
- A Phase 4 Braintrust export failure must not destroy the local/GitHub artifact.
  Its workflow status policy will be decided from the verified service contract.

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
- Workload concurrency is an explicit positive integer execution input, defaults
  to 1 locally, and is recorded in suite identity. The implementation is a small
  in-process promise pool with deterministic result order, not a queue, scheduler,
  lock, retry, or persistent coordination layer. CI uses 2 for discovery and 4
  for intent based on the measured baseline above.

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
3. **Phase 3 — parallel CI execution and concise reporting (MERGED;
   SAME-REPOSITORY LABEL PATH LIVE-VALIDATED; FIRST SCHEDULED RUN PENDING):**
   clean GitHub-hosted jobs run the Luna discovery and intent suites daily or
   after an authorized PR label, retain raw evidence, and render a concise
   no-baseline summary. A push to `main` does not start a paid run.
4. **Phase 4 — Braintrust persistence proof of concept (IMPLEMENTED LOCALLY;
   CI VALIDATION PENDING):** normalized Phase 3 records become durable
   per-workload/per-agent history without making agent execution dependent on
   Braintrust. The local export/readback proof and repository-internal
   Braintrust operations skill are complete; a qualifying CI export/readback is
   still required.
5. **Phase 5 — broader discovery matrix (PLANNED):** the proven metrics, suite,
   CI, and persistence contracts add approved Codex/Claude agent-model cells to
   the neutral canary without changing Luna history.
6. **Phase 6 — trend policy and result quality (PLANNED):** historical variance
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

At Phase 2 completion the scheduled discovery model matrix, target service, and
automation budget were unresolved. Subsequent user decisions selected Luna-low
only for Phase 3, separated Braintrust into Phase 4, and retained any broader
model matrix for Phase 5.

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
   agent/model cells without applying them to all 21 workloads. Configured
   scenario shards may run concurrently; each shard uses the explicit bounded
   `workloadConcurrency` pool (default `1`) and preserves manifest order.

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
   deterministic tests. Execute the two profile shards concurrently, run each
   shard's workloads through its explicit bounded pool while preserving
   manifest order, and write a validated partial or complete `suite.json` after
   both shards settle.
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
   without the later explicit rollout decision; Phase 3 now remains Luna-only.

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
      tokens, and an estimated \$0.2030556. The named six-workload smoke subset
      is derived from those same stable metrics and is documented below.
- [x] Focused tests (178 pass, 1,004 expectations), full tests (3,605 pass,
      12,040 expectations), typecheck, format (442 files), lint (442 files),
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
and intended tool surface. Subsequent user decisions and measured concurrency
evidence make Phase 3 ready, subject to CI secret provisioning.

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
estimated \$0.0266578 with `long_context_pricing_not_attributable` uncertainty.

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
require operator presence. The daily CI workflow uses separately provisioned
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
the corrected discovery canary and intent suite. The pipeline decisions are
captured below; Braintrust persistence is intentionally a later phase.

## Phase 3 — Parallel CI Execution And Concise Reporting

### Status

MERGED; SAME-REPOSITORY LABEL PATH LIVE-VALIDATED. The runner, schema-v3 suite
artifacts, CI reporter, workflow, and operational documentation are merged.
The corrected label run passed its clean runner and summary checks; the first
default-branch scheduled/manual execution has not happened yet. A push to
`main` does not trigger this paid workflow.

### Live label-run evidence

The first same-repository label run, `33379420414` at SHA `6f26242`, rendered
its summary but failed execution validation: discovery was 2/2, intent was
20/21, authenticated MCP data calls returned `AUTH_REQUIRED`, and
`docs-discovery` used the GitHits CLI fallback. The root cause was missing
Codex stdio `env_vars` forwarding. This demonstrates failure detection, not
model quality.

The corrected same-repository label run
([workflow run 33380560726](https://github.com/githits-com/githits-cli/actions/runs/33380560726))
at exact SHA `16fd964` succeeded: discovery took 44 seconds and intent 2
minutes 24 seconds, with 13 seconds for summary rendering; end to end it ran
from 10:02:30Z to 10:05:12Z (about 2 minutes 42 seconds). Suite
wall/cumulative seconds were 24.804/44.386 for discovery and 124.898/454.773
for intent. The cells were 2/2 and 21/21 at workload concurrency 2/4, using
Codex CLI 0.151.0. All 125 logical calls (10 + 115) were MCP; there were no
isolation-violation files, CLI calls/fallbacks, `AUTH_REQUIRED` responses, or
warnings. Reporter estimates were $0.0265 + $0.2249 (about $0.2514 total),
with 417 uncached input, 2,474,289 cached input, 701,553 cache-write input,
22,048 output, and 4,739 reasoning tokens. All 23 Codex configs used only the
name-only `GITHITS_API_TOKEN` `env_vars` entry and no literal token assignment;
secret values were not read during inspection.

### Expected Outcome

A clean GitHub-hosted runner executes Luna-low discovery and intent suites in
parallel each day from the default branch, on trusted manual dispatch, or once
when a maintainer adds `agent-eval` to a same-repository pull request. A final
job renders one concise report containing execution status, exact harness
identity, durations, token buckets, estimated cost, logical call totals, and
per-tool call counts. It performs no baseline or `main` comparison. Full
guidance remains local/manual.

### Assumptions

- The first scheduled shape is the two-workload discovery canary plus the
  21-workload stable-full intent suite, both Codex `gpt-5.6-luna` at low
  reasoning.
- GitHub-hosted Ubuntu is the clean execution boundary. The current Codex CLI is
  deliberately installed on every run so version drift is measured, and its
  exact version is captured in existing artifacts and the concise report.
- A provisional daily schedule of 03:00 UTC is acceptable; changing the cron
  later does not alter the execution or metrics contract.
- GitHub artifacts are diagnostic rather than long-term persistence. Retain
  them for 14 days until Phase 4 establishes the Braintrust retention policy.
- The accepted \$0.2297134 local estimate is sufficient cost evidence for the
  first Luna-only daily shape; no hard cost gate is introduced.

### Unknowns Or Product Decisions

None.

### Dependencies

- Phase 2 accepted and merged at `origin/main` commit `68f4b96`.
- Repository administrators verified the required secret names
  `OPENAI_API_KEY` and `GITHITS_API_TOKEN` on 2026-08-31 without reading their
  values. Secret values are never read into a developer or review session.
- Existing GitHub-hosted runner access and provider quotas support two
  discovery calls plus four concurrent intent calls per workflow. Independent
  schedule, dispatch, and label-triggered workflows may overlap and multiply
  that load; Phase 3 deliberately adds no cross-run lock or queue, so any
  resulting provider failure remains visible evidence.

### Affected Components

- `scripts/agent-eval.ts` and focused tests for bounded workload execution;
- `scripts/agent-eval-suite.ts` and focused tests for CLI propagation,
  execution identity, and suite validation;
- a small CI-summary script and its tests, plus a package-script entrypoint;
- `.github/workflows/agent-evals.yml` as a dedicated paid workflow, leaving the
  deterministic `main.yml`, `pr.yml`, and reusable `ci.yml` paths unchanged;
- `eval/agentic/README.md`,
  `docs/implementation/agentic-eval-metrics.md`, and one maintainer-facing
  change fragment with `none` impact for both public packages.

### Contracts And Failure Behavior

1. **Bounded workload execution**

   Add an explicit positive-integer `--concurrency` input to the one-off and
   suite run commands. It defaults to 1, preserving current local behavior.
   The runner uses a small in-process promise pool, starts at most the requested
   number of workloads, and stores results in manifest order regardless of
   completion order. The selected concurrency is recorded in `run.json` and
   `suite.json` execution metadata so duration evidence remains attributable.
   The suite writer advances to schema version 3; version 1 and 2 readers
   normalize absent workload concurrency to 1. It is execution configuration,
   not a prompt/content compatibility dimension, so it is reported but does not
   suppress otherwise valid tool/token comparisons.

   Ordinary workload failures already return persisted failure evidence; they
   do not prevent unscheduled siblings from running. An unexpected executor
   exception rejects the run as today. An empty suite selection fails during
   preflight before child execution. Do not add retries, provider backoff,
   locks, a queue, or a scheduler. Concurrent workloads continue to receive
   separate disposable acting-agent homes/workspaces and share only the
   caller-supplied clean `CODEX_HOME`, as current concurrent scenario shards do.

2. **Workflow triggers and authorization**

   Add one workflow with `schedule`, `workflow_dispatch`, and
   `pull_request: {types: [labeled]}` triggers. Scheduled runs use the workflow
   from the default branch and check out that exact SHA. PR execution requires
   both the exact `agent-eval` label event and
   `head.repo.full_name == github.repository`; it checks out the immutable
   `github.event.pull_request.head.sha` from that label event. A later
   `synchronize` event does not rerun while the label remains. Maintainers must
   remove/re-add the label to authorize a newer SHA.

   Do not use `pull_request_target`, do not accept fork PRs, and set workflow
   permissions to `contents: read`. Applying the label is authorization to run
   that reviewed same-repository SHA with provider secrets, including any
   changes it makes to `.github/workflows/agent-evals.yml`; this operational rule
   is documented beside the workflow.

3. **Clean Codex and credential boundary**

   Install the current Codex CLI using the official supported installer, then
   record `codex --version`. Create an empty absolute `CODEX_HOME` under
   `runner.temp` so the existing validator proves no global `AGENTS.md` or
   non-system skills are present. Authenticate non-interactively through the
   official API-key flow and expose provider/GitHits secrets only to the
   execution steps. The existing environment allowlist passes
   `OPENAI_API_KEY` and `GITHITS_API_TOKEN`; artifact redaction remains the
   enforcement boundary. Do not copy local subscription state, Keychain data,
   user config, skills, or auth files into CI.

4. **Two scenario jobs**

   Run discovery as `canary --scenario discovery --concurrency 2` and intent as
   `stable-full --scenario intent --concurrency 4` in two matrix entries/jobs.
   Each job has a 40-minute timeout, uploads its complete suite directory even
   after a recorded failure, and retains it for 14 days. Full, experimental,
   stateful, neutral non-canary, Claude, and baseline/candidate cells are absent.

5. **Concise report and workflow status**

   A pure formatter reads one or more schema-validated suite artifacts and
   emits a compact Markdown table for `$GITHUB_STEP_SUMMARY`. Per scenario it
   reports suite status, successful/expected cells, wall and cumulative agent
   time, logical MCP/CLI calls, token buckets, estimated cost/uncertainty,
   Codex CLI version, isolation/telemetry warnings, and deterministic per-tool
   logical call counts. The workflow supplies a run URL, which the reporter
   renders as the evidence link to the workflow run containing the artifacts;
   it does not load a baseline, calculate deltas, or write PR comments.

   The summary job runs with `if: always()` so missing and failed scenario jobs
   remain visible. Missing/unparseable suite evidence, isolation violations,
   CLI fallback in an MCP run, timeouts, zero selected workloads or zero
   expected executions, and failed/missing workload cells make the workflow
   fail after the summary is written. A successful discovery cell with zero
   GitHits calls remains a valid observed result. Metric movement
   alone cannot fail because this phase performs no comparison or thresholding.

### Ordered Implementation Steps

1. **Completed:** Add focused failing tests for concurrency parsing, a maximum-in-flight
   invariant, continued execution after ordinary workload failure, unexpected
   executor rejection, and manifest-order output. Implement the minimal pool and
   record/propagate the selected value through run and suite artifacts while
   keeping default concurrency 1.
2. **Completed:** Add focused failing tests for compact multi-suite Markdown output and its
   status classification, including zero-call discovery, per-tool frequencies,
   unknown telemetry, partial/missing suites, CLI fallback, and isolation
   violations. Implement the pure formatter and thin CLI entrypoint.
3. **Merged; same-repository label path live-validated:** Add the dedicated
   workflow with the three triggers, an explicit
   `github.event.label.name == 'agent-eval'` job gate, same-repository label/SHA
   authorization, clean Codex home and API-key setup, the two scenario jobs,
   unconditional artifact upload/reporting, 14-day retention, and minimal
   permissions. Keep secret scope to the paid execution steps. The corrected
   label run passed; the first default-branch scheduled/manual execution is
   pending.
4. **Completed locally:** Update local/CI operational documentation, the durable implementation
   contract, and the required no-public-impact change fragment. Document label
   authorization, re-label behavior, exact suites/concurrency, expected
   duration/cost, secret names, and artifact/report locations.
5. **Local and label evidence complete; first scheduled/manual evidence
   pending:** Run focused tests, all suite dry-runs at concurrency 1 and the CI-selected
   values, `bun test`, typecheck, format, lint, build, and workflow syntax/action
   validation. The same-repository label path is live-validated with no global
   skill/guidance reads or CLI fallbacks. Verify the scheduled/default-branch
   path on its first run before treating Phase 3 deployment acceptance as
   complete.

### Acceptance Criteria

- Default local execution remains sequential; explicit concurrency never
  exceeds the requested in-flight workload count and preserves manifest order.
- MET: A same-repository label run checks out the exact labeled head SHA and
  produces 2/2 discovery plus 21/21 intent records with concurrency 2/4
  captured in artifacts.
- PENDING: A trusted manual run or scheduled default-branch run
  check out the exact intended SHA and produce 2/2 discovery plus 21/21 intent
  records, or explicit failed/missing records, with concurrency 2/4 captured in
  artifacts.
- A same-repository PR runs only after the exact `agent-eval` label event at the
  labeled head SHA; forks and later unlabeled SHAs cannot consume secrets.
- The corrected same-repository label workflow completed in about 2 minutes 42
  seconds at a $0.2514 rate-based estimate; actual wall time, cost, and any
  provider-quota behavior are recorded rather than hidden by retries.
- The GitHub summary concisely shows status, exact Codex CLI/model identity,
  tool calls/tools used, tokens, duration, cost uncertainty, and evidence links
  for both scenarios, with no baseline or `main` comparison.
- Execution-invalid evidence makes the workflow red only after the summary is
  rendered; zero-call discovery and ordinary metric values remain advisory.
- No secret value, local auth state, global guidance, or personal skill appears
  in logs, artifacts, summaries, or acting-agent context.
- Raw/normalized artifacts remain downloadable for 14 days; no Braintrust SDK,
  exporter, repository persistence, queue, retry, lock, or quality judge is
  introduced.

## Phase 4 — Braintrust Persistence Proof Of Concept

### Status

IMPLEMENTED LOCALLY; NATIVE-FIRST PROOF PENDING; CI VALIDATION BLOCKED. Phase 3
is merged and its same-repository label path has clean runner evidence. The
exact-pinned Braintrust exporter, post-report CI wiring, local persistence/
readback proof, and internal operations skill are implemented. A real labeled
or manually dispatched CI run must still export and read back 23 rows before
Phase 4 is accepted as complete; that validation cannot begin until the
repository `BRAINTRUST_API_KEY` secret is visible/effective in Actions. The
native-first mapper is implemented locally, but native-root readback and a
fresh CI export/readback remain acceptance work. SDK tracing was deliberately
not added.

### Expected Outcome

Each completed Luna workflow attempt creates one immutable experiment in the
Braintrust project `githits-cli-agent-evals`, with one top-level experiment row
per scenario/workload cell. Braintrust exposes the exact effective prompt,
answer/status evidence, tool-call frequencies and ordered sequence, token
buckets, agent duration, estimated cost, repository/harness identity, exact
Codex CLI/model identity, and a link to the GitHub workflow evidence. Local and
GitHub suite generation and concise reporting remain independent of
Braintrust. No SDK tracing is inserted into Codex, the GitHits MCP server, or
the harness execution path.

### Assumptions

- Phase 3 `suite.json`, contained child `metrics.json`/`report.json`, and raw
  `prompt.md`/`final.json` evidence are the complete exporter input. Braintrust
  does not become the source of truth for raw provider events.
- The Braintrust experiment/event model accepts the existing dimensions through
  a post-run mapping. The installed 3.29.0 SDK source confirms
  `initExperiment()`, explicit experiment names, top-level `startSpan()` eval
  rows with `input`, `output`, `error`, `metadata`, `metrics`, and `tags`,
  explicit `flush()`, and `summarize({ summarizeScores: false })` permalink
  retrieval. `update: true` continues an existing experiment, but the PoC does
  not use it.
- The native-first mapper uses the pinned SDK's verified `duration`,
  `tool_calls`, `tool_errors`, `prompt_tokens`, `prompt_cached_tokens`,
  `prompt_cache_creation_tokens`, `completion_tokens`,
  `completion_reasoning_tokens`, `tokens`, and `estimated_cost` keys. Native
  UI and comparison behavior remains unproven until a native-root export is
  read back.
- One CI run attempt is one immutable experiment. GitHub `run_id` plus
  `run_attempt` gives reruns distinct names, so no event-ID scheme, upsert,
  retry, or duplicate-repair mechanism is required.
- The existing `bt` OAuth profile is suitable for local read/query operations
  and for a `bt eval` wrapper that injects resolved authentication into its Bun
  child. CI uses only the repository secret `BRAINTRUST_API_KEY` and invokes the
  exporter directly; it does not install or depend on the global CLI.
- Persisting the exact prompt and neutral answer now is required to make later
  quality scoring possible after 14-day GitHub artifacts expire. Self-reported
  confidence is diagnostic metadata, not a quality score.

### Resolved SDK contract contradiction

The initial plan assumed that `Experiment.log()` could represent a scoreless
eval row. Runtime behavior in the installed Braintrust 3.29.0 package disproved
that assumption: `Experiment.log()` requires non-empty `scores`. No quality
judge or fabricated score is appropriate in this phase. The exporter therefore
uses one top-level `type: "eval"` span per mapped cell, ends each span
immediately, flushes the experiment, and then reads its permalink through
`summarize({ summarizeScores: false })`. This is a resolved implementation
contradiction, not a reason to alter the neutral metrics contract.

### Unknowns Or Product Decisions

No product choice blocks the implementation. The selected policy is:

- project: `githits-cli-agent-evals`;
- ingestion: exact-pinned TypeScript `braintrust` SDK, currently verified as
  3.29.0, through a downstream exporter;
- raw traces: GitHub artifacts only; Braintrust receives normalized rows plus
  the exact prompt and neutral answer, not stdout, stderr, environment values,
  MCP payloads, or auth state;
- quality: no scorer or `scores` value in this phase;
- export failure: preserve the GitHub summary/artifacts, then fail the final
  workflow status so missing persistence cannot be silent;
- retention: Braintrust is the durable normalized history. GitHub raw artifacts
  remain at 14 days until observed operations justify a change; and
- cadence: unchanged in this phase. The existing schedule/manual/label triggers
  remain; push-to-main behavior is reconsidered only after Braintrust evidence
  is available.

The built-in experiment comparison behavior observed on prior custom-only rows
is a known historical limitation, not a native-first result: its exercised
output contained only generic all-zero trace metrics and omitted the custom eval
telemetry. Native UI and comparison behavior remains unproven pending a fresh
native export/readback. Its investigation is deferred to a Phase 5 / PoC
follow-up; bounded SQL and row/UI inspection remain the current metrics path.

### Dependencies

- Phase 3's merge commit is `e1599b7`; planning was reoriented on current
  `origin/main` commit `5a5fab7` after the non-overlapping 0.11.3 release merge.
- The user-created Braintrust project `githits-cli-agent-evals` and local `bt`
  authentication exist. This is user-provided verification; the plan does not
  inspect `.bt/`, Keychain contents, or any credential value.
- The user reported adding `BRAINTRUST_API_KEY`, but both
  `gh secret list --repo githits-com/githits-cli --json name` and the
  repository Actions-secrets API currently expose only `GITHITS_API_TOKEN` and
  `OPENAI_API_KEY`; organization-secret visibility could not be checked because
  that API returned 403. Secret values were never read. CI/labeled validation
  remains blocked until `BRAINTRUST_API_KEY` is visible and effective in the
  repository Actions context.

### Verified Braintrust Constraints

- [`bt setup`](https://www.braintrust.dev/docs/reference/cli/setup) separates
  authentication, optional skills/MCP setup, and optional SDK instrumentation.
  Cancelling instrumentation does not undo authentication.
- The [CLI authentication model](https://www.braintrust.dev/docs/reference/cli/quickstart)
  uses an OAuth profile/keychain locally and `BRAINTRUST_API_KEY` in CI. The
  official `bt` source passes resolved profile credentials to `bt eval` child
  processes, which lets the same exporter run locally without reading or
  copying Keychain material.
- The [TypeScript SDK](https://www.braintrust.dev/docs/reference/libs/nodejs)
  supports named experiments, explicit repository metadata, custom numeric
  metrics, structured metadata, top-level eval spans, manual flush, and returned
  experiment URLs. The installed 3.29.0 runtime requires non-empty scores for
  `Experiment.log()`, so the exporter uses scoreless top-level eval spans and
  does not fabricate quality scores.
- Braintrust [SQL](https://www.braintrust.dev/docs/reference/sql) and the
  `bt experiments`/`bt sql` commands can inspect and compare the persisted fields.
  The repository skill records only commands exercised against the PoC
  experiment. The built-in compare command previously returned only generic,
  all-zero trace metrics rather than the custom-only telemetry; native-first UI
  and comparison behavior remains unproven pending a fresh export/readback.
  Bounded SQL/query and experiment UI inspection remain the current metrics path.

### Verified PoC evidence

The accepted pre-native GitHub run `33381601980` at SHA
`dc63675d7c0ee95a9594eac272982943dceef521` validated and exported the discovery
and intent suites as exactly 23 rows. The experiments
`poc-33381601980-top-level-spans` and `poc-33381601980-repeat` each read back
23 rows. Bounded SQL and row inspection reconciled prompts, neutral answers,
prompt hashes, token buckets, duration, cost, and tool telemetry to the source
artifacts. The first experiment permalink is:

<https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/poc-33381601980-top-level-spans>

The exercised custom-only command
`bt experiments --json --project githits-cli-agent-evals compare
poc-33381601980-top-level-spans poc-33381601980-repeat` succeeds but exposes
only generic Braintrust trace metrics, all zero, and not the custom eval
telemetry. This prior observation does not invalidate persistence, but it is not
native-first proof. Native-root readback and a fresh CI export/readback remain
acceptance work. The labeled run `33413090610` is the current pre-native
baseline; it is not native-first evidence.

### Affected Components

- `scripts/agent-eval-braintrust.ts` and focused tests for pure mapping, CLI
  parsing, and an injected SDK boundary;
- `scripts/agent-eval-report.ts` and focused tests to preserve the already
  emitted `prompt.md` path and neutral answer in contained `report.json`
  evidence;
- `package.json`/`bun.lock` for one exact-pinned `braintrust` development
  dependency and exporter entrypoint;
- `.github/workflows/agent-evals.yml` for a post-report export step, narrowly
  scoped secret, nonsecret result link, and final status aggregation;
- `.gitignore` for `.bt/` local CLI state;
- `eval/agentic/README.md` and
  `docs/implementation/agentic-eval-metrics.md` for durable operations and data
  contracts;
- `.agents/skills/braintrust-agent-evals/SKILL.md` as an internal-only
  operations/query skill; and
- one maintainer-facing change fragment with `none` impact for `githits` and
  `@githits/mcp`.

### Export Contract

1. **Validated downstream input**

   Reuse `loadImportedSuite()` for every repeatable
   `--suite <label>=<suite.json>` input. This retains schema parsing, realpath
   containment, canonical child basenames, metrics/report reconciliation, and
   status validation. Before opening a network connection, reject dry-run
   suites, duplicate scenario/workload cells, mixed target or measurement SHAs,
   mixed agent/model/reasoning/surface/server identity, or incompatible
   reporting/result-schema identity. Partial and failed suites with valid child
   evidence remain exportable because failures are part of the history; a
   missing or unparseable suite fails preflight and creates no experiment.

   Extend the report's allowlisted workload artifacts with `prompt.md` and its
   neutral final summary with `answer`. Existing report version 1 readers remain
   compatible because both fields are additive and optional. The exporter
   resolves prompt references inside the imported child run directory and
   never loads raw stdout, stderr, environment/config files, or provider event
   payloads.

2. **Experiment and comparison identity**

   Create one experiment per invocation. CI passes the deterministic name
   `github-<run_id>-<run_attempt>`; local use defaults to a timestamped
   `local-...` name but accepts explicit `--experiment`. Use `update: false` and
   no base experiment. Braintrust's normal experiment comparison matches rows
   by `input`; the input therefore contains scenario, workload ID/path, exact
   effective prompt, and its SHA-256. Agent, model, CLI, git, and run identity
   stay out of `input` so comparable runs retain the same test-case key. A
   changed effective prompt deliberately becomes a different input rather than
   producing a misleading direct comparison.

   Experiment metadata records source (`local` or `github`), GitHub run ID and
   attempt when present, workflow/run URL, suite IDs/names/hashes, target and
   measurement SHAs/branches/dirty state, schema version, and exporter version.
   Explicit `repoInfo` uses the evaluated target SHA while SDK automatic Git
   collection is disabled, preventing the summary checkout or local dirty tree
   from replacing artifact identity.

3. **One allowlisted row per workload/scenario**

   `output` contains process/cell/final status, neutral answer when present,
   self-reported confidence, and discovery observation when available.
   Failed cells use a generated status-only `error` label; raw error/stderr text
   is not uploaded. `scores` is omitted.

   Native numeric values use Braintrust's verified standard names: `duration`
   (seconds from recorded milliseconds), `tool_calls`, `tool_errors`,
   `prompt_tokens`, `prompt_cached_tokens`, `prompt_cache_creation_tokens`,
   `completion_tokens`, `completion_reasoning_tokens`, `tokens`, and
   `estimated_cost`. The provider input total includes cached reads and cache
   creation; `tokens` is that total plus provider output tokens. The remaining
   GitHits-specific metrics are `mcp_tool_calls`, `cli_tool_calls`,
   `tool_calls_started`, `tool_calls_completed`, `tool_calls_unknown`, and
   `raw_tool_events`. Known zero is logged as zero, and unknown values are
   absent rather than coerced to zero. Cost kind/uncertainty/rate metadata stays
   explicit because `estimated_cost` is still a rate-based estimate.

   Structured metadata contains cell/suite/run IDs, guidance/intent identity,
   agent/model/reasoning/CLI identity, cost kind/uncertainty/rate snapshot,
   normalized warnings/validation categories, `toolTelemetryKnown`, ordered
   normalized tool sequence, and per-surface/per-tool total and status counts.
   Each known used tool also adds a filter tag such as `tool:mcp:search`; the
   nested counts remain authoritative. Tool telemetry that cannot reconcile is
   `toolTelemetryKnown: false` with no tool-count metrics or fabricated empty
   counts.

4. **Thin SDK boundary and local authentication**

   Keep record construction pure and inject only the minimal SDK publisher
   needed by tests. Production initializes the exact project/experiment, starts
   and immediately ends one top-level `type: "eval"` span per row in
   deterministic suite/scenario/workload order, calls `flush()`, and writes a
   small nonsecret result JSON containing project, experiment, URL, and
   exported-row count. There is no agent execution, tracing wrapper, dataset,
   scorer, queue, retry, lock, cache, or repository database.

   The normal package command runs directly under Bun; `BRAINTRUST_API_KEY` is
   required only when it performs a network export, matching CI. Local
   OAuth-profile use runs the same file explicitly through
   `bt eval --runner bun --no-auto-instrumentation ...`; the official `bt`
   source supports the exported `btEvalMain` entrypoint, and the local
   persistence/readback proof exercised this path without reading or copying
   Keychain credentials. A credential-free `--validate-only` mode maps all rows
   without initializing Braintrust and reports only identity/counts, not
   prompts or answers.

5. **CI sequencing and failure visibility**

   Keep scenario execution and artifact upload unchanged. Mark the existing
   report step `continue-on-error` so its summary is always appended. Run the
   exporter afterward with `if: always()`, both downloaded suite paths, explicit
   GitHub experiment identity, and `BRAINTRUST_API_KEY` scoped only to that
   step. Append the returned Braintrust experiment link when available. A final
   no-secret step fails if the scenario job, report step, or exporter step
   failed. Thus an exporter outage cannot suppress raw evidence or the concise
   report, but it cannot pass silently either. Do not retry ingestion.

6. **Internal operations skill after live proof**

   Create `.agents/skills/braintrust-agent-evals/SKILL.md` from the proven local
   export/readback workflow. It is repository-internal and is not added to root
   `skills/`, plugin manifests, generated assets, or public packages. Keep it
   short and automatically discoverable for requests to inspect, compare, or
   operate GitHits agent-eval history.

   Document only exercised commands: selecting `githits-cli-agent-evals`,
   listing/viewing/comparing experiments, running bounded SQL queries for token,
   duration, tool, status, and cost fields, opening the returned permalink, and
   invoking local export through the saved `bt` profile. The skill must prohibit
   printing API keys, reading `.bt/` or Keychain contents, uploading raw
   artifacts, deleting experiments, or treating confidence as quality. It
   routes schema/detail questions to the durable implementation document rather
   than duplicating the full field contract.

### Ordered Implementation Steps

1. Add focused failing tests for the pure suite-to-Braintrust mapping: stable
   input identity, exact prompt/answer capture, deterministic ordering, all
   numeric metrics, known-zero preservation, unknown omission, per-tool
   frequency/sequence, failed cells, and allowlisted metadata only. Add the
   additive prompt/answer report fields needed by those tests.
2. **Implemented locally:** Implement exporter argument parsing, cross-suite
   preflight, pure mapping, injected publisher, exact `braintrust` 3.29.0
   development dependency, direct Bun entrypoint, `btEvalMain` profile wrapper,
   validate-only output, explicit flush, and nonsecret result file. Verify
   credential-free `--validate-only` mapping against complete Phase 3 artifacts
   without running an agent.
3. **Local pre-native persistence/readback proven:** Use the authenticated local `bt`
   profile to export the accepted 23-cell evidence into
   `githits-cli-agent-evals` under clearly named `poc-...` experiments. Read it
   back with `bt experiments` and bounded `bt sql`; reconcile row count,
   zero-tool discovery, tool-using cells, native token buckets, duration, cost,
   prompt, answer, exact Codex version, SHA, and permalink against source
   artifacts. The built-in compare limitation is recorded for follow-up.
4. **Implemented locally; CI validation pending:** Add the CI export/final-status
   steps and document the repository Actions visibility/effectiveness of the
   `BRAINTRUST_API_KEY` secret.
   Unit-test the workflow contract, validate YAML/action references, and use
   direct SDK execution in CI so the workflow does not install `bt`. A real
   labeled or manual run must still export/read back 23 rows.
5. **Implemented locally:** Update durable eval operations documentation and
   create the internal `braintrust-agent-evals` skill from the commands and
   field semantics proven in step 3. Validate it with the skill validator. Run
   plugin generation/check and confirm the internal skill causes no
   public/generated skill changes.
6. Run focused tests, exporter validate-only mode, `bun test`, typecheck, format, lint,
   `bun run plugins:generate`, `bun run plugins:check`, and `bun run build`.
   After merge and secret provisioning, manually dispatch one workflow and
   verify the GitHub summary link plus 23 reconciled Braintrust rows before
   calling the PoC complete. The later scheduled run should create a separate
   experiment without code changes.

### Acceptance Criteria

- MET locally: PoC experiments in `githits-cli-agent-evals` have exactly 23
  rows for the current two discovery plus 21 intent cells. PENDING for CI:
  one real labeled or manually dispatched workflow experiment must be
  exported/read back with the same 23-row reconciliation, including failed
  cells when a run fails.
- Every row is filterable by workload, scenario, agent, exact CLI/model,
  reasoning, guidance, intent, target SHA, and used-tool tags. Structured
  metadata exposes ordered tools and per-tool/per-status counts.
- Prompt, neutral answer, process/final status, self-reported confidence, native
  token buckets/duration/cost, and GitHits-specific tool counts reconcile to
  contained source artifacts. Unknown telemetry is absent/unknown; a verified
  zero-tool discovery cell remains numeric zero. Native-root local readback and
  a fresh CI export/readback remain pending acceptance work.
- The exporter keeps unchanged scenario/workload/prompt inputs stable across
  workflow attempts, and no baseline is selected automatically or metric
  movement fails the workflow. PENDING: the exercised `bt experiments compare`
  command reports only generic all-zero trace metrics, so custom eval trend
  comparison still requires the documented SQL/UI follow-up.
- The existing GitHub concise report and 14-day raw artifact upload complete
  even when export fails; the final workflow is red and names export as the
  failed stage. Local suite/report generation works without Braintrust or its
  credential.
- `BRAINTRUST_API_KEY` is scoped only to the CI export step. No Braintrust,
  GitHits, provider, Keychain, or local auth value appears in logs, artifacts,
  summaries, records, tests, or the internal skill.
- The internal skill can list, inspect, compare, and query the proven metrics
  through the user's authenticated `bt` profile without reading credentials or
  mutating/deleting experiments.
- The Braintrust integration adds no tracing instrumentation, quality judge,
  public skill, repository database, queue, retry, lock, cache, runner
  replacement, or cadence change.
- Braintrust ingestion itself makes no model call and adds no model-token cost;
  exporter wall time and every run-variant Luna duration/cost value are measured
  and persisted rather than pinned as an acceptance threshold.

## Phase 5 — Broader Discovery Matrix

### Status

PLANNED. Detail only after the Luna-only pipeline and Braintrust proof of
concept have been validated and the user approves specific additional cells.

### Expected Outcome

Approved additional Codex and Claude agent/model cells use the same neutral
two-workload discovery canary, normalized metrics, CI report, and persistence
contracts as Luna. This tracks which agents autonomously select registered
GitHits tools without rewriting Luna history or coupling persistence to one
provider.

### Assumptions

- Phases 3 and 4 have exposed and resolved the initial harness, runner,
  authentication, and service-integration bumps.
- Each added agent CLI has a provider adapter sufficient for tool, token,
  duration, cost, and identity telemetry before entering the scheduled matrix.

### Unknowns Or Product Decisions

- Exact agent/model/reasoning cells. Candidate names include Luna reasoning
  variants and Claude Code Haiku/Sonnet/Opus, but the manual `claude.ai`
  observation does not establish that list.
- Automation authentication, cadence, concurrency, and budget for each cell.
- Whether any added model later earns an intent-smoke workload; discovery
  expansion alone does not imply stable-full execution.

### Dependencies

- Phases 3 and 4 accepted and merged.
- Approved broader-matrix rollout and budget decision.

### Acceptance Criteria

- Usage, cost, tool, duration, agent CLI, and identity metrics conform to the
  same versioned contract without changing historical Luna records.
- Every new agent CLI's neutral prompt and isolation are verified on the clean
  automation runner before results are treated as causal discovery evidence.
- Braintrust compares trends only within compatible agent/model/reasoning/
  scenario dimensions; cross-agent values remain explicitly non-equivalent.
- The approved canary matrix runs within its measured budget and preserves the
  same raw-artifact and credential-redaction guarantees.

## Phase 6 — Trend Policy And Result Quality

### Status

PLANNED. Detail after the pipeline has produced enough real history to
characterize normal variance and after the user approves the quality policy.

### Expected Outcome

Maintainers receive calibrated signals for abnormal harness/tool/token/cost
changes, and selected workloads can be scored against explicit result-quality
rubrics with the score and judge provenance stored beside operational metrics.

### Assumptions

- Phase 4 provides queryable Luna history and raw evidence; Phase 5 provides
  broader discovery history if that rollout has been approved.
- Alerting thresholds are based on observed variance rather than the initial
  eight-run sample.

### Unknowns Or Product Decisions

- Alert destinations and thresholds.
- Quality workload subset, rubrics, judge model/service, budget, and whether
  quality is advisory or gating.

### Dependencies

- Phase 4 accepted and merged; Phase 5 is required only for additional-model
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

At the Phase 3 boundary, record actual CI duration, cost, concurrency behavior,
Codex version, quota failures, summary usefulness, and any isolation or fallback
evidence, then resolve the Braintrust contract before detailing Phase 4. At the
Phase 4 boundary, bring the broader discovery-matrix decision to the user with
the observed Luna pipeline and persistence evidence. Bring the quality/alerting
policy at the Phase 5 or Phase 6 boundary with observed historical variance.

## Completion And Cleanup

The overall effort is complete when:

- local named suites and paired comparisons are documented and verified;
- the daily and label-authorized neutral discovery canary and Luna intent suite
  preserve raw and normalized evidence and render concise CI reports;
- Braintrust exposes the required per-workload/per-agent trends;
- the advisory drift policy is documented;
- any approved quality rubric is implemented or explicitly recorded as out of
  scope; and
- durable architecture, schema, operational, cost, isolation, and failure
  guidance is current under `docs/implementation/` and
  `eval/agentic/README.md`.

Then delete this temporary plan. Do not leave completed phase instructions as
permanent project documentation.
