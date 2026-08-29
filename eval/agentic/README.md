# Agentic Eval Harness

This harness runs real coding agents against GitHits through either the MCP
server or packaged Agent Skills, and records whether the agent can use GitHits
effectively from the exposed guidance.

It is not a smoke test. Smoke tests exercise CLI and MCP contracts directly.
Agentic evals exercise agent behavior end-to-end.

This harness is intentionally human/agent-driven, not CI. Use it to understand
how MCP tool-description, quick-start, or skill changes affect real agent
behavior. Do not treat a live agent pass/fail result as a deterministic
regression test: model behavior, backend indexing state, auth state, network
conditions, and package data can all change. The useful output is the artifact
set, especially `tool-calls.json`, `final.json`, `metrics.json`, `report.json`,
and `isolation-violations.json`.

The repository-local named-suite commands below are the Phase 2 measurement
workflow. They run the fixed Luna matrix and produce validated suite and
comparison artifacts, but they do not yet schedule paid runs, retain history in
a service, or judge answer quality.

## What Is Under Test

- MCP local mode starts the MCP server from this checkout with
  `bun run --cwd <repo> dev mcp start`.
- MCP published mode starts the MCP server with `npx -y githits@latest mcp start`
  by default.
- Skills mode copies this checkout's `skills/` directory into the isolated
  workspace at `skills/`, `.agents/skills`, `.claude/skills`, and
  `.codex/skills`, creates a `githits` CLI shim on `PATH`, and runs Claude with
  an empty strict MCP config so global/plugin MCP servers do not contaminate the
  run.
- MCP runs use the `descriptors` guidance profile by default. It exposes the
  MCP tools, including `quick_start`, with no MCP server instructions and no
  installed skills or project pointer. This approximates a remote connector
  that exposes tool definitions only. OpenCode can isolate this profile
  locally. The `full` profile uses the same MCP server and additionally installs
  only the `githits-mcp` skill plus project `CLAUDE.md`/`AGENTS.md` guidance;
  it does not install a CLI shim.
  `full` requires
  `--server local`; `descriptors` also supports published MCP runs.
- To evaluate `quick_start` or MCP description changes, change branch/source
  and run local mode.
- To evaluate skill instruction changes, use `--surface skills --server local`.

Smoke tests are the right fit for CI gating. Agentic evals are the right fit for
qualitative review before/after instruction, tool-description, and agent-facing
UX changes.

The harness must not add GitHits usage guidance through agent system prompts,
append prompts, or plugin commands. The `descriptors` profile does not install
project guidance; `full` deliberately exercises the same
canonical project guidance and skills that a guided local installation provides.
Workload prompts may ask the agent to report what happened, but must not tell
the agent how to use GitHits.

## Isolation

Each workload receives a fresh temporary isolation root containing its workspace,
OS home, user profile, config directories, and temporary directory. Only the
caller-supplied `CODEX_HOME` is retained outside that root. It is a dedicated
eval home containing Codex authentication state and Codex-managed runtime state;
it is not an auth-only directory. Live Codex MCP runs reject a missing,
relative, or root-level `AGENTS.override.md`/`AGENTS.md` before invoking the
agent. The harness checks only those two names at the CODEX_HOME root and does
not read auth material or guidance contents. Codex-managed `config.toml`,
bundled system skills, plugin caches, logs, and other nested runtime files are
allowed. A root global-instruction file is rejected even when empty; nested
`AGENTS.md` files do not trigger this preflight because they are outside Codex's
documented global discovery root.

For local subscription authentication, log in once to a dedicated home and use
that same home for evals:

```bash
CODEX_HOME="$HOME/.codex-eval" codex login -c 'cli_auth_credentials_store="file"'
CODEX_HOME="$HOME/.codex-eval" bun run agent:e2e --agent codex --surface mcp --server local --workload eval/agentic/workloads/package-overview-vulnerabilities.md
```

CI should create a clean `CODEX_HOME` and authenticate Codex with
`OPENAI_API_KEY`. Set `GITHITS_API_TOKEN` for deterministic GitHits
authentication. Never copy a personal auth file into a run directory. The eval
commands retain `--ignore-user-config` and explicitly disable Codex's `apps`,
`plugins`, and `remote_plugin` features, so user customization and external
app/plugin catalogs cannot alter the tested surface.

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
bun run agent:e2e:suite run --suite canary --dry-run
bun run agent:e2e:suite run --suite smoke --out .agent-eval/suites/smoke-local

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
and two profile shards: `descriptors` and `full`. The shards run concurrently;
workloads are sequential within each shard. The experimental suite passes the
explicit experimental-tools option. The pair command runs the baseline target
fully before the current checkout, while the current checkout owns the
measurement harness for both sides. A pair has no candidate-root option: run it
from the candidate checkout and use `--baseline-root` for the other target.

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
duration, process/final status, full-cell failures, and logical tool counts
grouped by `(surface, normalized tool)` with separate MCP and CLI rows. Raw
provider event counts remain separate audit evidence. `callsByTool: null`,
unknown token/cost/duration values, and missing cell IDs mean telemetry was not
available or was inconsistent; they are never silently converted to zero.
Partial shards preserve their successful sibling and the full status matrix.
Comparison aggregate deltas use only compatible cells where that metric is
known on both sides and list included/excluded cells. Reporting-contract or
result-schema changes suppress direct deltas; a workload-content change excludes
only that workload's cells. Harness Git or Codex CLI drift is warned about and
prevents a repository-only attribution label, while target Git/guidance changes
remain intentional comparison dimensions.

These local commands are diagnostic measurement tools. Paid CI scheduling,
persistent result history, service export, Haiku coverage, and quality judging
remain later phases.

For ad hoc interactive testing with the same MCP/skills setup logic:

```bash
bun run agent:session --agent claude --surface mcp --server local
bun run agent:session --agent claude --surface skills --server local --model haiku
bun run agent:session --agent codex --surface skills --server local --prompt "Evaluate npm:express"
bun run agent:session --agent codex --surface mcp --server local --dry-run
bun run agent:session --agent claude --surface mcp --server local --guidance-profile full --dry-run
bun run agent:session --agent opencode --surface mcp --server local --prompt "Evaluate npm:express" --dry-run
bun run agent:session --agent codex --surface mcp --server local --experimental-tools --dry-run
```

`agent:session` creates an isolated temp workspace by default and leaves it in
place for inspection. Skills mode installs this checkout's skills into
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
--reasoning-effort <minimal|low|medium|high|xhigh|max|ultra>
                                Codex reasoning effort; automated Codex defaults to `high`
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
available. The harness stores the effective model and reasoning effort in
`run.json` and `report.json`, and includes them in the console summary.

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
guidance profile, model, and reasoning effort. They warn when any of those
comparison dimensions differ. Cross-agent comparisons intentionally degrade to
tool-name presence with a warning because Claude and Codex expose different
tool-call status events.

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

| Affected Area | Workload |
|---|---|
| Agent-driven GitHits onboarding and setup UX | `githits-onboarding.md` |
| Core global examples, `get_example`, `search_language`, `feedback` | `global-example.md` |
| Unified `search` / `search_status` behavior | `unified-search-investigation.md`; use `search-source-ergonomics.md` when changing `search` source-selection arguments or minimal-call guidance; use `opencode-compaction.md` for the remote-MCP routing regression |
| Explicit standalone site targets in unified `search` | `site-search-explicit.md` |
| Package overview or vulnerability UX, `pkg_info`, `pkg_vulns` | `package-overview-vulnerabilities.md`; use `package-vulnerability-filter.md` for severity/version filtering behavior, `package-vulnerability-history.md` for historical/non-affecting advisory scope behavior, and `package-vulnerability-rubygems.md` for non-npm descriptor routing |
| Dependency graph UX, `pkg_deps` | `package-dependencies.md` |
| Release notes UX, `pkg_changelog` | `package-changelog.md`; use `package-changelog-range.md` for range/body-preview behavior |
| Upgrade evidence UX, `pkg_upgrade_review` | `package-upgrade-safety.md` |
| Documentation browsing, `docs_list`, `docs_read` | `docs-discovery.md`; use `docs-search-followup.md` for search-to-read handoff and `docs-search-noise.md` for noisy docs-result recovery |
| File listing / file read UX, `code_files`, `code_read` | `code-file-navigation.md`; use `code-files-listing.md` for focused listing behavior; use `code-read-window.md` for focused source-window behavior |
| Deterministic source search UX, `code_grep` | `code-grep-investigation.md` |
| Multi-tool code navigation strategy and MCP/skill guidance | `express-router.md`; `opencode-compaction.md` is the remote-MCP routing regression derived from the connector transcript |
| Experimental target resolution | `experimental-resolution-follow-up.md`; use `experimental-site-resolution-follow-up.md` for site resolution into docs search |
| Experimental exact source diff | `experimental-code-diff.md` |

For broad MCP quick-start or description edits, start with the cheap Luna-low
canary in both guidance profiles:

```bash
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile descriptors --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile full --workload eval/agentic/workloads/express-router.md
```

These two commands are the smallest local Luna-low metrics pair. Each run
writes `metrics.json` and `report.json`; use the printed run directory with:

```bash
bun run agent:e2e:report --json .agent-eval/runs/<run>
bun run agent:e2e:report .agent-eval/runs/<run>
```

Named suites are now available through `agent:e2e:suite`; daily pipeline
execution, persistent result history, and quality judging remain later phases.

For broad skill edits, run at least:

```bash
bun run agent:e2e --agent claude --surface skills --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --surface skills --server local --workload eval/agentic/workloads/express-router.md
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
  never persisted.
- Each workload records relative isolation metadata. If trace validation finds
  an external/descriptor guidance read or MCP CLI fallback, it writes redacted
  `isolation-violations.json` and marks the workload failed.

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
Codex MCP runs use per-run `-c` MCP config overrides, `--ignore-rules`, and
`--ignore-user-config`; the caller-supplied dedicated eval `CODEX_HOME` is
validated for root global instructions before launch. Skills runs omit the MCP
and rule overrides while retaining `--ignore-user-config` so project skills can
be discovered without user-configured MCP servers. Every Codex eval command
also repeats `--disable apps`, `--disable plugins`, and `--disable
remote_plugin` before its prompt. Codex always uses
`--dangerously-bypass-approvals-and-sandbox` so non-interactive GitHits calls are
not cancelled by the approval layer. Keep workloads controlled and run them from
the harness's empty temporary workspace. These isolation flags belong to
non-interactive `codex exec`; interactive `agent:session` launches must not pass
the exec-only `--ignore-rules` flag.

Malformed final JSON, schema mismatches, external guidance reads, MCP CLI
fallbacks, Claude failures, and timeouts are harness failures. Raw stdout and
stderr are preserved for diagnosis with known secret values redacted.
