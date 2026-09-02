---
name: braintrust-agent-evals
description: Inspect, query, compare, or explicitly export GitHits agent-eval history in Braintrust using the repository's verified workflow.
metadata:
  internal: true
---

# Braintrust agent evals

Use this skill for read-only inspection of the GitHits agent-eval history in the
Braintrust project `githits-cli-agent-evals`, or when the user explicitly asks
to export a validated local suite. The normalized exporter stores one top-level
eval span per scenario/workload cell plus structural tool children; see
[`docs/implementation/agentic-eval-metrics.md`](../../../docs/implementation/agentic-eval-metrics.md)
for the field contract.

The persistence unit is one exporter invocation = one experiment, one
scenario/workload cell = one eval row, and one normalized logical tool call =
one structural tool child. Current exporter-owned experiment names are
`main-r<run-id>-a<attempt>`, `pr-<pr-number>-r<run-id>-a<attempt>`, and
`local-<branch-slug>-<UTC-timestamp-with-milliseconds>-<short-sha>`. Historical
`github-*` experiments predate this identity contract and should be treated as
historical evidence, not as current names or baseline candidates.

## Safety and interpretation

- Read-only is the default. Never delete experiments or upload raw stdout,
  stderr, environment/configuration, provider events, or arbitrary artifacts.
- Never read or print `BRAINTRUST_API_KEY`, `.bt/`, Keychain contents, or any
  credential/environment value. CI scopes the key only to its exporter step.
- Do not treat an agent's self-reported confidence as result quality. This
  phase has no scorer or quality score.
- A failed or partial cell can be valid history when its normalized evidence is
  complete; distinguish that from a rejected suite or failed preflight.

## Inspect experiments

Use the exercised project-option placement for list/view:

```bash
bt experiments --json --project githits-cli-agent-evals list
bt experiments --json --project githits-cli-agent-evals view <experiment-name>
```

Use the experiment ID returned by the view result for a bounded field query:

```bash
bt sql --json --non-interactive "SELECT input, output, metrics, metadata, tags FROM experiment('<experiment-id>') WHERE span_attributes.type = 'eval' LIMIT 23"
bt sql --json --non-interactive "SELECT name, span_attributes.type, metrics, metadata FROM experiment('<experiment-id>') WHERE span_attributes.type = 'tool' LIMIT 100"
```

The eval-root query is the verified path for prompts, neutral answers, hashes,
statuses, native token/cost/duration metrics, and root metadata. Query tool
children separately for native tool counts/errors and exact lifecycle timing.
An unfiltered `count(*)` includes both eval roots and tool children, so it is not
the workload-row count. A local proof experiment
`poc-native-tool-spans-v2-20260831` (ID
`e8480301-6622-4a06-a37b-0ebd0e42bb64`,
<https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/poc-native-tool-spans-v2-20260831>)
read back two eval roots and 10 tool children. Native comparison reported
`tool_calls` average `5.0` and
`tool_errors` `0`; child durations totaled 30.970 seconds and ranged from
0.006 to 10.400 seconds. Native token and cost fields remain populated. Open
the experiment permalink when row-level UI inspection is useful.

The labeled CI path is proven by [run
33424857668](https://github.com/githits-com/githits-cli/actions/runs/33424857668)
at code SHA `7195ccc56b9ac9288dfb3d8de854f2f0e7ae7cf0`. Its experiment is
`github-33424857668-1` (ID `182ee9db-0df3-40f4-8987-6eeb6d91a89b`), source
`github`, exporter/schema 2, metrics schema 3: 23 eval spans and 116 tool
children, exactly matching 116 MCP calls, with zero CLI calls and zero failed
tool spans. Totals were 513.911 seconds eval duration, 126.458999872 seconds tool
duration, 2,686,094 prompt tokens, 20,172 completion tokens, 2,706,266 total
tokens, and estimated cost `$0.22819038`. Compare averages were duration
`22.343956532685652`, estimated cost `$0.009921320869565216`, tool calls
`5.043478260869565`, tool errors `0`, and total tokens `117663.73913043478`.
The first stable default-branch bootstrap is [run
33477846273](https://github.com/githits-com/githits-cli/actions/runs/33477846273)
at SHA `40796bd0eabaf87afec5ea0e4460ff47e7448603`. Experiment
`main-r33477846273-a1` (ID `6f3847fc-3816-4b32-b1f6-65019c2757b7`) read back
23 eval roots and 112 tool children, zero CLI calls, 3,024,404 tokens,
445.728 seconds cumulative agent duration, and estimated cost `$0.24188221`.
Its null base is the expected one-time bootstrap result. Main pushes now
temporarily run the same matrix, in addition to the daily/manual/label paths,
to collect variance and workload-optimization evidence.

For current comparisons, inspect experiment-level `metadata.channel` and
`baseExperiment` in the safe exporter result or CI summary. A current main
baseline has a `main-r...-a...` name and `channel: main`; PR and local exports
resolve the newest such main experiment before initialization. The exporter
reports the actual linked base `{id, name}` after `fetchBaseExperiment()`.
Validate-only reports the base as unresolved/not queried and performs no
discovery. The first main run is a one-time bootstrap; PR and default-local
exports fail before initialization when no main baseline exists. Explicit
local `--base-experiment` takes precedence and skips discovery. No live
readback has proven the first main bootstrap, but not later-main, PR, or local
linkage under the new names.
For exports, use the returned experiment name from the SDK readback; it can
differ from a reused explicit local name if Braintrust de-duplicates it.
Validate-only reports the requested or generated name.

The exercised comparison syntax is:

```bash
bt experiments --json --project githits-cli-agent-evals compare <experiment-a> <experiment-b>
```

For custom cross-experiment SQL analysis, join eval rows by
`metadata.cellId`, not `metadata.workloadId`: the same workload can appear in
multiple scenarios. Braintrust's built-in experiment comparison already
matches the stable row inputs and avoids this ambiguity.

The prior custom-only experiments succeeded but reported only generic
Braintrust trace metrics, which were zero and did not expose their custom eval
telemetry. Treat that only as historical evidence about the older rows. The
preceding native-root experiment is also historical: it set root
`tool_calls=119` and `tool_errors=2`, so comparison reported zero before
structural children were implemented. Use bounded SQL and the experiment UI for
GitHits-specific/custom telemetry; the current exporter uses exact
harness-observed lifecycle boundaries and never fabricates timing.

## Validate or explicitly export

Credential-free validation maps complete suite artifacts without initializing
Braintrust:

```bash
bun run agent:e2e:braintrust \
  --suite discovery=.agent-eval/suites/<discovery>/suite.json \
  --suite intent=.agent-eval/suites/<intent>/suite.json \
  --project githits-cli-agent-evals \
  --validate-only
```

An authenticated local subscription export uses the saved `bt` profile to run
the same official entrypoint. The exporter, not `bt`, owns the experiment
options and safe result file:

```bash
bt eval --runner bun --no-auto-instrumentation scripts/agent-eval-braintrust.ts -- \
  --suite discovery=.agent-eval/suites/<discovery>/suite.json \
  --suite intent=.agent-eval/suites/<intent>/suite.json \
  --project githits-cli-agent-evals \
  --source local \
  --result-out .agent-eval/braintrust-result.json
```

This default local export lets the exporter derive its stable name and resolve
the latest main baseline. Add `--branch <branch>` only when the evaluated suite
is detached or has no branch; add `--base-experiment <main-r...-a...>` to use an
explicit local main override. `--experiment <name>` is also a local-only
override. GitHub workflow exports supply their channel, branch, PR number, run
identity, and URL through environment-bound arguments and never pass
`--experiment`.

The suite preflight rejects dry-run suites, suites with no workload cells,
duplicate cells, mixed identity or schema contracts, and missing/unsafe child
evidence before network setup. It does not reject a failed cell that retains
complete report, metrics, workload, and contained prompt evidence. The result
file is nonsecret and uses result-file `schemaVersion: 2`; it contains only
mode, project, experiment, row count, suite summaries, an export URL when
applicable, and `baseExperiment`. In validate-only mode `baseExperiment: null`
means unresolved/not queried; in export mode `null` means the required
Braintrust readback returned no actual linked base. Experiment metadata records
exporter schema/version 2. It never contains row bodies, prompts, answers,
artifact paths, or credentials.
Terminal tool-bearing rows lacking complete/valid observed lifecycle timing are
rejected because they cannot produce accurate structural children; an observed
started-only call remains an open child. Zero-tool legacy rows remain
exportable. Do not create or upload a new experiment unless the user explicitly
requests that export.
