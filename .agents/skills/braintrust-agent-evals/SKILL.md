---
name: braintrust-agent-evals
description: Inspect, query, compare, or explicitly export GitHits agent-eval history in Braintrust using the repository's verified workflow.
---

# Braintrust agent evals

Use this skill for read-only inspection of the GitHits agent-eval history in the
Braintrust project `githits-cli-agent-evals`, or when the user explicitly asks
to export a validated local suite. The normalized exporter stores one row per
scenario/workload cell; see
[`docs/implementation/agentic-eval-metrics.md`](../../../docs/implementation/agentic-eval-metrics.md)
for the field contract.

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
bt sql --json --non-interactive "SELECT input, output, metrics, metadata, tags FROM experiment('<experiment-id>') LIMIT 23"
```

The query is the verified path for prompts, neutral answers, hashes, statuses,
native token/cost/duration metrics, and tool telemetry. Native-first UI and
comparison behavior still require a fresh export/readback. Open an experiment
permalink when row-level UI inspection is useful.

The exercised comparison syntax is:

```bash
bt experiments --json --project githits-cli-agent-evals compare <experiment-a> <experiment-b>
```

The prior custom-only experiments succeeded but reported only generic
Braintrust trace metrics, which were zero and did not expose their custom eval
telemetry. Do not treat that historical result as native-first comparison
evidence; use bounded SQL and the experiment UI until a fresh native export is
read back and the comparison behavior is investigated.

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
  --experiment local-<name> \
  --source local \
  --result-out .agent-eval/braintrust-result.json
```

The suite preflight rejects dry-run suites, suites with no workload cells,
duplicate cells, mixed identity or schema contracts, and missing/unsafe child
evidence before network setup. It does not reject a failed cell that retains
complete report, metrics, workload, and contained prompt evidence. The result
file is nonsecret and contains only schema version, mode, project, experiment,
row count, suite summaries, and an export URL when applicable; it never contains
row bodies, prompts, answers,
artifact paths, or credentials. Do not create or upload a new experiment unless
the user explicitly requests that export.
