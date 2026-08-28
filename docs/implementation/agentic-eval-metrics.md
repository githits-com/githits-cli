# Agentic eval usage metrics

## Purpose

The agentic eval runner preserves raw workload evidence and now derives a
schema-versioned `metrics.json` artifact for local inspection. `report.json`
and the console summary are review aids built from that artifact; they do not
replace the raw terminal output or `tool-calls.json`.

This is local maintainer tooling. It is not a daily pipeline, persistent
history service, deterministic CI gate, or quality judge. Named suites, daily
execution, long-term export, and answer-quality scoring remain later phases.

## Run lifecycle

For each run, `scripts/agent-eval.ts`:

1. Creates a run ID and ISO start/end timestamps and records the target git
   branch, SHA, and dirty state when available.
2. Runs each workload in its isolated temporary workspace and writes raw
   workload artifacts first. Live workloads retain redacted stdout/stderr,
   extracted tool events, discovery events, and the parsed final report when
   available. Dry runs intentionally have no provider telemetry.
3. Builds and validates one metrics record per workload, then writes
   `metrics.json` through the existing secret-redaction boundary.
4. Derives `report.json` and the console output from the persisted metrics and
   raw artifacts.

The report loader accepts older run directories. It checks that `metrics.json`
resolves inside the run directory and validates it with the shared Zod schema.
When `run.json` includes a `runId`, the validated metrics artifact must carry
the same ID; a mismatch is rejected as unknown rather than attached to the
run. Legacy run metadata without a `runId` continues to accept valid metrics.
Missing, malformed, or unsafe metrics make normalized usage, cost, aggregate
duration, and logical-call values `null`/`unknown`, never fabricated zeroes.
Duplicate or unmatched records are warned and are not attached to a workload;
the validated artifact aggregate remains available for inspection. Legacy
workload status and duration fields from `run.json` remain readable when
present.

## Metrics contract

The top-level artifact has `schemaVersion: 1`, `runId`, `startedAt`,
`completedAt`, `records`, `aggregates`, and de-duplicated `warnings`.

Each record preserves the run/workload identity dimensions: workload ID,
requested and resolved model, agent and CLI version, reasoning effort, MCP or
Skills surface, local or published server, guidance profile, experimental
tools, published package, target git state, workload timing, process/final
status, exit code, timeout, and relative artifact paths.

The resolved-model field remains nullable for future provider adapters. The
current Codex CLI does not expose a provider-resolved model, so Phase 1 writes
`resolvedModel: null` and the cost adapter uses the requested model.

`usage` contains:

- `providerUsage`, retaining the five validated Codex numeric fields:
  inclusive `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`,
  `output_tokens`, and `reasoning_output_tokens`;
- non-overlapping `normalizedTokens`: uncached input, cached input,
  cache-write input, output, and reasoning output; and
- `cost`, which is either an explicit unknown or a `base_rate_estimate` with
  USD, uncertainty, and the embedded Luna rate snapshot.

`tools` contains raw event count, the current logical-call count, completed and
failed counts, sorted unique normalized tool names, and ordered sequence
entries. Sequence entries retain `mcp` or `cli`
surface and normalized status (`started`, `completed`, `failed`, or `unknown`).
The builder preserves duplicate raw observations and their order; Codex's
derived sequence applies provider-ID pairing as described below. A persisted
call with
`server: "githits-cli"` is `cli`; other persisted GitHits calls are `mcp`.

The run aggregates sum only known record values. Token and cost totals are
`null` when no contributing value is known. Reasoning output is an output
detail and is never added to the output total a second time.

## Codex derivation and limitations

The Codex adapter selects the last terminal `turn.completed.usage` object in
the JSONL stream. Its verified semantics make `input_tokens` inclusive of
cached and cache-write input:

```text
uncached input = input_tokens - cached_input_tokens - cache_write_input_tokens
```

This inclusive-input partition is verified against the upstream Codex parser
fixture `parses_cache_write_token_usage` (input 100, cached input 40,
cache-write input 60, total tokens 110). The Luna live canary had zero
cache-write input, so it did not independently verify a nonzero cache-write
case.

The Luna base-rate snapshot is effective 2026-08-28 and sourced from the
[OpenAI gpt-5.6-luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna):

| Bucket | USD per million tokens |
|---|---:|
| Uncached input | 0.20 |
| Cached input | 0.02 |
| Cache-write input | 0.25 |
| Output | 1.20 |

The estimate is not billed, exact, or an upper bound. Codex exposes a
turn-level aggregate rather than request-level usage. When inclusive input is
above 272,000, the artifact retains the base estimate and emits
`long_context_pricing_not_attributable`, because the request that crossed the
pricing boundary cannot be reconstructed.

Codex extraction carries the provider's non-sensitive `item.id` on each raw
tool observation. The metrics builder preserves every observation in
`rawEventCount`, then pairs only Codex observations with the same surface, ID,
and normalized tool name. The first observation determines sequence order and
the latest observation supplies status, so a started-only call counts once and
separate IDs for the same tool remain separate calls. The derived sequence
does not persist the provider ID or tool arguments. Observations without an ID
are not paired heuristically. Claude and OpenCode remain runnable but report
unknown usage/cost and logical tool count with `adapter_not_implemented` and
`tool_logical_count_not_implemented`.

## Report and console fields

For a matched metrics record, each `WorkloadReport.metrics` contains normalized
token buckets, cost kind/USD/uncertainty, logical tool count, MCP and CLI
sequence counts, and record telemetry warnings. `AgentEvalReport.metrics`
contains the run aggregates, and `metricsWarnings` contains metrics-load,
schema, and workload-record warnings. Existing raw tool summaries, artifacts,
final-report issues, and comparison behavior remain available.

The console prints the same compact per-workload values and one aggregate line.
Null values print as `unknown`; reasoning is labelled as a detail. MCP CLI
fallback warnings identify the effective `descriptors` or `full` profile.
Skills runs use the CLI surface by design and do not receive the MCP fallback
warning.

## Local Luna-low inspection

Run the smallest one-workload pair when changing MCP descriptions, guidance, or
the harness:

```bash
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile descriptors --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile full --workload eval/agentic/workloads/express-router.md
```

Use the printed run directory to regenerate the report or inspect its JSON:

```bash
bun run agent:e2e:report .agent-eval/runs/<run>
bun run agent:e2e:report --json .agent-eval/runs/<run>
```

Inspect `metrics.json` for normalized values and warnings, then use
`tool-calls.json` and redacted `stdout.json` to explain the underlying event
sequence. Do not interpret a missing metric as zero usage, or a Luna estimate
as provider billing. Local Codex and Claude profile comparisons also remain
diagnostic where user-level guidance can leak into the session.

## Security and evidence boundary

Metrics contain validated numeric/provider fields and normalized summaries,
not stdout, tool arguments, shell commands, or environment values. The runner
redacts known secret values before writing raw artifacts and metrics. Artifact
paths are relative and validated; report loading refuses metrics and raw
artifacts that resolve outside the run directory.

## Key reference files

| File | Responsibility |
|---|---|
| `scripts/agent-eval.ts` | Run lifecycle, raw artifacts, redaction, and metrics/report ordering |
| `scripts/agent-eval-metrics.ts` | Codex adapter, Zod schemas, normalization, and aggregate builder |
| `scripts/agent-eval-report.ts` | Safe metrics loading, derived report fields, and console formatting |
| `scripts/agent-eval.test.ts` | Runner, report, fallback, safety, and integration coverage |
| `scripts/agent-eval-metrics.test.ts` | Adapter and metrics-contract coverage |
| `eval/agentic/README.md` | User-facing harness usage, workload guidance, and limitations |
