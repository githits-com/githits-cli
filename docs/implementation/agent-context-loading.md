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
   bootstrap stub requiring `quick_start`. Current canonical skill content is
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
The current canonical self-contained skill already eliminates the redundant
`quick_start` call in these runs. Its guide still occupies context; removing
the call does not remove that content's recurring cost.

The next optimization candidate is guide/descriptor duplication, evaluated
against task completion, discovery and existing safety contracts. It requires
a broader workload cohort than this fixed grep result. No production guidance
has been shortened or moved by this study. The live backend stall also needs a
separate diagnosis before using live latency as an optimization metric.

## Existing harness integration and remaining visibility

`scripts/agent-eval.ts` already provides descriptors/full/skills modes, source
selection via `--target-root`, raw CLI output and Claude discovery events.
However, it currently disables native session persistence, reports Codex
discovery as `not_exposed`, and normalizes only Codex terminal aggregate usage.
Its full MCP mode installs `AGENTS.md` while still passing `--ignore-rules` to
Codex. Do not equate installed guidance with observed ingestion.

The research reader is separate from historical aggregate metrics to preserve
their semantics. Future integration should reuse these verified numeric
fixtures and add explicit trace retention, configuration identity and multi-turn
support rather than silently changing existing benchmarks. Complete initial
provider-prompt attribution and exact host schema rendering remain unresolved.
