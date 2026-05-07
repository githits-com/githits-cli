# Agentic Eval Harness

This harness runs real coding agents against the real GitHits MCP server and
records whether the agent can use GitHits tools effectively from the MCP
server's own instructions and tool descriptions.

It is not a smoke test. Smoke tests exercise CLI and MCP contracts directly.
Agentic evals exercise agent behavior end-to-end.

This harness is intentionally human/agent-driven, not CI. Use it to understand
how MCP instruction or tool-description changes affect real agent behavior. Do
not treat a live agent pass/fail result as a deterministic regression test: model
behavior, backend indexing state, auth state, network conditions, and package
data can all change. The useful output is the artifact set, especially
`tool-calls.json`, `final.json`, `toolIssues`, `instructionIssues`, and the
agent's usefulness assessment.

## What Is Under Test

- Local mode starts the MCP server from this checkout with
  `bun run --cwd <repo> dev mcp start`.
- Published mode starts the MCP server with `npx -y githits@latest mcp start`
  by default.
- To evaluate MCP instruction changes, change branch/source and run local mode.

Smoke tests are the right fit for CI gating. Agentic evals are the right fit for
qualitative review before/after instruction, tool-description, and agent-facing
UX changes.

The harness must not add GitHits usage guidance through agent system prompts,
append prompts, alternate MCP instruction files, project instructions, or plugin
commands. Workload prompts may ask the agent to report what happened, but must
not tell the agent how to use GitHits.

## Isolation

Runs execute agents from an empty temporary workspace so repository-local files
such as `AGENTS.md`, `.mcp.json`, commands, skills, and plugin payloads do not
contaminate results. The harness keeps the user's normal Claude/GitHits auth
environment so human-driven keychain/OAuth sessions continue to work.

GitHits authentication follows normal local behavior. Keychain-backed human
login should work by default. Automation can use `GITHITS_API_TOKEN`.

## Usage

```bash
bun run agent:e2e --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --server published --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --workload eval/agentic/workloads/express-router.md
```

Useful options:

```bash
--agent <claude|codex>          Agent to run, default `claude`
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

## Workloads

Workloads are Markdown prompts. They should contain:

- The task.

The harness appends `eval/agentic/workloads/REPORTING.md` to every workload so
all agents return the same structured report. Workload files should not repeat
that reporting contract.

They should not contain instructions such as "call `search` first" or "use
`code_read` after `search`". That guidance must come from the MCP server.

### Workload Selection

Use targeted workloads when a change affects a specific tool family. Use both
Claude and Codex for instruction/tool-description changes when practical; use at
least one agent for quick iteration.

| Affected Area | Workload |
|---|---|
| Core global examples, `get_example`, `search_language`, `feedback` | `global-example.md` |
| Unified `search` / `search_status` behavior | `unified-search-investigation.md` |
| Package overview or vulnerability UX, `pkg_info`, `pkg_vulns` | `package-overview-vulnerabilities.md` |
| Dependency graph UX, `pkg_deps` | `package-dependencies.md` |
| Release notes UX, `pkg_changelog` | `package-changelog.md`; use `package-changelog-range.md` for range/body-preview behavior |
| Documentation browsing, `docs_list`, `docs_read` | `docs-discovery.md` |
| File listing / file read UX, `code_files`, `code_read` | `code-file-navigation.md` |
| Deterministic source search UX, `code_grep` | `code-grep-investigation.md` |
| Multi-tool code navigation strategy and MCP instructions | `express-router.md` |

For broad MCP instruction edits, run at least:

```bash
bun run agent:e2e --agent claude --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --workload eval/agentic/workloads/express-router.md
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
- `tool-calls.json` is the source of truth for tool usage. The final JSON is for
  the agent's assessment of clarity, issues, and usefulness.

## Artifacts

Each run writes:

- `run.json` with command, git, environment, and timing metadata.
- One workload directory per workload with `prompt.md`, `mcp.json`,
  `stdout.json`, `stderr.txt`, `tool-calls.json`, and `final.json` when parsing
  succeeds.

Claude is launched with `--permission-mode bypassPermissions` so non-interactive
evals can exercise configured MCP tools without a human approval prompt, and
`--disable-slash-commands` to reduce plugin/skill contamination while preserving
normal human auth. Codex is launched with per-run `-c` MCP config overrides,
`--ignore-rules`, and a read-only sandbox so it can use normal human auth
without mutating global MCP configuration.

Malformed final JSON, schema mismatches, Claude failures, and timeouts are
harness failures. Raw stdout and stderr are preserved for diagnosis with known
secret values redacted.
