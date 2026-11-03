# Instruction efficiency comparison

This experiment compares public guidance against commit
`c7a9e0f7df371ca4d034cd792a8af129f21cc440`, using the current harness for both
implementations. It does not modify the benchmark repository or resume its
paused five-arm pilot.

The primary sample is the seven-workload `smoke` suite, three repetitions of
both MCP `intent` and `full` scenarios per implementation. Use the same model,
effort, endpoints, authentication, workload bytes, and harness on both sides.
Named suites select Codex with GPT-6 Luna at low effort. `--concurrency 1`
limits each scenario shard to one workload; two scenarios can run concurrently.
Run implementation arms sequentially, alternating their order across repeats.

Supplementary diagnostics run once per implementation:

- `code-read-window`, `code-file-navigation`, `code-grep-investigation`, Q09,
  Q10, and `symbol-following` through MCP intent, MCP full, and CLI skills.
- All seven smoke workloads through CLI skills.
- Express routing and package upgrade review through Claude Sonnet, separately
  with MCP full guidance and CLI skills. These are different clients/models;
  do not pool them with the primary sample or call them claude.ai validation.

`symbol-following` names a declaration and asks about delegated behavior, without suggesting a tool or retrieval sequence. It complements the existing known-line-window and call-site workloads.

Q09 and Q10 are exact frozen version-scoped prompts from
`githits-benchmark/baselines/luna-golden-questions-6-10/questions.json`.
[provenance.json](provenance.json) records their SHA-256 values. The benchmark
repository's version-4 `criteria.json` distinguishes required adequacy,
critical contradictions, and optional depth. Criteria stay outside actor
workspaces. Do not count optional depth as required correctness or grade from
the acting agent's confidence.

## Run

Create a detached baseline worktree and install its dependencies. Set
`GITHITS_ENV=dev`, supply `GITHITS_API_TOKEN` through the process environment,
and use a dedicated authenticated `CODEX_HOME` without user skills or global
instructions. Clear unintended endpoint overrides. Never put credentials in
commands, artifacts, or committed files.

From the candidate checkout:

```powershell
bun run agent:e2e:suite run --suite smoke --scenario intent --scenario full --concurrency 1 --target-root .agent-eval/instruction-baseline --out .agent-eval/instruction-comparison/baseline-r1
bun run agent:e2e:suite run --suite smoke --scenario intent --scenario full --concurrency 1 --out .agent-eval/instruction-comparison/candidate-r1
```

Use fresh output directories for each repetition. Do not overwrite an earlier
run after revising guidance; label it exploratory and rerun the final candidate.
Use the harness's offline `compare` command for completed named suites.

For supplemental workloads, use `agent:e2e` with repeatable `--workload` paths,
`--agent codex --model gpt-6-luna --reasoning-effort low --server local` and:

| Surface | Options |
| --- | --- |
| MCP intent | `--surface mcp --guidance-profile descriptors --intent-profile githits` |
| MCP full | `--surface mcp --guidance-profile full` |
| CLI skills | `--surface skills` |

Add `--target-root .agent-eval/instruction-baseline` for the baseline. Claude
diagnostics use `--agent claude --model sonnet`; record the resolved model when
available. Keep workload prompts neutral.

## Interpret

Inspect `tool-calls.json`, `final.json`, `metrics.json`, and
`isolation-violations.json`. Count every attempted cell and preserve failures.
Report isolation-valid paired comparisons separately; neither a successful
process nor a valid final JSON establishes answer quality.

Separate input, cached input, and output tokens. Cached input is a subset of
provider input, not additional tokens. Report model-rate cost estimates as
estimates. Separate total call counts from navigation, Research, bootstrap,
failed calls, and actual selector reads.

Before claiming quality gains, review answers against the task and fetched
evidence; use the frozen criteria for Q09/Q10. Fewer calls are useful only if
the answer still covers the needed facts. Small samples, backend/index warmth,
quota effects, and changing tool paths limit causal claims.

## Recorded run: 2026-11-03

See [the evaluation report](../../../docs/implementation/instruction-efficiency-20261103.md)
and [per-attempt measurements and benchmark grades](results-20261103.json).

The initial candidate changed during review. Exclude its 62 pre-freeze attempts
from final comparisons. Final guidance was frozen at
`2026-11-03T08:39:58.169522+00:00`; only candidate cells starting after that
point count. Complete each primary scenario/workload to exactly three attempts,
including failed attempts. Pair baseline and candidate chronologically within
each scenario/workload. Do not select repetitions by outcome.

The recorded run deviated from alternating complete suites: after the freeze,
missing final candidate cells were filled with the same one-off harness options
and model. At most two actors ran concurrently. The candidate therefore ran
later, with potentially warmer backend indexes and caches. Do not interpret
this as a randomized or causal timing experiment.

CLI normalized call counts missed some shell command chains and Research
invocations. Inspect provider commands as well as `tool-calls.json`; zero
normalized calls does not always mean no GitHits use. Some candidate actors
actually bypassed GitHits, which also prevents interpreting fewer calls as
retrieval efficiency. Claude attempts failed authentication; no Claude task
comparison or claude.ai connector validation was obtained.
