# Search semantic context and precise source reads

## Status and outcome

- Overall: IN PROGRESS; implementation authorized via `$orchestrate`.
- Phase 1: IN PROGRESS — CLI and MCP search hits show enclosing declarations,
  numbered focused source, and sufficient coordinates for an optional read.
- User direction: omit the redundant per-hit read command from text; check
  token efficiency and successful read selection with evals. The rest of the
  approach is supported. Scope marker and parameter display remain provisional.
- Product decisions: no architectural blockers. Settle the presentation choices
  with measured examples and evals before finalizing the formatter.
- Dependency: the backend structural-evidence schema must be available before
  shipping the client. Local SDL is verified; deployed availability is unknown.

### Implementation checkpoint

Runtime and deterministic verification are implemented. Comparative agent evals
are waiting for a development backend URL; neither `GITHITS_CODE_NAV_URL` nor
`PKGSEER_URL` is configured in this session. The coordinator requested the URL
before starting the transport slice. The invoked implement workflow prohibits
production verification. No authenticated backend request has been made.

Current text candidate uses `-` scope markers and omits parameters/return types;
these are provisional presentation choices, not measured winners. Per-hit read
commands are omitted as requested. Legacy JSON summaries remain for compatibility.

Verification at the implementation checkpoint:

- `bun test`: 4,027 passed, zero failed; 13,827 assertions across 195 files.
- `bun run typecheck`: passed.
- `bun run build`: passed.
- `bun run validate:packages`: passed, including root and MCP builds and
  packed-artifact validation outside workspace aliases.
- `bun run smoke:cli --mode unauthenticated`: passed (23 steps).
- `bun run smoke:mcp --mode registration`: passed (8 steps).
- `bun run smoke:cli:built`: passed (23 steps).
- `bun run smoke:mcp:built`: passed (8 steps).
- Biome checks on changed TypeScript and `git diff --check`: passed.
- These credential-free smoke modes prove registration/auth handling, not live
  backend semantic evidence. Live smokes and comparative evals are outstanding.

The original built CLI at `c9cfa8d` is preserved under the git-ignored
`.agent-eval/semantic-search/baseline-target/`; its `dev` script starts the built
Node CLI so the existing eval harness can target it with `--target-root`.
No performance or token-cost baseline has been claimed from this saved build.

Delegation: four bounded slices (core decoding, JSON propagation, parity,
smoke-validator fixtures), plus corrections within those slices. Coordinator
caught redundant normalization and a weak wire assertion; the worker corrected
both through follow-ups; the parity fixture needed an explicit tuple-bearing
type after coordinator typecheck. The third brief had omitted that typecheck;
the coordinator corrected the evidence contract. Coordinator owns the read
mapping, renderer, documentation, and eval adjudication.

Next: obtain the development backend URL, run the matched baseline/candidate
evals and presentation controls below, finish live validation, then run the one
permitted final reviewer and deliver the draft PR. Do not retire this plan or
mark the increment complete until those acceptance criteria are satisfied.

Agents should understand where a match sits and choose the smallest useful read
without a symbol lookup, guessing line numbers, or downloading whole enclosing
blocks just to render a search result.

## Verified evidence (2026-09-05)

- Backend `~/proj/githits/pkgseer-backend/priv/graphql/CHANGELOG.md`, September 5
  entry, schema hash `sha256:61e7f65a4a12`; corresponding `schema.graphql`
  `DiscoveryRepositoryEvidence`, `DiscoverySemanticContext`,
  `DiscoverySemanticScope`, `DiscoveryFocusedSource`, and
  `DiscoverySemanticPreferredRead` definitions.
- Structural evidence applies to `REPOSITORY_CODE` and `REPOSITORY_DOC`.
  Crawled `DOCUMENTATION_PAGE` and explicit `REPOSITORY_SYMBOL` return null.
- Semantic scopes are outer-to-inner, capped at eight, and contain normalized
  declaration facts, inclusive declaration ranges, and target-aware symbol refs.
  They are not source-exact signatures. Truncated chains omit outer ancestors.
- Focused source is independently nullable. Its ordered lines have absolute
  numbers, line-relative grapheme highlights, and inline truncation flags.
  Whole-line omission flags describe the 16 KiB payload bound. Missing semantic
  proof does not imply missing source; missing exact source must not be rebuilt
  from scope facts.
- Semantic metadata and preferred-read locators require no source hydration.
  Focused source, content safety, or legacy source fields trigger a batched exact
  file read. Selecting both legacy and structural source uses one union batch,
  but duplicates response content. No selection hydrates the wider read.
- `packages/core-internal/src/services/code-navigation-service.ts` owns both
  search query documents, Zod decoding, service interfaces, and normalization.
  Both result selections currently fetch `summary` and `highlights.summary`;
  neither selects structural evidence or search-hit content safety.
- `packages/mcp/src/shared/unified-search-response.ts` produces the shared JSON
  hit shape and follow-up. `unified-search-text.ts` renders CLI and MCP hits from
  that shape. It wraps legacy source summaries as prose, without line gutters.
- `follow-up-command-text.ts` already chooses proven enclosing definitions,
  pins repository reads to the served revision with repository-relative paths,
  and bounds MCP reads around evidence to 300 lines. Text currently does not
  print each hit's generated follow-up.
- `colors.ts:highlightRanges` uses JavaScript string offsets; it cannot directly
  consume the new grapheme offsets for non-ASCII source.
- Existing documentation explicitly postponed numbered search lines until the
  backend supplied per-line coordinates (`docs/implementation/tools.md`,
  repository evidence section). That prerequisite is now met in the local SDL.
- Ran the existing search formatter suite: 94 tests passed, zero failures.
  Also executed the formatter with the existing pi-mono fixture shape: its
  header shows evidence 920-930 and function 858-964, but its two summary lines
  have no coordinates. This is local fixture output, not a live backend sample.
- Existing search-output and search-recovery plans cover other remaining work;
  this proposal does not reopen their completed increments.

## Ownership and smallest design

The backend owns semantic proof, scope order, coordinates, source cropping, and
preferred-read selection. The core service owns typed transport decoding. The
existing shared MCP presentation code owns display and CLI/MCP action syntax.
Keep the new behavior in these existing owners; placing it in CLI commands would
duplicate behavior and placing rendering in core would couple transport to UX.

One increment carries the fields through service -> shared response -> shared
formatter and read-action builder. No new tool, flag, parser, auto-read, cache,
fallback query, or independent formatter framework is needed.

## Proposed presentation

Illustrative layout, not captured backend output:

```text
[1] npm:example@1.2.3 src/client.ts:142-145 [repo code]
  - class Client | lines 20-220
    - method Client.send | lines 120-165
  142 | const response = await transport(request);
> 143 | if (response.status === 429) {
  144 |   return retry(request);
  145 | }
```

The ASCII `-` marker is a candidate, not a settled choice. Compare it with
`Scope:`. A parameter-bearing candidate adds `| params: request` to the method
row; keep that separate from the marker comparison so the result is attributable.

- Keep the current ranked, locator-first header, target provenance, result order,
  pagination, lifecycle, and trust facts. For structural hits, use the focused
  source range when present. Do not repeat scope identity/ranges in the title
  when the scope rows already carry them; retain independent useful title text.
- Render all returned scopes in order with increasing indentation, kind,
  qualified path, and declaration range. Evaluate nonempty parameter names on
  method/function scopes as optional labelled metadata; do not reconstruct
  source-exact signatures or render empty parameter scaffolding. Keep parameter
  names, return types, stable symbol refs, and parent paths in JSON regardless
  of the selected text variant. Return-type text is not required by default.
- Put `... outer scopes omitted` before a truncated chain. Do not infer a
  scope from the legacy indexed chunk or associated primary symbol.
- Render returned lines verbatim in supplied order with absolute gutters.
  Do not prose-wrap, trim, renumber, or locally crop source. Long source lines
  may exceed terminal width. Wrap free prose/metadata while keeping locators
  intact, using existing formatting conventions.
- A `>` gutter marks a line with returned match highlights in plain text as
  well as color. Color additionally marks spans after converting grapheme
  offsets to JS string offsets. Apply highlights before adding crop markers.
  Do not change the offset interpretation of legacy title/summary highlighting.
- Use `... lines omitted before/after` for whole-line payload omissions and
  inline `...` markers only where prefix/suffix flags are true. If match spans
  were capped, state `Some matches are not highlighted` once for that hit.
- Nullable cases: source without scopes renders numbered source; scopes without
  source render metadata plus `Exact source unavailable` and the read locator;
  neither branch means retain the hit and existing locator/action with that
  source-unavailable notice. Never substitute a fabricated declaration body.
- Preserve existing crawled-doc and explicit-symbol presentation. Repository
  docs use structural source and scope context when returned.
- Carry backend `contentSafety` into JSON and show a compact per-hit notice
  only when filtered, including modification kinds. Do not re-sanitize source
  in a way that changes the supplied highlight coordinates.

## Precise wider reads

- Use `semanticContext.preferredRead` ahead of legacy follow-up derivation for
  structural hits, including repository docs that also have a page ID.
  This action reads source context; crawled documentation keeps `docs_read`.
- Package-attributed preferred reads use its complete registry/package/version
  tuple plus target-relative `filePath`; repository-attributed reads use
  `repoUrl` + `commitSha` + `repositoryFilePath`. Use attribution from that
  object, not original caller intent. Never substitute `requestedRef`.
- Keep the complete preferred-read locator and true scope ranges in JSON.
  Reuse the existing MCP 300-line bounding algorithm against preferred-read
  bounds and focused evidence; CLI may request the full preferred range.
- Do not print a per-hit `Read context` or `Read source` command. The header
  supplies target, path, and focused range; scope rows supply enclosing ranges.
  Verify the visible target/path pair remains sufficient for an exact read,
  especially with monorepo attribution and requested-versus-served refs.
- Preserve the existing structured `followUp` and the full preferred-read
  locator in JSON. The generated MCP follow-up stays bounded to 300 lines;
  scope ranges stay truthful even when the declaration is larger. Text agents
  choose a needed window using the existing `code_read` tool contract.
- A preferred read is not necessarily identical to the focused header range or
  a declaration range. Evals must check this distinction, rather than assume
  the header repeats every preferred-read fact. If extra information proves
  necessary, propose the smallest locator/range annotation supported by that
  evidence; do not silently reinstate a verbose per-hit command.
- No display-time network call is introduced. Without semantic context, retain
  existing safe JSON follow-up behavior and visible source locators.

## Compatibility and field selection

Add `repositoryEvidence` and `contentSafety` to the shared service/public hit
contracts; retain existing locator and legacy JSON fields in this increment.
Select all structural fields from the backend example: each has a text or JSON
consumer. Preserve null branches and explicit false flags in the new structure.

Retain `summary` and `highlights.summary` for compatibility with existing JSON
consumers and for crawled-doc/explicit-symbol text. Render only structural source
for repository code/docs. This is the backend's documented compatibility
exception: mixed results share one concrete `DiscoverySearchHit` GraphQL type,
so a type fragment cannot omit summary only for repository hits. Accept the
duplicate legacy payload to keep this additive; do not introduce split searches,
mode plumbing, or schema probes. Removing legacy JSON summary later requires
an explicit compatibility decision and is outside this increment.

Both initial and stored search-result queries select the same structural fields.
Progress responses without a result must not trigger client-side reads. Add wire tests
for initial results, stored results, and progress-only requests, and CLI/MCP
text/JSON parity. No latency or token-saving claims are made without measurement.

## Phase 1 implementation and acceptance

Status: IN PROGRESS. Outcome: agents can identify enclosing declarations and read
their intended source range directly from either search response surface.

Assumptions: the local SDL is the intended backend contract; existing JSON fields
remain supported; existing MCP read limits remain unchanged. The assumption that
header/scope coordinates suffice without a printed command must be tested.
Unknowns: deployed schema availability and real rendered result distribution
are not verified; marker/parameter choices need comparative evaluation.
Dependencies: backend schema availability for live validation/shipping; existing
service/formatter/read-action boundaries. No user product decision blocks local
implementation once this proposal is accepted.

Dispatch sequence (one Luna worker, one concern per dispatch):

1. Luna: carry the documented structural evidence through core service decoding,
   proven by isolated search/search-status wire-and-round-trip tests.
2. Luna: preserve new evidence in the shared JSON response, proven by isolated
   field-preservation tests including false/null values.
3. Coordinator: implement preferred-read attribution and bounded JSON follow-ups.
4. Coordinator: implement source/scope rendering and decide eval variants.
5. Luna: extend existing CLI/MCP parity fixtures for the settled output contract.
6. Luna: add accepted structural-text fixtures to the existing CLI/MCP smoke
   validator tests, without changing validation infrastructure.
7. Coordinator: run comparative evals, adjudicate results, finish documentation,
   validate the complete increment, and conduct the single permitted review.

The parent and worker run with full filesystem/network access. Worker briefs
therefore explicitly forbid credential access and network operations. The
coordinator handles authorized external verification. No tests/builds run in
parallel with the worker's changes.

1. Add interfaces, Zod shapes, field selections, and normalization in
   `packages/core-internal/src/services/code-navigation-service.ts`, with public
   type exports following existing core and MCP export surfaces. Validate
   positive ordered ranges and grapheme highlight pairs against the documented
   shape; retain nullable evidence rather than interpreting null as failure.
2. Extend `unified-search-response.ts` to carry structural evidence and safety
   without dropping false/null facts. Update `follow-up-command-text.ts` to use
   preferred-read attribution, bounds, and existing safe legacy behavior.
3. Extend `unified-search-text.ts` for scopes, literal numbered source, and omission
   markers, without per-hit read commands. Any grapheme conversion belongs beside
   the new source rendering; use the existing color helper with converted
   offsets, without changing legacy callers' coordinate system.
4. Update focused service, response, formatter, CLI/MCP parity, and smoke tests.
   Cover nested/truncated scopes; both independent null branches; repo docs with
   page IDs; mixed crawled docs/symbols; monorepo package-relative versus
   repository-relative paths; requested ref differing from served SHA; ranges
   of 300 and 301+ lines; Unicode combining marks and emoji; blank/indented
   lines; inline/whole-line cropping; capped highlights; safety notices; narrow
   terminals; and no follow-up service calls during rendering.
5. Run relevant `bun test` suites, typecheck, build, `smoke:cli`, and `smoke:mcp`.
   Live-smoke affected surfaces against the supporting backend when available;
   do not call unauthenticated envelope validation proof of live field support.
   Run the comparative evals below; inspect chosen ranges/revisions, final
   answers/confidence, metrics, and isolation violations. Judge usefulness only
   with a grading stage. Do not claim improvements from harness pass alone.
6. Update `docs/implementation/tools.md`, `cli-commands.md`, and
   `mcp-cli-parity.md`. Replace the now-superseded contiguous-summary limitation.
   Add an independent change fragment proposing minor impact for both public
   artifacts for the additive capability. No tool description/quick-start/skill
   changes are planned; evals must verify the existing read guidance suffices.

Acceptance: the same initial/stored hit yields equivalent CLI/MCP evidence;
every visible source line has its supplied coordinate; scope facts cannot be
mistaken for source; wider reads use correct attributed paths and exact target;
large reads preserve true block bounds and a bounded JSON follow-up; null/cropped
evidence stays honest; legacy JSON/doc/symbol consumers retain their fields;
rendering issues no additional reads; required tests and live validation pass
before shipping. If implementation approaches 1.5-2k runtime lines or requires
new infrastructure, stop and reassess scope with the user.

## Comparative evals before final presentation

Use the existing agent eval harness; no new benchmark infrastructure or product
flag is needed. Capture the current implementation's baseline before formatter
changes. Use built artifacts for performance comparisons and report the build,
agent/model, workload, served source revision, and guidance profile for each run.

- Compare the proposed no-command output with an explicit-command variant as
  an experimental control. Run the same neutral workloads and agent settings
  against both variants, checking source identity so backend drift does not
  masquerade as a presentation effect.
- Use `opencode-compaction.md` and `unified-search-investigation.md` to observe
  whether agents derive useful follow-up reads from search hits. The existing
  `code-read-window.md` already supplies lines 55-90, so it is a read-cap
  regression workload, not evidence that search coordinates are sufficient.
- Include representative returned hits with nested method scopes, available
  parameters, monorepo attribution, and declarations over 300 lines. Verify
  these shapes actually occur in the evaluated evidence. If the named workloads
  do not exercise them, add a neutral investigation workload grounded in a
  verified source example rather than asserting untested coverage.
- Compare `Scope:` with an ASCII `-` marker separately. Then compare omitted
  parameters with nonempty method/function parameter names. Do not assume a
  shorter character sequence uses fewer tokens or yields cheaper whole tasks.
- Record search-response tokens, total input/output tokens and cost, tool calls,
  read line spans, wrong-path/ref/range calls, unnecessary symbol lookups, and
  graded answer correctness/evidence sufficiency. Token reduction is useful
  only if agents still select adequate evidence; extra corrective reads count
  against any response-level saving.
- Use repeated matched runs before interpreting small differences; report
  variability and inconclusive results plainly. Do not claim a winner from one
  successful run. Default to no printed command; settle marker and parameters
  from measured token cost, observed read behavior, and the user's preference.

These evals are implementation acceptance work, not completed evidence. The
runtime candidate exists, but comparative agent evals have not run.

## Completion and review

This is one increment, so no later implementation phase is scheduled. Recheck
the backend contract and current main before starting. Ship CLI and MCP package
changes through their normal releases; hosted clients additionally require the
separate remote-mcp dependency update and deployment. Those release/deployment
steps require their own authorization and are not part of this proposal.

Review: the proposal was reviewed inline. The coordinator has inspected the
runtime and worker deltas; no reviewer agent has been launched. The fresh Orca
review run is armed as `run_e802b65640e2`. Follow the user's single-reviewer
policy, skipping the skill's additional preflight/internal/fan-out reviewers.
Live backend verification and comparative evals are not claimed. No unrelated
refactor is proposed. After implementation review, transfer durable decisions
and verification to implementation docs and delete this temporary plan.
