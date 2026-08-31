# Agentic eval usage metrics

## Purpose

The agentic eval runner preserves raw workload evidence and now derives a
schema-versioned `metrics.json` artifact for local inspection. `report.json`
and the console summary are review aids built from that artifact; they do not
replace the raw terminal output or `tool-calls.json`.

This is local maintainer tooling. It is not a daily pipeline, persistent
history service, deterministic CI gate, or quality judge. Named Luna suites and
local paired/offline comparisons are implemented here; daily execution,
long-term export, and answer-quality scoring remain later phases.

## Scenario and intent identity

The harness has three closed MCP scenarios:

| Scenario    | Guidance profile | Intent profile | Fragment hash                                                      |
| ----------- | ---------------- | -------------- | ------------------------------------------------------------------ |
| `discovery` | `descriptors`    | `neutral`      | `null`                                                             |
| `intent`    | `descriptors`    | `githits`      | `b04b96acfd7a89516ab1742d9df914bb6779e952c7df96ac9858785ed40f10d0` |
| `full`      | `full`           | `neutral`      | `null`                                                             |

The exact harness-owned intent fragment is `Use GitHits for this task.`. It is
inserted between the unchanged workload Markdown and reporting contract. The
workload files remain prompt-neutral. Descriptor-only discovery is autonomous
tool discovery from MCP descriptors, not a Claude Desktop or claude.ai
simulation. `full` plus `githits`, Skills plus `githits`, non-MCP `githits`, and
unnamed values are invalid before launch. One-off runs accept repeatable
workloads and `--intent-profile neutral|githits`, defaulting to `neutral`.

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

## Isolation correction

The runner now creates a fresh per-workload OS home/config root and retains only
the caller-supplied, validated dedicated eval `CODEX_HOME`. That home contains
authentication state plus Codex-managed runtime state accumulated by normal
use. Local subscription use requires a dedicated home, for example:

```bash
CODEX_HOME="$HOME/.codex-eval" codex login -c 'cli_auth_credentials_store="file"'
CODEX_HOME="$HOME/.codex-eval" bun run agent:e2e --agent codex --surface mcp --server local --workload eval/agentic/workloads/package-overview-vulnerabilities.md
CODEX_HOME="$HOME/.codex-eval" bun run agent:e2e --agent codex --surface skills --server local --workload eval/agentic/workloads/package-overview-vulnerabilities.md
```

CI should provide a clean `CODEX_HOME` with `OPENAI_API_KEY` authentication. The
harness does not read auth material and never copies it into artifacts. The
workload preflight rejects only root-level `AGENTS.override.md` and `AGENTS.md`;
nested runtime/cache files, including Codex's `config.toml`, bundled system
skills, plugin caches, and logs, are allowed. The stricter existence check
rejects a root instruction file even when it is empty. Interactive
`agent:session` adds the direct-skills and allowed-config-key validation
described below. Full MCP guidance installs only
the project guidance and `githits-mcp` skill; it does not install a CLI shim.
Skills-surface runs retain their CLI shim.

Every non-interactive Codex eval command retains `--ignore-user-config` and
repeats `--disable apps`, `--disable plugins`, and `--disable remote_plugin`.
This keeps user customization and external app/plugin/remote catalogs out of
the descriptor, full-guidance, and skills surfaces while preserving repository
skill discovery for the latter two where intended.

After live MCP execution, trace validation rejects external `AGENTS.md` or
`SKILL.md` reads, guidance reads in the descriptor profile, and every GitHits
CLI call. It persists only the violation category and redacted path/tool in
`isolation-violations.json`; workspace-local full-profile skill reads are
allowed. The neutral acting result contract is `status`, `answer`, and
`confidence`. Legacy final artifacts remain readable by the offline report
loader.

Interactive `agent:session` applies the same disposable acting-agent
`HOME`/`USERPROFILE`/`XDG_CONFIG_HOME`/`APPDATA` and temporary roots for Codex
only. Live Codex sessions validate the caller-supplied absolute dedicated
`CODEX_HOME` before launch; dry runs do not require it, and that path remains
unchanged for Codex authentication. Interactive validation rejects root
`AGENTS.override.md`/`AGENTS.md`, every direct `$CODEX_HOME/skills` entry except
`.system`, and every `config.toml` key except `model`,
`model_reasoning_effort`, and project `trust_level`. The local MCP child is
configured from the host auth roots before the acting-agent environment is
replaced, preserving trusted GitHits authentication without copying
credentials. Session metadata stores only relative isolation labels. Claude
and OpenCode retain workspace isolation only; they are non-causal for
instruction-isolation evidence until agent-specific subscription auth
isolation exists. Interactive Codex commands do not pass the exec-only
`--ignore-user-config`; they disable `apps`, `plugins`, and `remote_plugin`,
clear ambient MCP servers, and register only the intended local GitHits server
on the MCP surface. They do not use exec-only `--ignore-rules`; reasoning
effort applies on both Codex surfaces.

### Clean-canary evidence and correction history

On 2026-08-29, the corrected v2 canary used the dedicated local subscription
CODEX_HOME and passed isolation. The descriptor cell completed in 31.2 seconds
with zero tools, CLI calls, or isolation violations. The full cell completed in
35.0 seconds with two MCP calls and zero CLI calls, but both GitHits calls
returned AUTH_REQUIRED and the agent fell back to web sources. The result proves
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
the test suite, but no live skills canary has run.

The v2, v3, and v4 measurements above, including the contaminated 42-cell
stable-full run, are preserved as historical descriptor/full and capacity
evidence. None is relabeled as `intent` evidence under the current contract.

### Current corrected Luna evidence

The safe schema-v2 artifacts verified on 2026-08-31 include a bounded
Luna-low package pair, the discovery canary, and the stable-full intent suite.
The package discovery cell had one process/final success in 32,592 ms, zero
logical/MCP/CLI calls, 38,763 uncached input, 56,576 cached input, 842 output,
138 reasoning-detail tokens, and an estimated $0.00989452. The package intent
cell had one process success and an inconclusive/low-confidence final in
275,327 ms, three logical MCP calls and zero CLI calls, 51,445 uncached input,
207,360 cached input, 688 output, 121 reasoning-detail tokens, and an estimated
$0.0152618. Its calls were `quick_start` completed, with `pkg_info` and
`pkg_vulns` started. Both cells had zero isolation violations. This establishes
tool execution and isolation, not answer quality.

The discovery canary recorded 2/2 process and final successes, 267,221 ms wall
time, 266,375 ms cumulative agent time, two logical MCP `code_files` calls
(started), zero CLI calls, zero isolation violations, 77,831 uncached input,
376,320 cached input, 2,971 output, 591 reasoning-detail tokens, and an
estimated $0.0266578 with `long_context_pricing_not_attributable` uncertainty.
The stable-full intent suite recorded 21/21 process and final successes with
no failures, timeouts, or missing cells: 798,452 ms wall time, 796,139 ms
cumulative agent time, 115 logical MCP calls, zero CLI calls, zero isolation
violations, 655,840 uncached input, 2,389,760 cached input, 20,077 output,
4,272 reasoning-detail tokens, and an estimated $0.2030556 using a rate-based
estimate with Codex CLI 0.151.0. One `code_grep` call failed and recovered
within a successful workload; the remaining recorded calls completed. The
named six-workload smoke subset was derived from this stable artifact, not
rerun: 6/6 process successes, 280,541 ms summed duration, 31 MCP calls, zero
failed tool calls, 198,863 uncached input, 746,752 cached input, 6,527 output,
1,187 reasoning-detail tokens, and an estimated $0.06254004.

The stable suite's MCP `callsByTool` totals were `code_files` 5,
`code_grep` 16 (15 completed, one failed), `code_read` 31, `docs_list` 2,
`docs_read` 14, `get_example` 1, `pkg_changelog` 4, `pkg_deps` 4,
`pkg_info` 2, `pkg_upgrade_review` 4, `pkg_vulns` 8, `quick_start` 12, and
`search` 12. The derived smoke subset contained `code_files` 2,
`code_grep` 5, `code_read` 8, `docs_read` 3, `get_example` 1,
`pkg_changelog` 2, `pkg_info` 1, `pkg_upgrade_review` 2, `pkg_vulns` 1,
`quick_start` 2, and `search` 4; all 31 calls completed.

Manual `bun run agent:session` validation on 2026-08-31 with Codex CLI 0.151.0
and Luna high listed only six bundled system skills (Image Gen, OpenAI Docs,
Plugin Creator, Review Agent, Skill Creator, and Skill Installer), no GitHits or
personal skills, and `githits: connected (18 tools)`. No tool call or Keychain
access was needed for this diagnostic; the normal temporary-workspace trust
prompt required human approval. Two earlier stable intent attempts that waited
at an unattended macOS Keychain approval prompt are invalid/excluded evidence,
not a harness timeout defect. Local subscription/keychain-backed runs can
require operator presence; future daily CI must use separately provisioned
non-interactive API credentials without copying or reading credentials into
artifacts.

The trusted MCP child receives the caller's HOME, USERPROFILE, XDG_CONFIG_HOME,
and APPDATA so keychain- or file-backed GitHits authentication can resolve,
while the acting agent retains disposable HOME, USERPROFILE, XDG_CONFIG_HOME,
APPDATA, and temporary paths. Runtime MCP configs are consumed with the actual
child auth roots and then redacted in the persisted artifact boundary. When an
optional config root is unset, the harness uses the platform default:
`HOME/.config` on POSIX or `USERPROFILE/AppData/Roaming` on Windows.

The report loader accepts older run directories. It checks that `metrics.json`
resolves inside the run directory and parses it through the shared Zod
normalizer, including deterministic schema-v1 identity normalization.
When `run.json` includes a `runId`, the validated metrics artifact must carry
the same ID; a mismatch is rejected as unknown rather than attached to the
run. Legacy run metadata without a `runId` continues to accept valid metrics.
Missing, malformed, or unsafe metrics make normalized usage, cost, aggregate
duration, and logical-call values `null`/`unknown`, never fabricated zeroes.
Duplicate or unmatched records are warned and are not attached to a workload;
the validated artifact aggregate remains available for inspection. Legacy
workload status and duration fields from `run.json` remain readable when
present.

## Named suite and comparison artifacts

The Phase 2 suite layer emits schema-v2 `suite.json` around child run artifacts.
The fixed execution matrix is Codex `gpt-5.6-luna`, reasoning `low`, local MCP;
its scenario-keyed shards may run concurrently while workloads remain
sequential within each shard. The closed scenarios are `discovery`
(`descriptors` + `neutral`), `intent` (`descriptors` + `githits`), and `full`
(`full` + `neutral`). Canary defaults to `discovery` plus `intent`; smoke,
stable-full, stateful-manual, and experimental default to `intent` only. The
repeatable `--scenario discovery|intent|full` option replaces those defaults,
making `full` local/manual opt-in. The manifest selects canary, smoke,
stable-full, stateful-manual, or experimental workloads. Stateful onboarding is
dry-run-only; experimental workloads are selected only by the experimental
suite, which enables the experimental-tools option.

Use the local entrypoint as follows:

```bash
bun run agent:e2e:suite run --suite canary [--dry-run] [--out <dir>]
bun run agent:e2e:suite pair --suite canary --baseline-root ../githits-main [--dry-run] [--out <dir>]
bun run agent:e2e:suite compare --baseline-suite <path> --candidate-suite <path> [--out <dir>]
```

Pass `--scenario` once per selected cell, for example
`run --suite canary --scenario full`; explicit values replace the suite's
default scenario selection.

`run` defaults to `.agent-eval/suites/<timestamp>`. Pair output has distinct
`baseline/`, `candidate/`, and `comparison/` directories under
`.agent-eval/pairs/<timestamp>`; offline comparison defaults to
`.agent-eval/comparisons/<timestamp>`. `--out` overrides the corresponding
directory. Pair execution always uses the current checkout as both candidate
target and measurement harness, and accepts only an explicit baseline target.
The harness owns the manifest, workload prompts, reporting contract, result
schema, adapters, and output. Each target owns its local MCP/CLI implementation,
target Git identity, and full-profile `skills/githits-mcp` plus
`GITHITS_GUIDANCE_BLOCK`; a single-target run can select a target with
`--target-root`.

`suite.json` is schema version 2 and records the suite execution ID, matrix,
selected scenarios/workloads, measurement-harness and target Git identities,
wall and cumulative agent time, scenario shard status/errors, scenario/workload
cell status, normalized tokens, cost, duration, aggregate logical calls by
`(surface, normalized tool)`, missing telemetry cell IDs, exact Codex CLI
versions, and content identities. Each shard and cell records scenario,
guidance profile, intent profile, exact intent-fragment hash, agent, model, and
reasoning identity. Content identities hash exact bytes with SHA-256 and sorted
forward-slash repository-relative paths for selected workloads, the reporting
contract, and the result schema. Target guidance identity is separate and
contains target skill file hashes plus the runtime-validated guidance-block
hash/size.

`comparison.json` is also schema-versioned. Live pair mode and offline mode use
the same pure builder and record each input suite's ID, SHA-256 of its exact
`suite.json` bytes, and diagnostic absolute path. Imported `run.json`,
`metrics.json`, and `report.json` references are resolved relative to the
owning suite directory and checked with realpath containment. Absolute paths,
traversal, missing files, and symlink escapes are validation errors, even when
the two suite trees have unrelated parents.

Comparison checks scenario/workload plus agent/model/reasoning,
guidance-profile, intent-profile, intent-fragment hash, surface/server,
execution mode (`dryRun`), experimental-tools, published-package, and
measurement-content identity before direct deltas. A mixed dry-run/live pair is
incompatible: all direct numeric, logical-call, per-tool, and ordered-sequence
deltas are suppressed while process/final status remains visible.
Reporting-contract or result-schema mismatches suppress direct metric deltas
for the whole suite. A workload hash mismatch excludes only that workload's
scenario cells. Harness Git and Codex CLI version differences remain prominent
warnings and make `repositoryOnly` false, but do not suppress otherwise
compatible harness-drift deltas. Target Git and guidance differences are
intentional comparison dimensions. Per-cell output retains before/after status,
duration, logical calls, token buckets, cost, calls-by-tool
additions/removals/status counts, ordered tool sequence changes, and
process/final status. Unknown values remain unknown, and zero baselines use
`added`/`removed` with a null percentage.

Aggregate deltas are metric-specific matched cohorts. A cell is included only
when it is compatible and that metric is known on both sides; every aggregate
lists included and excluded cell IDs. One-sided missing/failed cells and unknown
telemetry remain in the full status matrix but are excluded from the affected
cohort. A suite aggregate `callsByTool` is null when any selected cell lacks
consistent logical telemetry, with those cell IDs listed; a mismatch between
`logicalCallCount` and sequence length is treated as inconsistent telemetry.
The suite loader deterministically normalizes valid schema-v1 artifacts at the
boundary: historical descriptor shards/cells become `discovery`, and full
becomes `full`. The historical v1 contract requires one of those exact
profiles; missing, null, or other profiles are rejected rather than mapped to
`intent`. Their child `metrics.json` files are loaded through
`parseAgentEvalMetrics`, which normalizes metrics v1 without inventing intent
evidence. Cell IDs are rewritten to
`<scenario>/<workload>` during normalization; contamination and isolation
warnings and contained child references are preserved.
Raw child artifacts remain authoritative and partial shards preserve successful
siblings. These commands perform no retries, service export, persistence,
scheduled CI execution, Haiku runs, or quality judging.

## Previous paid comparison: contaminated; capacity evidence only

The local suite and paired-comparison implementation was measured on
2026-08-28 with Codex CLI `0.150.1`, model `gpt-5.6-luna`, reasoning `low`,
local MCP, and concurrent `descriptors` and `full` shards. Every descriptor
workload was contaminated by global skill discovery: 12 loaded `githits-mcp`,
8 loaded `githits-package`, and 1 loaded `githits-code`. The latter 9 used the
CLI fallback, so the 42-cell descriptor/full behavior comparison is invalid and
must not support minimal-versus-full conclusions or be reinterpreted as clean
behavior evidence. The timing and cost figures below are retained only as
provisional capacity/cost evidence. Costs are
base-rate estimates, not provider invoices; long-context pricing was not
attributable for some workloads.

| Suite           | Successful cells |       Wall time | Cumulative agent time | Logical calls |   Estimated cost |
| --------------- | ---------------: | --------------: | --------------------: | ------------: | ---------------: |
| canary          |              4/4 |       205.813 s |             307.327 s |            27 |     \$0.04880940 |
| smoke           |            12/12 |       565.772 s |             954.759 s |            66 |     \$0.15365184 |
| stable-full     |            42/42 |     2,116.129 s |           3,404.942 s |           243 |     \$0.48549548 |
| **suite total** |        **58/58** | **2,887.714 s** |       **4,667.028 s** |       **336** | **\$0.68795672** |

The stable-full normalized token totals were 1,425,367 uncached input,
6,664,704 cached input, 0 cache-write input, 55,940 output, and 9,948
reasoning-detail tokens. Its exact aggregate `callsByTool` status counts were:

| Surface   | Tool                 |   Total | Started | Completed | Failed | Unknown |
| --------- | -------------------- | ------: | ------: | --------: | -----: | ------: |
| cli       | `code_grep`          |       3 |       2 |         0 |      1 |       0 |
| cli       | `pkg_changelog`      |       6 |       2 |         1 |      3 |       0 |
| cli       | `pkg_deps`           |       4 |       0 |         2 |      2 |       0 |
| cli       | `pkg_info`           |       8 |       4 |         0 |      4 |       0 |
| cli       | `pkg_upgrade_review` |       7 |       2 |         1 |      4 |       0 |
| cli       | `pkg_vulns`          |      14 |       5 |         2 |      7 |       0 |
| mcp       | `code_files`         |      11 |       0 |        11 |      0 |       0 |
| mcp       | `code_grep`          |      22 |       0 |        22 |      0 |       0 |
| mcp       | `code_read`          |      38 |       0 |        38 |      0 |       0 |
| mcp       | `docs_read`          |      26 |       0 |        26 |      0 |       0 |
| mcp       | `feedback`           |       4 |       0 |         4 |      0 |       0 |
| mcp       | `get_example`        |       2 |       0 |         2 |      0 |       0 |
| mcp       | `pkg_changelog`      |      11 |       0 |         7 |      4 |       0 |
| mcp       | `pkg_deps`           |       8 |       0 |         8 |      0 |       0 |
| mcp       | `pkg_info`           |       6 |       0 |         6 |      0 |       0 |
| mcp       | `pkg_upgrade_review` |       4 |       0 |         4 |      0 |       0 |
| mcp       | `pkg_vulns`          |       9 |       0 |         9 |      0 |       0 |
| mcp       | `quick_start`        |      30 |       0 |        30 |      0 |       0 |
| mcp       | `search`             |      28 |       0 |        27 |      1 |       0 |
| mcp       | `search_status`      |       2 |       0 |         2 |      0 |       0 |
| **total** |                      | **243** |  **15** |   **202** | **26** |   **0** |

The stable-full profile breakdown below keeps workload-level evidence
reconcilable with the suite totals. Durations are the persisted workload
milliseconds expressed in seconds; costs retain eight decimal places from the
base-rate estimate.

| Workload                           | Descriptors s |        Full s | Descriptors calls | Full calls | Descriptors cost |        Full cost |    Combined cost |
| ---------------------------------- | ------------: | ------------: | ----------------: | ---------: | ---------------: | ---------------: | ---------------: |
| `code-file-navigation`             |        26.725 |        31.673 |                 3 |          3 |     \$0.00906452 |     \$0.01119736 |     \$0.02026188 |
| `code-files-listing`               |        25.721 |        21.491 |                 2 |          1 |     \$0.00664944 |     \$0.00757352 |     \$0.01422296 |
| `code-grep-investigation`          |       106.919 |        31.539 |                 9 |          4 |     \$0.01199508 |     \$0.00998308 |     \$0.02197816 |
| `code-read-window`                 |        26.033 |        20.558 |                 2 |          2 |     \$0.01028784 |     \$0.00791092 |     \$0.01819876 |
| `docs-discovery`                   |        30.454 |        33.854 |                 5 |          5 |     \$0.01098244 |     \$0.01154936 |     \$0.02253180 |
| `docs-search-followup`             |        23.545 |        25.797 |                 3 |          2 |     \$0.00698492 |     \$0.00742312 |     \$0.01440804 |
| `docs-search-noise`                |        33.519 |        81.345 |                 4 |          7 |     \$0.01096260 |     \$0.01172520 |     \$0.02268780 |
| `express-router`                   |        44.305 |        48.627 |                10 |         11 |     \$0.01251356 |     \$0.01114948 |     \$0.02366304 |
| `global-example`                   |        71.534 |        68.396 |                 4 |          3 |     \$0.01189012 |     \$0.01740188 |     \$0.02929200 |
| `opencode-compaction`              |       137.273 |       166.870 |                15 |         16 |     \$0.02418636 |     \$0.02417836 |     \$0.04836472 |
| `package-changelog`                |       224.993 |        40.603 |                 7 |          3 |     \$0.01045420 |     \$0.00820776 |     \$0.01866196 |
| `package-changelog-range`          |       157.383 |        45.845 |                 7 |          6 |     \$0.01144308 |     \$0.00594684 |     \$0.01738992 |
| `package-dependencies`             |       126.240 |        45.291 |                 5 |          5 |     \$0.01143380 |     \$0.00922904 |     \$0.02066284 |
| `package-overview-vulnerabilities` |       154.205 |        33.577 |                 4 |          2 |     \$0.00605740 |     \$0.00801552 |     \$0.01407292 |
| `package-upgrade-safety`           |       182.229 |        80.421 |                 5 |         10 |     \$0.01076688 |     \$0.01269004 |     \$0.02345692 |
| `package-vulnerability-filter`     |       180.336 |        69.943 |                 7 |          4 |     \$0.01079488 |     \$0.01133036 |     \$0.02212524 |
| `package-vulnerability-history`    |       172.321 |        50.568 |                 6 |          2 |     \$0.01101200 |     \$0.00808912 |     \$0.01910112 |
| `package-vulnerability-rubygems`   |       259.131 |        87.781 |                 7 |          3 |     \$0.01522504 |     \$0.01124368 |     \$0.02646872 |
| `search-source-ergonomics`         |        45.262 |       145.341 |                 5 |          8 |     \$0.01140588 |     \$0.01535676 |     \$0.02676264 |
| `site-search-explicit`             |        37.991 |        79.170 |                 6 |         10 |     \$0.01204428 |     \$0.01476600 |     \$0.02681028 |
| `unified-search-investigation`     |        45.683 |        84.450 |                 7 |         13 |     \$0.01247772 |     \$0.02189604 |     \$0.03437376 |
| **profile total**                  | **2,111.802** | **1,293.140** |           **123** |    **120** | **\$0.23863204** | **\$0.24686344** | **\$0.48549548** |

The two profile shards run concurrently, so wall time is lower than cumulative
agent time; the latter is the sum of workload durations. The descriptors shard
accumulated 36 CLI calls (many failed fallback attempts) and 87 MCP calls,
while full guidance accumulated 6 CLI calls and 114 MCP calls. These CLI calls
are contamination evidence, not legitimate descriptor behavior. The missing
`githits` PATH / stalled `npx` fallback explains part of the provisional timing
variance.

The bounded no-change canary pair also completed all four cells on each side,
but its profile comparison is likewise invalid because it used the contaminated
runner. Its timings and spend remain provisional capacity measurements only.
The baseline used 218.842 s wall time, 297.390 s cumulative agent time, and
$0.05240004 estimated cost; the candidate used 235.969 s, 308.227 s, and
$0.04048996. The comparison machinery was compatible, unsuppressed,
repository-only, and included all four cells, but the behavioral result is
invalid because both sides used contaminated guidance. Its observed changes
were duration +3.64%,
logical calls -6.45%, uncached input -32.09%, cached input -12.20%, output
-5.58%, and cost -22.73% (reasoning-detail output changed -11.65%). This is
evidence that a single sample has substantial natural variance; it does not
justify alert thresholds.

The five paid artifacts together consumed 3,342.525 s of wall time (about
55m43s), 5,272.645 s of cumulative agent time (about 87m53s), and an
estimated \$0.78084672. These measurements provide provisional local cost and
timing evidence for the later runner decision. They do not add a paid CI schedule,
persistent service history, Haiku execution, or quality judging.

## Metrics contract

The current top-level artifact has `schemaVersion: 2`, `runId`, `startedAt`,
`completedAt`, `records`, `aggregates`, and de-duplicated `warnings`. Historical
schema-v1 metrics remain readable through deterministic normalization at the
loader boundary. For a valid v1 record, `descriptors` guidance becomes neutral
`discovery`, `full` becomes neutral `full`, and neither historical profile is
treated as `intent` evidence.

Each record preserves the run/workload identity dimensions: workload ID,
requested and resolved model, agent and exact CLI version, reasoning effort,
MCP or Skills surface, local or published server, guidance profile, scenario,
intent profile, exact intent-fragment hash, experimental tools, published
package, target git state, workload timing, process/final status, exit code,
timeout, and relative artifact paths. The intent hash is the SHA-256 of the
exact `Use GitHits for this task.` fragment for `githits`, and `null` for
`neutral`; no separate fragment version or host field is part of the identity.

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

| Bucket            | USD per million tokens |
| ----------------- | ---------------------: |
| Uncached input    |                   0.20 |
| Cached input      |                   0.02 |
| Cache-write input |                   0.25 |
| Output            |                   1.20 |

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
contains the run aggregates, while run metadata/report fields expose scenario,
intent profile, and intent-fragment hash. `metricsWarnings` contains
metrics-load, schema, and workload-record warnings. Existing raw tool summaries,
artifacts, final-report issues, and comparison behavior remain available.

The console prints the same compact per-workload values and one aggregate line,
including scenario, intent profile, and intent-fragment hash. Null values print
as `unknown`; reasoning is labelled as a detail. MCP CLI fallback warnings
identify the effective `descriptors` or `full` profile and indicate a
validation failure. Skills runs use the CLI surface by design and do not
receive the MCP fallback warning.

## Local Luna-low inspection

Run the smallest one-workload scenario pair when changing MCP descriptions,
guidance, or the harness:

```bash
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile descriptors --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low --server local --guidance-profile descriptors --intent-profile githits --workload eval/agentic/workloads/express-router.md
```

The first command is `discovery`; the second is `intent`. Add
`--guidance-profile full` for the opt-in `full` scenario (which retains neutral
intent).

Use the printed run directory to regenerate the report or inspect its JSON:

```bash
bun run agent:e2e:report .agent-eval/runs/<run>
bun run agent:e2e:report --json .agent-eval/runs/<run>
```

Inspect `metrics.json` for normalized values and warnings, then use
`tool-calls.json` and redacted `stdout.json` to explain the underlying event
sequence. Do not interpret a missing metric as zero usage, or a Luna estimate
as provider billing. Historical local descriptor/full comparisons remain
diagnostic and are not intent evidence. Current scenario evidence is causal
only when the isolation metadata and trace validation show a clean run.

## Security and evidence boundary

Metrics contain validated numeric/provider fields and normalized summaries,
not stdout, tool arguments, shell commands, or environment values. The runner
redacts known secret values before writing raw artifacts and metrics. Artifact
paths are relative and validated; report loading refuses metrics and raw
artifacts that resolve outside the run directory.

## Key reference files

| File                                 | Responsibility                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `scripts/agent-eval.ts`              | Run lifecycle, raw artifacts, redaction, and metrics/report ordering                             |
| `scripts/agent-eval-metrics.ts`      | Codex adapter, Zod schemas, normalization, and aggregate builder                                 |
| `scripts/agent-eval-report.ts`       | Safe metrics loading, derived report fields, and console formatting                              |
| `scripts/agent-eval-suite.ts`        | Named-suite manifest validation, Luna orchestration, paired comparison, and artifact containment |
| `scripts/agent-eval-suite.test.ts`   | Suite, comparison, CLI, failure, and containment coverage                                        |
| `scripts/agent-eval.test.ts`         | Runner, report, fallback, safety, and integration coverage                                       |
| `scripts/agent-eval-metrics.test.ts` | Adapter and metrics-contract coverage                                                            |
| `eval/agentic/README.md`             | User-facing harness usage, workload guidance, and limitations                                    |
