# Semantic search context evaluation

This document records the September 5, 2026 evaluation of numbered focused source
and enclosing-scope metadata. The behavior contract lives in [tools.md](tools.md).
The existing agent-eval harness owns task execution and metrics; this document
owns the interpretation of this presentation experiment. No new product flag or
benchmark infrastructure was added.

## Setup and reproducibility

All runs target the user-provided development services: `mcp-dev.githits.com`,
`api-dev.githits.com`, and `pkgseer-backend-dev.fly.dev`. Production was not used.
The harness starts a local MCP server from a built Node CLI artifact. Baseline
build: `c9cfa8d`; semantic candidate and three isolated controls: `1098c87`.
The repository-attribution regression is evaluated separately with the corrected
candidate build; it does not alter the Express presentation comparisons.
Artifact directories are ignored under `.agent-eval/semantic-search/`.
The nested baseline directory inherits the parent repository's Git metadata in
metrics; that metadata does not identify the saved baseline binary. Candidate
variant directories include `build-provenance.json` with renderer hashes.

Settings: Codex CLI 0.153.4, requested model `gpt-5.6-luna`, low reasoning effort,
local MCP, descriptors guidance, GitHits intent, 300-second workload timeout.
The emitted metrics do not resolve a different model ID. Token figures are task
input totals including cached input, with cached and uncached counts preserved
in the detailed results. Costs are the harness's base-rate estimates; they are
not billing totals because long-context pricing is not attributable.

Example invocation (set the development environment and the existing dedicated
Codex eval home before running):

```sh
bun run agent:e2e --agent codex --model gpt-5.6-luna --reasoning-effort low \
  --server local --guidance-profile descriptors --intent-profile githits \
  --target-root .agent-eval/semantic-search/candidate-target \
  --workload .agent-eval/semantic-search/response-abort-controlled.md \
  --concurrency 1 --timeout 300 \
  --out .agent-eval/semantic-search/candidate-controlled-r1
```

Exact controlled workload (the harness additionally supplies its standard
GitHits intent and final-answer schema):

```text
# Workload: Express response abort handling with a controlled first search

Investigate how `npm:express@5.2.1` handles an aborted response during file delivery.
Explain which error reaches the caller, how the callback is obtained, and how
completion handling avoids calling it twice. Ground the explanation in the
implementation and give exact source locations.

For this output-layout evaluation, begin with `search` using target
`npm:express@5.2.1`, source `code`, query `handle request response`, limit 3,
and format `text-v1`. After that first search, choose whatever follow-up evidence
you need. Keep search responses in `text-v1` so the layout being evaluated is visible.
```

This controls exposure without supplying read paths or ranges. It evaluates
navigation after search, not tool discovery.

Variants change one property each: current compact `-` scope marker; the same
layout plus a per-hit `Read context` action; `Scope:` instead of `-`; or nonempty
`| params: ...` metadata. Legacy output is a separate baseline. The source
fixture includes `sendfile` (927-1015), nested `sendfile.onaborted` (932-939), and
the available outer parameters `res, file, options, callback`.

## Grading and evidence limits

The coordinator grades final answers separately from harness status against
Express commit `dbac741a49a5a64336b70c06e85c2e2706e36336`, particularly
`lib/response.js:378-419` and `927-1015`. Required facts are the abort error's
message and code, third/second-argument callback selection and forwarding, and
the shared done guard plus deferred finish recheck. We inspect actual search
formats, read paths/ranges, failed tool calls, finals/confidence, metrics, and
isolation violations. Self-reported high confidence is not a quality grade.

Earlier unrestricted runs, including `unified-search-investigation.md`, often
requested JSON or skipped search. Even adding a compact-text preference did not
ensure exposure. Those artifacts remain as compatibility/exploratory evidence;
they cannot attribute outcomes to a text label. An attempted Claude Haiku pair
failed before tool use because the isolated Claude home was not logged in; it
is excluded. We did not copy credentials to repair that run.

A captured three-hit sample contains 863 characters with the compact candidate,
1,068 with read commands, 878 with `Scope:`, and 902 with parameters. These are
character counts, not token counts. The harness supplies task tokens but no
direct per-search-response token measure, so response-token savings are not
claimed. Three repetitions per variant are a small sample, not statistical proof.

## Live attribution finding

OpenCode `v1.18.15` served commit
`d7b115f623760e68a4749d16508a9eca350f246f`. Its preferred-read target label was a
GitHub repository while package fields were also populated with a synthetic SHA
version. That contradicts the local SDL description that those fields are null
for repository-only attribution. Tuple-presence inference generated an npm read
that failed with `VERSION_NOT_FOUND`. The client now selects a package only when
the preferred-read label matches its registry/package prefix. Other labels use
repository attribution, pairing `repoUrl`/`commitSha` with `repositoryFilePath`. Replaying that exact repository read succeeded. Header and
CLI/MCP action regression tests cover this shape. No retry or caller-intent
heuristic is involved.

## Controlled results and decision

All 15 runs used the prescribed first text search. Within each variant, the first
search-response hash was identical across all three repetitions. No isolation
violation files were emitted (the harness writes them only on detected violations).
No wrong-path or wrong-ref read failed, no symbol lookup was used, and no run
copied the printed preferred-read command's exact range. Agents chose wider
windows themselves.

| Variant (three runs) | Input tokens, including cache | Cached input | Output tokens | Tool calls | Estimated cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Legacy | 498,088 | 418,560 | 3,210 | 18 | $0.02813 |
| Compact, no command | 767,104 | 647,424 | 3,697 | 23 | $0.04132 |
| With read command | 582,031 | 498,688 | 3,338 | 18 | $0.03065 |
| Scope: label | 743,549 | 658,944 | 3,765 | 26 | $0.03462 |
| Parameter names | 823,874 | 692,992 | 3,878 | 25 | $0.04469 |

The no-command candidate used 31.8% more total input than the command control in
this sample, and 54.0% more than legacy output. It is shorter per response than
the command control, but that did **not** translate into cheaper tasks. The
command control used fewer calls in two repetitions and the same count in one.
All layouts still needed broader reads and caller discovery. Most failed calls
were oversized grep context arguments, which occurred across all variants;
extra guessed reads also varied substantially. These results do not establish
that any label caused the differences, but they do rule out claiming measured
task-token savings from removing the command.

Keep the user's requested no-command text, with `-` scope rows and no parameter
text. This favors the requested compact presentation and preserves correct
navigation; it is not a measured task-cost optimization. `Scope:` and parameter
names produced no consistent advantage over the compact candidate. Parameters,
return types, preferred reads, and symbol references remain available in JSON.
Callable metadata is not formatted as a reconstructed signature.

The required abort error, callback selection/forwarding, and one-shot guard were
correct in all finals and supported by their read/grep evidence. One parameter
run described the deferred callback/flag sequence imprecisely (invoking callback
and setting done); the implementation sets done first. Another scope run
compressed EISDIR handling without explaining the argumentless next() call.
Neither affects the requested abort-path conclusion, but these are answer
limitations, not perfect correctness scores. All agents self-reported high
confidence. This is one model and one controlled problem; method metadata is
covered by fixtures, while the live nested scopes are functions.

Per-run detail (requested read spans include overlapping or unhelpful reads):

| Variant/run | Input tokens | Tool calls | Failed calls | Requested code-read spans |
| --- | ---: | ---: | ---: | --- |
| baseline-r1 | 192,455 | 7 | 1 | 141, 43, 27 |
| baseline-r2 | 129,290 | 5 | 0 | 141, 96 |
| baseline-r3 | 176,343 | 6 | 1 | 161, 43 |
| candidate-r1 | 227,133 | 7 | 1 | 116, 14, 81 |
| candidate-r2 | 235,713 | 7 | 1 | 171, 96 |
| candidate-r3 | 304,258 | 9 | 1 | 116, 121, 141, 93 |
| command-r1 | 184,203 | 7 | 1 | 141, 47 |
| command-r2 | 153,750 | 5 | 0 | 119, 48 |
| command-r3 | 244,078 | 6 | 1 | 166, 43 |
| scope-r1 | 266,480 | 9 | 1 | 136, 41, 161, 101 |
| scope-r2 | 215,474 | 8 | 1 | 121, 61, 47 |
| scope-r3 | 261,595 | 9 | 1 | 116, 14, 81, 68 |
| params-r1 | 382,861 | 9 | 1 | 141, 81, 44 |
| params-r2 | 213,139 | 8 | 1 | 126, 121, 112 |
| params-r3 | 227,874 | 8 | 1 | 136, 46 |

## Repository and read-window checks

The corrected candidate also ran `opencode-compaction.md` with text search
requested, plus the unchanged `code-read-window.md` workload. OpenCode used 11
tool calls, including one transient UPSTREAM_ERROR followed by a successful
search. It first omitted the requested tag, then corrected to v1.18.15 and
explicitly disclosed the newer unpinned evidence in its answer. All subsequent
reads used the tag and repository-root paths. The search exposed a function
spanning lines 353-2391; the independently captured compaction sample had a
393-line legacy enclosing constant with null semantic context. We do not invent
a semantic scope for the latter. The agent requested 1-330 and 289-601; the
existing read tool returned 1-300 and 289-588. These are successful cap checks,
not proof that the agent consistently chooses minimal windows.

The OpenCode final covered the requested subjects but also combined implementation
and v2 specification claims. It is navigation/regression evidence, not a fully
graded quality win or a matched cost comparison. The read-window task used two
calls and correctly described the lazy cached Router getter and its caseSensitive
and strict options. Its prompt supplied lines 55-90, so it provides no evidence
for deriving read coordinates from search.

## Verification and delivery boundary

At the implementation checkpoint, `bun test` passed 4,027 tests with 13,827
assertions across 195 files. Typecheck, build, public-package artifact validation,
and changed-file Biome checks passed. Unauthenticated source and built smokes
passed (CLI 23 steps, MCP 8 steps each). Authenticated development source smokes
passed (CLI 103 steps, MCP 54 steps). The subsequent attribution fix passed its
two focused suites (12 tests, 52 assertions), typecheck, build, formatting, and
an exact live repository read. The repository eval ran the corrected built CLI.

Both public artifacts have a pending minor release fragment. The backend schema
must be deployed before client release; hosted clients additionally require a
remote-mcp dependency update and deployment. This change does not authorize or
perform those release steps.

## Review closure

One Claude Opus review pass ran over the complete runtime delta. No reviewer
subagents or additional rounds ran. Findings were adjudicated inline:

- Accepted: scheme-only repository-label detection missed the documented
  `owner/repo@ref` form with synthetic package metadata. That shape would generate
  an npm SHA-version read and fail; a small predicate change closes it. Positive
  package-prefix detection now covers both bare and scheme-prefixed repository
  labels. Header and CLI/MCP action tests cover both. Related label normalization
  and the existing legacy package-target predicate were checked; the defect was
  confined to the new preferred-read branch.
- Rejected: falling back to legacy summary when focused source is unavailable.
  The approved contract and regression tests deliberately retain the locator and
  explicitly report missing exact source. Reintroducing an unnumbered legacy
  snippet would undermine that distinction. This rejection is dated September 5,
  2026; reconsider only with new requirements or evidence.
- Accepted after measurement: reuse the grapheme segmenter in the formatter
  instead of constructing it for each highlighted line. No text output changes.
  Legacy highlight-coordinate handling remains unchanged.

A minified Node-target build of the formatter was benchmarked before and after
segmenter reuse on Node v24.15.0, using the captured three-hit Express payload.
Each color mode warmed up for 1,000 renders, then ran five samples of 5,000
renders. Median milliseconds/render: plain 0.00466 -> 0.00410; colored 0.03010 ->
0.01547. Plain timings are noise at this scale. This measures only local render
work, excludes process startup and network, and does not imply lower agent cost.
The benchmark and both bundled artifacts are preserved under the ignored
`.agent-eval/semantic-search/formatter-*` and `renderer-{before,after}.mjs` paths.

After closure, `bun test` over follow-up commands, semantic text, existing search
text, and CLI/MCP search parity passed 114 tests with 397 assertions. No finding
remains unresolved. The same reviewer terminal is retained for inspection:
`term_3ede4784-0153-42a3-8f75-8a359088cce0`.


## Three CI / Braintrust repetitions against main

On September 5, 2026, PR #359 ran the existing Agent Evals pipeline three
complete times: [run 33987516988](https://github.com/githits-com/githits-cli/actions/runs/33987516988),
attempts 1–3. All evaluated commit `3a265c5d2d98c36a68de77aa38c4e0a3bbfb0b6a`.
Each exported 23 cells (2 discovery, 21 intent) and linked to
[main-r33941231621-a1](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/main-r33941231621-a1),
at main commit `c9cfa8d9939c921e7379888e310bd7942e372bae`.
The runs used the pipeline's existing service configuration, not local dev
endpoint overrides. Model, reasoning, prompt hashes, guidance, reporting schemas,
and Codex CLI version (0.153.4) matched the baseline. Rows were compared by
`metadata.cellId`.

| Experiment | Total tokens | MCP calls | Failed tool calls | Estimated cost |
| --- | ---: | ---: | ---: | ---: |
| Main | 4,046,854 | 125 | 1 | $0.27498 |
| [PR attempt 1](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/pr-359-r33987516988-a1) | 3,424,995 | 114 | 6 | $0.26261 |
| [PR attempt 2](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/pr-359-r33987516988-a2) | 3,047,158 | 113 | 1 | $0.24473 |
| [PR attempt 3](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/pr-359-r33987516988-a3) | 2,839,717 | 108 | 0 | $0.24159 |

These totals include input (including cached input) and output, unlike the
input-only local layout table above. The PR mean is 3,103,957 tokens (-23.3%),
111.7 MCP calls (-10.7%), and $0.24965 estimated cost (-9.2%). This is a descriptive
comparison against one matched main run, not a demonstrated causal improvement.

The OpenCode workload dominates the apparent saving: main used 1,273,760 tokens
and 27 calls, versus 381,952/16, 309,358/13, and 216,374/12. Main never called
search in that cell. Excluding OpenCode, PR token deltas are +9.7%, -1.3%, and
-5.4%; their mean is approximately +1.0%. An earlier main run at the same SHA
used only 3,065,615 total tokens and 221,924 for OpenCode, but used Codex 0.153.2,
so it is additional evidence of variability rather than a matched control.
The intent Express Router and search-source-ergonomics cells used more tokens
than the primary main baseline in all three PR attempts. The file-navigation
cell was stable at about 97.6k tokens and three calls, versus main's 104.0k
and three calls. The evidence is mixed at the workload level.

Actual intent traces contained 36 successful JSON search/search_status responses
and 11 text responses across the three attempts. Structural semantic/focused
fields were present in live JSON results. These runs exercise the feature but
mostly do not exercise its text layout; they cannot settle dash versus Scope,
parameter display, or omission of a Read context command.

Every cell reported successful process/report/final completion in all three
runs and main. There is no independent quality scorer. Two low-call cells are
particularly unsuitable as evidence of feature efficiency: attempt 1's explicit
site-search task used web search and no GitHits calls; attempt 3's discovery
Express task also made no GitHits calls and reported consulting Express 4.21.2
public source. The exported discovery field is `not_exposed`, so actual tool
traces/counts are needed to assess use.

Four attempt-1 OpenCode read failures were indexing responses; two other
attempt-1 failures were discovery Express reads. The original attempt-1
discovery artifact was no longer available after workflow reruns (the original
artifact ID returned 404), so their exact error causes were not reconstructed.
Attempt 2's failed call was pkg_vulns in package-changelog; attempt 3 had none.
Tool failures and self-reported final success are separate observations.
Normalized Braintrust rows and available downloaded traces were retained under
ignored `.agent-eval/semantic-search/pipeline/`; no anomalous results were deleted.

## User-supplied Fable feedback and heading cleanup

Fable reported two concrete benefits: reading an enclosing method's exact
89–161 range instead of guessing from match lines 114–118, and skipping an
irrelevant S3 load method from its kind and qualified name. This supports the
navigation design qualitatively; it is not a scored pipeline quality result.

Accepted: bare code headings such as `r` or `layer` can imply a verified symbol
identity. Backend titles originate from the indexed result name or filename,
while the scope chain owns semantic identity. The shared text formatter now
omits standalone titles on repository-code hits using the structural evidence
contract, including hits with null semantic context. Repository documentation
headings, legacy output, and lossless JSON titles retain their existing behavior.
This also removes the reported two-layout inconsistency for those code hits.
There is no separate provisional/ready heading state: the prior behavior only
suppressed a title when it matched a scope name. This small cleanup was made
**after** the three pipeline attempts; their metrics apply to `3a265c5`, not
the heading cleanup. Focused formatter/follow-up/parity tests passed: 116 tests,
406 assertions. Typecheck, build, changed-file Biome checks, and authenticated
development CLI/MCP smoke suites also passed after this cleanup.

The over-300-line scope observation is valid. code_read already enforces its
300-line explicit-range ceiling and returns a continuation start_line when it
truncates. Earlier live evaluation exercised this behavior. A symbol-reference
read API is a broader product change; this increment retains true scope ranges
and the existing continuation behavior rather than adding that API.


## Public format guidance: three follow-up CI repetitions

On September 6, 2026, the user requested all format-selectable tools expose only
`text` and `json`, default to `text`, and reserve JSON for programmatic follow-up
or exact structured details. Commit `d5987f0fd3c39a02e15c86b3f4b90b7e52328925`
applies this to 14 stable tools and 3 local experimental tools. `text-v1` is no
longer an accepted public argument. The tool schemas own format selection;
renderers and JSON payloads are unchanged by this selection change. The stable
MCP guide and its public skill copy use `text`. Tool-specific patch/body/range
and structured-detail distinctions remain documented.

One Luna implementation dispatch handled the mechanical edits in 17 modules.
The root agent owned scope, tests, guidance, verification, and eval interpretation.
The root requested shorter descriptions before accepting the checkpoint; no
extra reviewer or review round ran for this schema/copy delta. Full validation
passed 4,034 tests across 195 files, typecheck, build, plugin generation/check,
and authenticated dev smokes (103 CLI steps, 54 MCP steps). The initial test run
found two stale expectations, corrected before the successful full rerun: Zod's
invalid-option message and duplicated provenance wording formerly in the format
parameter. Provenance guidance remains in the example tool description.

[Pipeline run 34013308656](https://github.com/githits-com/githits-cli/actions/runs/34013308656)
ran three complete attempts at that immutable commit, each exporting 23 cells.
All linked to the newer
[main-r34008443071-a1](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/main-r34008443071-a1)
at main SHA `c9cfa8d9939c921e7379888e310bd7942e372bae`. Stable row inputs (including
prompt hashes), Codex CLI 0.153.4, requested model gpt-5.6-luna, low reasoning,
descriptor guidance, and reporting/result schema hashes matched main across
all cells. The pipeline service configuration was unchanged. Both scenario
artifacts were retained before each rerun, avoiding the earlier artifact loss.

| Experiment | Total tokens | MCP calls | Failed tool calls | Estimated cost |
| --- | ---: | ---: | ---: | ---: |
| Main September 6 | 3,026,831 | 107 | 0 | $0.25389 |
| [New attempt 1](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/pr-359-r34013308656-a1) | 2,920,349 | 108 | 2 | $0.24250 |
| [New attempt 2](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/pr-359-r34013308656-a2) | 3,462,117 | 129 | 1 | $0.26228 |
| [New attempt 3](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/pr-359-r34013308656-a3) | 2,916,206 | 107 | 0 | $0.24280 |

Total tokens include input (including cached input) and output. The new mean is
3,099,557 tokens (+2.4% versus the newer main), 114.7 calls (+7.2%), and $0.24919
estimated cost (-1.8%). Excluding OpenCode, mean tokens are 2,680,473 versus main's
2,738,504 (-2.1%). Attempt 2's OpenCode task used 644,103 tokens/27 calls versus
main's 288,327/17; discovery Express also used seven calls versus main's zero.
Task paths vary, so smaller responses do not establish lower total task cost.
The older PR mean was 3,103,957 tokens: the new mean differs by only -0.14%.

### Observed format selection

Count successful calls to format-selectable tools in the **intent** artifacts;
exclude failed calls and tools without a format parameter. Omitted format is
text. Search counts combine search and search_status responses. This is a
selection-frequency measurement, not a quality score.

| Runs | JSON / all selectable calls | JSON share | JSON / search calls | Search JSON share |
| --- | ---: | ---: | ---: | ---: |
| Previous PR attempts 1–3 | 145 / 254 | 57.1% | 36 / 47 | 76.6% |
| Newer main baseline | 49 / 86 | 57.0% | 11 / 12 | 91.7% |
| New attempt 1 | 34 / 85 | 40.0% | 8 / 13 | 61.5% |
| New attempt 2 | 37 / 100 | 37.0% | 11 / 17 | 64.7% |
| New attempt 3 | 34 / 86 | 39.5% | 9 / 13 | 69.2% |
| New attempts combined | 105 / 271 | 38.7% | 28 / 43 | 65.1% |

The new intent calls included 70 explicit text selections and 96 omitted-format
selections. No new call selected text-v1. The JSON share fell in every repetition,
but most search calls still selected JSON. These are observations of the combined
format-schema/guidance change (and intervening heading cleanup), not isolated
causal estimates for one sentence or proof that JSON was unnecessary in each call.
The stable-full pipeline does not exercise the three experimental tools; their
schemas and behavior were covered by local tests and live smoke cohorts.

All 69 new cells reported successful process/report/final/cell completion;
normalized validation categories were empty. There is no independent quality
scorer. The two attempt-1 failures were pkg_vulns rejecting `version: "latest"`
and code_grep rejecting context_lines_after=12 (maximum 10). Attempt 2's failure
was code_read on a nonexistent indexed OpenCode path. Attempt 3 had no failed
calls. None was a format-validation failure. These invalid requests do not
justify loosening the existing tool contracts.

The implementation and repeat runs are complete. Current operational guidance
lives in tools.md and mcp-tool-annotations.md; the temporary format plan was
removed. Safe normalized rows, downloaded artifacts, comparison output, and
trace-format counting scripts are retained under ignored
`.agent-eval/semantic-search/format-guidance/`. No additional Braintrust runs were
created beyond the three requested pipeline repetitions.


## Sharpened text-first guidance

The next wording revision removes the ambiguous phrase "programmatic follow-up":
normal agent tool chaining should use text. All 17 format parameters now say:
"Use `text` (default) for reading and tool follow-ups; it is token-efficient.
Use `json` only to parse responses in code or obtain fields absent from text."
The shared quick-start core and exact skill copy explicitly say returned paths,
IDs, and line ranges can be passed directly to subsequent tools. Docs-routing
hints now condition JSON on needed locators being absent from text. Known
JSON-only data remains a valid reason to request JSON immediately; the guide
does not require an extra text request before every JSON request.

Two targeted live development runs exercised code-file-navigation with
Codex 0.153.4 / gpt-5.6-luna / low reasoning on the working-tree revision over
`8a9d3b3` (the guidance edits were present; this is separate from the three
pipeline experiments above):

- Descriptor/intent: quick_start, search, code_read. Search and read both omitted
  format and received text. Read lib/express.js lines 30–70. The final answer
  identified createApplication, Object.create(req/res), and the app reference.
- Full guide: search, code_read, both default text. The read pinned Express 5.2.1
  and requested lib/express.js lines 1–80. The final answer identified the same
  factory/prototype behavior. The guide was installed through the skill, so
  quick_start was not called.

Both completed with no tool failures or reported isolation violations. The
first run did call quick_start, so this does not isolate the format-parameter
wording from the guide wording. One run per profile on one task is navigation
and guidance evidence, not proof of an aggregate token or JSON-selection gain.
No new Braintrust export was requested or made for these local checks.

The attempted Claude full-guide check exited before tool use with "Not logged
in" / "Please run /login". It had no final report and is excluded from behavior
conclusions; authentication state was not read or modified. Its artifacts and
both Luna traces remain under ignored
`.agent-eval/semantic-search/sharpen-guidance/`.


Validation after this wording revision passed 4,034 tests / 13,928 assertions,
build, typecheck, plugin generation/check, exact quick-start/skill parity, and
103 CLI / 54 MCP live smoke steps. One intermediate full run hit the existing
stale-auth-lock fixture's 100 ms timeout while live workloads were running;
its isolated 33-test suite passed, followed by a clean full run without those
live workloads. Auth-lock behavior was not modified by this guidance revision.


## Sharpened guidance: pipeline follow-up round

The user requested one new pipeline round after the wording change.
[Run 34015685915](https://github.com/githits-com/githits-cli/actions/runs/34015685915)
at `d6b13a9e5a8b63d19258ecbae60a1dae3e876413` completed successfully and exported
[pr-359-r34015685915-a1](https://www.braintrust.dev/app/GitHits/p/githits-cli-agent-evals/experiments/pr-359-r34015685915-a1)
(ID `6b7ef1d8-935c-49f7-b135-e08e1a48e495`). Its linked baseline remains
main-r34008443071-a1 (ID `dcd02a00-add5-4f39-baa3-a43c638c76a2`). All 23 row
inputs/prompt hashes, model/reasoning, Codex CLI version, and reporting/result
schema hashes matched that main baseline. Both discovery cells made no GitHits
calls; the format-selection figures below cover intent only.

| Measurement | Previous three format-guidance runs | Sharpened wording, one run |
| --- | ---: | ---: |
| Successful selectable calls using JSON | 105 / 271 (38.7%) | 22 / 102 (21.6%) |
| Successful search calls using JSON | 28 / 43 (65.1%) | 3 / 14 (21.4%) |

The new run had 80 text calls (30 explicit, 50 omitted format). All six explicit
code searches, one auto-source search, and four documentation searches used text.
The remaining three searches used JSON immediately for documentation:
docs-search-followup, docs-search-noise, and site-search-explicit. None of the
22 successful JSON calls followed a successful text call to the same tool in
that task. Format choices moved toward text, but this is one run rather than a
replicated causal estimate.

Total tokens were 3,109,895 versus main's 3,026,831 (+2.7%), with 124 MCP calls
versus 107. Estimated cost was $0.24476 versus $0.25389 (-3.6%). Excluding
OpenCode, tokens were 2,731,660 versus 2,738,504 (-0.25%). The previous PR run
mean was 3,099,557 tokens, almost unchanged from this new run. Smaller response
formats still do not establish smaller task totals.

All 23 cells reported successful completion and had empty normalized validation
categories. One failed tool call was pkg_vulns rejecting `version: "latest"`;
no format-validation failure occurred. Spot inspection found an answer-quality
error despite the successful report: search-source-ergonomics described
z.flattenError() as returning `{ errors, properties }`, while its own text
search results showed `{ formErrors, fieldErrors }`. The needed evidence was
present in text. This is a model answer error, not evidence that JSON was
required or a reason to change the formatter. There is still no independent
quality scorer, and this round is not claimed as a quality improvement.

The safe Braintrust rows, native comparison, both scenario artifacts, format
counts, and JSON sequence classification are retained under ignored
`.agent-eval/semantic-search/sharpen-pipeline/`.
