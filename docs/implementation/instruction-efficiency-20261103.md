# GitHits instruction efficiency: 2026-11-03

The rewrite makes the CLI skills substantially shorter and shows a promising
MCP full-guidance result. It does **not** establish that usage quality never
regresses. Descriptor-only results are mixed; CLI actors sometimes skipped
GitHits or stopped without inspecting the requested source. Keep this as a
draft for review, with claude.ai validation still outstanding.

The [complete delivered instructions](../sharing/mcp-cli-instructions-review.md)
include tool and argument descriptions, CLI help, skills, and reference guidance.
The [repeatable protocol](../../eval/agentic/instruction-efficiency/README.md)
and [per-attempt results](../../eval/agentic/instruction-efficiency/results-20261103.json)
record the experiment separately from this interpretation.

## Instruction size and scope

Counts below are whitespace-separated words, not model tokens.

| Surface | Before | After | Change |
| --- | ---: | ---: | ---: |
| MCP quick start, including trust rules | 1,039 | 940 | -9.5% |
| CLI code skill | 1,766 | 935 | -47.1% |
| CLI package skill | 1,410 | 802 | -43.1% |
| All 15 tool descriptions | 1,856 | 1,791 | -3.5% |

Serialized descriptions plus argument schemas changed from 42,024 to 42,126
characters. **Repeated complete MCP catalog savings are not established.**
The major text reduction is in CLI skills; fewer retrieval steps could reduce
runtime context separately. All 15 tool first sentences and first 80 raw
characters are unchanged, as are schema shapes, validation, and defaults.

Guidance now prioritizes direct operations, known symbol selectors, following
relevant helpers and re-exports, complete relevant reads, reuse, and bounded
recovery. Depth follows the information needed to continue the task. Research
remains available for questions requiring investigation across code/docs. In
the primary sample, candidate Research calls fell to zero in both profiles
(full: six to zero; intent: five to zero). That shows changed routing, not that
Research was unnecessary in every case.
Open-source scope and the inability to access private repositories or local
workspaces are explicit. Trust rules remain intact.

## Method and exclusions

Baseline: `c7a9e0f7df371ca4d034cd792a8af129f21cc440`, clean detached checkout.
Evaluated candidate: commit `57a0f7d585d1991e316c63ec2da2d347e3991018`,
with guidance frozen at
`2026-11-03T08:39:58.169522+00:00`. Both used the candidate harness, dev backend,
the same credentials, and exact workload bytes. Codex used `gpt-6-luna`, low
effort. Candidate guidance snapshot SHA-256:
`b402f252f5b5cc2e6bc25ca4c44fd94125b78188d12d436b9f1e45d9d74674a4`.
This snapshot covers the guide, tool descriptions/schemas, and main code/package
skills; it is not a hash of every help/reference file.

There were 204 attempts: 62 pre-freeze candidate attempts retained as exploratory,
and 142 selected attempts. The selected sample consists of 84 primary MCP cells
(seven workloads, two guidance profiles, three attempts, two versions), 30
focused cells, 14 CLI smoke cells, six symbol-following cells, and eight Claude
attempts. Failed attempts count; they were not rerun until successful. Pairing
uses chronological attempt order within each workload/profile.

`intent` supplies descriptors and a short GitHits-use instruction. `full`
supplies the MCP skill/guide. CLI skills are a separate surface. At most two
actors ran concurrently. Final candidate cells ran later after review changes,
so backend warming and run order confound time and availability comparisons.
This is a small directional experiment, not a statistical non-inferiority test.

## Primary MCP results

All-attempt totals include isolation failures; valid paired comparisons follow.
Input includes cached input. Cached input must not be added again.

| Profile/version | Valid reports / attempts | GitHits calls | Input | Cached input | Output | Cumulative seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full baseline | 21/21 | 69 | 3,168,551 | 2,680,832 | 16,493 | 611.1 |
| Full candidate | 21/21 | 61 | 2,526,463 | 2,059,648 | 14,712 | 473.4 |
| Intent baseline | 17/21 | 103 | 3,088,769 | 2,502,016 | 15,478 | 565.8 |
| Intent candidate | 19/21 | 90 | 3,014,006 | 2,572,416 | 13,995 | 501.8 |

For full guidance, all 21 pairs are valid: calls fell 11.6%, total input 20.3%,
and cumulative agent time 22.5%. Median per-run calls stayed at two. Median
input was 123,077 versus 106,388; median time 25.28 versus 20.10 seconds.
Research calls fell from six to zero. Tool errors increased from one to two.
One baseline example task also used a web lookup, so these are overall agent
runs rather than an enforced GitHits-only comparison.

Intent has 15 pairs valid on both sides. In those pairs, calls were 81 versus
71, input 2,377,768 versus 2,366,193 (0.5% lower), and cumulative time 418.9
versus 383.5 seconds. Median paired time change was effectively zero (-0.1%);
per-side paired medians were 24.24 versus 27.66 seconds. There is no convincing
broad descriptor-only token or latency improvement in this sample.

Isolation failures involved reading skills in descriptor-only mode and/or
falling back to CLI. Four baseline and two candidate primary cells failed.
The additional focused intent sample worsened from four of five valid reports
to two of five. Preserve these failures; do not credit them as cheaper answers.

Full-guidance calls by workload, summed over three attempts:

| Workload | Baseline | Candidate |
| --- | ---: | ---: |
| Source diff | 10 | 8 |
| Docs follow-up | 3 | 4 |
| Express router | 14 | 11 |
| Cross-project example | 5 | 5 |
| Package overview/vulnerabilities | 6 | 6 |
| Upgrade review | 6 | 7 |
| Unified search | 25 | 20 |

A separate label-withheld coverage review inspected the fixed second full-guidance
attempt for each workload (14 answers). Twelve addressed the explicit prompt
needs. One baseline docs answer supplied an official source example instead of
a docs page; one candidate example answer did not establish the requested
current/canonical status. This is a coverage review, not independent source
verification or a score for the other repetitions.

These are operational measures, not correctness scores. Provider cost was not
used: some traces could not attribute long-context pricing reliably.

## Symbol following

A neutral task asked how Express 5.2.1 `createApplication` delegates a request
and gives request/response objects their Express prototypes.

- MCP full: baseline used six calls, including three searches and a list;
  candidate used four, following `handle` in `lib/application.js` with a selector.
  One of those four was an unnecessary quick-start call.
  Both answers covered delegation, per-app prototypes, prototype assignment,
  and router dispatch. Time was 38.0 versus 14.8 seconds; one pair is not a
  general speed estimate.
- MCP intent: baseline used quick start plus Research (two calls); candidate
  used six calls, including a selector and an extra line read. Time fell from
  33.4 to 17.4 seconds, but operation count increased.
- CLI candidate read the skill, then used web/registry source retrieval without
  invoking GitHits. Its correct-looking explanation does not demonstrate the
  GitHits selector workflow.

Across the primary full sample, selector reads stayed at three per version;
intent changed from two to five. The new guidance helps in a concrete case,
but consistent immediate selector use is not demonstrated. Candidate full-profile
runs also called quick start twice across the primary/focused/symbol samples
(baseline: zero), despite the guide's instruction to skip it once loaded.

## Frozen benchmark answer review

Q09 and Q10 reuse exact version-scoped prompts from the benchmark repository.
Its wider five-arm pilot remains paused. An independent agent reviewed 12
answer texts with version-4 criteria, withholding baseline/candidate and profile labels and
acting-agent confidence. This was not a human expert review or a build test.
All required checks must pass; optional depth is scored separately. Citations
were not independently reopened or validated.

| Surface | Q09 baseline | Q09 candidate | Q10 baseline | Q10 candidate |
| --- | --- | --- | --- | --- |
| MCP intent | Inadequate | Inadequate | Inadequate | Adequate |
| MCP full | Inadequate | Inadequate | Adequate | Adequate |
| CLI skills | Inadequate | Adequate | Adequate | Adequate |

Q09 MCP answers omitted the relationship between the incoming cookie and session
token; the baseline full answer abstained because versioned source was not
available. Baseline CLI also misstated the refresh threshold. Q10 baseline
intent abstained; the other answers met the required context-update facts.
No answer triggered the rubric's predefined critical-contradiction checks;
that does not establish that every additional factual claim is correct.

MCP adequacy was one of four versus two of four. Across all surfaces it was
two of six versus four of six, but the candidate CLI answers used web evidence,
so the latter is **not** a GitHits retrieval-quality gain. Better Auth indexing
became available during the experiment, confounding the apparent improvement.
Per-criterion grades and reviewer notes are in the results artifact.

## CLI and Claude limitations

The CLI skill smoke sample produced seven valid reports per version, but the
candidate Express-router answer was inconclusive without any retrieval. A
focused candidate known-line task also searched only the local workspace and
abstained. These are observed routing/coverage failures, despite valid finals.
The candidate example task and both candidate frozen benchmark tasks used web
tools instead of GitHits. They cannot count as evidence of improved GitHits use.

CLI normalized call telemetry also missed some shell command chains and
Research calls visible in provider events. Therefore the apparent 29-to-13
smoke call reduction is not a reliable measure of operations saved. No CLI
runtime efficiency conclusion is drawn. The instruction-size reduction itself
is measured independently and remains valid.

All eight Claude Code attempts failed before task execution with
`authentication_failed` / `Not logged in`. They provide no task comparison.
The resolved requested alias was Claude Sonnet 5.5. Local CLI evals would not
validate claude.ai even if authenticated. Preserving first sentences/prefixes
reduces one known connector risk but does not replace testing the actual
connector selection and follow-up behavior.

Braintrust MCP was not exposed in this session; historical Braintrust results
were not queried. No experiment or raw trace was uploaded.

## Verification and review

- `bun test`: 6,865 passed, three skipped, zero failed. Python 3.14 was selected
  on PATH for tests using `tomllib`; no dependency or product workaround added.
- Final guidance closure tests: 168 passed, zero failed, after wording fixes.
- `bun run typecheck`, `bun run build`, and `bun run plugins:check`: passed.
  Plugin generation produced no substantive generated-asset changes.
- Authenticated dev `bun run smoke:cli` and `bun run smoke:mcp`: passed
  (168 CLI steps, 86 MCP steps).
  Two initial failures were stale wording expectations in smoke assertions;
  these were updated, including whitespace-tolerant matching for wrapped help.
- `bun run smoke:mcp:built`: passed. `bun run smoke:cli:built`: failed on
  the first malformed-command case under Node 24.15.0 on Windows. A minimal
  isolated spawn returns the expected JSON error, then libuv asserts
  `!(handle->flags & UV_HANDLE_CLOSING)` and exits 9 instead of 1. The identical
  probe against a freshly built clean baseline reproduces it. This existing
  built-CLI shutdown failure is not fixed by this instruction-only change.
- Internal review and three Opus 5.5 rounds closed the implementation findings.
  Final report/verification delta reviewed separately before the draft PR.

The next useful validation is targeted CLI routing with actual tool-use and
coverage checks, plus the claude.ai connector. This result supports reviewing
the shorter guidance; it does not justify claiming the whole rewrite is
regression-free or that complete MCP catalog context is materially smaller.

## Integration after the evaluation

After the recorded runs, `main` advanced to
`202dd2328990d0f435cdc33da3d7a6e8432eba6f` with Pub package support, dependency
namespace output, and CLI argument tolerance. The PR merges that commit without
rebasing the evaluated history. The only textual merge conflict was grep help:
retain the concise symbol guidance together with main's context-clamping rule
and exact-file/directory examples. Read help retains main's single-line option.

The measured candidate and its size/hash figures above remain the pre-merge
commit `57a0f7d5`; no agent comparison was rerun for the integrated runtime.
The full instruction review file reflects the integrated text. Integration
validation is recorded separately from the historical eval results.

Integration checks passed: `bun test` (6,981 passed, three skipped, zero failed),
`bun run typecheck`, `bun run build`, `bun run plugins:check`, and authenticated
dev `bun run smoke:mcp` / `bun run smoke:cli`. Internal and retained Opus 5.5
review found no integration defect. The reference's 0-10 context advice remains
valid; complete CLI help describes the new clamping tolerance.
