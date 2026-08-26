# Plan: Remote MCP tool discovery and routing

## Objective

Make GitHits' public MCP catalog lines and loaded descriptors sufficient to
select the right tool when a host exposes only on-demand tool search and does
not pass MCP server instructions or installed Agent Skills to the model.
Extend the existing agentic harness with controlled guidance profiles so the
same descriptor change is evaluated both with tools/descriptions alone and with
the instructions and skills existing installations receive.
Change and evaluate the existing descriptions first, without adding a tool, so
any improvement or regression is attributable to descriptor wording. Treat an
optional `quick_start` bootstrap as a separate, evidence-gated follow-up only if
the descriptor-only results still show a cross-tool routing gap.
Open-ended investigations of a known public package or repository should begin
with relevance-ranked `search`, then move to `code_grep` for exact/paginated
match tracing and `code_read` or `docs_read` for focused evidence. Exact
identifier, string, regex, file-listing, and known-file tasks should still route
directly to their specialized tools.

The tool-selection contract belongs to the public `@githits/mcp` descriptor
catalog. Server-level instructions remain useful supplemental workflow guidance,
but no public tool may depend on those instructions for its own selection
boundary.

## Status

- Overall: IN PROGRESS — Phase 1 implementation and local verification are
  complete; implementation review and hosted deployment remain
- Phase 1 — the eval harness isolates guidance profiles, and description-only
  changes are covered by attributable before/after regressions: REVIEW
- Phase 2 — decide from Phase 1 evidence whether an optional `quick_start` tool
  is still justified; if approved, implement and evaluate it independently:
  COMPLETE — no tool added; the observed miss occurred after all relevant
  definitions were loaded, so a bootstrap would not address it
- Phase 3 — the hosted remote MCP serves the accepted descriptor/catalog
  contract and the real Claude connector follows the intended workflow:
  PENDING

## Verified current state and evidence

1. The supplied Claude connector transcript began with a mechanism-shaped tool
   lookup, `grep source code of a repository`. That loaded `code_grep`, after
   which the agent stayed with grep. When the same investigation was replayed
   with `search`, search found `CONTEXT.md` and `specs/v2/**` evidence that the
   TypeScript-only grep had structurally excluded. This changed the answer: the
   original response missed Context Epoch behavior and misclassified a planned
   redesign as two parallel implementations. A current GitHits lookup verifies
   the reproducible target as `github:anomalyco/opencode#v1.18.15`, resolved to
   commit `d7b115f623760e68a4749d16508a9eca350f246f`.
2. The transcript also demonstrates the correct division of labor. `search`
   was better for the open-ended first pass across docs, specs, code, symbols,
   tests, and examples. `code_grep` remained better once exact vocabulary such
   as `tail_start_id` and `isOverflow` was known and every call site mattered.
3. The follow-up transcript corrects the initial explanation of the perceived
   latency tax. The first `code_grep` call also returned `INDEXING`, and both
   tools expose `wait_timeout_ms` with the same 20-second default. Two replayed
   `search` calls completed with results in one round trip and returned no
   `searchRef`. The observed difference is presentation: grep looks like one
   ordinary call with recovery on its slow path, while the 2,074-character
   `search` description foregrounds `searchRef`, multiple progress/terminal
   states, partial-result policy, and a companion `search_status` tool before an
   agent knows whether the initial call will complete or require continuation.
4. `packages/mcp/src/mcp/instructions.ts` already describes the broad workflow,
   including discovery with `search`, deterministic known-pattern work with
   `code_grep`, path enumeration with `code_files`, and focused reading with
   `code_read`. The connector session did not receive that layer, so it cannot
   be the sole owner of routing guidance.
5. The current local descriptors partially contain the same guidance, but it is
   inconsistent and mixed with long operational contracts. Measured descriptor
   lengths are `search` 2,074 characters, `code_grep` 985, `code_files` 1,254,
   and `code_read` 1,340. `search` starts with a discovery use case and
   `code_grep` places `Use search for discovery instead` in its third sentence,
   while `code_files`, `code_read`, `docs_list`, and `docs_read` lead mainly
   with the operation they perform. The distinction between a generic user verb
   such as “grep/find” and a known exact pattern is not explicit.
6. The transcript's description of deployed `code_grep` wording conflicts with
   this checkout: it reports routing guidance buried behind pattern and error
   semantics, whereas the local descriptor leads with the known-pattern
   boundary. The hosted endpoint requires OAuth even for initialization, so its
   live descriptor inventory could not be inspected without credentials. The
   transcript is the available production evidence. This apparent drift must be
   resolved before claiming a local wording change fixes the connector.
7. Anthropic's current tool-search documentation states that tool search indexes
   tool names, descriptions, argument names, and argument descriptions, then
   expands only matching definitions (five by default). Anthropic's tool-design
   guidance says descriptions must explain what a tool does, when to use it,
   when not to use it, and important limitations. This makes per-tool routing
   language and argument descriptions part of the retrieval contract, not only
   post-retrieval documentation.
8. Existing unit tests assert selected descriptor phrases but not the routing
   boundary across the navigation family. Existing agentic workloads separately
   exercise unified search, source ergonomics, grep, and Express navigation,
   but none reproduces an open-ended repository investigation whose user wording
   can be mistaken for an exact grep request.
9. The 150-line `code_read` limit is deliberate: its source comment records
   prior 300–600-line reads dominating agent context. The transcript does not
   establish that changing the cap would improve answer quality enough to
   justify reversing that constraint.
10. A second supplied Claude connector transcript reports that Datadog exposed
    a 239-entry deferred catalog as tool names plus truncated first lines, then
    expanded selected tools into complete schemas. That session successfully
    navigated APM using `aggregate_spans` without loading a Datadog skill. This
    makes retrieval-grade first lines and self-contained tool protocols
    plausible contributors, not proven causes. Its one catalog miss was
    `search_datadog_services`; the agent recovered through the more general
    `aggregate_spans` tool.
11. The Datadog MCP configured in this session currently exposes 25 tools, not
    the transcript's 239, so catalog size and enabled scopes differ. Every
    exposed tool has non-empty tool-specific prose (138–1,723 characters) and a
    required `telemetry.intent` argument. Every description also carries the
    same 1,197-character preamble instructing agents to discover skills before
    other tool calls by running a direct `load_datadog_skill` and fuzzy
    `list_datadog_skills` query in parallel. From the model-visible metadata
    alone, it is uncertain whether Datadog authors that preamble into every raw
    descriptor or this MCP client prepends server instructions; either way, the
    model receives redundant guidance on this surface. Tool-specific
    descriptions also restate chains: `aggregate_spans` points to raw span
    search for field discovery, and `get_datadog_dashboard` requires dashboard
    search first.
12. Direct Datadog skill inspection verifies a real MCP-native guidance layer.
    `list_datadog_skills` and `load_datadog_skill` have explicit reciprocal
    descriptions; `datadog/traces` contains tool roles, parameter tables, query
    syntax, examples, a search-to-trace workflow, best practices, related skills,
    and deeper resources. The fuzzy query `APM traces spans service discovery
    tool workflows` did not return `datadog/traces`, while a direct exact load
    succeeded. Datadog's mandatory parallel discovery protocol compensates for
    that miss, but costs at least two extra calls before domain work and can
    require further loads for listed or related skills.
13. The Datadog evidence contradicts two claims in the second transcript. Skill
    guidance is not merely pointed to by a few relevant tools on the configured
    surface; it is repeated in the common preamble for every exposed tool. Also,
    the transcript's claim that a model loading only GitHits `search` would not
    know `search_status` exists is stale relative to this checkout:
    `search` already names `search_status`, and response text emits the exact
    conditional continuation action. The remaining GitHits problem is retrieval
    and framing, not a missing chain link. The Datadog transcript also says no
    skill was loaded, while the currently configured preamble mandates skill
    discovery before domain calls; the sessions therefore differ or the agent
    skipped that guidance, so the skill layer cannot be credited as the cause of
    the successful APM navigation.
14. GitHits currently has 15 stable public MCP tools. The canonical public
    `buildMcpInstructions()` output is 4,642 characters and already names every
    stable tool while explaining the main selection boundaries. This makes a
    static bootstrap technically feasible as a later option, but does not show
    that one is necessary. The stable
    registry, annotation coverage, local-server expected names, and smoke tool
    inventory are all explicit and tested. If Phase 1 evidence justifies a
    `quick_start` follow-up, it can expose the canonical public instructions
    without introducing a skill list/load protocol or a second authored guide.
    Because the instructions' external-content posture refers generically to
    tool results, that tool would need to identify its own result as
    GitHits-authored routing guidance and scope the posture to subsequent
    evidence content. Adding it would require catalog-test and public release
    updates in a separate increment.
15. A third supplied Claude transcript reports that its deferred-tool catalog
    displays roughly 78–80 characters of each description before truncation.
    That is an observed presentation limit, not a documented retrieval-index
    limit. Direct inspection of this checkout finds all 15 descriptions exceed
    80 characters. Ten use an opening usage preamble when `search_status`'s
    “Use only after” is included; four, not the claimed five, begin with the
    exact phrase “Use when the user asks.” `get_example` instead begins “Use
    when the user needs.” The deployed transcript and local checkout therefore
    differ, and the transcript also contains a counting error, but both support
    the same catalog-readability problem: generic usage preambles displace the
    differentiating verb and noun from the visible prefix.
16. The transcript correctly separates two failure layers: a host may fail to
    retrieve a definition, or the model may retrieve it and then invoke it or
    its workflow incorrectly. Anthropic documents full names, descriptions,
    argument names, and argument descriptions as tool-search inputs, so this
    plan does not assume the visible 80-character prefix is the retrieval index.
    The prefix remains the model's catalog-reading surface. Rejected on
    2026-08-26: the transcript's proposed `search` rewrite—“Async search ...
    returns searchRef → poll search_status.” Verified complete calls return no
    `searchRef`, and current responses make continuation conditional. Under
    normal complete calls that wording would cause a bounded but needless
    status-tool lookup or call; the smaller remedy is an early conditional
    handoff.
17. A fresh Claude Code probe resolves the index-depth uncertainty for that
    host surface. Its visible lines truncated `search`, `code_grep`, and
    `pkg_vulns` at roughly 80 characters, but exact late-description queries
    retrieved the relevant definitions: `suggestedSiteTargets` loaded `search`;
    `FILE_PATH_EXCLUDED` matched `code_files`, `code_grep`, and `code_read`; and
    `serveable subset` matched both `search_status` and `search`. Claude Code
    therefore indexes metadata beyond the displayed prefix. The latter two
    queries also loaded unrelated Datadog interactive-UI tools, so total loaded
    counts include host-controlled additions and are not a pure ranking metric.
    `pkg_vulns` was irrelevant to all three probes, and `search_status` was not
    one of the three catalog lines requested, so neither absence supports a
    negative inference. This evidence is specific to Claude Code; Phase 3 still
    verifies the approved Claude connector surface.
18. The user confirmed the original OpenCode connector transcript is the
    unprimed behavioral before-state. Do not request another equivalent
    pre-change session. The remaining connector replay is post-deployment
    acceptance evidence, not duplicate discovery.
19. The existing agentic harness does not expose the required context matrix.
    `--surface mcp` runs in an isolated workspace without skills or project
    instructions, but the local MCP server always supplies
    `buildLocalMcpInstructions()`. `--surface skills` copies skills and a CLI
    shim while configuring an empty MCP server, so it does not exercise MCP tool
    descriptions. There is no MCP-tools-only mode and no combined
    MCP-plus-skills-and-pointer mode. The local server already funnels its
    instruction string through `createMcpServerWithFactories`, where an explicit
    empty string suppresses the default builder; the missing piece is a narrow
    local/eval launch option, not another server implementation.
20. The harness preserves raw agent stdout but intentionally filters Claude
    `ToolSearch` calls out of `tool-calls.json`; this behavior has an explicit
    “ignores non-MCP Claude tool calls” test. Therefore current reports cannot
    say whether Claude Code used deferred tool discovery. With only GitHits in
    strict MCP config, absence of `ToolSearch` would remain inconclusive because
    the host may eagerly load the small catalog. Discovery events must be
    recorded separately from GitHits calls and interpreted as host-specific
    evidence, not as proof of Claude Desktop/connector parity.
21. Codex model selection is pass-through only: `--model` is optional, no
    reasoning-effort option is recorded, and examples still name
    `gpt-5.4-mini`/`nano`. The installed Codex CLI accepts model and TOML config
    overrides, so the automated cohort can use `gpt-5.6-luna` at `high`
    reasoning while preserving explicit caller overrides. Keep that default
    only if Luna completes the Phase 1 workloads.
22. The pre-description baseline is retained under
    `.agent-eval/runs/remote-mcp-before-{codex,claude}-{descriptors,full}` and
    `.agent-eval/runs/remote-mcp-before-opencode-{descriptors,full}-direct`.
    All 20 mandatory Codex cells completed with `gpt-5.6-luna` at `high`
    reasoning, high confidence, and expected GitHits tool-family access.
    Claude completed 19 of 20 cells; the descriptor-only upgrade-review cell
    produced a complete successful report preceded by one prose sentence, so
    the strict JSON parser correctly retained it as a failed conformance cell.
    Its raw tool and discovery evidence was inspected rather than rerun.
23. The baseline exposed and fixed two eval-observer defects before descriptor
    edits. Full Codex runs often followed installed CLI skills instead of MCP;
    full-profile extraction now records both call paths and warns on GitHits CLI
    fallback. OpenCode initially loaded the user's global GitHits skill and
    delegated work to a child session, hiding calls. OpenCode eval/session
    processes now disable external skill scans while retaining the full
    profile's local `.opencode/skills`, and generated eval config denies task
    delegation so calls stay observable. The accepted direct OpenCode reruns
    contain no global skill or task calls. A parallel rerun produced a shared
    database lock; the accepted reruns were sequential and no retry/locking
    mechanism was added.
24. The recorded pre-change prefixes confirm the catalog-readability gap. Five
    descriptions begin with `Use when`/`Use before`/`Use after`, four package
    descriptions begin with user-request boilerplate, and `search_status`
    begins with its precondition rather than its continuation benefit. Claude
    Code emitted `ToolSearch` events in every descriptor-only workload; Codex
    and OpenCode drivers do not expose an equivalent discovery event.
25. The post-description Codex matrix is retained under
    `.agent-eval/runs/remote-mcp-after-codex-{descriptors,full}`. All 20 cells
    completed with `gpt-5.6-luna` at `high` reasoning, reached the expected tool
    families, and reported useful evidence; 19 were high confidence and the
    full-profile upgrade cell remained medium confidence as in the baseline.
    The final changelog-contract and known-pattern-prefix refinements also have
    focused Luna-high descriptor-only runs under
    `.agent-eval/runs/remote-mcp-after-changelog-contract` and
    `.agent-eval/runs/remote-mcp-after-known-pattern-prefix`.
26. The post-description Claude runs are retained under
    `.agent-eval/runs/remote-mcp-after-claude-{descriptors,full}`. Twelve cells
    completed with useful, high-confidence evidence and observed `ToolSearch`;
    the remaining eight were rejected before inference with zero tokens and
    zero tool calls after the Claude account reached its seven-day usage limit.
    Those cells are external-capacity gaps, not descriptor regressions, and
    were not rerun or reclassified as passes.
27. The accepted sequential OpenCode after-state is retained under
    `.agent-eval/runs/remote-mcp-after-opencode-{descriptors,full}-direct`.
    All four bounded cells completed with useful, high-confidence evidence and
    observable direct MCP calls. No global skills or delegated child sessions
    contaminated these runs.
28. Raw call review found one selection deviation worth acting on. Codex and
    OpenCode began the descriptor-only compaction investigation with `search`,
    while Claude's completed after-cell began with `code_grep` even though its
    baseline began with `search`. Claude's `ToolSearch` event shows it explicitly
    loaded both full definitions, so this was not a retrieval miss. The
    `code_grep` known-pattern precondition was therefore moved from sentence two
    into its catalog prefix. A focused Luna-high boundary run then began the
    open-ended compaction workload with `search` and the exact-pattern control
    with `code_grep`; Claude could not be rerun after the quota rejection.
29. Phase 1 does not justify `quick_start`. Every completed descriptor-only
    workload reached a useful tool chain, and the only material routing miss
    happened after Claude had already loaded all relevant definitions. A static
    bootstrap would add a call and repeat guidance without fixing that observed
    decision. Keep the stable public catalog at 15 tools unless hosted connector
    validation later produces a genuine definition-retrieval gap.
30. The eval exposed one false existing contract claim: live
    `pkg_changelog` range behavior excludes `from_version` and rejects an equal
    start/end range. The descriptor, schema help, service contract comment, and
    durable documentation now state `(from_version, to_version]` and direct a
    one-release lookup to latest mode with `to_version` plus `limit: 1`.
31. Final local verification passes 3,179 unit tests, typecheck, format, lint,
    root and MCP builds, public-package validation, plugin generation/checks,
    source CLI/MCP smokes, and built CLI/MCP smokes. The first live MCP smoke
    encountered an explicit retryable backend `RATE_LIMITED` envelope on the
    second back-to-back example call; after the reported four-second window,
    both source smoke suites passed without a product-code workaround.

## Scope

- Audit all 15 current stable public MCP descriptions as one routing catalog.
  Change openings that spend the visible prefix on generic usage preambles or
  delay the discriminating result/object noun. Preserve already-specific
  openings and change full protocol prose only where the audit finds a concrete
  missing or contradictory boundary.
- Present the initial-call completion path before continuation. Describe `searchRef` and
  `search_status` as conditional slow-path continuation that applies only when
  the response explicitly supplies that action.
- Make each changed descriptor's first 80 characters communicate the tool's
  main benefit: what the agent gets or accomplishes, expressed with a compact
  capability verb and discriminating nouns. Put “use when” triggers, negative
  routing, workflow handoffs, parameters, and recovery afterward. Include a
  chain marker in the prefix only when it fits without obscuring the benefit or
  making a conditional workflow look mandatory.
- State each tool's role in the navigation chain and cross-advertise its
  immediate predecessor, successor, or alternative by exact tool name. Do not
  rely on server instructions or another tool's descriptor to supply that
  transition.
- After Phase 1, decide whether the remaining evidence justifies a separate
  no-argument, read-only `quick_start` increment. Do not add or evaluate it in
  the same before/after comparison as the description changes.
- Strengthen `search.query` wording with open-ended investigation vocabulary
  that tool search can match, including “how does”, “where is”, “find”,
  “locate”, and generic “grep the source” intent.
- Keep the cross-project `get_example` boundary aligned with known-target
  `search`; change it only if the revised navigation wording exposes an actual
  contradiction.
- Add structural descriptor tests and a targeted agentic workload based on the
  OpenCode compaction investigation.
- Add controlled local MCP guidance profiles to the existing agentic eval and
  interactive-session harnesses. Capture a before-change baseline with those
  profiles before editing descriptors, then compare the same agent/model/
  workload cells afterward.
- Make automated Codex evals reproducible with `gpt-5.6-luna` at `high`
  reasoning by default, record both effective values, and preserve explicit
  model/reasoning overrides. If Luna cannot complete the Phase 1 cohort, report
  that evidence instead of silently substituting Sol.
- Update durable MCP tool/eval documentation and add an independent Phase 1
  change fragment with patch impact for both `githits` and `@githits/mcp`.
  A later public-tool addition would use its own minor-impact fragment.
- Mirror or consume the accepted descriptor contract in the hosted remote MCP,
  then validate the actual Claude connector after deployment.

## Non-goals

- Changing search ranking, indexing, file-intent classification, locale-file
  handling, symbol resolution, result ordering, or result limits.
- Changing the 150-line `code_read` / `docs_read` caps.
- Making `search` synchronous, removing `search_status`, or redesigning
  `searchRef` continuation. The follow-up evidence shows a framing problem, not
  a missing initial-call completion path.
- Adding Datadog-style skill discovery, required intent telemetry, a common
  preamble to every tool, or a list/load guide protocol. Datadog is evidence for
  retrieval-grade descriptions and explicit workflow handoffs, not a design to
  reproduce. If later approved, `quick_start` is one optional view over GitHits'
  existing canonical public instructions, not a separate skill system or
  mandatory first call.
- Designing `quick_start` around caller-supplied `options.instructions` or local
  experimental-tool additions. If the follow-up is approved, the public
  bootstrap owns stable GitHits guidance only; host-specific and
  local-experimental guidance remains owned by the serving host, its server
  instructions, and those tools' descriptors.
- Trying to make the remote server control the one-line header or ranking that
  Claude's host-owned `tool_search` returns. The server controls descriptors,
  schemas, and results, not that presentation layer.
- Treating local Claude Code discovery behavior as proof of Claude Desktop or
  connector behavior. The local descriptors-only profile approximates missing
  guidance; only the post-deployment connector replay proves hosted retrieval.
- Adding a second/mock GitHits MCP implementation or synthetic distractor tools
  solely to force `ToolSearch`. The existing local server remains the system
  under test; discovery events are observed when the host emits them.
- Changing tool names or combining tools. The current operation boundaries are
  useful once the correct tool has been discovered.
- Fixing the separate transcript findings that `code_grep` does not print its
  resolved commit, broad grep can be crowded by i18n files, or workspace alias
  resolution is manual. Preserve them as evidence for separate product work;
  do not mix runtime/backend changes into this descriptor increment.

## Target contract and architecture

### Catalog and descriptor layering

Each affected descriptor has five ordered responsibilities:

1. **Benefit prefix:** the first 80 characters state the main outcome—what the
   agent gets or can accomplish—with a compact capability verb and
   discriminating nouns. Treat 80 characters as an observed display budget,
   not as the tool-search index contract. Avoid generic “Use when the user
   asks/needs” preambles.
2. **Use trigger and routing boundary:** after the benefit, state when to use
   the tool, when not to use it, and the nearest positive/negative selection
   boundary. The opening paragraph must stand alone when tool search returns
   only that definition.
3. **Workflow role and handoff:** state whether the tool discovers, narrows,
   lists, continues, or reads. Name its immediate predecessor, successor, or
   alternative tools, such as `search → code_grep → code_read` and
   `search(source:"docs") → docs_read`. Repeat the relevant transition in
   every participating tool so any one loaded definition is sufficient.
4. **Call contract:** retain only the inputs, result identifiers, caps, and
   limitations needed before the call.
5. **Recovery:** keep concise lifecycle rules whose omission could cause an
   incorrect repeat or poll. Detailed recovery remains authoritative in schema
   argument descriptions and response-owned actions/errors.

The existing external-content guardrail remains appended unchanged. Descriptor
compression must not weaken its safety contract.

The Datadog evidence supports the workflow-role and handoff requirements. It
does not determine GitHits' wording, schema, skill model, or telemetry design.
GitHits currently has 15 stable tools and an existing general `search`
entrypoint, so Phase 1 keeps the current 15-tool catalog and makes every
existing boundary self-routing. A bootstrap, if Phase 1 evidence supports one,
is a separate catalog change.

### Potential follow-up bootstrap contract

This contract applies only if the Phase 2 product decision authorizes
`quick_start`. It would be a recovery surface for missing host context, not the
first step of every workflow. Its descriptor must be broad enough for tool
retrieval and specific enough to prevent ritual calls:

- Lead with the returned value and retrieval nouns: a GitHits routing guide for
  search, grep, code, docs, packages, and examples. Immediately follow with the
  user's condition: use it once if GitHits MCP instructions or the GitHits
  skill were not received and the task may require choosing among tools, or
  whenever tool choice is unclear.
- Name all other stable public tools and their high-value intent terms in the
  descriptor, because host tool search cannot index a result before invocation.
- Keep each specialist's description and argument terms more specific than its
  compact mention in `quick_start`; the bootstrap must not be the best semantic
  match for a clear single-tool request.
- State that a clearly matching loaded tool should be called directly.
- Return one concise provenance line followed by the canonical
  `buildMcpInstructions()` content rather than authoring a parallel routing
  guide. The line states that `quick_start` is GitHits-authored guidance and
  that the embedded external-content posture applies to evidence returned by
  subsequent search/code/docs/package/example tools, not to this guide.
- Accept no arguments and perform no GitHits API or network operation.
- Return the canonical public guide, not the serving instance's arbitrary
  `options.instructions` or local experimental additions. This avoids threading
  host-owned text through a trusted public tool and keeps ownership explicit.

The tool may add one bootstrap call to an ambiguous or multi-tool session. It
must not become a required predecessor for a clear single-tool request.

### Tool-selection matrix

| User intent | First tool | Required descriptor distinction |
|---|---|---|
| After Phase 2 approval: GitHits instructions/skill are absent and the correct GitHits tool remains unclear | `quick_start` | Optional routing bootstrap covering every stable tool; absent from Phase 1 and skipped when a loaded specialist already clearly matches. |
| “How does X work?”, “where is X?”, “find/locate/grep the implementation” in a known public package/repo | `search` | Start here for open-ended discovery across docs, specs, code, symbols, tests, and examples, even when “grep” is used as a generic verb. |
| Exact identifier, literal, regex, or all call sites after vocabulary is known | `code_grep` | Deterministic paginated matching; not the first tool for conceptual discovery. |
| Files under a known directory or files matching path/type filters | `code_files` | Path inventory only; not content or conceptual search. |
| A known exact file and focused line region | `code_read` | Requires a path; use discovery/list/grep first when path or region is unknown. |
| Browse all available docs pages for a package | `docs_list` | Inventory/browse; use docs `search` for a topic. |
| Read a known page ID | `docs_read` | Requires a page ID returned by `search` or `docs_list`. |
| Continue a prior incomplete search | `search_status` | Continuation only, never a fresh discovery entrypoint. |
| Canonical pattern across projects without one known target | `get_example` | Cross-OSS examples; known-target investigation belongs to `search` and follow-ups. |
| Resolve an uncertain `get_example` language name | `search_language` | Language-name lookup only; never a general source search. |
| Latest-version package adoption or health overview | `pkg_info` | Summary facts; route focused vulnerability, dependency, changelog, and upgrade questions to their specialist tools. |
| CVEs, advisories, severity, or fixed versions for a package/version | `pkg_vulns` | Vulnerability evidence; an upgrade comparison belongs to `pkg_upgrade_review`. |
| Direct or bounded transitive package dependency inventory | `pkg_deps` | Dependency graph facts; not package health or upgrade risk. |
| Release notes or changes across package/repository versions | `pkg_changelog` | Changelog evidence; use `pkg_upgrade_review` for a current-to-target assessment. |
| Assess whether to accept a dependency version bump | `pkg_upgrade_review` | Current-vs-target evidence spanning release and vulnerability facts; not a risk score. |
| Report a helpful or defective GitHits result | `feedback` | Bounded result feedback after another GitHits tool; never discovery. |

The `search` description and its `query` argument must contain the open-ended
phrases that were absent from the connector's mechanism-shaped lookup. The
`code_grep` description must still contain “grep”, “literal”, “regex”,
“identifier”, and “call sites”, but its opening must make the known-pattern
precondition explicit. Do not promise whole-repository exhaustiveness in one
response because grep is paginated and can truncate; describe deterministic,
paginated match enumeration instead.

The `search` call contract must state the one-call completion path before
continuation: it can return complete relevance-ranked results in one call; only
follow `search_status` when the response explicitly returns a `searchRef` and
action.
The full progress-state taxonomy does not belong in the discovery pitch. Keep
the minimum no-repeat/terminal rules in `search`, put continuation detail in
`search_status`, and rely on response-owned actions for the exact next call.
Do not claim a frequency for the one-call path until production telemetry or a
representative sample supports it; the verified evidence is two successful
replays.

### Agentic guidance profiles

Keep `surface` as the access mechanism (`mcp` or the existing CLI-backed
`skills`). Add one MCP-only guidance-profile enum rather than interacting
booleans:

| Profile | Local MCP server instructions | Installed skills and canonical pointer | Purpose |
|---|---|---|---|
| `descriptors` | Empty | No | Closest controllable remote-connector approximation: tool names, descriptions, schemas, and results only. |
| `instructions` | Current `buildLocalMcpInstructions()` | No | Existing harness behavior and diagnostic middle cell. |
| `full` | Current `buildLocalMcpInstructions()` | Yes | Regression protection for enriched installations created by plugins or `githits init`. |

The harness default remains `instructions` for compatibility. `descriptors` and
`full` are local-MCP profiles; reject them with the published server rather than
silently producing a mixed-version comparison. The existing `surface=skills`
mode remains a separate CLI/skill test and does not accept an MCP guidance
profile.

Implement instruction suppression inside the existing local server path. Add a
small `default | none` instruction mode to `createLocalMcpServer` and the hidden
`githits mcp start` eval launch surface; `none` passes an explicit empty string
to `createMcpServerWithFactories`. Do not fork tool registration, service
construction, authentication, or handlers.

The `full` profile reuses `prepareSkillsWorkspace` and the canonical
`GITHITS_GUIDANCE_BLOCK`, installing the same skills, CLI fallback, and
host-readable project instruction file(s) in the isolated workspace while
retaining the MCP configuration. Agent launch isolation must still exclude
unrelated global MCP servers, skills, and instructions.

Preserve GitHits MCP/CLI calls in `tool-calls.json`. Add a separate
`discovery-events.json` for host discovery mechanisms, initially recognizing
Claude `ToolSearch` requests and their result text when the verbose stream emits
it. Reports state whether discovery was observed, not observed, or not exposed
by that driver. “Not observed” is never interpreted as “the host does not use
tool search.”

Use this before/after cohort for both Claude and Codex under `descriptors` and
`full`, keeping the same explicit or recorded model selection within each
comparison:

- `opencode-compaction.md` and `express-router.md` for open-ended multi-tool
  discovery and exact follow-ups
- `global-example.md` for `get_example`, `search_language`, and feedback-facing
  guidance
- `package-overview-vulnerabilities.md`, `package-dependencies.md`,
  `package-changelog.md`, and `package-upgrade-safety.md` for every package
  specialist
- `docs-search-followup.md`, `code-files-listing.md`, and
  `code-grep-investigation.md` for specialized direct routes and handoffs

Run OpenCode under both profiles for `opencode-compaction.md` and
`express-router.md`. This keeps its regression cost bounded while still testing
the multi-tool behavior affected by the descriptor catalog. The
`instructions` profile is diagnostic rather than part of the mandatory
before/after matrix.

For Codex, the automated harness default is `gpt-5.6-luna` with `high`
reasoning. Explicit model or reasoning options remain authoritative. Persist
both effective values and make compare mode warn when either differs, so a
model/effort mismatch cannot masquerade as a descriptor effect.

### Canonical ownership and hosted parity

The verified friction is ownership drift: both the TypeScript public package
and the hosted server need the same agent-selection semantics, but the live
transcript and local checkout appear different. The immediate low-cost fix is
to make the same reviewed wording change in both implementations and compare
their complete tool descriptors before deployment.

The longer-term boundary correction is for the hosted server to consume the
public `@githits/mcp` descriptors/server directly. If its runtime cannot do so,
the alternative is one mechanically generated descriptor contract with a
cross-repository parity check. That alternative adds release/build machinery
and is not authorized by this plan without an explicit product decision.

## Assumptions

1. The connector transcript reflects the deployed remote MCP behavior closely
   enough to serve as the before-state even though an unauthenticated descriptor
   inventory is unavailable.
2. The approved Claude connector is expected to use the same indexed fields as
   Anthropic tool search and the verified Claude Code surface: names,
   descriptions, argument names, and argument descriptions. Phase 3 verifies
   that connector rather than assuming host parity.
3. Tool names and operation boundaries remain stable; descriptor wording and
   tests are sufficient for the immediate routing correction.
4. The hosted implementation can accept an equivalent descriptor-only change
   without changing request/response schemas.
5. Agentic eval outcomes are qualitative evidence. Unit/smoke checks remain the
   deterministic gates.
6. Truncated catalog lines are a relevant Claude catalog-reading surface based
   on the supplied sessions. Anthropic's documented server-side tool search can
   index the full descriptor and schema, so the plan does not equate the visible
   prefix with the retrieval index; both the prefix and complete loaded
   definition must remain coherent.
7. The hosted MCP can expose a static read-only tool without making an upstream
   GitHits API request. If its request-scoped service resolution prevents that,
   stop and resolve ownership rather than adding a network dependency to a
   static guide.
8. An empty local MCP `instructions` string is the closest controllable match
   for the connector's missing-guidance behavior. It does not reproduce the
   connector's tool-ranking implementation, catalog size, or UI.
9. Phase 1 can establish the effect of description changes only if the stable
   tool inventory remains unchanged. `quick_start` therefore cannot enter that
   before/after cohort.

## Unknowns and product decisions

1. **Hosted descriptor owner and deployment path.** The hosted server source is
   outside this workspace. Resolve its repository, current descriptor inventory,
   and deployment owner before Phase 3 implementation. This does not block
   Phase 1.
2. **Permanent parity mechanism.** Decide by the start of Phase 3 whether to
   keep a manual dual-repo mirror for the immediate release or authorize a
   single generated/consumed contract. Recommendation: ship the manual mirror
   now, then prefer direct `@githits/mcp` consumption when the hosted server can
   adopt it; do not build a cross-language generator solely for this patch.
3. **Actual connector evaluation access.** Phase 3 needs an authenticated Claude
   connector session, but credentials must never be copied into this workspace
   or transcript. Use the already-approved connector interactively.
4. **Bootstrap necessity.** Decide after Phase 1 whether descriptor-only runs
   still show a meaningful cross-tool routing failure that `quick_start` could
   address. Recommendation: do not add a public tool if existing descriptions
   route and chain successfully. This decision gates Phase 2, not Phase 1.

## Cross-cutting considerations

- **Security:** Preserve all tool guardrails. Do not place credentials in eval
  prompts, artifacts, shell commands, or MCP configuration.
- **Compatibility:** Phase 1 descriptor edits do not change schemas or the
  15-tool stable inventory. If separately approved, Phase 2 expands the stable
  public catalog to 16 tools while preserving all existing names and schemas.
- **Performance:** No backend query or selection changes. Shorter, higher-signal
  descriptors may reduce loaded context, but do not claim a token or latency
  improvement without measuring it.
- **Evaluation isolation:** Persist the effective guidance profile and installed
  guidance artifacts in `run.json`, dry-run/session metadata, and reports.
  Persist Codex model and reasoning effort as independent comparison fields.
  Preserve current secret filtering and never serialize credential values.
- **Telemetry:** Do not add Datadog-style required `telemetry.intent` fields in
  this increment. They add schema/call overhead and observe only selected tools,
  not the tool-search misses central to this issue. Reconsider only with a
  concrete analytics question that existing request telemetry cannot answer.
- **Migration/rollback:** Descriptor changes can be reverted independently of
  schemas and services. The hosted and package copies must be rolled forward or
  back together to avoid another parity mismatch.
- **Documentation:** Update `docs/implementation/tools.md` with the durable
  tool-selection contract and `eval/agentic/README.md` with the new workload.
  Do not encode temporary rollout state in implementation docs.
- **Release:** Phase 1 adds
  `changes/remote-mcp-tool-routing.changed.md` with `patch` for both public
  artifacts. If approved, Phase 2 adds its own `.added.md` fragment with
  `minor` for both because it expands the stable MCP catalog. Do not edit
  `CHANGELOG.md` during implementation.

## Phase 1: Guidance-profile evals and description-only routing changes

### Status

REVIEW — implementation, matched local evals, durable documentation, release
fragment, and deterministic verification complete. Eight after-state Claude
cells and a final Claude rerun remain unavailable because the account exhausted
its seven-day usage allowance; this evidence gap is recorded rather than hidden.

### Expected outcome

The harness can run reproducible `descriptors`, `instructions`, and `full`
local-MCP profiles without changing tools or backend behavior. Each stable
definition carries a discriminating catalog prefix and enough
positive and negative routing context to stand alone when a host discovers only
that tool. The catalog distinguishes navigation, examples, package intelligence,
feedback, and continuation roles. The before/after comparison changes only
descriptions and argument descriptions, preserving the 15-tool inventory so its
result is attributable. Actual connector retrieval remains a Phase 3 gate.

### Assumptions

- The current `@githits/mcp` descriptors are the canonical package-side inputs.
- No existing tool schema or backend response change is needed.

### Unknowns or product decisions

None for this phase.

### Dependencies

- Existing public tool factories in `packages/mcp/src/tools/**`.
- Existing MCP instruction and agent-eval harness contracts.

### Likely files

- `packages/mcp/src/tools/search.ts`
- `packages/mcp/src/tools/search-status.ts`
- `packages/mcp/src/tools/grep-repo.ts`
- `packages/mcp/src/tools/list-files.ts`
- `packages/mcp/src/tools/read-file.ts`
- `packages/mcp/src/tools/list-package-docs.ts`
- `packages/mcp/src/tools/read-package-doc.ts`
- `packages/mcp/src/tools/get-example.ts`
- `packages/mcp/src/tools/search-language.ts`
- `packages/mcp/src/tools/feedback.ts`
- `packages/mcp/src/tools/package-summary.ts`
- `packages/mcp/src/tools/package-vulnerabilities.ts`
- `packages/mcp/src/tools/package-dependencies.ts`
- `packages/mcp/src/tools/package-changelog.ts`
- `packages/mcp/src/tools/package-upgrade-review.ts`
- Existing adjacent `*.test.ts` files, plus at most one focused routing-contract
  test if cross-tool assertions do not fit cleanly beside the factories
- `packages/mcp/src/mcp/local-server.test.ts`
- `src/commands/mcp.ts`
- `src/commands/mcp.test.ts`
- `scripts/agent-eval.ts`
- `scripts/agent-eval.test.ts`
- `scripts/agent-eval-report.ts`
- `scripts/agent-session.ts`
- `packages/mcp/src/mcp/instructions.ts` only if re-reading exposes a wording
  contradiction; do not expand it to compensate for descriptor gaps
- `eval/agentic/workloads/opencode-compaction.md`
- `eval/agentic/README.md`
- `docs/implementation/tools.md`
- `changes/remote-mcp-tool-routing.changed.md`

### Implementation steps

1. Add the guidance-profile enum to `agent:e2e` and `agent:session`, defaulting
   MCP runs to `instructions`. Validate that `descriptors` and `full` require
   `surface=mcp --server local`, and that `surface=skills` cannot accept an MCP
   guidance profile. Persist the effective profile in every run/session and
   dry-run artifact and include it in report/compare labels.
   For automated Codex evals, resolve an omitted model to `gpt-5.6-luna` and an
   omitted reasoning effort to `high`; accept explicit overrides, persist both,
   and compare both. Do not apply Codex defaults to Claude or OpenCode.
2. Add `default | none` instruction mode to the existing local MCP server and a
   hidden matching `githits mcp start` launch option. The eval
   `descriptors` profile selects `none`; all other starts retain the existing
   default. Test that `none` produces an empty MCP instruction string while
   registering the same tool names, schemas, annotations, and handlers.
3. Make `full` reuse the existing skills-workspace preparation and canonical
   `GITHITS_GUIDANCE_BLOCK` while retaining local MCP configuration. Configure
   Claude, Codex, and OpenCode to read only the isolated project guidance and
   skills plus the explicit GitHits MCP; keep unrelated user/global surfaces
   disabled. Persist installed skill and instruction paths for inspection.
4. Extend artifact extraction without changing `tool-calls.json`: write
   `discovery-events.json` for Claude `ToolSearch` request/result events when
   emitted, add an observed/not-observed/not-exposed summary to reports, and
   test that MCP calls and discovery events remain separate. Never infer host
   behavior from an absent event.
5. Before changing any descriptor, run and retain the
   baseline cohort under `descriptors` and `full` with fixed agent/model choices.
   Inspect raw discovery, tool-call, and final artifacts; do not treat aggregate
   harness success alone as the baseline.
6. Re-read all 15 current stable descriptors and schema argument descriptions as
   one catalog. Record the first 80 characters as the before-state. Remove
   generic usage preambles and duplicated operational prose only when the same
   rule remains explicit in the opening paragraph, a parameter description, or
   a response-owned action and the agent does not need it before calling.
7. Compare every descriptor's first 80 characters and opening paragraph with
   the selection matrix. Make the prefix communicate the main benefit with a
   capability verb and discriminating nouns. Follow it with “use when” and
   “do not use when” boundaries, then workflow, parameters, and recovery. Do not
   force every description to the same grammar, and do not claim that 80
   characters are all the host indexes.
8. Add open-ended investigation terms to `search` and `search.query`. Explicitly
   distinguish a user's generic “grep/find the source” request from an exact
   identifier/literal/regex request. Preserve source omission as the default so
   docs/spec evidence is not structurally excluded.
9. Reframe `search` as one ordinary call that can return complete results and
   otherwise returns an actionable response. Move the progress-state inventory
   out of the opening selection prose, retain the rule to follow `search_status`
   only when the response explicitly supplies `searchRef`, and add a concise
   description to `search.wait_timeout_ms` so the schema explains the shared
   initial wait budget without making continuation look mandatory.
10. Tighten `code_grep` around deterministic paginated exact matching and
   call-site tracing. Preserve RE2, scoping, context, indexing, and path-recovery
   behavior; do not change arguments or outputs.
11. Verify `code_files`, `code_read`, `docs_list`, and `docs_read` against their
   inventory/read roles. For every navigation tool, name the immediate prior,
   next, or alternative tool wherever a handoff exists; leave wording unchanged
   only when both the role and handoff are already explicit. Keep the 150-line
   caps and all existing recovery actions unchanged. Keep `search_status` in the
   catalog and reframe its opening to lead with the continuation benefit, then
   immediately make it conditional on an explicit prior `searchRef` from
   `search`.
12. Reframe `get_example`, `search_language`, `feedback`, and all five `pkg_*`
   descriptors where their current prefix delays the distinguishing result or
   object. Keep their existing schemas, result behavior, safety wording, and
   direct cross-tool boundaries. Re-read server instructions against the
   revised catalog and make only contradiction-removing edits; broad instruction
   expansion is out of scope because the target client ignores it.
13. Add structural tests for each changed routing contract and one cross-catalog
   test that derives stable definitions from the registry. Assert that every
   first-80-character prefix contains its tool-specific benefit terms and does
   not begin with the rejected generic user-request preamble; do not snapshot
   complete prose. When shortening `search`, move assertions for
   detailed progress/terminal taxonomy from `search.test.ts` to the continuation
   owner in `search-status.test.ts`; retain only the explicit conditional
   handoff/no-repeat contract on `search`.
14. Add `opencode-compaction.md` using the verified public target
   `github:anomalyco/opencode#v1.18.15` from the transcript. The prompt asks how
   compaction works and requests evidence, but does not tell the agent which
   GitHits tools to call. Evaluation criteria are:
   record the first content-navigation call, whether results include docs/spec
   and source evidence, whether exact follow-up uses `code_grep` and focused
   reads when needed, and whether the final answer discloses the served
   ref/commit and any fallback from default-branch intent. This local result is
   qualitative regression evidence, not connector acceptance.
15. Run the unchanged baseline cohort again under `descriptors` and `full` with
    the same agent/model cells. Compare same-profile before/after artifacts and
    investigate regressions from raw events rather than rerunning until a noisy
    result passes. Use `instructions` only as a diagnostic middle cell when a
    profile difference needs attribution.
16. Update permanent docs and add the Phase 1 patch-impact release fragment.

### Edge cases and boundaries

- `instructions: undefined` and `instructions: ""` are distinct: the former
  retains the current default guide, while the latter intentionally suppresses
  it for the `descriptors` profile.
- Guidance-profile validation must reject incompatible surface/server
  combinations instead of silently falling back to the default profile.
- Eval cohorts use the stable catalog (`experimentalTools: false`) so before
  and after runs compare the same product surface.
- A Claude run with no recorded `ToolSearch` event is not a failed discovery
  assertion. The driver may not expose the event, or Claude Code may eagerly
  receive the small isolated catalog.
- An unexpected CLI fallback in the `full` MCP profile is a tool-selection
  issue: the installed skill permits CLI only when MCP is unavailable.
- A query containing the word “grep” must not automatically imply
  `code_grep`; the presence or absence of an exact pattern is the boundary.
- Exact symbol/API lookup may route to `search` with `source:"symbol"`; tracing
  all occurrences after the symbol is known routes to `code_grep`.
- A docs topic routes to `search`; browsing the package's complete docs
  inventory routes to `docs_list`.
- An explicit path with no line region can use `code_read`, accepting the
  existing first-150-lines behavior. Unknown paths do not.
- Empty strings, empty arrays, and explicit `false` schema values retain their
  current semantics; no existing tool schema changes.
- No descriptor may claim access to local, private, uncommitted, or proprietary
  source.

### Tests and verification

Run:

```text
bun test scripts/agent-eval.test.ts packages/mcp/src/mcp/local-server.test.ts src/commands/mcp.test.ts
bun test packages/mcp/src/tools
bun test
bun run typecheck
bun run format:check
bun run lint
bun run build
(cd packages/mcp && bun run build)
bun run validate:packages
bun run validate:packages:mcp-publish
bun run plugins:generate
bun run plugins:check
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
```

Before descriptor changes, run the named cohort with Claude and
Codex under both `descriptors` and `full`, plus the bounded OpenCode cells.
Retain those artifacts as the baseline. After the changes, rerun the same
agent/model/profile/workload cells. Inspect `tool-calls.json` for the first
GitHits call, complete call sequence, source selection, and focused reads;
inspect `discovery-events.json` for any host-exposed `ToolSearch` activity; and
inspect `final.json` for `toolIssues`, `instructionIssues`, usefulness, and
evidence quality. Use the `instructions` profile only to diagnose a difference
between the two mandatory profiles. These local runs approximate guidance
presence or absence; they do not prove Claude connector behavior.

### Acceptance criteria

- The harness exposes one validated MCP guidance-profile enum. Existing MCP
  eval commands retain `instructions` as their default, and the independent
  `surface=skills` behavior remains unchanged.
- Under `descriptors`, the local server registers the same stable tools,
  schemas, annotations, handlers, and result behavior as `instructions`, but
  sends an explicit empty server-instructions string and installs no skill or
  project guidance pointer.
- Under `full`, that same MCP surface is paired with the current server
  instructions, installed GitHits skills, and canonical guidance pointer in the
  isolated workspace. Unexpected CLI fallback is reported rather than accepted
  as equivalent MCP success.
- Run/session artifacts and comparisons identify the effective surface,
  server source, guidance profile, agent, model, reasoning effort, and workload
  without recording credentials.
- Automated Codex evals with no model options use `gpt-5.6-luna` at `high`
  reasoning. Explicit overrides remain authoritative, non-Codex agents receive
  no Codex configuration, and comparisons warn on model or effort mismatches.
- Luna completes the mandatory Phase 1 Codex cohort with valid final reports and
  expected tool-family access. If it does not, stop before claiming Luna as the
  default; Sol is not used to conceal the failure.
- Claude `ToolSearch` requests/results, when the verbose driver exposes them,
  are recorded in `discovery-events.json` and never mixed into GitHits
  `tool-calls.json`. Reports distinguish observed, not observed, and not exposed;
  no pass/fail criterion assumes Claude Code or the connector must emit the
  event.
- A retained pre-change baseline exists for every mandatory cohort cell before
  descriptor edits. The after-state is compared only with the
  matching agent/model/profile/workload cell; failed or surprising runs are
  investigated from raw artifacts rather than retried until they pass.
- The selection matrix is true from each individual descriptor without relying
  on server instructions.
- Every stable tool's first 80 characters communicate its main benefit with
  tool-specific capability/outcome terms and do not begin with generic “Use
  when the user asks/needs” boilerplate. “Use when” triggers and remaining
  protocol follow the benefit. This is tested as a catalog-readability
  invariant, not asserted as the host retrieval algorithm.
- Every stable descriptor states its role. Every navigation or package
  descriptor with a workflow relationship names each immediate handoff or
  mutually exclusive alternative by exact tool name; the reciprocal descriptor
  names the reverse relationship where relevant.
- Loading any full definition adds routing boundaries and protocol without
  contradicting its catalog prefix.
- `search` describes initial-call completion before conditional continuation;
  `search_status` is visibly continuation-only.
- The descriptor catalog gives host-owned tool search explicit terms to
  distinguish an open-ended query using “grep” generically from an exact
  identifier/literal/regex task. Actual retrieval/selection is verified in
  Phase 3.
- Unit tests cover every changed positive/negative routing boundary without
  freezing incidental prose.
- Across the mandatory `descriptors` cohort, each workload reaches its expected
  tool family, reports no new descriptor-caused `toolIssues` or
  `instructionIssues`, and does not materially reduce evidence usefulness or
  confidence relative to its matching baseline. Because the tool inventory is
  unchanged, observed selection differences are attributable to descriptor or
  argument-description changes rather than a bootstrap tool.
- Across the mandatory `full` cohort, enriched installations retain their
  baseline tool accessibility and evidence quality.
- The bounded OpenCode runs record call sequences and evidence quality under
  both mandatory profiles. No local result is treated as connector proof.
- Exact grep, file listing, focused read, and docs follow-up workloads retain
  their specialized direct routes.
- All deterministic verification passes, generated plugin assets remain
  explainable, and the Phase 1 release fragment declares both public patch
  impacts.

## Phase 2: Evidence-gated `quick_start` follow-up

### Status

COMPLETE — no public tool added. Phase 1 found no definition-retrieval gap that
the bootstrap would solve; the one routing deviation happened after all
relevant definitions were loaded.

### Expected outcome

Phase 1 results determine whether descriptions alone solve tool selection and
chaining. If they do, the phase records that `quick_start` is unnecessary and
adds no public tool. If a concrete cross-tool routing gap remains and the user
approves the follow-up, `quick_start` is implemented and evaluated as an
independent catalog change, preserving attribution to the descriptor work.

### Assumptions

- Phase 1 retains matching before/after artifacts and its post-description
  results can serve as the baseline for any bootstrap comparison.
- The canonical public MCP instructions remain suitable source content if the
  bootstrap is approved.

### Unknowns or product decisions

None. Reopen this decision only if hosted connector validation records a
meaningful retrieval failure, not merely a different choice among already
loaded definitions.

### Dependencies

- Phase 1 deterministic verification and qualitative eval comparison.
- A phase-boundary `$next-steps` reorientation and explicit bootstrap decision.

### Acceptance criteria

- The decision cites specific Phase 1 tool-call and answer-quality evidence;
  missing or unexposed `ToolSearch` telemetry alone is not justification.
- If no material gap remains, the phase completes with no catalog, schema, or
  release change and records why the simpler 15-tool design is sufficient.
- If approved, `quick_start` follows the potential-bootstrap contract above,
  and its implementation detail is added after reorientation rather than
  assumed from this pre-evidence plan.
- An approved tool is evaluated against the retained post-description state as
  a separate intervention. It may be called once for genuinely unclear routing
  but does not displace direct specialist calls.
- An approved tool receives independent deterministic coverage, durable docs,
  and a separate `.added.md` fragment with minor impact for both public
  artifacts.

## Phase 3: Hosted parity and Claude connector validation

### Status

PENDING

### Expected outcome

The production remote MCP returns the accepted canonical routing descriptions,
and a fresh Claude connector session answers the OpenCode compaction prompt by
starting with discovery search, then using exact grep/read follow-ups without
needing Agent Skills or server instructions.

### Assumptions

- The hosted server exposes an equivalent stable tool inventory.
- Its descriptor layer can be updated without changing backend query behavior.

### Unknowns or product decisions

- Hosted source/deployment ownership and the permanent parity choice described
  above. Resolve both before detailing or implementing this phase.

### Dependencies

- Phase 1 accepted wording and eval evidence.
- Access to the hosted server repository/deployment process.
- An authenticated Claude connector session that does not export credentials.

### Acceptance criteria

- A complete authenticated hosted tool-list audit matches Phase 1 names,
  descriptions, argument names, and argument descriptions for the affected
  tools, or every intentional host-specific difference is documented and
  approved.
- Where the host exposes the distinction, record which definitions tool search
  retrieved separately from which MCP tools Claude invoked. If Phase 2 added
  `quick_start`, its retrieval is acceptable for an ambiguous query but it must
  not displace the correct invocation for a clear specialist control.
- The updated hosted server is deployed and its release/version provenance is
  recorded.
- Replaying the original OpenCode question in a fresh Claude connector session
  retrieves `search` directly—or, only if Phase 2 added it, uses `quick_start`
  once before `search`—surfaces docs/spec and source evidence, and uses
  `code_grep` only after exact vocabulary is known.
- Replaying an exact-pattern control prompt still selects `code_grep` directly.
- If Phase 2 added `quick_start`, a prompt asking how to choose among GitHits
  tools retrieves it, and its result names the appropriate next tool without
  relying on server instructions or an installed skill.
- Record whether the connector still misses cross-cutting workflow knowledge
  after selecting the right tool. A repeated miss is evidence for a separate
  investigation; it does not expand this descriptor increment.
- No credentials appear in committed files, eval artifacts, or review output.
- Durable hosted ownership/parity behavior is documented; temporary deployment
  instructions are not left in this plan.

Detailed Phase 3 files and commands will be added after phase-boundary
reorientation against the hosted repository and the parity decision.

## Deferred transcript findings

These are credible observations but need separate evidence and ownership. They
are not TODOs inside the descriptor implementation:

1. `code_grep` should disclose the resolved commit/ref, as `search` already
   does. Verify the current response envelope and every text/JSON/CLI consumer
   before changing API selections or output.
2. Broad grep can spend its match budget on locale bundles. Verify backend
   file-intent classification and ranking/filter semantics before proposing an
   i18n/generated change.
3. Workspace alias/symbol resolution may need a better follow-up path. First
   measure `search(source:"symbol")` on representative monorepos.
4. `search` exposes session continuation while grep exposes indexing recovery in
   an error envelope. The follow-up transcript shows this difference can create
   a false perception of mandatory extra calls even when search completes in
   one round trip. Phase 1 fixes that framing. Revisit protocol convergence only
   if post-change connector evidence still shows material avoidance or misuse;
   the current evidence does not justify a backend lifecycle change.

## Phase-boundary reorientation

After Phase 1 merges, run `$next-steps` against current `origin/main`. Record the
observed descriptor/eval evidence and decide whether Phase 2 is justified. If
`quick_start` is approved, add only the implementation detail supported by that
evidence and evaluate it independently. If it is rejected, mark Phase 2
complete without a catalog change. Before Phase 3, resolve the hosted repository
and parity decision and add only implementation detail supported by that
repository. Do not proceed from the high-level hosted sketch if its architecture
or tool inventory contradicts it.

## Completion and cleanup

The effort is complete when both package and hosted MCP descriptors implement
the same approved routing contract, the Phase 2 bootstrap decision is recorded,
the actual Claude connector and exact-grep control behave as intended,
verification passes, and durable tool-selection and parity ownership are
recorded under `docs/implementation/` in the appropriate repositories. The
completed design may remain at 15 tools; `quick_start` is not a completion
requirement. Delete this plan after transferring all lasting decisions and
evidence; plans are temporary artifacts.
