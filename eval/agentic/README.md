# Agentic Eval Harness

This harness runs real coding agents against GitHits through either the MCP
server or packaged Agent Skills, and records whether the agent can use GitHits
effectively from the exposed guidance.

It is not a smoke test. Smoke tests exercise CLI and MCP contracts directly.
Agentic evals exercise agent behavior end-to-end.

Use this harness locally to understand how MCP tool-description, quick-start,
or skill changes affect real agent behavior. The dedicated CI workflow runs a
small Luna matrix daily and on explicitly authorized same-repository pull
requests. Do not treat a live agent pass/fail result as a deterministic
regression test: model behavior, backend indexing state, auth state, network
conditions, and package data can all change. The useful output is the artifact
set, especially `tool-calls.json`, `final.json`, `metrics.json`, `report.json`,
and `isolation-violations.json`.

The repository-local named-suite commands below are the local measurement
workflow. They run the fixed Luna matrix and produce validated suite and
comparison artifacts. The CI workflow composes the same commands for daily and
explicitly authorized pull-request runs; it retains raw artifacts for diagnosis
and exports normalized rows to Braintrust, but does not judge answer quality.

## What Is Under Test

- MCP local mode starts the MCP server from this checkout with
  `bun run --cwd <repo> dev mcp start`.
- MCP published mode starts the MCP server with `npx -y githits@latest mcp start`
  by default.
- Skills mode copies this checkout's `skills/` directory into the isolated
  workspace at `skills/`, `.agents/skills`, `.claude/skills`, and
  `.codex/skills`, creates a `githits` CLI shim on `PATH`, and gives Claude an
  empty strict MCP config so global/plugin MCP servers do not contaminate the
  run. Codex and OpenCode use their corresponding isolated command/config
  paths.
- One-off MCP runs use the `descriptors` guidance profile by default. The
  closed scenario set is described below; `descriptors` plus `neutral` is
  discovery, while `descriptors` plus `githits` is intent. The `full` profile
  uses the same MCP server and additionally installs only the `githits-mcp`
  skill plus project `CLAUDE.md`/`AGENTS.md` guidance; it does not install a
  CLI shim. `full` requires `--server local`; descriptor-only runs also support
  published MCP runs.
- To evaluate `quick_start` or MCP description changes, change branch/source
  and run local mode.
- To evaluate skill instruction changes, use `--surface skills --server local`.

Smoke tests are the right fit for CI gating. Agentic evals are the right fit for
qualitative review before/after instruction, tool-description, and agent-facing
UX changes.

Workload prompts remain neutral and must not tell the agent how to use GitHits.
The harness-owned `githits` intent profile is the one explicit exception: it
appends exactly `Use GitHits for this task.` between the workload and the
unchanged reporting prompt. It is an identity-bearing test condition, not a
workload edit or an agent system prompt.

## Closed scenarios

One-off and named-suite runs use this closed MCP scenario set:

| Scenario    | Guidance      | Intent    | Fragment hash                                                       | Meaning                                                |
| ----------- | ------------- | --------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `discovery` | `descriptors` | `neutral` | `null`                                                              | Descriptor-only autonomous tool discovery              |
| `intent`    | `descriptors` | `githits` | `b04b96acfd7a89516ab1742d9df914bb6779e952c7df96ac9858785ed40f10d0` | Descriptor-only discovery with the exact harness nudge |
| `full`      | `full`        | `neutral` | `null`                                                              | Repository guidance and skills, with no nudge          |

Discovery is autonomous tool discovery from MCP descriptors; it is not a
Claude Desktop or claude.ai simulation. `full` plus `githits`, Skills plus
`githits`, non-MCP `githits`, and unnamed or other values are rejected before an
agent launches. `--intent-profile` defaults to `neutral`, and its value is
recorded with the scenario and exact fragment hash.

## Isolation

Each workload receives a fresh temporary isolation root containing its workspace,
OS home, user profile, config directories, and temporary directory. Only the
caller-supplied `CODEX_HOME` is retained outside that root. It is a dedicated
eval home containing Codex authentication state and Codex-managed runtime state;
it may accumulate managed state across runs. Workload evals reject a missing or
relative `CODEX_HOME`, a root-level `AGENTS.override.md`/`AGENTS.md`, and every
direct `$CODEX_HOME/skills` entry other than `.system`, before invoking the
agent. The workload preflight does not read auth material or guidance contents.
Codex-managed
`config.toml`, bundled system skills, plugin caches, logs, and other nested
runtime files are allowed for non-interactive workload execution. Interactive
`agent:session` adds a stricter contract for `config.toml`: it may contain only
`model`, `model_reasoning_effort`, and project `trust_level` keys. A root
global-instruction file is rejected even when empty; nested `AGENTS.md` files
do not trigger this preflight because they are outside Codex's documented
global discovery root.

For local subscription authentication, log in once to a dedicated home and use
that same home for evals:

```bash
CODEX_HOME="$HOME/.codex-eval" codex login -c 'cli_auth_credentials_store="file"'
CODEX_HOME="$HOME/.codex-eval" bun run agent:e2e --agent codex --surface mcp --server local --workload eval/agentic/workloads/package-overview-vulnerabilities.md
CODEX_HOME="$HOME/.codex-eval" bun run agent:e2e --agent codex --surface skills --server local --workload eval/agentic/workloads/package-overview-vulnerabilities.md
```

The acting agent still receives only the disposable per-workload
`HOME`/`USERPROFILE`/`XDG_CONFIG_HOME`/`APPDATA` and temporary paths. The MCP
child receives the caller's `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME`/`APPDATA`
overrides so keychain- or file-backed GitHits authentication can resolve in the
trusted child. Descriptors and full guidance use the same child authentication
environment. When an optional config root is unset, the harness uses the
platform default: `HOME/.config` on POSIX or `USERPROFILE/AppData/Roaming` on
Windows.

The CI workflow creates a clean `CODEX_HOME` and authenticates Codex with
`OPENAI_API_KEY`. It sets `GITHITS_API_TOKEN` for deterministic GitHits
authentication. Codex receives that token only by variable name through the MCP
server's `env_vars`; the value is never written to `codex-config.toml` or an
eval artifact. Never copy a personal auth file into a run directory.
Non-interactive eval commands retain the supported `--ignore-user-config` and
explicitly disable Codex's `apps`, `plugins`, and `remote_plugin` features. The
flag suppresses Codex `config.toml`/user configuration only; explicit preflight
still rejects direct `$CODEX_HOME/skills` entries other than `.system`.
Interactive Codex sessions omit that exec-only flag, retain all three disables,
clear ambient MCP servers, and register only the intended GitHits MCP target.

An earlier partial Luna-low canary (2026-08-29) was not acceptance evidence:
the clean descriptor cell completed in 31.2 seconds with zero tools, CLI calls,
or isolation violations, while the clean full cell completed in 35.0 seconds
with two MCP calls and zero CLI calls but both GitHits calls returned
AUTH_REQUIRED, so the agent fell back to web sources. At that point, the final
two-cell canary still required successful GitHits MCP calls as well as clean
isolation.

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
the test suite, but no live skills canary has run.

The v2, v3, and v4 measurements above, including the contaminated 42-cell
stable-full run, remain historical descriptor/full and capacity evidence. None
is relabeled as `intent` evidence under the current contract.

### Current corrected Luna evidence

The safe schema-v2 artifacts verified on 2026-08-31 include a bounded
Luna-low package pair, the discovery canary, and the stable-full intent suite.
The package discovery cell succeeded in 32,592 ms with zero logical/MCP/CLI
calls; the package intent cell completed the process successfully in 275,327 ms
with three logical MCP calls and zero CLI calls, but its final was
inconclusive/low confidence. Both had zero isolation violations. These cells
prove tool execution and isolation, not answer quality. The discovery canary
recorded 2/2 process and final successes, 267,221 ms wall time, 266,375 ms
cumulative agent time, two MCP `code_files` calls, zero CLI calls, zero
isolation violations, and an estimated $0.0266578. The stable-full intent suite
recorded 21/21 process and final successes, 798,452 ms wall time, 796,139 ms
cumulative agent time, 115 MCP calls, zero CLI calls, zero isolation violations,
and an estimated $0.2030556 with Codex CLI 0.151.0. One `code_grep` call failed
and recovered within a successful workload. The six-workload smoke subset was
derived from that stable artifact, not rerun: 6/6 process successes, 31 MCP
calls, zero failed tool calls, and an estimated $0.06254004.

Manual `bun run agent:session` validation on 2026-08-31 with Codex CLI 0.151.0
and Luna high listed only six bundled system skills (Image Gen, OpenAI Docs,
Plugin Creator, Review Agent, Skill Creator, and Skill Installer), no GitHits or
personal skills, and `githits: connected (18 tools)`. No tool call or Keychain
access was needed for this diagnostic; the normal temporary-workspace trust
prompt required human approval. Two earlier stable intent attempts that waited
at an unattended macOS Keychain approval prompt are invalid/excluded evidence,
not a harness timeout defect. Local subscription/keychain-backed runs can
require operator presence. The daily CI workflow uses separately provisioned
non-interactive API credentials without copying or reading credentials into
artifacts.

Trace validation fails an MCP workload if it observes an external
`AGENTS.md`/`SKILL.md` read, a guidance read in the descriptor profile, or any
GitHits CLI call. The failure is preserved as redacted
`isolation-violations.json`; workspace-installed full-profile skills are
allowed. Skills-surface CLI calls remain valid.

OpenCode eval and session processes set `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`
and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` to exclude global and
Claude-compatible skills. Full MCP runs retain the intended local
`.opencode/skills` installation. Generated OpenCode config denies task
delegation (`permission.task: "deny"`) so GitHits calls stay in the observable
session. MCP reports identify any GitHits CLI fallback as an eval validation
failure rather than counting it as equivalent MCP usage. Skills runs
intentionally use the CLI surface and remain valid.

GitHits authentication follows normal local behavior. Keychain-backed human
login should work by default. Automation can use `GITHITS_API_TOKEN`.
For skills-surface evals, the agent executes the GitHits CLI through its shell;
set `GITHITS_API_TOKEN` when you need deterministic authenticated Codex/CI runs.
Without it, a run may still be useful for validating auth-error handling and CLI
command extraction.

## Usage

```bash
bun run agent:e2e --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --server published --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --surface skills --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --guidance-profile descriptors --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent claude --server local --guidance-profile full --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent opencode --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent claude --model haiku --workload eval/agentic/workloads/package-overview-vulnerabilities.md
bun run agent:e2e --agent codex --model gpt-5.4-mini --workload eval/agentic/workloads/package-overview-vulnerabilities.md
bun run agent:e2e:report .agent-eval/runs/<run>
bun run agent:e2e:report --compare .agent-eval/runs/<before> .agent-eval/runs/<after>
```

## Named suites and Luna matrix

Use the named-suite entrypoint when the change should be measured with the
curated workload policy rather than one manually selected workload:

```bash
# One target checkout; default output is .agent-eval/suites/<timestamp>
bun run agent:e2e:suite run --suite canary --concurrency 2 --dry-run
bun run agent:e2e:suite run --suite smoke --concurrency 4 --out .agent-eval/suites/smoke-local

# Compare the current checkout with an explicit baseline target checkout
bun run agent:e2e:suite pair --suite canary --baseline-root ../githits-main --dry-run

# Compare two existing suite artifacts without launching an agent
bun run agent:e2e:suite compare \
  --baseline-suite .agent-eval/pairs/<timestamp>/baseline/suite.json \
  --candidate-suite .agent-eval/pairs/<timestamp>/candidate/suite.json \
  --out .agent-eval/comparisons/local-review
```

Canary has `express-router` and
`package-overview-vulnerabilities`; smoke adds `global-example`,
`unified-search-investigation`, `docs-search-followup`, and
`package-upgrade-safety`; stable-full contains all 21 stable workloads.
`stateful-manual` contains only `githits-onboarding` and is dry-run-only in
this phase. `experimental` contains only
`experimental-code-diff`, `experimental-resolution-follow-up`, and
`experimental-site-resolution-follow-up`. The manifest therefore classifies
25 workloads: 21 stable, one stateful, and three experimental. Canary is a
subset of smoke, smoke is a subset of stable-full, and stateful or experimental
workloads never enter those stable suites.

Every named suite uses exactly Codex `gpt-5.6-luna`, reasoning `low`, local MCP,
and scenario-keyed shards. Shards may run concurrently; each shard runs its
workloads through a bounded pool selected by `workloadConcurrency`, which
defaults to `1` locally. Results remain in manifest order and the value is
recorded in `run.json` and schema-v3 `suite.json`. CI runs `discovery` with
concurrency `2` and `intent` with concurrency `4`. By default, `canary` runs
`discovery` and `intent`; `smoke`, `stable-full`, `stateful-manual`, and
`experimental` run
`intent` only. An empty suite selection fails during preflight before child
execution. Repeatable `--scenario discovery|intent|full` explicitly selects
the scenario cells and replaces the default selection, so `full` is a local or
manual opt-in. The experimental suite passes the explicit experimental-tools
option. The pair command runs the baseline target fully before the current
checkout, while the current checkout owns the measurement harness for both
sides. A pair has no candidate-root option: run it from the candidate checkout
and use `--baseline-root` for the other target.

Each scenario cell carries the fixed agent/model/reasoning identity and its
guidance/intent identity:

| Scenario    | Guidance      | Intent    | Fragment hash                                                      |
| ----------- | ------------- | --------- | ------------------------------------------------------------------ |
| `discovery` | `descriptors` | `neutral` | `null`                                                             |
| `intent`    | `descriptors` | `githits` | `b04b96acfd7a89516ab1742d9df914bb6779e952c7df96ac9858785ed40f10d0` |
| `full`      | `full`        | `neutral` | `null`                                                             |

For `run`, the current checkout owns workloads, the manifest, reporting
contract, result schema, adapters, output, and comparison code. `--target-root`
can point a single-target run at another checkout; that target supplies its
local MCP/CLI implementation, target Git identity, and full-profile
`skills/githits-mcp` plus `GITHITS_GUIDANCE_BLOCK`. Pair artifacts record both
the measurement-harness and target roots/identities so harness drift is not
mistaken for a target change.

Each run writes `suite.json` under its suite directory. A pair writes
`baseline/suite.json`, `candidate/suite.json`, and
`comparison/comparison.json` under `.agent-eval/pairs/<timestamp>` (or under
`--out`). Offline comparison defaults to
`.agent-eval/comparisons/<timestamp>`. The suite and comparison artifacts point
to child `run.json`, `metrics.json`, and `report.json` using portable relative
paths; imported references cannot traverse or follow symlinks outside their
owning suite directory.

Suite and comparison output includes normalized token buckets, cost estimates,
duration, process/final status, scenario/workload cell IDs, full-cell failures,
and logical tool counts grouped by `(surface, normalized tool)` with separate
MCP and CLI rows. Raw provider event counts remain separate audit evidence.
`callsByTool: null`, unknown token/cost/duration values, and missing cell IDs
mean telemetry was not available or was inconsistent; they are never silently
converted to zero. Partial shards preserve their successful sibling and the
full status matrix. Suite artifacts are schema version 3 and record
`workloadConcurrency` as execution metadata. Version-1 and version-2 suite
artifacts remain readable and normalize a missing concurrency value to `1`.
Comparison output does not treat concurrency as a content dimension, so valid
metric deltas remain visible.

Pair/offline comparison matches cells by scenario and workload. Agent, model,
reasoning, guidance profile, intent profile, and intent-fragment hash must also
match; a mismatch is incompatible, so historical discovery/full cells are
never compared as intent. Aggregate deltas use only compatible cells where
that metric is known on both sides and list included/excluded cells.
Reporting-contract or result-schema changes suppress direct deltas; a
workload-content change excludes only that workload's cells. Harness Git or
Codex CLI version drift remains a prominent warning and does not suppress
otherwise compatible deltas, but it prevents a repository-only attribution
label. Target Git/guidance differences remain intentional comparison
dimensions. Valid schema-v1 suite artifacts normalize the exact historical
descriptor shards/cells to `discovery` and full to `full`; missing, null, or
other profiles are rejected rather than mapped to `intent`. Legacy child
`metrics.json` files use the one-off v1 metrics normalizer.

These local commands are diagnostic measurement tools. CI scheduling and
Braintrust export are implemented by `.github/workflows/agent-evals.yml`;
Haiku coverage and quality judging remain later phases.

## Braintrust persistence

The exporter persists normalized suite evidence in the Braintrust project
`githits-cli-agent-evals` using the exact `braintrust` SDK `3.29.0`. It creates
one top-level `type: "eval"` span per scenario/workload cell and does not upload
raw stdout, stderr, provider events, environment/configuration, or arbitrary
artifacts. Known logical tool calls are safe structural `type: "tool"` child
spans under that eval root. No quality score is fabricated; self-reported
confidence remains diagnostic metadata.
The exporter metadata contract is schema/version 2; both values are recorded
in experiment metadata for regression attribution. The safe CLI result keeps
its separate result-file schema version 2.

One exporter invocation is one immutable experiment. A scenario/workload cell
is one eval row, and each normalized logical tool call is one structural tool
child. The exporter owns stable names: `main-r<RUN_ID>-a<ATTEMPT>` for main,
`pr-<PR_NUMBER>-r<RUN_ID>-a<ATTEMPT>` for trusted same-repository pull
requests, and
`local-<branch-slug>-<UTC-timestamp-with-milliseconds>-<short-sha>` for local
exports. Local branch slugs are lowercase, collapse each run of
non-ASCII-alphanumeric characters to one hyphen, and trim hyphens. Source,
channel, branch, optional PR number, full SHA, run identity, and evaluated
target dirty state are also retained in allowlisted metadata/tags and
`repoInfo`.

Before experiment initialization, the exporter scans the newest-first project
pages through the same authenticated Braintrust integration boundary and picks
the first returned object with `metadata.channel: main` and a
`main-r...-a...` name. It filters client-side, paginating with the final object
ID while a page is full; it does not send a metadata filter. That ID is passed
as `baseExperimentId`. An explicit local `--base-experiment` takes precedence
and skips discovery. PR and default-local exports fail before initialization if
no main baseline exists. The first main run is a one-time bootstrap and may
retain SDK automatic ancestry; the returned actual base is reported, but that
bootstrap is not linkage acceptance evidence.

After flush, the exporter calls `fetchBaseExperiment()` and reports the actual
safe base `{id, name}` or `null` in the result. Validate-only builds and prints
the same identity without credentials, network access, or baseline discovery;
its base is unresolved/not queried. This deterministic identity/linkage
contract is covered by focused tests, but has not yet been live-proven for a
later main run linking to main, a PR linking to main, and a local run linking
to main. Existing `github-*` experiments are historical records from the old
identity contract and are not current baselines.
For exports, the reported experiment name is the SDK's actual server name
after flush, which may differ from a reused explicit local name when Braintrust
de-duplicates it. Validate-only reports the requested or generated name.

The row mapper uses Braintrust-native metrics for duration (`duration`, in
seconds), token totals and breakdowns (`tokens`, `prompt_tokens`,
`prompt_cached_tokens`,
`prompt_cache_creation_tokens`, `completion_tokens`, and
`completion_reasoning_tokens`), and rate-based cost (`estimated_cost`). It
retains only the GitHits-specific `mcp_tool_calls`, `cli_tool_calls`,
`tool_calls_started`, `tool_calls_completed`, `tool_calls_unknown`, and
`raw_tool_events` metrics. The superseded pre-structural native-root export
from the accepted artifacts (`poc-33381601980-native-root`, Braintrust ID
`dfa37c74-0b31-4b48-aeb1-a2698a03cecc`, 23 rows) populated native duration,
prompt/completion/cache/reasoning token buckets, total `tokens`, and estimated
cost in readback/comparison. Bounded SQL totals were
`prompt_tokens=2,861,042`, `completion_tokens=20,942`,
`tokens=2,881,984`, and `estimated_cost=0.23660003`; duration ranged from 8.53
to 207.317 seconds. This is local evidence, not CI proof. Native structural
tool views are populated by the current exporter: completed/failed child spans
carry exact harness-observed start/end times and computed duration, while
started-only children remain open without a fabricated duration. Root rows do
not set `tool_calls` or `tool_errors`; Braintrust derives those native metrics
from the structural children. The labeled CI proof is recorded below;
default-branch scheduled/manual activation remains pending merge.

The current local native structural proof used suite
`.agent-eval/suites/native-tool-smoke-2` at target and measurement commit
`4850299`. Its Luna-low intent canary ran with workload concurrency 2: 2/2
workloads succeeded, with 10 logical MCP calls, zero CLI calls and failures,
and complete harness-observed intervals for all 10 calls. Wall time was
43.447 seconds, cumulative agent time 71.855 seconds, and estimated cost
`$0.02070904`.

The resulting experiment `poc-native-tool-spans-v2-20260831` (ID
`e8480301-6622-4a06-a37b-0ebd0e42bb64`,
<https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/poc-native-tool-spans-v2-20260831>)
read back two eval roots and 10 structural tool children. Native comparison
reported `tool_calls` average `5.0` and `tool_errors` `0`. Child SQL showed
exact observed start/end values and computed durations totaling 30.970 seconds,
with individual durations from 0.006 to 10.400 seconds; eval duration totaled
71.855 seconds. Native token and cost fields remain populated. This is local
proof, not CI proof. The preceding `poc-native-tool-spans-20260831` experiment
proved counts and timestamps but had null child duration and is superseded by
the v2 experiment.

The qualifying labeled CI proof is GitHub run
[33424857668](https://github.com/githits-com/githits-cli/actions/runs/33424857668)
at code SHA `7195ccc56b9ac9288dfb3d8de854f2f0e7ae7cf0`. Discovery completed in
40 seconds, intent in 2 minutes 32 seconds, and summary/export in 22 seconds,
for about 3 minutes total. Its Braintrust experiment is
`github-33424857668-1` (ID `182ee9db-0df3-40f4-8987-6eeb6d91a89b`), with source
`github`, exporter/schema 2, and metrics schema 3. Readback reconciled 23 eval
spans and 116 structural tool spans exactly to 116 MCP calls: zero CLI calls
and zero failed tool spans. Totals were 513.911 seconds of eval duration,
126.458999872 seconds of tool duration, 2,686,094 prompt tokens, 20,172
completion tokens, 2,706,266 total tokens, and estimated cost `$0.22819038`.
Standard Braintrust compare averages were duration
`22.343956532685652`, estimated cost `$0.009921320869565216`, tool calls
`5.043478260869565`, tool errors `0`, and total tokens
`117663.73913043478`. This validates the labeled pull-request path; default-
branch scheduled/manual activation remains pending merge. No paid rerun
was made for this documentation-only closeout.

Validate downloaded or local suites without credentials or network access:

```bash
bun run agent:e2e:braintrust \
  --suite discovery=.agent-eval/suites/<discovery>/suite.json \
  --suite intent=.agent-eval/suites/<intent>/suite.json \
  --project githits-cli-agent-evals \
  --validate-only
```

Validation requires non-dry-run suites with complete contained child evidence.
It rejects dry-run suites, suites with no workload cells, duplicate
scenario/workload cells, mixed identity or schema contracts, and missing/unsafe
prompts. Failed or partial cells remain exportable when their report, metrics,
workload, and prompt evidence are complete; tool-bearing legacy cells upgraded
with null timing are rejected because accurate structural spans cannot be
created. Validate all suite inputs before an export; the command reports only
safe identities and row counts in validate-only mode.

For a local export using the authenticated `bt` profile, run the same official
entrypoint through `bt eval`:

```bash
bt eval --runner bun --no-auto-instrumentation scripts/agent-eval-braintrust.ts -- \
  --suite discovery=.agent-eval/suites/<discovery>/suite.json \
  --suite intent=.agent-eval/suites/<intent>/suite.json \
  --project githits-cli-agent-evals \
  --source local \
  --result-out .agent-eval/braintrust-result.json
```

This default local export lets the exporter choose its stable name and resolve
the latest main baseline. Use `--branch <branch>` only for a detached suite;
`--experiment <name>` and `--base-experiment <main-r...-a...>` are local-only
overrides. CI supplies its channel, branch, PR number, run ID, attempt, and URL
through environment-bound arguments and does not pass `--experiment`.

The result file is safe to retain and uses result-file `schemaVersion: 2`; it
contains only mode, project, experiment, row count, suite summaries, export
URL, and the actual base `{id, name}` or `null`. In validate-only mode
`baseExperiment: null` means unresolved/not queried; in export mode `null`
means required Braintrust readback returned no actual linked base. It contains
no prompt, answer, row body, artifact path, or credential. The direct command
`bun run agent:e2e:braintrust` is also the CI path; CI scopes
`BRAINTRUST_API_KEY` only to that export step and never installs or runs `bt`.
The workflow renders the existing report and retains raw artifacts for 14 days
before exporting; a final no-secret step names scenario, report, or Braintrust
failure while preserving the earlier evidence.

Inspect persisted history with the authenticated profile:

```bash
bt experiments --json --project githits-cli-agent-evals list
bt experiments --json --project githits-cli-agent-evals view <experiment-name>
bt sql --json --non-interactive "SELECT input, output, metrics, metadata, tags FROM experiment('<experiment-id>') WHERE span_attributes.type = 'eval' LIMIT 23"
bt sql --json --non-interactive "SELECT name, span_attributes.type, metrics, metadata FROM experiment('<experiment-id>') WHERE span_attributes.type = 'tool' LIMIT 100"
```

An exported experiment contains one eval root per workload cell plus one
structural tool child per normalized logical call. Filter
`span_attributes.type` when counting workload rows; an unfiltered `count(*)`
includes both kinds of span.

The exercised comparison command is:

```bash
bt experiments --json --project githits-cli-agent-evals compare <experiment-a> <experiment-b>
```

The prior custom-only rows produced only generic Braintrust trace metrics, all
zero, and did not surface their custom eval telemetry; that remains a historical
observation about those older rows. The preceding native-root experiment is
also historical: it set root `tool_calls=119` and `tool_errors=2`, so its
comparison reported zero before structural child spans were implemented. Use
the v2 experiment above for the current native tool comparison and bounded SQL
for the exact GitHits-specific sequence/count metadata.

## Daily CI workflow

`.github/workflows/agent-evals.yml` runs the two initial Luna-low cells in
parallel on GitHub-hosted Ubuntu:

| Job       | Suite                  | Scenario    | Workload concurrency |
| --------- | ---------------------- | ----------- | -------------------: |
| discovery | `canary`                | `discovery` |                    2 |
| intent    | `stable-full`           | `intent`    |                    4 |

The workflow runs at 03:00 UTC from the default branch, on manual
`workflow_dispatch`, and for a `pull_request` `labeled` event targeting
`main`. A pull request run is authorized only when the event label is exactly
`agent-eval` and `github.event.pull_request.head.repo.full_name` equals the
repository; forks cannot consume the provider secrets. The workflow checks out
the immutable labeled head SHA for that event and `github.sha` for scheduled or
manual runs. Later commits on a still-labeled pull request do not rerun the
workflow; remove and re-add the label to authorize the newer SHA. Applying the
label is an explicit maintainer review of the code and any changes to
`.github/workflows/agent-evals.yml` before granting that SHA access to paid
credentials.

Each scenario job has a 40-minute timeout and creates its output directory
under `runner.temp` before checkout or setup. It installs the current Codex CLI
and records `codex --version`, creates an empty per-scenario `CODEX_HOME`, and
authenticates through Codex's stdin API-key flow. `OPENAI_API_KEY` is scoped to
that authentication step; `GITHITS_API_TOKEN` is scoped only to the paid suite
execution. Local subscription state, Keychain data, personal skills, and user
configuration are never copied into CI. The scenario directories are uploaded
as `agent-eval-discovery` and `agent-eval-intent` artifacts for 14 days.

The final summary job always runs for an authorized workflow, downloads both
scenario artifacts without flattening them, appends the concise report to
`GITHUB_STEP_SUMMARY`, and then exports the normalized 23-cell result to
Braintrust. The local equivalent report command is:

```bash
bun run agent:e2e:ci-report \
  --suite discovery=.agent-eval/ci-validation/discovery/suite.json \
  --suite intent=.agent-eval/ci-validation/intent/suite.json \
  --out .agent-eval/ci-validation/summary.md
```

The report is absolute: it links to the workflow run, shows schema/harness and
Codex identity, successful/expected cells, wall and cumulative time, logical
MCP/CLI calls, deterministic per-tool counts, token buckets, cost uncertainty,
concurrency, and warnings. It never loads a baseline or calculates deltas. The
subsequent Braintrust export uses the same validated suites and has no quality
judge or metric-based failure gate; it resolves and records the native
Braintrust base link after the report is rendered. The concise report remains
absolute.
Missing or malformed suite evidence, zero selected workloads or zero expected
executions, partial/failed/timeout execution, unknown or missing workload cells,
CLI fallback, and isolation violations make the workflow fail only after the
report is rendered. A successful discovery run with zero GitHits calls and
ordinary telemetry warnings remain advisory. The two observed healthy workflow
paths took about 2 minutes 42 seconds and 4 minutes 33 seconds end to end; this
is an observed range, not a future-run guarantee. The 2-minute-42-second path
had a $0.2514 rate-based cost estimate from the measured model rates; this is
not a billing guarantee. The workflow does not judge answer quality. Braintrust
persistence is observational;
export failure preserves the report/artifacts and makes the final workflow
status red.

For ad hoc interactive testing with the same MCP/skills setup logic:

```bash
bun run agent:session --agent claude --surface mcp --server local
bun run agent:session --agent claude --surface skills --server local --model haiku
CODEX_HOME="$HOME/.codex-eval" bun run agent:session --agent codex --surface skills --server local --prompt "Evaluate npm:express"
bun run agent:session --agent codex --surface mcp --server local --dry-run
bun run agent:session --agent claude --surface mcp --server local --guidance-profile full --dry-run
bun run agent:session --agent opencode --surface mcp --server local --prompt "Evaluate npm:express" --dry-run
bun run agent:session --agent codex --surface mcp --server local --experimental-tools --dry-run
```

`agent:session` creates an isolated temp workspace by default and leaves it in
place for inspection. Codex sessions additionally use the workload runner's
disposable acting-agent `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `APPDATA`,
and `TMPDIR`/`TMP`/`TEMP` roots. A live Codex session requires an existing,
absolute dedicated `CODEX_HOME` without a root `AGENTS.md` or
`AGENTS.override.md`; the caller-supplied absolute path is preserved for Codex
authentication and is not copied into the disposable roots. Dry-run Codex
sessions do not require `CODEX_HOME`, but an explicit or ambient supplied value
is validated before use. The local MCP child is built from the
host auth roots before acting-agent isolation, so trusted GitHits auth remains
available without persisting credential paths. Session metadata records only
safe relative labels for disposable acting-agent roots and omits the ephemeral
workspace label because the command runs in the user-selected workspace.

Claude and OpenCode sessions retain workspace isolation only. They are not
causal evidence for instruction isolation until agent-specific subscription
auth isolation exists. Skills mode installs this checkout's skills into
`skills/`, `.opencode/skills`, `.agents/skills`, `.claude/skills`, and
`.codex/skills`, and adds a local `githits` CLI shim to `PATH`. MCP mode writes
the same local/published GitHits MCP config used by the eval harness. Claude gets
an explicit `mcp.json`, Codex gets inline config overrides plus a persisted
`codex-config.toml` artifact, and OpenCode gets a project `opencode.json` with a
local MCP server entry. Use `--workspace <dir>` when you want a stable workspace
path, and `--dry-run` to print the command without launching the agent. Skills
and full-guidance setup preserves unrelated skills but refuses existing GitHits
skill destinations or its CLI shim, so use a new path for those modes. OpenCode
session setup also refuses to overwrite an existing project `opencode.json`.

Useful options:

```bash
--agent <claude|codex|opencode> Agent to run, default `claude`
--model <name>                  Agent model name or alias, passed through to the agent CLI
--surface <mcp|skills>          GitHits access surface under test, default `mcp`
--guidance-profile <descriptors|full>
                                MCP guidance profile; MCP defaults to `descriptors`
--intent-profile <neutral|githits>
                                One-off prompt intent; defaults to `neutral`
--reasoning-effort <minimal|low|medium|high|xhigh|max|ultra>
                                Codex reasoning effort; automated Codex defaults to `high`
--concurrency <positive integer> Maximum workloads in flight; defaults to `1`
--dry-run                       Generate artifacts without invoking the agent
--out <dir>                     Output directory, default `.agent-eval/runs/<timestamp>`
--timeout <seconds>             Per-workload timeout, default 300
--published-package <spec>      Published package spec, default `githits@latest`
--workload <path>               Repeatable workload path
--experimental-tools            Enable local experimental MCP tools for this eval/session
```

`--experimental-tools` is development/eval infrastructure only. It is valid
only with `--surface mcp --server local`, appends the hidden
`githits mcp start --experimental-tools` session flag to every generated local
MCP launch vector, and forces issue reporting off for that process. The flag
does not apply to published servers or skills runs, never writes host config,
and bypasses only the host experimental policy. Valid host auth settings still
apply; a wholly malformed shared TOML document can still block auth startup.
Host dogfooding uses the experimental policy in `config.toml` instead.

`--guidance-profile` applies to MCP runs. `descriptors` installs no skills or
project guidance. `full` installs the canonical `githits-mcp` skill and project guidance in
the isolated workspace and therefore requires local MCP. Both profiles use the
same MCP server, which publishes no initialize instructions. Skills-surface
runs do not accept an explicitly supplied MCP guidance profile.

Normal GitHits backend overrides are passed through when set:

- `GITHITS_API_URL`
- `GITHITS_MCP_URL`
- `GITHITS_CODE_NAV_URL`
- `PKGSEER_URL`
- `GITHITS_API_TOKEN`
- `GITHITS_AUTH_STORAGE`

Secret-like values are redacted in run metadata.

Automated Codex runs default to `gpt-5.6-luna` with `high` reasoning. Use
`--model` and `--reasoning-effort` to evaluate another Codex configuration;
explicit values always win. Claude accepts aliases such as `sonnet` and
`haiku`; explicit Codex examples include `gpt-5.4-mini` or `gpt-5.4-nano` when
available. The harness stores the effective model, reasoning effort, and exact
selected agent CLI version in `run.json` and `report.json`, and includes them
in the console summary. The report's generic `agentVersion` is selected only
from the matching agent-specific run field; legacy, dry-run, or missing version
data is shown as `unknown` rather than inferred from another agent.

After each run, the harness prints a concise summary with the run directory,
per-workload status and duration, unique tool count, raw tool event count,
normalized token buckets, cost kind/USD/uncertainty, logical call count,
MCP/CLI call counts, confidence when available, key artifact paths, and any
validation warnings. Null metrics are printed as `unknown`.
It also prints a `Next:` block with the exact report, compare, and raw-call
inspection commands an agent should use for follow-up. The same summary can be
regenerated later from persisted artifacts:

```bash
bun run agent:e2e:report .agent-eval/runs/<run>
bun run agent:e2e:report --json .agent-eval/runs/<run>
```

Use comparison mode for before/after review against published or a saved main
branch run:

```bash
bun run agent:e2e --server published --out .agent-eval/runs/published-baseline --workload eval/agentic/workloads/package-overview-vulnerabilities.md
bun run agent:e2e --server local --out .agent-eval/runs/local-change --workload eval/agentic/workloads/package-overview-vulnerabilities.md
bun run agent:e2e:report --compare .agent-eval/runs/published-baseline .agent-eval/runs/local-change
```

Same-agent comparisons include normalized aggregate status counts and label the
scenario, workload, guidance/intent identity, model, and reasoning effort. They
warn when any identity dimension differs. Cross-agent comparisons intentionally
degrade to tool-name presence with a warning because Claude and Codex expose
different tool-call status events.

## Workloads

Workloads are Markdown prompts. They should contain:

- The task.

The harness appends `eval/agentic/workloads/REPORTING.md` to every workload so
all agents return the same structured report. Workload files should not repeat
that reporting contract.

They should not contain instructions such as "call `search` first" or "use
`code_read` after `search`". That guidance must come from the active GitHits
surface under test.

### Workload Selection

Use targeted workloads when a change affects a specific tool family. Use both
Claude and Codex for instruction/tool-description/skill changes when practical;
use at least one agent for quick iteration.

| Affected Area                                                      | Workload                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent-driven GitHits onboarding and setup UX                       | `githits-onboarding.md`                                                                                                                                                                                                                                                               |
| Core global examples, `get_example`, `search_language`, `feedback` | `global-example.md`                                                                                                                                                                                                                                                                   |
| Unified `search` / `search_status` behavior                        | `unified-search-investigation.md`; use `search-source-ergonomics.md` when changing `search` source-selection arguments or minimal-call guidance; use `opencode-compaction.md` for the remote-MCP routing regression                                                                   |
| Explicit standalone site targets in unified `search`               | `site-search-explicit.md`                                                                                                                                                                                                                                                             |
| Package overview or vulnerability UX, `pkg_info`, `pkg_vulns`      | `package-overview-vulnerabilities.md`; use `package-vulnerability-filter.md` for severity/version filtering behavior, `package-vulnerability-history.md` for historical/non-affecting advisory scope behavior, and `package-vulnerability-rubygems.md` for non-npm descriptor routing |
| Dependency graph UX, `pkg_deps`                                    | `package-dependencies.md`                                                                                                                                                                                                                                                             |
| Release notes UX, `pkg_changelog`                                  | `package-changelog.md`; use `package-changelog-range.md` for range/body-preview behavior                                                                                                                                                                                              |
| Upgrade evidence UX, `pkg_upgrade_review`                          | `package-upgrade-safety.md`                                                                                                                                                                                                                                                           |
| Documentation browsing, `docs_list`, `docs_read`                   | `docs-discovery.md`; use `docs-search-followup.md` for search-to-read handoff and `docs-search-noise.md` for noisy docs-result recovery                                                                                                                                               |
| File listing / file read UX, `code_files`, `code_read`             | `code-file-navigation.md`; use `code-files-listing.md` for focused listing behavior; use `code-read-window.md` for focused source-window behavior                                                                                                                                     |
| Deterministic source search UX, `code_grep`                        | `code-grep-investigation.md`                                                                                                                                                                                                                                                          |
| Multi-tool code navigation strategy and MCP/skill guidance         | `express-router.md`; `opencode-compaction.md` is the remote-MCP routing regression derived from the connector transcript                                                                                                                                                              |
| Experimental target resolution                                     | `experimental-resolution-follow-up.md`; use `experimental-site-resolution-follow-up.md` for site resolution into docs search                                                                                                                                                          |
| Experimental exact source diff                                     | `experimental-code-diff.md`                                                                                                                                                                                                                                                           |

For broad MCP quick-start or description edits, start with the cheap Luna-low
canary's `discovery` and `intent` scenarios:

```bash
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile descriptors --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile descriptors --intent-profile githits --workload eval/agentic/workloads/express-router.md
```

These two commands are the smallest local Luna-low metrics pair. Each run
writes `metrics.json` and `report.json`; use the printed run directory with:

```bash
bun run agent:e2e:report --json .agent-eval/runs/<run>
bun run agent:e2e:report .agent-eval/runs/<run>
```

Named suites are available through `agent:e2e:suite`. Use
`--scenario full` for a local/manual full-guidance run. Daily pipeline
execution and persistent result export are provided by
`.github/workflows/agent-evals.yml`; quality judging remains a later phase.

For broad skill edits, run at least:

```bash
bun run agent:e2e --agent claude --surface skills --server local --workload eval/agentic/workloads/express-router.md
CODEX_HOME="$HOME/.codex-eval" bun run agent:e2e --agent codex --surface skills --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent opencode --surface skills --server local --workload eval/agentic/workloads/express-router.md
```

For tool-specific edits, add the workload from the table. Compare
`tool-calls.json`, `metrics.json`, and the final JSON's answer/confidence across
branches or against a published run.

For local experimental tool changes, run both new workloads and the
`express-router.md` regression cohort with Claude and Codex:

```bash
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/experimental-resolution-follow-up.md
bun run agent:e2e --agent codex --server local --experimental-tools --workload eval/agentic/workloads/experimental-resolution-follow-up.md
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/experimental-site-resolution-follow-up.md
bun run agent:e2e --agent codex --server local --experimental-tools --workload eval/agentic/workloads/experimental-site-resolution-follow-up.md
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/experimental-code-diff.md
bun run agent:e2e --agent codex --server local --experimental-tools --workload eval/agentic/workloads/experimental-code-diff.md
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --experimental-tools --workload eval/agentic/workloads/express-router.md
```

The eval override keeps the acting result contract product-neutral. Inspect raw
`tool-calls.json` for the actual tool sequence and arguments, then inspect
`final.json` for status, answer, and confidence. For
resolution, check that ambiguity is retained when warranted and source
follow-up uses the selected identity; for source diffs, check exact
changed-file evidence and bounded summaries without compatibility claims.

### Current Baseline Observations

The initial local baseline ran all workloads against Claude and Codex. Expected
tool families were exercised after tightening the shared reporting contract.
Notable findings to keep in mind when evaluating future changes:

- `global-example.md` exercises `get_example`; agents may combine it with docs,
  source, or package metadata when they need stronger canonical evidence.
- `code-grep-investigation.md` surfaced a real `code_grep` regex limitation for
  short/stopword-heavy patterns; literal grep is the reliable path for that
  workload.
- `unified-search-investigation.md` intentionally exposes `search` warnings and
  follow-up needs. Agents should inspect warnings and use `code_read`,
  `docs_read`, or `code_grep` when top search hits are incomplete/noisy.
- Codex sometimes reports a tool as unavailable until it performs additional
  tool discovery. Use `tool-calls.json` to distinguish actual unavailable tools
  from delayed discovery.
- The August 2026 package-description run used compact user-question prefixes
  without registry counts or prefix enumerations. Luna-low routed all four npm
  workloads to the intended package tools. Haiku selected the intended tools in
  ToolSearch for all four, then incorrectly treated the discovered deferred
  tools as uncallable in two runs; keep discovery selection separate from
  post-selection invocation failures.
- The 2026-08-31 `pkg_vulns` description comparison ran the overview, pinned
  severity, qualitative history, and RubyGems workloads against clean
  `origin/main` and the candidate with Luna-low descriptor-only intent. All
  candidate calls completed successfully with no CLI fallback. Overview and
  pinned-filter tool counts were unchanged; history kept three calls while
  replacing `pkg_info` with a second `pkg_vulns` scope; RubyGems improved from
  seven unrelated `search` / `search_status` / `code_grep` calls to direct
  `quick_start` + `pkg_vulns`. The matching neutral discovery cells exposed no
  tools and made zero calls, so they are host-discovery evidence rather than
  descriptor-selection evidence. This single Luna-low sample found no harmful
  routing regression; it is not a deterministic quality guarantee or a
  claude.ai reproduction.
- `package-vulnerability-rubygems.md` guards non-npm routing without naming
  RubyGems in the `pkg_vulns` prefix. Haiku called the intended package tools;
  Luna-low browsed instead on one run but called `pkg_vulns` and
  `pkg_upgrade_review` on an identical rerun. Treat an isolated miss as model
  variance, not evidence to crowd every prefix with registry names.
- `code-read-window.md` should show focused bounded reads when the prompt already
  names a source file and line area. Claude Haiku does this directly; Codex mini
  has been observed doing package/search preflight before the eventual bounded
  `code_read`, so review raw calls when tuning general tool-selection guidance.
- `code-files-listing.md` should show direct path enumeration with `code_files`.
  Claude Haiku does this directly. Codex mini has been observed oscillating
  between `code_read`, `code_grep`, and `code_files`, and can self-report that
  `code_files` is unavailable even when earlier runs used it; treat raw calls as
  the source of truth and fix concrete validation/error issues rather than
  overfitting instructions to one noisy run.
- `tool-calls.json` is the source of truth for tool usage. The final JSON records
  only the agent's result status, answer, and confidence; quality assessment is
  a later review concern.
- `report.json` and `agent:e2e:report` are derived review aids. They normalize
  tool names/statuses for readability but do not replace raw artifacts.

## Artifacts

Each run writes:

- `run.json` with command, git, environment, and timing metadata.
- `summary.json` with backward-compatible execution status metadata.
- `metrics.json` with schema-versioned per-workload and aggregate normalized
  usage, cost, tool-surface, identity, timing, and warning fields.
- `report.json` with derived review fields, normalized tool summaries, matched
  metrics fields, relative artifact paths, and warnings for missing or
  ambiguous metrics, missing artifacts, validation violations, or legacy
  self-report drift.
- One workload directory per workload with `prompt.md`, `stdout.json`,
  `stderr.txt`, `tool-calls.json`, and `final.json` when parsing succeeds.
- Each live or dry-run workload also records `discovery-events.json`. For Claude
  it reports `observed` when verbose JSON contains `ToolSearch` requests/results
  or `not_observed` when none are present. Other drivers report `not_exposed`.
  An absent Claude event does not prove that the host lacks tool search.
- MCP runs write a GitHits `mcp.json`, `codex-config.toml`, and `opencode.json`;
  skills runs write an empty `mcp.json` and an `opencode.json` that denies task
  delegation for isolation.
- When the local experimental override is enabled, `run.json`, each workload's
  dry-run metadata, and `.agent-session/session.json` persist
  `experimentalTools: true`; the Claude, Codex, and OpenCode local launch
  vectors contain the same `--experimental-tools` flag.
- Skills runs also write `skill-installation.json` with relative copied-skill
  paths and the CLI shim path.
- Full MCP runs additionally write `guidance-installation.json` with the
  canonical project instruction paths and copied skill metadata. Full MCP
  metadata has no CLI shim. Paths are persisted for inspection; credentials are
  never persisted. Host home values in MCP child configs and persisted command
  metadata are redacted after the child has consumed runtime config. Other
  paths and agent evidence remain attributable; credential secrets continue to
  be redacted globally.
- Each workload records relative isolation metadata. If trace validation finds
  an external/descriptor guidance read or MCP CLI fallback, it writes redacted
  `isolation-violations.json` and marks the workload failed.

Current one-off metrics are schema version 3. Run metadata and normalized
records expose `scenario`, `intentProfile`, and `intentFragmentHash`; the latter
is the SHA-256 hash of the exact intent fragment (`null` for `neutral`). The
one-off report and human summary expose the same identity plus the exact
selected agent CLI version, or `unknown` for legacy, dry-run, or missing data.
Valid schema-v1 metrics remain readable through deterministic normalization: historical MCP
`descriptors` maps to neutral `discovery`, and `full` maps to neutral `full`;
missing, null, or other profiles are rejected rather than mapped to `intent`.
No historical descriptor/full record is inferred to have used the intent
fragment.

The harness records an ISO-8601 `observedAt` when each complete stdout JSONL
lifecycle line is received. Schema-v3 normalization pairs valid observations
for each logical call into nullable `startedAt` and `completedAt`; these are
harness receipt times, not provider execution times. Existing schema-v1 and
schema-v2 metrics remain readable with missing timing upgraded to `null`.
Raw `tool-calls.json` lifecycle events may retain their optional `observedAt`.
Accurate Braintrust export rejects terminal tool-bearing rows without complete,
valid, ordered observed boundaries; observed started-only calls remain open,
and zero-tool legacy rows remain exportable.

`metrics.json` is authoritative for normalized usage and cost. For Codex it
uses the final `turn.completed.usage` aggregate. `input_tokens` is inclusive of
cached and cache-write input, so uncached input is derived by subtraction;
that partition is verified by the upstream Codex parser fixture
`parses_cache_write_token_usage` (input 100, cached input 40, cache-write input
60, total tokens 110). The Luna canary had zero cache-write input, so it did
not independently verify a nonzero cache-write case.

Reasoning output is an output detail and is not added again. Raw observations
retain their provider `item.id` for pairing: Codex logical counts collapse
observations with the same surface, ID, and normalized tool, keep first-call
order, and use the latest status. Started-only observations count once and
separate IDs remain separate calls; observations without IDs are not paired by
heuristics. The derived metrics sequence does not persist IDs or arguments.
`server: "githits-cli"` is surfaced as `cli`, and other persisted GitHits calls
as `mcp`.

Luna cost is a reproducible base-rate estimate using the stored rate snapshot,
not billed or exact cost. A turn aggregate above 272,000 inclusive input
tokens retains the estimate and warns that request-level long-context pricing
cannot be attributed. Missing or invalid Codex terminal telemetry is unknown,
not zero. Claude and OpenCode currently emit unknown usage/cost with
`adapter_not_implemented`. See
`docs/implementation/agentic-eval-metrics.md` for the complete derivation and
limitations.

The current Codex CLI does not expose a provider-resolved model, so Phase 1
metrics retain `resolvedModel: null` and use the requested model for cost;
the nullable field supports later provider adapters.

Claude is launched with `--permission-mode bypassPermissions` so non-interactive
evals can exercise GitHits without a human approval prompt. Non-full MCP runs
add `--disable-slash-commands` to disable skills. The fresh per-workload home
also prevents user-level `CLAUDE.md` discovery.
Skills runs do not use that flag because Claude Code treats it as disabling all
skills; they instead use project-only settings plus an empty strict MCP config.
Non-interactive Codex MCP evals use per-run `-c` MCP config overrides,
`--ignore-rules`, and supported `--ignore-user-config`; every live Codex eval
requires the caller-supplied dedicated eval `CODEX_HOME`, which is validated
for root global instructions and direct skills before use/launch. Dry runs may
omit `CODEX_HOME`; when an explicit or ambient value is supplied, the same
validation runs before use. The supported
`--ignore-user-config` flag suppresses Codex `config.toml`/user configuration;
the explicit skills preflight remains in force. Non-interactive Skills evals
omit the MCP and rule overrides while retaining `--ignore-user-config` so
project skills can be discovered without user-configured MCP servers. Every
non-interactive Codex eval command also repeats `--disable apps`, `--disable
plugins`, and `--disable remote_plugin` before its prompt. Interactive Codex
sessions omit both exec-only flags and retain the stricter dedicated-home
contract described above.
Codex always uses
`--dangerously-bypass-approvals-and-sandbox` so non-interactive GitHits calls are
not cancelled by the approval layer. Keep workloads controlled and run them from
the harness's empty temporary workspace. These isolation flags belong to
non-interactive `codex exec`; interactive `agent:session` launches must not pass
the exec-only `--ignore-rules` flag.

Malformed final JSON, schema mismatches, external guidance reads, MCP CLI
fallbacks, Claude failures, and timeouts are harness failures. Raw stdout and
stderr are preserved for diagnosis with known credential secrets redacted.
