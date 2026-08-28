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
`toolIssues`, `instructionIssues`, and the agent's usefulness assessment.

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
  locally; Codex and Claude runs retain the diagnostic limitations documented
  below. The `full` profile uses the same MCP server and additionally installs
  only the `githits-mcp` skill plus project `CLAUDE.md`/`AGENTS.md` guidance.
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

Runs execute agents from an empty temporary workspace so repository-local files
such as `AGENTS.md`, `.mcp.json`, commands, skills, and plugin payloads do not
contaminate results. The harness keeps normal agent and GitHits authentication
so human-driven keychain/OAuth sessions continue to work. OpenCode can exclude
user guidance under that constraint. Codex always reads global
`$CODEX_HOME/AGENTS.md` when present; `--ignore-user-config` excludes
`config.toml`, not agent guidance. Claude Code's `--bare` mode suppresses global
`CLAUDE.md` auto-discovery but disables subscription/OAuth in favor of
API-key-style auth. Therefore local Codex and Claude descriptor/full runs may
observe user-level guidance and are diagnostic only, not causal evidence for a
guidance-profile comparison. Use an authenticated remote connector or another
verified instruction-isolated host for acceptance; do not treat a local Codex
or Claude profile label as proof of instruction isolation.

OpenCode eval and session processes set `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`
and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` to exclude global and
Claude-compatible skills. Full MCP runs retain the intended local
`.opencode/skills` installation. Generated OpenCode config denies task
delegation (`permission.task: "deny"`) so GitHits calls stay in the observable
session. MCP reports identify any GitHits CLI fallback in both the
`descriptors` and `full` profiles rather than counting it as equivalent MCP
usage. Skills runs intentionally use the CLI surface and do not receive that
MCP fallback warning.

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
per-workload status and duration, unique GitHits tool count, raw tool event
count, normalized token buckets, cost kind/USD/uncertainty, logical call count,
MCP/CLI call counts, usefulness/confidence when available, key artifact paths,
and reported tool/instruction issues. Null metrics are printed as `unknown`.
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
| Experimental target resolution | `experimental-resolution-follow-up.md` |
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

Named suites, daily pipeline execution, persistent result history, and quality
judging are later phases; this implementation runs the existing workload list
one workload at a time.

For broad skill edits, run at least:

```bash
bun run agent:e2e --agent claude --surface skills --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --surface skills --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent opencode --surface skills --server local --workload eval/agentic/workloads/express-router.md
```

For tool-specific edits, add the workload from the table. Compare
`tool-calls.json` plus the final JSON's `toolIssues`, `instructionIssues`, and
`githitsUsefulnessReason` across branches or against a published run.

For local experimental tool changes, run both new workloads and the
`express-router.md` regression cohort with Claude and Codex:

```bash
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/experimental-resolution-follow-up.md
bun run agent:e2e --agent codex --server local --experimental-tools --workload eval/agentic/workloads/experimental-resolution-follow-up.md
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/experimental-code-diff.md
bun run agent:e2e --agent codex --server local --experimental-tools --workload eval/agentic/workloads/experimental-code-diff.md
bun run agent:e2e --agent claude --server local --experimental-tools --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --experimental-tools --workload eval/agentic/workloads/express-router.md
```

The eval override forces issue reporting off. Inspect raw `tool-calls.json`
for the actual tool sequence and arguments, then inspect `final.json` for
`toolIssues`, `instructionIssues`, usefulness, and confidence. For
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
- `tool-calls.json` is the source of truth for tool usage. The final JSON is for
  the agent's assessment of clarity, issues, and usefulness.
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
  ambiguous metrics, missing artifacts, CLI fallback, or self-report drift.
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
- Skills runs also write `skill-installation.json` with the copied skill path
  and CLI shim path.
- Full MCP runs additionally write `guidance-installation.json` with the
  canonical project instruction paths and copied skill metadata. Paths are
  persisted for inspection; credentials are never persisted.

`metrics.json` is authoritative for normalized usage and cost. For Codex it
uses the final `turn.completed.usage` aggregate. `input_tokens` is inclusive of
cached and cache-write input, so uncached input is derived by subtraction;
reasoning output is an output detail and is not added again. The current
Codex adapter reports one logical call for each persisted extracted event;
because Codex can emit both `item.started` and `item.completed` for one MCP
call, treat logical counts as provisional and inspect the ordered raw sequence
until that event pairing is reconciled. `server: "githits-cli"` is surfaced as
`cli`, and other persisted GitHits calls as `mcp`.

Luna cost is a reproducible base-rate estimate using the stored rate snapshot,
not billed or exact cost. A turn aggregate above 272,000 inclusive input
tokens retains the estimate and warns that request-level long-context pricing
cannot be attributed. Missing or invalid Codex terminal telemetry is unknown,
not zero. Claude and OpenCode currently emit unknown usage/cost with
`adapter_not_implemented`. See
`docs/implementation/agentic-eval-metrics.md` for the complete derivation and
limitations.

Claude is launched with `--permission-mode bypassPermissions` so non-interactive
evals can exercise GitHits without a human approval prompt. Non-full MCP runs
add `--disable-slash-commands` to disable skills, but this does not disable
global `CLAUDE.md` discovery; the isolation limitation above still applies.
Skills runs do not use that flag because Claude Code treats it as disabling all
skills; they instead use project-only settings plus an empty strict MCP config.
Codex MCP runs use per-run `-c` MCP config overrides, `--ignore-rules`, and
`--ignore-user-config`; these exclude user config, execution-policy rules, and
configured MCP/plugin skills, but not global `$CODEX_HOME/AGENTS.md`. Skills
runs omit the MCP and rule overrides while retaining `--ignore-user-config` so
project skills can be discovered without user-configured MCP servers. Codex always uses
`--dangerously-bypass-approvals-and-sandbox` so non-interactive GitHits calls are
not cancelled by the approval layer. Keep workloads controlled and run them from
the harness's empty temporary workspace. These isolation flags belong to
non-interactive `codex exec`; interactive `agent:session` launches must not pass
the exec-only `--ignore-rules` flag.

Malformed final JSON, schema mismatches, Claude failures, and timeouts are
harness failures. Raw stdout and stderr are preserved for diagnosis with known
secret values redacted.
