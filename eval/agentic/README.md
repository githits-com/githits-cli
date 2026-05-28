# Agentic Eval Harness

This harness runs real coding agents against GitHits through either the MCP
server or packaged Agent Skills, and records whether the agent can use GitHits
effectively from the exposed guidance.

It is not a smoke test. Smoke tests exercise CLI and MCP contracts directly.
Agentic evals exercise agent behavior end-to-end.

This harness is intentionally human/agent-driven, not CI. Use it to understand
how MCP instruction, tool-description, or skill changes affect real agent
behavior. Do not treat a live agent pass/fail result as a deterministic
regression test: model behavior, backend indexing state, auth state, network
conditions, and package data can all change. The useful output is the artifact set, especially
`tool-calls.json`, `final.json`, `toolIssues`, `instructionIssues`, and the
agent's usefulness assessment.

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
- To evaluate MCP instruction changes, change branch/source and run local mode.
- To evaluate skill instruction changes, use `--surface skills --server local`.

Smoke tests are the right fit for CI gating. Agentic evals are the right fit for
qualitative review before/after instruction, tool-description, and agent-facing
UX changes.

The harness must not add GitHits usage guidance through agent system prompts,
append prompts, alternate MCP instruction files, project instructions, or plugin
commands. In skills mode, the copied skills are the only GitHits guidance added
to the workspace. Workload prompts may ask the agent to report what happened,
but must not tell the agent how to use GitHits.

## Isolation

Runs execute agents from an empty temporary workspace so repository-local files
such as `AGENTS.md`, `.mcp.json`, commands, skills, and plugin payloads do not
contaminate results. The harness keeps the user's normal Claude/GitHits auth
environment so human-driven keychain/OAuth sessions continue to work.

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
```

`agent:session` creates an isolated temp workspace by default and leaves it in
place for inspection. Skills mode installs this checkout's skills into
`skills/`, `.agents/skills`, `.claude/skills`, and `.codex/skills`, and adds a
local `githits` CLI shim to `PATH`. MCP mode writes the same local/published
GitHits MCP config used by the eval harness. Use `--workspace <dir>` when you
want a stable workspace path, and `--dry-run` to print the command without
launching the agent.

Useful options:

```bash
--agent <claude|codex>          Agent to run, default `claude`
--model <name>                  Agent model name or alias, passed through to the agent CLI
--surface <mcp|skills>          GitHits access surface under test, default `mcp`
--dry-run                       Generate artifacts without invoking the agent
--out <dir>                     Output directory, default `.agent-eval/runs/<timestamp>`
--timeout <seconds>             Per-workload timeout, default 300
--published-package <spec>      Published package spec, default `githits@latest`
--workload <path>               Repeatable workload path
```

Normal GitHits backend overrides are passed through when set:

- `GITHITS_API_URL`
- `GITHITS_MCP_URL`
- `GITHITS_CODE_NAV_URL`
- `PKGSEER_URL`
- `GITHITS_API_TOKEN`
- `GITHITS_AUTH_STORAGE`

Secret-like values are redacted in run metadata.

Use `--model` to evaluate smaller or cheaper models against the same workload.
Claude accepts aliases such as `sonnet` and `haiku`; Codex accepts model IDs such
as `gpt-5.4-mini` or `gpt-5.4-nano` when available. The harness
stores the selected model in `run.json` and `report.json`, and includes it in the
console summary.

After each run, the harness prints a concise summary with the run directory,
per-workload status, unique GitHits tool count, raw tool event count,
usefulness/confidence when available, key artifact paths, and reported
tool/instruction issues. It also prints a `Next:` block with the exact report,
compare, and raw-call inspection commands an agent should use for follow-up. The
same summary can be regenerated later from persisted artifacts:

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

Same-agent comparisons include normalized aggregate status counts. Cross-agent
comparisons intentionally degrade to tool-name presence with a warning because
Claude and Codex expose different tool-call status events.

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
| Core global examples, `get_example`, `search_language`, `feedback` | `global-example.md` |
| Unified `search` / `search_status` behavior | `unified-search-investigation.md`; use `search-source-ergonomics.md` when changing `search` source-selection arguments or minimal-call guidance |
| Package overview or vulnerability UX, `pkg_info`, `pkg_vulns` | `package-overview-vulnerabilities.md`; use `package-vulnerability-filter.md` for severity/version filtering behavior; use `package-vulnerability-history.md` for historical/non-affecting advisory scope behavior |
| Dependency graph UX, `pkg_deps` | `package-dependencies.md` |
| Release notes UX, `pkg_changelog` | `package-changelog.md`; use `package-changelog-range.md` for range/body-preview behavior |
| Upgrade evidence UX, `pkg_upgrade_review` | `package-upgrade-safety.md` |
| Documentation browsing, `docs_list`, `docs_read` | `docs-discovery.md`; use `docs-search-followup.md` for search-to-read handoff and `docs-search-noise.md` for noisy docs-result recovery |
| File listing / file read UX, `code_files`, `code_read` | `code-file-navigation.md`; use `code-files-listing.md` for focused listing behavior; use `code-read-window.md` for focused source-window behavior |
| Deterministic source search UX, `code_grep` | `code-grep-investigation.md` |
| Multi-tool code navigation strategy and MCP/skill instructions | `express-router.md` |

For broad MCP instruction edits, run at least:

```bash
bun run agent:e2e --agent claude --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --workload eval/agentic/workloads/express-router.md
```

For broad skill edits, run at least:

```bash
bun run agent:e2e --agent claude --surface skills --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --surface skills --server local --workload eval/agentic/workloads/express-router.md
```

For tool-specific edits, add the workload from the table. Compare
`tool-calls.json` plus the final JSON's `toolIssues`, `instructionIssues`, and
`githitsUsefulnessReason` across branches or against a published run.

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
- `report.json` with derived review fields, normalized tool summaries, relative
  artifact paths, and warnings for missing artifacts or self-report drift.
- One workload directory per workload with `prompt.md`, `stdout.json`,
  `stderr.txt`, `tool-calls.json`, and `final.json` when parsing succeeds.
- MCP runs write a GitHits `mcp.json` and `codex-config.toml`; skills runs write
  an empty `mcp.json` for Claude isolation.
- Skills runs also write `skill-installation.json` with the copied skill path
  and CLI shim path.

Claude is launched with `--permission-mode bypassPermissions` so non-interactive
evals can exercise GitHits without a human approval prompt. MCP runs add
`--disable-slash-commands` to reduce plugin/skill contamination. Skills runs do
not use that flag because Claude Code treats it as disabling all skills; they
instead use project-only settings plus an empty strict MCP config. Codex MCP runs
use per-run `-c` MCP config overrides and `--ignore-rules`; skills runs omit
both and use `--ignore-user-config` so project skills can be discovered without
user-configured MCP servers. Codex always uses
`--dangerously-bypass-approvals-and-sandbox` so non-interactive GitHits calls are
not cancelled by the approval layer. Keep workloads controlled and run them from
the harness's empty temporary workspace.

Malformed final JSON, schema mismatches, Claude failures, and timeouts are
harness failures. Raw stdout and stderr are preserved for diagnosis with known
secret values redacted.
