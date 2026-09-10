# Skill and MCP context loading research

## Purpose and evidence boundaries

This study measures what GitHits makes an agent load, when it loads, and what
remains expensive on later model requests. The research tools live alongside
the existing eval scripts because measurement belongs to the eval layer, not
the production MCP server. Public skills and descriptions remain canonical;
there are no published host-specific variants in this change.

The checked-in [protocol](../../eval/agentic/context-loading/protocol.json),
[observations](../../eval/agentic/context-loading/observations/study-summary.json),
and [reproduction guide](../../eval/agentic/context-loading/README.md) are the
durable record. Original private session files stay local. Sanitized fixtures
contain public GitHits content and numeric request usage, not private paths,
session identifiers, credentials or whole system prompts.

Use these evidence labels:

- **Observed trace:** an actual returned tool payload, operation, or usage event.
- **Source/documented:** published code or documentation; not automatically proof
  of the exact configuration used by a particular installed client.
- **Self-report:** the acting model describing its visible context. Useful but
  insufficient to prove complete initial provider-request contents.
- **User-verified:** Claude.ai behavior supplied by the user from prior analysis.
- **Simulated:** declared content/retention assumptions; not host emulation.

Initial hidden prompts and complete provider wire payloads were not captured.
Neither CLI event streams nor native session logs should be described as full
provider-request captures. The counters do establish actual input usage at
request boundaries. An input delta includes assistant call text, host changes,
and wrappers as well as returned tool content.

## Host loading matrix

| Surface | Initially available GitHits skill information | Initially available GitHits tools | How details enter context | Evidence |
| --- | --- | --- | --- | --- |
| Codex code mode in the observed sessions | Name, description and location; no full skill body | Deferred metadata is available through `ALL_TOOLS`; individual GitHits declarations were not initially visible to the acting model | Filesystem read loads the skill; printing selected catalog entries loads full descriptions and TypeScript declarations | Initial self-report, native traces, matching upstream code |
| Claude Code with connected fixture MCP and tool search | Skill names/descriptions; body is deferred | Names; descriptions/schemas are deferred. No GitHits server instructions were visible in our probe | `Skill` loads the body; `ToolSearch` selects definitions before invocation | Initial self-report, connected-server init event, ToolSearch and Skill traces, official docs |
| Claude.ai | Not established by this study | Names plus first 80 description characters | `tool_search` searches full descriptions | User-verified observation; not rerun here |

The current Codex skills documentation describes metadata-first activation:
[Build skills](https://learn.chatgpt.com/docs/build-skills). Upstream
[code-mode description construction](https://github.com/openai/codex/blob/7c88f03/codex-rs/code-mode-protocol/src/description.rs)
adds generic deferred-tool guidance, renders enabled definitions into the exec
description, and appends a TypeScript declaration when augmenting tool metadata
(notably lines 261–317 and 370–443). This supports the observed distinction
between metadata being available to execution and being printed into context.
That indexed source revision is not asserted to be the installed CLI build.

Claude Code documents names and server instructions at startup with deferred
tools, configurable tool-search modes, and 2KB truncation of descriptions and
server instructions: [MCP reference](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search).
The cap is documented, not independently measured in these runs. Do not assume
Claude.ai's 80-character selection surface also applies to Claude Code.

Claude Code's [skill lifecycle](https://code.claude.com/docs/en/skills#skill-content-lifecycle)
describes metadata before invocation and body persistence across later turns.
This explains why skill-body length can recur in later request cost; invocation
does not make the body transient.

## Corrections and confounders discovered

1. **Installed skill drift.** The earlier installed skill was a 1,105-character
   bootstrap stub requiring `quick_start`. Canonical skill content at the initial study baseline was
   6,396 Unicode characters and includes the stable guide, explicitly skipping
   the bootstrap call. Its SHA-256 is in the protocol. Those delivery paths
   cannot be compared as though they were the same skill version.
2. **Catalog representation matters.** The observed Codex catalog contains 19
   local tools, including experimental ones; the canonical stable fixture has
   16. Codex metadata contains rendered TypeScript declarations. The canonical
   inventory contains MCP JSON schemas. Sizes across those representations are
   not interchangeable, even for the same tool.
3. **Availability/configuration matters.** The first Claude worktree found no
   GitHits tools. An explicit server named `githits` was reported as disabled;
   saved configuration also disables that name for the main repository. A
   distinct session-local name connected successfully without changing global
   preferences. Preserve the failed attempts as setup evidence, not routing
   failures attributable to the skill.
4. **Live retrieval is a separate variable.** The connected live Claude grep
   remained pending for over 15 minutes and was terminated with its trace
   retained. Its cause was not established. It is excluded from token/latency
   comparisons; fixture results do not establish that live retrieval works.
5. **Normalized traces hide relevant operations.** Codex stdout exposed the
   shell read and MCP invocation but not the full catalog-print expressions.
   Native session records exposed those expressions. Reading only normalized
   `tool-calls.json` would have missed the mechanism under investigation.
6. **Initial availability can change.** The earlier compact child initially
   found zero matching catalog entries and later found `quick_start`. The
   source of that discrepancy is unknown; it is not proof of any particular
   connection/readiness implementation.
7. **Resume counters and models need verification.** One Codex resume stream
   returned lifetime cumulative input while another returned the new turn's
   usage. Native request counters resolved the discrepancy. Unpinned Claude
   resumes switched from Fable to Opus; those runs are excluded from same-model
   comparisons. Claude streaming message output counters can also be provisional
   (`1` in a message versus `41` in the completed result). The reader reconciles
   input buckets and preserves final output separately when its per-request
   allocation is unknown. See the retained
   [resume exclusions](../../eval/agentic/context-loading/observations/resume-exclusions.json).

## Earlier discovery incident

The original discovery execution returned every matching metadata object:

```js
text(ALL_TOOLS.filter(x =>
  /githits|search.*tools|tool.*search/.test(x.name + " " + x.description)
));
```

This matched unrelated providers too. The tool reported 31,133 output tokens
before truncation, with 21,133 truncated. Adjacent native request input rose
from 22,453 to 32,454: 10,001 additional input tokens, not 31,133. These counters
establish the admitted request-size change, not exact attribution of every
token to the returned catalog.

A targeted repeat with the tool already identified and bootstrap already
loaded added 742 input tokens for its definition and 298 for its result
(1,040 total). A separate fresh child with compact-discovery guidance grew
from 22,221 to 26,503 across nine requests: 4,282 growth, 218,013 cumulative
input, 196,864 cache-read and 21,149 uncached input tokens. Its old installed
skill required an 8,084-character local bootstrap. Neither diagnostic is a
controlled comparison with the canonical-skill cohort below. The sanitized
[child counters](../../eval/agentic/context-loading/fixtures/codex-compact-child-usage.json)
and observed-rendering inventory preserve the reusable evidence.

## Controlled literal-grep study

The task requests three literal `tool_search` occurrences in
`github:openai/codex`, with one context line. The fixture server exposes the
production stable descriptions, schemas and annotations, returns the stable
guide for `quick_start`, and supplies a fixed, explicitly labeled grep result.
No OSS backend is contacted. Unsupported fixture operations return an error.

We tested the same canonical skill in three conditions:

- **Baseline:** unchanged skill.
- **Description:** append the protocol's 213-character discovery instruction
  to the skill's frontmatter description.
- **Body:** add exactly the same instruction after the skill heading, leaving
  the description unchanged.

There are three fresh runs per condition and host (18 runs total), with rotated
condition order. Codex requested Astra at medium effort; Claude's reported
model was Fable 5.1. CLI versions and exact prompt/hint are in the protocol.
This is an identity-bearing GitHits task, not neutral product discovery.
Project skill copies varied; global instructions and system skills were retained.
Provider cache state was not reset. The results are a small mechanism study,
not a statistical reliability guarantee or a Context7 comparison.

| Host / condition | Model requests per run | Input-context growth, three runs | Median cumulative input |
| --- | --- | --- | --- |
| Codex baseline | 3 | 10,120 / 10,148 / 10,148 | 85,888 |
| Codex description hint | 4 | 2,938 / 2,870 / 2,912 | 95,410 |
| Codex body hint | 3 | 10,094 / 10,152 / 10,131 | 85,830 |
| Claude Code baseline | 4 | 5,888 / 6,634 / 5,973 | 124,003 |
| Claude Code description hint | 4 | 5,997 / 5,979 / 5,879 | 123,947 |
| Claude Code body hint | 4 | 5,983 / 6,056 / 5,904 | 123,764 |

**Codex: early metadata changed behavior in all three observed repetitions.**
Baseline and body conditions printed complete matching `ALL_TOOLS` entries.
All three description-hint runs printed compact previews and then one selected
full definition. The first execution in baseline/body both read the skill and
printed the catalog. The agent constructed that entire execution before seeing
the body; a new body instruction could not retroactively change it.

Median context growth fell about 71% with the description hint. However, that
path required another model request, so cumulative input for this short task
was higher. Do not call the 71% reduction a 71% bill reduction. Uncached/cache
partitions are preserved per run; variation in cache hits prevents a clean
price comparison from this cohort alone.

**Claude Code: no material routing improvement was observed.** All nine runs
loaded the skill, selected tools through ToolSearch, invoked grep and skipped
`quick_start`. One baseline run additionally selected `feedback` without using
it, increasing context. The other eight selected only grep. The conditional
ALL_TOOLS hint did not produce a catalog dump or an extra call in these runs.

All 18 runs returned the fixture's paths/lines and disclosed its evidence limit.
That is bounded task completion, not a general answer-quality judgment. The
plain-MCP/stub diagnostic and failed live runs are separate from these 18 cases.

## Subsequent user-turn cost

Repetition 1's baseline and description-hint sessions received five further
user messages, each requesting an already-obtained path/line without tools.
Native Codex traces confirm one model request per follow-up and no tool calls.

| Codex condition | First follow-up input | Fifth follow-up input | Sum over five follow-ups |
| --- | ---: | ---: | ---: |
| Baseline | 32,269 | 32,509 | 161,945 |
| Description hint | 25,120 | 25,360 | 126,200 |

The observed gap persisted at 7,149 input tokens per follow-up: 35,745 fewer
input tokens across five follow-ups, about 22% of that whole-request input.
Including the original task, the two totals were 246,055 versus 221,655.
This directly demonstrates recurring load in these sessions, despite the
description condition's extra initial discovery request. It is one resumed
pair, with uncontrolled cache state, not a universal savings rate or a bill
comparison. Both original and resumed numeric fixtures are retained.

Claude's later explicitly pinned Fable continuations used 196,235 versus
196,610 input tokens across five turns, with no tool calls. Both histories
already included the excluded five Opus turns, so this is diagnostic retention
evidence rather than a clean same-model continuation from the original task.
It provides no evidence of a context advantage for the hint on Claude Code.

## Reproducible size and usage measurements

`scripts/agent-context-load.ts` has four measurement surfaces:

- `inventory` / `sizes`: current canonical skill, stable bootstrap, tool
  descriptions and JSON input schemas, exact Unicode character/UTF-16/UTF-8
  sizes, and content hashes. Schema conversion uses input-mode draft-7,
  matching MCP argument semantics rather than Zod's output-mode defaults.
- `observe codex|claude <run.jsonl>`: extract only request usage and model
  identity from one selected run. Claude split messages are deduplicated by ID;
  identifiers and message contents are not exported.
- `usage <observations.json>`: normalize inclusive Codex input versus additive
  Claude input/cache buckets, preserving cache reads, writes and uncached input.
  Missing/invalid input/cache counters fail rather than silently becoming zero.
  Provisional per-request output is null when it cannot be reconciled; the
  completed terminal output total remains available separately.
- `replay <scenario.json> [inventory.json]`: each row explicitly lists content
  present in a model request. Repeated references count repeated copies;
  omitted blocks are absent. `repeat` models additional requests retaining
  that content. There is no implicit compaction or caching policy.

Replay does not predict agent decisions, tokenization, cache hits, provider
wrappers, or hidden prompts. Its token field is null. Actual tokens come from
observations, not a characters-divided-by-four heuristic. Request count is
never inferred from the number of user turns.

Current canonical inventory at capture:

| Content | Unicode characters |
| --- | ---: |
| Skill frontmatter | 293 |
| Full skill file | 6,396 |
| Stable bootstrap response | 5,585 |
| Sixteen stable tool names | 181 |
| Names plus raw 80-character prefixes | 1,493 |
| Full stable JSON catalog | 57,799 |
| Grep definition in JSON inventory | 7,547 |

These are attributable content sizes, not whole-host prompts. The observed
Codex grep declaration was 2,672 characters in its different rendering. The
catalog-prefix replay uses raw JavaScript string slicing; it does not emulate
Claude.ai's separately observed first-sentence/79-plus-ellipsis rendering.

For example, the observed Codex-rendering snapshot with a full compact catalog
then selected grep definition retained for 20 requests totals 96,154 attributable
characters. Retaining an untruncated GitHits-only full catalog for 21 requests
totals 996,975. These are explicit counterfactuals: neither represents the
original mixed-server output, which was truncated, nor a measured bill.

## Strategy supported so far

Keep full-description search useful on Claude.ai. The observed Codex failure
was printing search results too broadly, not searching descriptions internally.
A small, conditional instruction in metadata available before the first
discovery is a promising workaround. A body-only instruction is insufficient
when skill reading and catalog dumping share one execution.

Do not introduce host-specific published skill forks from this evidence. First
test a shorter conditional frontmatter hint on additional tools and models.
The initial baseline self-contained skill already eliminated the redundant
`quick_start` call in these runs. Its guide still occupies context; removing
the call does not remove that content's recurring cost.

The next optimization candidate is guide/descriptor duplication, evaluated
against task completion, discovery and existing safety contracts. It requires
a broader workload cohort than this fixed grep result. The initial study changed no production guidance; the later combined
candidate is described below. The live backend stall also needs a
separate diagnosis before using live latency as an optimization metric.

## Routing-format follow-up: can the guide precede discovery?

The follow-up removed the host-specific catalog instruction entirely. The
[exact variants and protocol](../../eval/agentic/context-loading/routing-protocol.json)
and [48 audited runs](../../eval/agentic/context-loading/observations/routing-study.json)
compare two delivery paths on both pinned hosts, with three fresh repetitions
each of literal grep and a package license/latest-version lookup.

The routing skill description begins "Route public OSS code, documentation,
examples, and package questions to GitHits tools" and asks the agent to read
the skill before searching for or selecting evidence tools. Its body maps
question types to named tools and leaves argument details in the selected tool.
The routing `quick_start` description starts "Choose the GitHits tool for an OSS
question before discovering evidence tools" and returns the same routing guide.
There are no `ALL_TOOLS` instructions in either candidate. All evidence-tool
descriptions/schemas remain canonical and the full existing external-content
guardrail block is preserved.

The direct skill shrinks from 6,396 to 3,838 characters; its shared guide shrinks
from 5,585 to 3,490. Bootstrap conditions both use the same short entry body
requiring quick-start before evidence discovery. Their metadata and returned
guide vary together. They are **not** tests of plain MCP without an installed
skill, and the combined intervention does not isolate each sentence's effect.
Source hashes and exact staged texts identify what was actually run.

Strict success requires the guide response to arrive in an earlier model
request than evidence-tool discovery. A skill read batched with discovery fails.
Discovering `quick_start` itself is allowed before bootstrap; selecting it and
an evidence tool together fails. Calls emitted in one Claude assistant message
share a request even when separate transcript rows display them sequentially.
Claude's Skill result only announces launch; the actual skill body was verified
in its subsequent synthetic user message. `routing-order.ts` checks the audited
event annotations; it does not parse arbitrary execution code automatically.

| Host / guide delivery | Baseline: guide before evidence discovery | Router: guide before evidence discovery |
| --- | ---: | ---: |
| Codex / self-contained skill | 0/6 | 4/6 |
| Codex / entry skill then quick-start | 0/6 | 6/6 |
| Claude Code / self-contained skill | 6/6 | 6/6 |
| Claude Code / entry skill then quick-start | 1/6 | 0/6 |

Codex's routing skill failed once per task: it still read the skill and printed
broad matching metadata in one execution. All six routing-bootstrap cases used
separate requests for entry skill, bootstrap discovery, bootstrap call, evidence
discovery and evidence call, followed by the final answer. That worked in this
small cohort, not a guarantee of reliability on other models or tasks.

Claude Code loaded both self-contained skill variants before discovery. In all
six routing-bootstrap runs it selected quick-start and the evidence tool
together, then called bootstrap before invoking the evidence tool. Thus the
guide preceded invocation but could not influence the earlier discovery. Three
baseline-bootstrap runs additionally emitted bootstrap and evidence calls in
the same model request; successful completion alone would hide that failure.

All 48 runs completed both requested fixture facts/locators and disclosed the
fixture limitation. Neither this completion check nor preserving the safety
block establishes adversarial robustness or live source-retrieval quality.
No model switches or failed process exits occurred in this cohort.

For the grep task, token and request effects were:

| Host / condition | Input growth, three runs | Requests per run | Median cumulative input |
| --- | --- | --- | ---: |
| Codex skill baseline | 10,150 / 10,146 / 10,151 | 3 / 3 / 3 | 87,122 |
| Codex skill router | 1,921 / 2,279 / 10,283 | 4 / 4 / 3 | 93,901 |
| Codex bootstrap baseline | 11,586 / 11,570 / 11,599 | 4 / 4 / 4 | 122,360 |
| Codex bootstrap router | 2,202 / 2,203 / 2,198 | 6 / 6 / 6 | 140,122 |
| Claude skill baseline | 6,052 / 5,995 / 5,993 | 4 / 4 / 4 | 127,603 |
| Claude skill router | 4,993 / 4,969 / 4,981 | 4 / 4 / 4 | 124,254 |
| Claude bootstrap baseline | 6,203 / 6,390 / 6,425 | 5 / 4 / 4 | 124,352 |
| Claude bootstrap router | 5,304 / 5,258 / 5,309 | 5 / 5 / 5 | 156,170 |

Package-task observations and cache partitions are in the same artifact; do
not pool their different prompt/schema sizes with grep. Smaller retained
context again did not imply lower first-task cumulative input: Codex's reliable
observed bootstrap sequence costs six requests. Claude's self-contained router
reduced input without adding requests, while bootstrap added request overhead
without achieving earlier discovery. No recurring-turn savings are inferred
for these new variants from the earlier study's warm sessions.

**Decision supported:** routing guidance is a viable content-organization
candidate, but it is not a host-independent discovery-order guarantee. Direct
skill delivery works naturally in the observed Claude Code setup. Codex's
bootstrap route is promising for ordering, with a measurable request-count
tradeoff; its direct routing skill still fails intermittently. Keep production
guidance unchanged at that stage; the user subsequently selected broader
workload/model validation of a combined description and body change. Do not infer
that these results justify mandatory bootstrap for every host.

## Luna pilot and CI coverage

The subsequent neutral-task Luna pilot attempted code grep-to-read, docs
search-to-read and a pinned upgrade, using the current skill, the tested router
and a clearer first-action description. No valid comparative cohort completed.
The first pilot exposed a fixture rejecting documented object-form repository
targets; the fixture now reuses the production target parser. The restarted
pilot read globally installed GitHits skills instead of staged candidates and
then hit the local subscription usage limit. Both pilots are preserved as
[excluded evidence](../../eval/agentic/context-loading/observations/luna-pilot-exclusions.json).
They provide no evidence for choosing the untested wording variant.

`codex exec --help` identifies `--ignore-rules` as skipping execpolicy `.rules`
files. It does not document suppression of Markdown skill instructions. Normal
home configuration can expose competing global skills even when user config is
ignored; confirm the exact path and returned body, not only a Skill/cat event.

The original PR CI matrix ran only descriptor-only `discovery` and `intent`
scenarios. It could measure bootstrap/tool changes but not the skill. CI now
includes the existing `full` scenario on stable-full, with its artifacts and
Braintrust rows kept separate by scenario/cell identity. Baseline and candidate
must use the same coverage; older descriptor-only experiments cannot establish
the effect of changing an installed skill.

## Combined production guidance

The selected skill and `quick_start` descriptions use the routing-study wording.
The shared guide leads with a question-to-tool table and defers argument mechanics
to the selected descriptor. No `ALL_TOOLS` instructions or host-specific forks
are added. The canonical builder owns the guide and the terminal skill section
embeds it exactly; every evidence-tool description and the runtime-only local
appendices remain unchanged between the matched conditions.

Compared with the experimental router, the production guide retains the existing
artifact/manifest-root versus full-repository scope, Swift/Zig target examples,
docs-topic routing, emitted locators and the directory-read boundary. Tool names
are formatted as code, and the retired feedback tool is omitted. The
external-content posture is byte-for-byte unchanged. This is a refined candidate,
not the exact 3,490-character guide from the historical fixture study.

| Surface | Baseline characters | Candidate characters | Reduction |
| --- | ---: | ---: | ---: |
| Complete skill | 6,348 | 4,515 | 28.9% |
| Shared quick-start guide | 5,537 | 3,984 | 28.0% |

These are Unicode text sizes, not token estimates. Both public artifacts have a
pending patch fragment; versions await normal release preparation. CLI code and
package skills retain their upstream routing because this changes MCP discovery
and adds no CLI behavior. Hosted clients receive the MCP changes only after the
package is released and adopted by the hosted server.

## Matched PR comparison

The matched baseline is `1fc2e4247559e6e8b6aaf057abf1e9f9f8b9ffd9`,
[run 34453944757](https://github.com/githits-com/githits-cli/actions/runs/34453944757).
The candidate is `2a02a2ea22bb8709f2f4169bceb186af91e0a4a7`,
[run 34454862897](https://github.com/githits-com/githits-cli/actions/runs/34454862897).
Each condition has three complete attempts under the same 15-tool catalog,
workload matrix, harness, requested model and rate snapshot. Each attempt covers
2 neutral descriptor-only discovery cells, 22 GitHits-intent descriptor-only cells,
and 22 neutral full-guidance cells. The full scenario installs the MCP skill;
the descriptor-only scenarios do not.

The complete combined change improves the skill-bearing cohort, but is not a
universal token reduction. Median totals per complete scenario run:

| Scenario | Input baseline -> candidate | Input delta | Estimated cost baseline -> candidate | Cost delta |
| --- | ---: | ---: | ---: | ---: |
| Discovery, 2 tasks | 180,739 -> 335,282 | +85.5% | $0.018144 -> $0.024430 | +34.6% |
| Intent, 22 tasks | 2,582,821 -> 2,964,773 | +14.8% | $0.226760 -> $0.233844 | +3.1% |
| Full guidance, 22 tasks | 2,325,909 -> 2,098,837 | -9.8% | $0.211835 -> $0.190696 | -10.0% |

Full-guidance input ranges were 2,226,145-2,413,533 for baseline and
2,055,434-2,142,874 for candidate; estimated cost ranges were
$0.210109-$0.219912 and $0.186752-$0.193879. All three candidate runs were below
all three baseline runs on both measures. Median uncached input fell from
610,779 to 539,183 (-11.7%), cached input from 1,715,130 to 1,559,654 (-9.1%),
and MCP calls from 87 to 80. Seventeen of 22 workload-level input medians fell.
Summing per-cell medians gives -10.1% input and -11.4% estimated cost, so the
improvement is also present under that aggregation.

Intent is a weaker result: 13 of 22 workload input medians rose. Summing
per-cell medians still gives +8.4% input and +1.0% cost. Median uncached input
fell only 1.0%, while cached input rose 20.2% and MCP calls rose from 105 to 118.
In discovery, baseline used GitHits in 0/6 tasks and candidate in 3/6; increased
GitHits activation is part of that comparison, so it is not a same-tool-path
cost test. Across the full 46-cell mix, the median complete-run input increased
4.5% (5,131,349 -> 5,362,344) while estimated cost decreased 3.6%
($0.463361 -> $0.446889). Cache accounting changes the conclusion materially.

Exact skill ingestion before the first MCP invocation was observed in 63/66
baseline full-guidance tasks and 65/66 candidate tasks. The documentation-site
task skipped the skill in all baseline repetitions and one candidate repetition.
Neither full-guidance cohort called `quick_start`. This supports the
self-contained skill direction, with no guarantee of universal activation.

All 138 cells per condition completed the harness with no isolation-validation
categories. Tool errors nevertheless rose from 3 to 17: baseline had one
missing source file and two unsupported-version calls; candidate had eight
out-of-range grep-context calls, three missing documentation pages, five package
backend timeouts and one search backend error. Seven grep errors occurred in
one intent/opencode-compaction run and contributed to its 408,050 input tokens.
Neither guide specified that context-line limit; the schema maximum of 10 is
unchanged. Keep these errors in the measurements. Successful harness completion
is not proof of equivalent answer quality, and the backend failures prevent
attributing every observed difference to guidance.

Recommendation: retain the shorter self-contained skill as the supported
optimization direction. The shared routing guide/description candidate remains
reviewable in this PR, but the plain-MCP results do not establish a cost win.
Do not introduce host-specific forks or claim the entire change reduces tokens
from these results. Further plain-MCP tuning would need its own matched cohort;
the full-guidance result cannot stand in for it.

The [sanitized observations](../../eval/agentic/context-loading/observations/pr-routing-comparison.json)
retain each cell's numeric metrics, structural tool counts/errors, completion
status, model/version identity, exact skill-read audit and guide hashes. Recompute
run-total medians/ranges and sums of per-cell medians with
[`summarize-pr.ts`](../../eval/agentic/context-loading/summarize-pr.ts), as described
in the [reproduction guide](../../eval/agentic/context-loading/README.md#matched-pr-guidance-comparison).
Match cells by `metadata.cellId`, not workloadId. The Braintrust exporter's
latest-main automatic base is not this controlled baseline; use the six explicit
experiments in the artifact for this comparison.

All cells use requested `gpt-5.6-luna` at low effort through Codex CLI 0.154.0.
The resolved model identifier is not exposed. Input includes cached input;
uncached input is their difference. Costs are the existing harness estimates,
not billed charges. Each cell is a fresh task session, so these results do not
measure multi-user-turn retention or compaction. Three repetitions provide
descriptive evidence, not a significance test or an answer-quality grade.

CI stdout verifies the exact committed skill body in successful command output
before the first MCP invocation. It does not expose full Codex tool discovery
or individual model requests. This audit establishes ingestion, not strict
guide-before-discovery ordering. The original 48-run request-order study is the
separate evidence for that distinction.

### Historical catalog baseline and excluded evidence

An earlier baseline at `8aa5492760149564496daf84aaa9d9225cf2f6bb` completed three
46-cell attempts in [run 34452621919](https://github.com/githits-com/githits-cli/actions/runs/34452621919).
Candidate `1a527a4` was not evaluated: upstream `53463de` removed feedback and
changed information-tool annotations/descriptions, causing merge conflicts.
We integrated upstream and repeated the baseline with its canonical guide before
testing the router. The earlier 16-tool results remain historical evidence and
are excluded from the matched comparison, rather than attributing the catalog
change to shorter guidance.

Starting the first historical rerun before downloading its artifacts cleared
attempt 1's downloadable raw traces. Its Braintrust rows remain, but it cannot
support a new skill-ingestion audit. Every later attempt was archived before
rerunning. The observations retain the historical run identities and scenario
totals, separately from the six matched runs. Both local Luna pilots remain
excluded for the fixture/isolation failures documented above.

### Validation and independent live-smoke limitation

Candidate `2a02a2e` passed PR build/checks, Ubuntu and Windows unit suites,
Bun/Node 20/22/24/26 compatibility and public MCP package validation. Local plugin
generation/check, build, typecheck, MCP registration and unauthenticated CLI smoke
passed. The complete final live MCP smoke passed all 58 steps.

The local candidate full suite recorded 4,519 passes and three process-startup
timeouts at the default five seconds while host load exceeded 80. All 26 tests
in those two files passed on an isolated rerun, including the three failures;
no timeout thresholds were changed. CI's full suites subsequently passed.
The offline summary tests distinguish run-total medians from per-cell medians
with rotating outliers and reject incomplete or mismatched cohorts.

Live CLI stable coverage and JSON parity completed, then experimental resolver
smoke failed. A direct scoped probe reproduced `expressjs` returning the expected
`site:expressjs.com` and related package/repository targets at medium confidence;
the existing assertion requires exact/high. The final integrated candidate
reproduced that same failure. The guide change does not modify resolver scores.
Retain this as a backend-confidence investigation; do not weaken the smoke
expectation based on this guidance experiment. An earlier MCP `get_example` JSON
call also timed out at 60 seconds; its complete retry and final integrated run
both passed, and the failed trace remains preserved.

## Existing harness integration and remaining visibility

`scripts/agent-eval.ts` already provides descriptors/full/skills modes, source
selection via `--target-root`, raw CLI output and Claude discovery events.
It disables native session persistence, reports Codex discovery as `not_exposed`,
and normalizes only Codex terminal aggregate usage. Its full MCP mode installs
`AGENTS.md` and the MCP skill. `--ignore-rules` concerns execpolicy files, not
Markdown instruction loading; installed guidance still requires an ingestion audit.

Complete initial provider-prompt attribution and exact host schema rendering
remain unresolved. Use a verified supported capture surface; model self-report
cannot fill missing payloads. No credential-bearing proxy is introduced.
Future trace-retention or multi-turn integration should reuse the numeric readers
and explicitly record configuration identity instead of silently changing the
historical metrics contract. Near-compaction sessions and an expanded final
Claude cohort remain unmeasured; the earlier Claude fixture results must not be
presented as validation of this final Luna/CI candidate.

The historical live stdio grep that stayed pending beyond 15 minutes also needs
a separate transport/service diagnosis. Its connection succeeded and its trace
is retained, but no root cause is established. Fixture latency is not a
substitute for production evidence, and this work adds no retries or workaround.


### Post-comparison grep context correction

The user-approved follow-up changes runtime behavior as well as the grep
argument descriptions. It is **not part of the six matched routing runs above**.
Eight candidate validation failures all requested `context_lines_after: 12`;
seven were launched before the first failure returned, then corrected to 10.
They were not seven sequential failures to follow an error message.

The shared grep request builder now caps effective context at 10 per side after
applying asymmetric overrides. CLI parsing and MCP schemas accept nonnegative
safe integers above 10. Negative, fractional, nonfinite and unsafe integers
remain invalid. Unchanged inputs retain the existing output shape. Reduced
requests include `contextClamping` with requested/effective before/after values;
MCP text and CLI stderr report the reduction and direct larger windows to
`code_read` / `githits code read`. Existing JSON filter fields retain their
prior semantics; `contextClamping` explicitly records the effective sides.
An overridden symmetric request does not emit a notice if neither effective
side needs reduction. Backend limits, match limits and network queries are
unchanged.

The selected grep description explains the cap and routes larger windows to
reads instead of repeated grep. Its first sentence and first 80 characters are
unchanged. No skill-body or quick-start changes accompany this correction.
Baseline targeted tests: 45 passed before implementation. Regression coverage
checks schema acceptance, normalized wire values, invalid inputs, overrides,
CLI/MCP JSON parity and notices for matches and empty results. Live smoke
requests now exercise after-context 12 in both surfaces.

A descriptor-only Claude `code-grep-investigation` attempt failed at login
before usable tool/usage evidence; its ignored local artifacts are retained.
Do not interpret it as a product failure or an optimization result. New CI
results must be reported separately from the matched routing comparison.

Documentation fragments were handed off through Orca to an independent
`pkgseer-backend` worktree named `docs-fragment-resolution`. The Flask failure
appended `#the-routing-system` to a returned page URL. The two Express misses
instead used alternate page URLs and require separate alias/bundle analysis.
Backend work owns source identity and section mapping; this PR does not strip
fragments or implement section selection.


Follow-up validation at `b2249fa`: the six focused request/tool/renderer/CLI
files passed 114 tests; smoke/descriptor contracts passed 92 tests. The full
suite passed 4,528 tests and exposed one stale exported-schema expectation;
that contract was updated and its five-test file passed. Typecheck, build,
plugin generation/check, built CLI unauthenticated smoke and built MCP
registration smoke passed. Normal PR CI is green. Saved argument replay passed
all eight historical failed grep requests through the current schema and a
mocked service, each with effective after-context 10; no token savings are
inferred from that replay.

Live stable MCP and CLI/JSON parity passed oversized grep requests. The first
full MCP invocation later timed out at experimental `ask` URL JSON after
60 seconds; the full trace is retained and one rerun was started. Live CLI
again reached the unchanged experimental `expressjs` resolver assertion and
failed there. Neither experimental failure changes the grep validation result.
The separate API-authenticated eval run is
[34460109501](https://github.com/githits-com/githits-cli/actions/runs/34460109501),
at `b2249fa`; its results do not replace the historical matched comparison.
