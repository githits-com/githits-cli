# MCP tool-surface simplification

## Status

- Overall: ACTIVE
- Current boundary: Phase 2a IN PROGRESS after internal and external plan review
- Baseline: `b2d4513` (`origin/main`, 2026-09-16; release 0.19.0 and language-tool removal merged)
- Last verified: 2026-09-16

## Problem and expected outcome

The stable MCP catalog is correct but expensive to expose. Its original 14-tool
baseline occupied 50,851 Unicode characters; Phase 1 reduced its merge catalog to
42,421 by removing duplicate structured target forms. Schemas still account for most
of the surface. Phase 3 removes the six structured `search` constraints that the
backend query language now expresses directly; the implementation has passed code
review, but subsequent production verification found a name-qualifier composition
gap described in the Phase 3 verification addendum below.

At the Phase 3 baseline, the catalog advertised both inline and structured qualifiers even though
the production backend now validates and reports inline syntax robustly. Other large
opportunities remain unsettled: code-navigation tools expose many overlapping
controls, and repeated output-format copy must not be shortened until lower-cost-agent
evals show that agents continue to omit `format` rather than selecting JSON
unnecessarily. Ask is a new intentional answer surface, not a retirement candidate.
Example-language recovery is settled: `get_example` keeps the language filter, and
`search_language` is removed.

When this effort is complete, MCP exposes one concise way to express each settled
concept, while the CLI retains human-friendly flags where they are useful. Tool
descriptors contain selection and call information that agents need; full grammar,
edge-case, and operator detail lives in the quick-start guide or durable docs rather
than being repeated across schemas. Ask remains the high-level, source-cited answer
tool, and lower-level evidence tools remain available for follow-up. Stale installed
skills that refer to `code_read` or `docs_read` can still discover the replacement
through `read`'s compatibility wording and Ask's source-pointer projection.

## Verified current state and evidence

### Catalog size and concentration

`bun scripts/agent-context-load.ts sizes` at `fe553ce` reports:

- stable catalog: 14 tools and 50,851 Unicode characters;
- `search`: 10,922 characters;
- `code_grep`: 7,227 characters;
- `code_files`: 5,672 characters;
- stable quick-start guide: 4,845 characters; and
- public `githits-mcp` skill: 5,376 characters.

These are exact serialized-content sizes, not provider token counts, runtime
performance measurements, or proof that every host retains the whole catalog. The
existing context-loading harness is the benchmark for this instruction-surface
optimization; no new benchmark infrastructure is needed.

A schema-only projection that replaced the structured target branches with the
already-advertised string branches in `search`, `code_files`, and `code_grep`, while
holding all descriptions constant, reduced the stable serialized catalog from
50,851 to 44,529 characters: 6,322 characters, or 12.4%. Phase 1 improved on that
with concise target wording; its recorded character result is not a token or cost
claim.

At the Phase 1 merge, the same inventory reported 42,421 characters for the stable
catalog and 6,441 for `search`. Canonical `@ref` guidance merged in PR #396 and moved
the current `origin/main` baseline to 42,659 catalog characters and 6,597 for
`search`. Removing only `search.category`, `kind`, `path_prefix`, `file_intent`,
`name`, and `language`, with descriptions held constant, projects the current catalog
at 40,821 characters: 1,838 fewer characters, or 4.3%. `public_only` remains because
the query language has no equivalent public-API qualifier.

### Production inline-qualifier contract

Targeted production calls through CLI 0.17.1 on 2026-09-15 verified the Phase 3
dependency against `npm:express@5.2.1`:

- `kind:function` and `category:callable` on symbol search returned the same ordered
  evidence locators as `--kind function` and `--category callable`;
- `path:lib/` and `intent:production` on code search returned the same ordered
  evidence locators as `--path-prefix lib/` and `--intent production`;
- invalid `kind:bogus`, `category:bogus`, and `intent:bogus` returned promptly with
  non-retryable `INVALID_ARGUMENT` errors and the accepted values, without a
  `searchRef` or indexing continuation;
- docs search reported all of `kind`, `category`, `intent`, `path`, `name`, and
  `lang` in `sourceStatus[].ignoredQueryFeatures` and a top-level warning;
- symbol search reported `path` and `lang` in
  `sourceStatus[].incompatibleQueryFeatures`; supported qualifiers were not reported
  as lost; and
- an unclosed qualifier quote remained a successful search with the explicit parser
  warning `Unclosed quote treated as end of query`. Client code must preserve that
  backend-owned recovery rather than adding a second parser.

The production vocabulary is already broader than the current MCP `kind` enum (for
example, the backend error advertises `unknown`, `const`, and `static`). Keeping the
full enum in the MCP schema would duplicate a drifting backend contract; the compact
descriptor should show representative qualifier examples and let backend validation
return the current accepted values.

### Pre-Phase-1 target contracts

- At the original planning baseline,
  `packages/mcp/src/tools/code-navigation-shared.ts` advertised a union of a
  five-field structured object and a compact string. `code_files` and `code_grep`
  shared that schema and resolver.
- `packages/mcp/src/tools/search.ts` extended the same object with `site`, then embedded
  the object/string union twice under singular `target` and plural `targets`.
- `packages/mcp/src/tools/code-diff.ts` independently accepted a compact string or
  package/repository objects. It is local and experimental, but it represents the
  same concept.
- `packages/mcp/src/shared/package-spec.ts`,
  `code-navigation-target.ts`, `unified-search-target.ts`, and
  `repository-target.ts` already own compact package, repository, ref, and site
  parsing. Compact code-navigation targets have been accepted since at least commit
  `5098e5f` (2026-06-05).
- The stable guide and public `githits-mcp` skill have taught compact package and
  repository targets since commit `c5a208c` (2026-08-28). No current canonical
  agent guidance tells callers to construct the structured target objects.
- The CLI intentionally has a different ergonomic surface. It parses positional
  package specs and flags such as `--repo-url`, `--git-ref`, and repeatable `--in`,
  then passes normalized values to the shared request builders.

### Compatibility and documentation

- Removing an advertised input branch is a breaking MCP schema change. A caller
  that hard-codes structured target objects must migrate to a compact string. The
  structured branch cannot remain in the advertised schema as a compatibility
  fallback without preserving the instruction cost this phase exists to remove.
- This change does not remove a tool or alter backend/service payloads. New sessions
  receive the current schema on discovery; there is no stored-data migration.
- `read` already accepts only a string target. Its description says it replaces
  `code_read` and `docs_read`, and the local Ask adapter projects backend pointers
  with those legacy names into callable `read` pointers. Those compatibility paths
  are required because installed user skills do not update automatically.
- `docs/implementation/tools.md` lists all 13 stable tools in its table, including
  `get_example`. `search_language` was removed after backend language recovery
  landed.
- `docs/implementation/unified-read.md` currently contrasts `read` with the
  structured target objects accepted by other navigation tools. That sentence will
  become stale in Phase 1.

## Scope

In scope for the overall effort:

- reducing stable and experimental MCP schema/description duplication;
- keeping CLI argument ergonomics independent where the CLI serves humans better;
- preserving output behavior and backend request semantics unless a later phase
  explicitly changes them;
- preserving CLI search flags while MCP callers use the backend query language;
- validating agent-facing changes with descriptor-only real-agent evals and the
  existing static context inventory;
- correcting current durable documentation as each contract changes; and
- recording public surface changes with independent changelog fragments.

Out of scope:

- retiring Ask, reducing the evidence depth of Ask answers, or replacing its
  lower-level follow-up tools;
- removing `read` compatibility wording for `code_read` / `docs_read`, removing the
  legacy CLI commands, or changing Ask's backend-pointer compatibility adapter;
- removing public TypeScript aliases solely for source cleanup when that does not
  reduce the agent-visible catalog;
- changing backend GraphQL/REST selections, service URLs, transport, auth, result
  formats, or text-output content beyond required callable-coordinate hint migrations;
- adding aliases, hidden fallback schemas, feature flags, or rollout machinery;
- changing hosted production, publishing packages, deploying `remote-mcp`, or
  merging a release without the separately required authorization; and
- claiming token, cost, or model-quality improvement from character counts alone.

## Target architecture and ownership

The MCP surface owns agent-call ergonomics. It should accept compact target strings
and one query string containing search qualifiers. The CLI owns human command-line
ergonomics and may keep positional specs and explicit flags. Shared client parsers
own target normalization and CLI flag adaptation; the backend query boundary owns
inline qualifier grammar, validation, source compatibility, and recovery. Services
remain thin data-access adapters.

```text
MCP compact target string
  -> existing shared target/package parser
  -> existing request builder and validation
  -> unchanged service interface and backend request

CLI positional spec and flags
  -> existing CLI parsing
  -> same request builder and validation
  -> unchanged service interface and backend request

MCP search query with inline qualifiers
  -> existing client request builder (required trim only)
  -> backend parser and per-source compiler
  -> typed validation or results with compatibility metadata

CLI search flags
  -> existing shared request builder
  -> existing structured filters / compiled name and language qualifiers
  -> same backend search operation
```

This is the right ownership boundary because target syntax is client input
normalization, while search-query syntax must behave identically for every client and
source lane. Parsing qualifiers in MCP would duplicate the production backend parser
and its evolving enum vocabulary. Removing CLI flags would make the human surface
worse without reducing MCP context, so the shared request builder remains their
adapter rather than becoming MCP-visible.

For guidance ownership:

- tool name plus first description sentence owns tool selection;
- the selected tool's input schema owns the minimum call contract and representative
  examples;
- `quick_start` and its exact public skill copy own cross-tool routing and shared
  target syntax; and
- durable implementation docs own exhaustive behavior, compatibility, and rollout
  detail.

The completed migration state is one compact target grammar per target family on
MCP, with no structured-coordinate alternative for the same concept. Different
tools may still constrain that grammar: for example, latest-only package health,
versioned vulnerability inspection, and changelog ranges are different operations.
Those constraints belong in their request adapters/builders rather than in parallel
addressing shapes.

## Decisions, assumptions, and unknowns

### Product decisions

1. Compact target strings are the desired MCP addressing form. CLI flags may remain.
2. Ask remains. Its intended role is to spend the necessary tokens on the best
   source-cited answer; lower-level tools remain valid for follow-up evidence.
3. `read` must keep an explicit `code_read` / `docs_read` migration signal because
   installed user skills can remain stale. Ask's pointer projection also remains.
4. Language remains a supported `get_example` filter. Backend recovery is live;
   the separate discovery tool was removed in merged Phase 5 (PR #399).
5. Repeated `format` documentation is not shortened without matched eval evidence
   from lower-cost agents showing that the shorter surface does not increase
   unnecessary `format: "json"` calls.
6. MCP `search` uses inline `kind:`, `category:`, `path:`, `intent:`, `name:`, and
   `lang:` qualifiers exclusively. The CLI retains its structured flags. The backend
   owns qualifier validation and per-source compatibility reporting.
7. Navigation-control consolidation requires a separate product discussion.

### Assumptions

- Current compact parsers are the canonical grammar and remain backend-compatible.
- Current public guidance is sufficient migration evidence for Phase 1; hard-coded
  structured-object callers are accepted breakage and will receive an explicit
  release note.
- Stable `search.target` and `search.targets` remain separate in Phase 1. A string-or-
  array union would replace one visible XOR with another JSON Schema union, while
  forcing arrays would make the common single-target call worse. Field-count changes
  can be reconsidered with call evidence later.
- Phase 1 changes no network operation or selected backend field.

### Later-phase unknowns

- Package tools: upgrade-review single/batch MCP representation remains later work;
  its existing CLI `@current..target` spelling is verified. Changelog exact-release
  selection and upper-tag snapshot behavior need backend support. Neither blocks
  the four package-coordinate tools in Phase 2a.
- Navigation: which path, intent, context, and result-limit controls real callers
  need, including whether singular/plural variants should collapse. Resolve through
  product discussion and observed call shapes before Phase 4.
- Language: backend fail-fast recovery with up to five canonical names is live;
  `search_language` is removed.
- Format copy: the shortest wording that keeps lower-cost agents on default text.
  Resolve with a matched candidate eval before Phase 6 accepts a copy change.
- `search_status`: its long-term continuation boundary is not settled by this plan.
  Do not remove or merge it without a separate product decision.

None of these later unknowns blocks Phase 2a.

## Cross-cutting constraints

- **Security:** Compact target parsers retain the existing rejection of credentials
  and unsupported repository inputs. Inline qualifiers remain untrusted query text
  validated by the backend; MCP must not interpret or execute their contents.
  Descriptions must not weaken the public-only scope or external-content posture.
- **Performance:** This is instruction-surface optimization, not a runtime hot-path
  change. Use the existing context inventory for before/after content size. Do not
  create a second benchmark or infer provider token savings. Phase 3 adds no network
  calls; it changes the shape of an existing search request.
- **Compatibility:** Phase 1 deliberately breaks structured MCP target objects and
  preserves compact strings, CLI inputs, service interfaces, outputs, legacy read-name
  routing, and Ask source projection. Use a pending minor fragment for both public
  artifacts, following the established pre-1.0 breaking-surface convention recorded
  in the repository's prior removal and public-contract plans.
- **Migration:** Release notes must show direct conversions such as
  `{registry:"npm",package_name:"express",version:"5.2.1"}` to
  `"npm:express@5.2.1"` and `{repo_url:"https://github.com/expressjs/express",
  git_ref:"main"}` to `"github:expressjs/express@main"`. They must also show the
  search-only conversion `{site:"https://expressjs.com/"}` to
  `"site:https://expressjs.com/"` or its canonical equivalent
  `"site:expressjs.com"`. No server-side dual-schema period is planned.
- **Phase 3 compatibility and migration:** Removing six advertised MCP fields is a
  breaking schema change for hard-coded callers. Migrate `kind:"function"`,
  `category:"callable"`, `path_prefix:"lib/"`, `file_intent:"production"`,
  `name:"Router"`, and `language:"typescript"` into `search.query` as
  `kind:function`, `category:callable`, `path:lib/`, `intent:production`,
  `name:Router`, and `lang:typescript`. Backend `AND` composition is the intended
  contract; the post-implementation name-composition gap is recorded below.
  CLI flags and `public_only` are unchanged. Record a pending minor for
  both public artifacts; do not preserve hidden MCP aliases or client-side fallbacks.
- **Rollback:** Reverting the release restores the prior schema. No stored state or
  backend migration is involved.
- **Testing:** Schema shape, parsing, normalized service calls, error envelopes,
  stable/local registration, smoke behavior, and real-agent argument shapes all need
  evidence. Existing service mocks remain sufficient.
- **Operations:** The required backend contract is deployed. Hosted MCP clients change
  only after `@githits/mcp` is released, adopted by `remote-mcp`, and deployed. Those
  are separate repositories/actions and are not authorized by implementation of this
  plan.
- **Documentation:** Update current contracts, not immutable historical eval records.
  Keep stable `buildMcpQuickStart()` and the public skill's terminal guide byte-aligned
  if either needs to change. Generated plugin assets are never edited directly.

## Phase map

1. **Phase 1 — compact code and discovery targets (MERGED):** `search`,
   `code_files`, `code_grep`, and experimental `code_diff` advertise and accept only
   compact string targets; CLI/service behavior and legacy read routing stay intact.
2. **Phase 2 — compact package-tool coordinates (PARTIALLY READY):** Phase 2a migrates
   `docs_list`, `pkg_info`, `pkg_vulns`, and `pkg_deps` together. Phase 2b changelog
   waits for verified backend exact-release/snapshot support; Phase 2c upgrade review
   follows later reorientation. CLI ergonomics and service contracts stay intact.
3. **Phase 3 — one MCP search-filter language (MERGED):** the six backend-supported
   inline qualifiers replace their duplicate MCP fields while CLI flags and
   `public_only` remain.
4. **Phase 4 — essential navigation controls only (PENDING):** `code_files` and
   `code_grep` expose one non-overlapping control for each verified caller need.
5. **Phase 5 — actionable example-language recovery (MERGED, PR #399):**
   `get_example` keeps language filtering. Unresolved languages fail before
   generation and return up to five canonical retry names. `search_language` and
   `githits languages` are removed.
6. **Phase 6 — concise answer/output routing copy (PENDING):** Ask remains the
   high-level answer tool, its boundary with evidence tools is concise, and repeated
   format guidance shrinks only after lower-cost-agent evals show no JSON-selection
   regression. `search_status` changes only after its separate product discussion.

Later-phase order may change during reorientation if product decisions arrive in a
different order. The destination and constraints stay fixed; only the current ready
phase has tactical implementation detail.

## Phase 1: compact code and discovery targets

**Status:** MERGED — `dc148c5` (PR #395)

**Expected outcome:** Stable code/discovery tools and local experimental diff expose
only compact target strings. Their normalized service requests, success/error output,
and CLI counterparts are unchanged. The stable serialized catalog is at most 44,529
characters before counting any additional reduction from concise copy.

**Assumptions:** The existing compact package/repository/site parsers remain the
canonical syntax; current skill and quick-start examples remain correct; separate
`search.target` and `search.targets` fields remain useful.

**Unknowns or product decisions:** none.

**Dependencies:** Existing target parsers, request builders, context inventory,
tool/service mocks, smoke suites, and agent-eval harness. No backend change.

### Behavioral contract

- `search.target` accepts one nonempty compact package, repository, or exact
  documentation-site string.
- `search.targets` accepts up to 20 of the same strings. Preserve current blank-entry
  handling, exact deduplication, order, mixed target types, and the error when both
  singular and plural fields are meaningfully supplied.
- `code_files.target` and `code_grep.target` accept one compact package or public
  repository string. Site targets remain invalid for code navigation.
- `code_diff.target` accepts one unversioned compact package or repository string;
  `from` and `to` remain the version/ref endpoints. Embedded package versions or
  repository refs remain invalid because they conflict with those endpoints.
- Structured target objects are absent from the generated JSON schemas and rejected
  before a handler/service call.
- Compact strings continue to normalize through the existing shared parsers into the
  same `registry`/`packageName`/`version` or `repoUrl`/`gitRef` service values.
- Whitespace-only strings still produce the existing mapped `INVALID_ARGUMENT`
  behavior from shared validation rather than reaching a service.
- Tool names, annotations, result formats, backend selections, wait behavior,
  pagination, and filtering are unchanged.

### Implementation boundaries and likely files

1. In `packages/mcp/src/tools/code-navigation-shared.ts`, keep the existing
   `codeTargetSchema` and `resolveCodeTarget` ownership but narrow both to strings.
   Remove `structuredCodeTargetObject`, `structuredCodeTargetSchema`,
   `StructuredCodeTargetArg`, object normalization, and object-only error branches.
   Do not introduce a replacement adapter layer.
2. In `packages/mcp/src/tools/search.ts`, narrow `SearchArgs.target` and
   `SearchArgs.targets` to string forms, remove the structured search schema/type and
   object resolution branches, and continue to call
   `parseUnifiedSearchTargetSpec()` before `buildUnifiedSearchParams()`. Keep the
   singular/plural request-builder contract unchanged.
3. In `packages/mcp/src/tools/code-diff.ts` and
   `packages/mcp/src/shared/code-diff-request.ts`, narrow the MCP target type/schema
   to string and delete the structured MCP target parser. Keep the CLI request path
   and `buildCodeDiffParams()` unchanged.
4. Tighten only target-related descriptor copy in `search`, `code_files`,
   `code_grep`, and `code_diff`. Preserve each stable tool's tested first sentence and
   first-80 routing prefix unless a measured routing need requires a change. Give a
   package, repository, and—only for search—site example; keep full edge-case grammar
   in shared guidance/docs instead of repeating it in every field.
5. Do not change `read`, Ask, `search_language`, package-tool inputs, search filters,
   navigation controls, or repeated `format` copy in this phase.

### Tests and verification

Update behavior tests rather than deleting their coverage:

- `packages/mcp/src/tools/search.test.ts`: replace structured inputs with compact
  equivalents; retain package/repository/site, mixed multi-target, blank, duplicate,
  invalid, and target/targets conflict cases; assert normalized service parameters.
  In particular, prove that `site:https://expressjs.com/` and
  `site:expressjs.com` normalize to the same exact site target.
- `list-files.test.ts` and `grep-repo.test.ts`: replace structured package/repository
  calls, retain version/ref parsing and invalid-target error coverage, and assert no
  service call on failure.
- `code-diff.test.ts` and `shared/code-diff-request.test.ts`: replace MCP object cases
  with strings, retain unversioned-target enforcement and endpoint parsing, and leave
  CLI target/repo-url tests unchanged.
- `src/tools/list-files-parity.test.ts`, `grep-repo-parity.test.ts`, and
  `code-diff-parity.test.ts`: keep the CLI side on its existing positional/flag
  inputs, convert only the MCP side to compact strings, and retain equality of the
  normalized service request and result/error envelopes.
- `src/mcp-public-surface.test.ts`: replace direct registered-handler object calls
  with compact strings while preserving auth/action and public-factory assertions.
- `scripts/cli-smoke.ts`: convert the MCP-side `code_files` and `code_grep` targets
  to the existing compact `SMOKE_PACKAGE_SPEC`; keep the CLI arguments and the
  structured `docs_list` MCP arguments unchanged. This file drives both source and
  built CLI smoke parity.
- `eval/agentic/context-loading/fixture-server.test.ts`: replace the current
  over-the-wire string/object equivalence assertion with an MCP client invalid-params
  assertion for the removed object form, and prove it cannot return the fixture's
  successful handler result. This is the protocol-level proof that SDK validation
  rejects the removed schema branch before useful handler/service work.
- `mcp/server.test.ts` and `mcp/local-server.test.ts`: assert generated `target` items
  are strings, `search.targets.items` is a string, and the schemas contain none of
  `registry`, `package_name`, `version`, `repo_url`, or `git_ref` as nested target
  properties. In the local-server test, also convert the direct experimental
  `code_diff` handler call to `"npm:express"` while retaining provider resolution and
  normalized service-call assertions. Keep stable/local inventory and first-sentence
  contracts intact.
- `packages/mcp/src/smoke-test.ts` and `smoke-test.test.ts`: convert the shared
  target usage without converting the existing structured `SMOKE_PACKAGE_TARGET`,
  which must remain for `docs_list`. Add a separate compact code/discovery constant
  such as `npm:express@${SMOKE_PACKAGE_VERSION}` for the seven `search`, `code_files`,
  and `code_grep` calls. Preserve the already-compact `read` calls, package-tool
  objects, deterministic expectations, and all service/output assertions. Update any
  other smoke fixture that still calls a removed object form.

Run, at minimum:

```text
bun test
bun run typecheck
bun run lint
bun run build
bun run validate:packages
bun run plugins:generate
bun run plugins:check
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
bun scripts/agent-context-load.ts sizes
```

Inspect all generated diffs; if canonical plugin inputs did not change, generated
assets must not acquire unexplained content changes. Live-capable smoke failures due
to auth/backend state must be reported with the successful unauthenticated or
registration evidence rather than hidden with retries.

Run targeted local MCP descriptor/intent evals for both Codex and Claude when
practical, covering:

- `unified-search-investigation.md`;
- `code-files-listing.md`;
- `code-grep-investigation.md`; and
- `experimental-code-diff.md` for the local experimental catalog.

Inspect `tool-calls.json`, raw tool results, `final.json`, `metrics.json`, and
`isolation-violations.json`. Acceptance requires string target arguments for every
changed tool, no schema-validation fallback to object forms, no futile retries caused
by the schema change, and no isolation violations. Self-reported success/confidence is
evidence to inspect, not a quality grade. If credentials or service availability
prevent live calls, report that limitation; deterministic schema, unit, smoke, and
package validation remain required.

### Documentation and release record

- Update the current tool table and registration sentence in
  `docs/implementation/tools.md`, including the already-verified 14-tool inventory.
- Update the current-contract sentence in `docs/implementation/unified-read.md` and
  the structured/string `codeTargetSchema` statements in
  `docs/implementation/tools.md` and `mcp-cli-parity.md`, plus any other current
  target-schema statement in `repository-targets.md`. Preserve dated historical
  measurements and tool-call records as history.
- The stable quick-start and public MCP skill already teach compact targets. Change
  them only if the new selected-tool contract would otherwise be incomplete; if
  changed, keep their terminal guide sections byte-identical and follow the public
  Agent Skill lifecycle.
- Add one independent `changes/<unique-name>.changed.md` fragment with pending
  `minor` impact for both `githits` and `@githits/mcp`. State the breaking object-to-
  string migration, including package, repository, and search-site conversions, and
  state that CLI syntax is unchanged. Do not edit `CHANGELOG.md`.

### Phase 1 acceptance criteria

1. Generated stable schemas for `search`, `code_files`, and `code_grep`, plus the
   local `code_diff` schema, advertise no structured target object alternative.
2. Every valid compact package/repository/site behavior and normalized service call
   remains covered; invalid strings and conflicting search fields make no service
   call and return the expected error class/envelope.
3. CLI command schemas and behavior are unchanged, and all source/built CLI and MCP
   smokes pass in their applicable modes.
4. `read` still advertises its `code_read` / `docs_read` replacement role, and Ask's
   pointer projection tests remain unchanged and passing.
5. The context inventory reports a stable `catalog.full` no larger than 44,529
   Unicode characters, with the exact before/after reduction recorded without a token
   claim.
6. Targeted agent traces use compact string targets without schema errors or object
   fallback; evidence limitations are explicit.
7. Durable docs describe the new contract, current tool inventory is internally
   consistent, and the minor/minor change fragment gives direct migration examples.
8. Internal and external review are clean under the repository review policy.

### Phase 1 implementation record

The implementation is complete on branch
`jlitola/audit-tool-surface-simplification` in five commits:

- `21af3575` narrows MCP schemas/resolvers and migrates protocol, parity,
  public-surface, and smoke callers;
- `8f8d96a` tightens target copy, corrects durable contracts, and adds the
  minor/minor migration fragment;
- `2d84d64` redirects current legacy-read skill guidance to unified `read`;
- `6909f63` corrects the experimental CodeDiff contract wording; and
- `cfdf375` keeps repository providers discoverable once in shared guidance and
  replaces a duplicate invalid-input fixture with whitespace coverage.

Verification evidence:

- focused implementation suites passed 122 and 210 tests respectively; the
  post-copy descriptor/server suite passed 111 tests;
- `bun test` passed 4,752 tests across 210 files with 0 failures;
- `bun run typecheck`, `bun run lint`, `bun run build`, and
  `bun run validate:packages` passed. Lint retained 12 pre-existing warnings in
  the unchanged repository-target parser and one pre-existing test style note;
- `bun run plugins:generate` produced no derived diff and
  `bun run plugins:check` validated all 10 generated assets;
- source MCP live smoke passed stable and experimental cohorts, including compact
  string calls for every changed tool; source CLI unauthenticated smoke and both
  built smoke modes passed;
- the source CLI live smoke completed 56 steps before one Express documentation
  response lacked its expected repo-backed page fields. The exact follow-up
  returned 130 pages with 18 complete repo-backed pages, and the subsequent MCP
  live smoke passed the same documentation contract. This is recorded as variable
  backend evidence, not hidden by a retry;
- stable `catalog.full` fell from 50,851 to 42,421 Unicode characters, a reduction
  of 8,430 characters (16.6%). The first-80 catalog remained unchanged. Shared
  provider discovery added 10 characters to the quick-start guide and public
  skill; no token or cost reduction is inferred from these character counts;
- the Claude descriptor-only intent run completed all four targeted workloads
  successfully with high confidence, 18 MCP calls, no CLI fallback, no object
  targets, no reported failed calls, and empty validation-violation arrays. The
  matched Codex 0.154.0 Luna/high run also completed all four workloads
  successfully with high confidence, 32 MCP calls, no CLI fallback, compact string
  targets in every affected tool call, no reported failed calls, and empty
  validation-violation arrays; and
- Luna pre-flight was clean after two current-guidance corrections. The internal
  code review's only finding was a stale CodeDiff documentation phrase, fixed in
  place. The external Opus round found no code defects and two minor copy/test
  hygiene issues; both were fixed, so the round is clean under repository policy.

PR #395 merged to `origin/main` as `dc148c5` on 2026-09-15. The post-merge Main,
Agent Evals, root release, and MCP release workflows passed. Root and MCP publish,
tag, and GitHub Release steps were skipped because package versions were unchanged,
so the Phase 1 contract is merged but not yet published to npm or deployed through
the separate hosted `remote-mcp` release path. The pending minor/minor change
fragment remains the release record.

Current target-facing guidance now has one ownership path: schemas state the
compact accepted form and representative examples, shared quick-start/skill text
names all supported repository providers once, and durable docs retain exhaustive
grammar and compatibility detail. Remaining `code_read` / `docs_read` references
are deliberate migration signals, backend contracts, or dated evaluation history.

## Remaining phases

### Phase 2: compact package-tool coordinates

**Status:** Phase 2a IN PROGRESS; Phase 2b BLOCKED ON BACKEND; Phase 2c PENDING

**Expected outcome:** `docs_list`, `pkg_info`, `pkg_vulns`, `pkg_deps`,
`pkg_changelog`, and `pkg_upgrade_review` expose compact package/repository/range
coordinates without changing their evidence or output semantics.

**Assumptions:** The shared package parser remains canonical; CLI positional specs and
flags remain; latest-only tools reject embedded versions actionably.

**Unknowns or product decisions:** none for Phase 2a. Phase 2b requires verified
backend exact-release/ref-kind/source selection and a later decision on open-ended
repository intervals. Phase 2c needs its single/batch MCP representation settled;
reuse the existing CLI interval spelling. Canonical `@ref` is merged.

#### Phase 2a: one four-tool package-coordinate increment

**Expected outcome:** `docs_list`, `pkg_info`, `pkg_vulns`, and `pkg_deps` each
advertise one required string `target`, with no `registry`, `package_name`, or
`version` input field. Options, normalized service calls, backend selections, and
CLI syntax remain unchanged. Output is unchanged except that `docs_list` retry
hints use the new callable target syntax. No backend deployment is needed.

**Assumptions, verified during planning:** `parsePackageSpec()` already handles
explicit registries case-insensitively, scoped npm names, Maven coordinates, and
last-`@` version splitting. Existing request builders own registry availability and
version normalization, including Go's `v` prefix. Existing CLI `pkg info` rejects
version pins. The stable guide already teaches canonical compact package targets;
its CLI-facing public skills need no behavior-dependent change for this MCP-only
migration. No new parser, adapter layer, compatibility alias, or strictness policy
is needed.

**Dependencies:** Existing canonical package parser, four request builders,
service mocks, SDK registration/fixture transport, source/built smoke suites,
context inventory, and descriptor-only agent-eval harness. Phase 1, Phase 3,
canonical refs, and Phase 5 are merged. Changelog backend work is not a dependency.

**Behavioral contract:**

- `docs_list`, `pkg_vulns`, and `pkg_deps`: `registry:name[@version]`; omitted pin
  retains latest lookup. Preserve pagination, severity/advisory filters, graph depth,
  explicit `false` values, detailed-mode fetching, and all current validation.
- `pkg_info`: latest-only `registry:name`. An embedded version returns mapped
  non-retryable `INVALID_ARGUMENT`, tells the caller to omit the pin, and makes no
  service call. Do not silently discard versions.
- Trim the target before calling `parsePackageSpec()`, then pass parsed
  `registry`, `name`, and (where supported) `version` to the existing builder.
  Parsing belongs to that shared canonical parser; MCP handlers own adaptation to
  their existing operation. Adding a second package-target helper would only wrap
  one existing call, so use direct imports instead.
- Empty/whitespace targets, missing registry/name, trailing `@`, and unsupported
  registries fail through the existing mapped error envelope without service calls.
  Repository/site/read locators are not package coordinates for these tools.
  Preserve actionable `VERSION_NOT_FOUND` details and availability restrictions.
- Schemas stay permissive strings so domain failures reach mapped handler errors.
  Missing required `target`/object target forms fail SDK validation. Unknown fields
  retain existing SDK stripping behavior; do not add global rejection or aliases.
- Preserve tool names, first selection sentence/first 80 characters, annotations,
  other arguments/defaults, output-format copy, service interfaces, and wire fields.
  Update only coordinate-related descriptor prose and examples.

**Planning evidence and comparison:** At `b2d4513`,
`bun scripts/agent-context-load.ts sizes` reports 13 tools, `catalog.full` 39,635
Unicode characters, and definitions of 1,564 (`docs_list`), 2,285 (`pkg_info`),
3,704 (`pkg_vulns`), and 3,660 (`pkg_deps`): 11,213 combined. Re-run this exact
inventory after migration; require a reduction in both the four-tool subtotal and
full catalog, with unchanged selection-prefix catalog. These are content-size
measurements, not provider token/cost/performance claims. The bounded baseline
command covering the four tool tests and four root parity tests passed 127 tests,
393 assertions, zero failures (9.81 seconds) on 2026-09-16.
**Delivered implementation and ownership:** Coordinator implemented the four
handler adapters, latest-only error policy, coordinate descriptor copy, retry hint,
durable docs and independent minor/minor fragment. One `luna_implementor` delivered
14 sequential bounded slices: the planned 12 (four schemas/unit callers, four parity
files, catalog contracts, runtime fixture, shared MCP smoke and CLI smoke fixtures),
one missed direct-smoke caller and one test-typing correction. Every return was
inspected and its exact proof rerun independently. No worker interruptions. The
final type check required one correction dispatch; the missed caller was a
coordinator ownership-trace omission. No new helper, alias, strictness
policy, backend wire field or CLI command change was introduced.

Per-file passing tests/assertions: docs 24/55, info 25/98, vulnerabilities 42/109,
dependencies 39/124; root parity docs 4/8, info 6/25, vulnerabilities 20/59,
dependencies 24/62; catalog 11/302; runtime fixture 2/77; shared MCP smoke 79/166;
CLI smoke-script tests 79/152. Exact normalized requests and unchanged controls
are asserted, not inferred from matching mock outputs. The docs happy parity
previously compared a pinned CLI input with an unpinned MCP input; both now use
the same pin and assert the two exact service calls.

Final consistency audit found and migrated two direct `pkg_info` authentication
probes in `scripts/mcp-smoke.ts` outside the shared smoke fixtures. Both actual
arguments and labels now use `target: "npm:express"`.
`bun run scripts/mcp-smoke.ts --mode registration` passed independently, including
stable compact-target `AUTH_REQUIRED` handling and experimental registration.

The first full type check caught static typing gaps in the new test assertions:
readonly catalog tuples and zero-argument mocks inferred incompatible call tuples.
A bounded test-only correction preserved assertion values while typing captured
request parameters and copying the readonly property tuple. `bun run typecheck`
now passes independently; the catalog and four parity files also pass 65 tests,
456 assertions (9.52 seconds). No handler change.

Local full-suite evidence: `bun test` ran 4,799 tests in 206 files: 4,785 passed,
14 existing subprocess tests exceeded their original deadlines, with three
cleanup-related unhandled errors (517.60 seconds). All failing files were
unchanged. Narrow rerun of the six affected files passed 122 tests with six
timeouts; rerunning only those remaining three files then passed 68 tests,
483 assertions, zero failures (103.72 seconds) at unchanged deadlines. No
test timeout, retry, or runtime workaround was added. Evidence is preserved in
`/tmp/phase2a-subprocess-rerun.log`; the full local suite has not been claimed green.
PR CI will supply the required full-suite result on clean Linux and Windows hosts.
A local-only `--help` diagnostic against an archived `origin/main` with the same
dependencies and environment succeeded on both versions: baseline 1,496/1,131 ms,
current 3,835/1,566 ms. This shows variable startup latency, not an established
root cause or a release-build performance measurement.

Final checks so far: `bun run format:check` passed 525 files; `bun run lint`
passed with eight pre-existing warnings in unchanged `repository-target.ts`;
`bun run build` passed; `bun run validate:packages` passed, rebuilding both public
packages and checking packed consumer/runtime/type boundaries. An attempted
standalone MCP build with misplaced Bun `--cwd` printed help despite exit 0 and
is not counted as proof; the validator ran its real build from the package directory.

Secret-free source `bun run scripts/cli-smoke.ts --mode unauthenticated` and
`bun run smoke:cli:built` / `bun run smoke:mcp:built` all passed stable and
experimental checks. Built MCP includes compact-target `AUTH_REQUIRED` handling.
Local built CLI/MCP durations were 163.8/17.7 seconds, exceeding the existing
combined CI 120-second budget; do not claim that budget passed locally. The final
CLI commands warmed to sub-second launches, consistent with host variability;
clean-host CI remains the required timing/full-suite result. No deadline was changed.

Authenticated live validation is currently blocked in local macOS Keychain access,
not in the backend or package parser. A one-second sample of the coordinator-owned
CLI subprocess (cwd this worktree, own smoke parent chain) shows native keyring
`SecKeychainFindGenericPassword` waiting in Security server IPC before fetch.
No credential values were read or printed. The user was asked to approve an
existing Keychain prompt, if present. No credential-store reset, new fallback,
discovery flag, retry, or timeout workaround was added.

The first descriptor-only Codex run is incomplete and must not count as passing:
docs discovery returned inconclusive/low with zero calls; filtered vulnerabilities
left the isolated workspace to read repository skills and attempted CLI fallback,
producing isolation violations. This was deliberate external file access, not
automatic host-skill discovery: fresh app-server `skills/list` exposed only bundled
system skills. The overview recorded valid compact `pkg_info`/`pkg_vulns` calls
that did not return before timeout; no complete aggregate metrics/report was
produced. Claude Haiku likewise submitted those two compact MCP targets but timed
out at 302.3 seconds. Its metrics report marks usage/logical telemetry unknown.
Preserve `.agent-eval/runs/phase2a-codex-low-20260916-1254` and
`.agent-eval/runs/phase2a-claude-haiku-probe-20260916-1254`; these are failed/blocked
validation evidence, not answer-quality or token-savings claims. Two tiny timeout
cleanup probes both completed normally, so no hypothesized harness timer fix was made.

**Measured result:** The same `bun scripts/agent-context-load.ts sizes` command
now reports 1,440 (`docs_list`), 2,211 (`pkg_info`), 3,315 (`pkg_vulns`), and
3,354 (`pkg_deps`): 10,320 combined, 893 fewer characters (8.0%). `catalog.full`
is 38,742, down 893 (2.3%). The 1,207-character first-80 catalog and SHA-256
`32000890e73be46ca020ce4b858c2098cdd97ca1807ec8c8a5899de307f97be8`
are unchanged. Accurate ecosystem/version guidance is retained; these character
reductions are not token/cost/performance claims.

**Acceptance and final verification:**

Implementation pre-flight (2026-09-16): accepted and corrected two minor wording
findings in this expected outcome and the release fragment, explicitly accounting
for the migrated `docs_list` retry hint. No interface finding. Full CI, authenticated
smoke, completed agent evals, and code review remain outstanding; pre-flight does
not establish those gates.

Internal code review (2026-09-16): fresh `code_reviewer` inspected the complete
Phase 2a delta and reported no findings, with no edits or extra validation. It
retained the full-CI, authenticated-smoke, completed-eval and local built-smoke
budget gaps above. External Opus round 1 is pending. Its first transport-accepted
dispatch had an empty composer and no review work; that dispatch was fenced and
the same reviewer terminal received one recovery task. That task was transport-
accepted but still has no agent transcript; terminal access returned a stale handle
despite the worker projection reporting live. External review is unproven, not
clean. Preserve this increment in a draft PR for CI while review/live/eval gates
remain open. No duplicate reviewer or speculative Enter submission.

1. Generated schemas and over-the-wire client calls prove the four tools require
   string `target` and advertise none of the removed coordinate fields. Registered
   stable/local inventories remain 13 stable tools; selection-prefix contracts pass.
2. Tool and parity tests prove exact normalized service parameters for latest,
   pinned, scoped npm, representative non-npm and Go/Swift cases; malformed targets
   and `pkg_info` pins never call services. Existing output/error and over-fetch
   controls remain covered rather than deleted.
3. Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, and
   `bun run validate:packages`. Run source `bun run smoke:cli` / `smoke:mcp` plus
   `smoke:cli:built` / `smoke:mcp:built` because shared smoke calls change. Project
   guidance requires safe authenticated read-only live smoke where available;
   never print credentials and report backend/auth limitations separately.
4. Re-run the named context inventory against the above baseline; record exact
   per-tool/subtotal/catalog reduction and unchanged first-80 prefix size/hash.
5. Run local MCP descriptor-only Codex evals with targeted workloads
   `docs-discovery.md`, `package-overview-vulnerabilities.md`,
   `package-vulnerability-filter.md`, and `package-dependencies.md`; use Claude
   when practical. Inspect actual calls/results, final neutral answer/confidence,
   metrics, and isolation violations. Require compact arguments for changed tools,
   no schema fallback/futile retry caused by migration, and no isolation violations.
   Do not claim answer quality without a grading stage; disclose auth limitations.
6. Current instructions, schemas, examples, hints, smokes and durable docs agree.
   `pkg_changelog` and `pkg_upgrade_review` remain explicitly structured pending
   their later increments; do not claim all package tools have migrated. CLI inputs,
   historical changelog and public artifact versions remain unchanged. Add a
   minor/minor fragment; run `bun run plugins:generate` / `bun run plugins:check`
   under plugin-maintenance guidance and require no unexplained generated changes.
7. Fresh Luna pre-flight, internal code review, then one external Opus reviewer per
   round are clean under project policy. Keep the active overarching plan through
   PR review; update it with actual evidence/status before draft PR delivery.

Phase 2a plan review (2026-09-16): internal technical review accepted one fixture
server ownership omission, fixed alongside the client migration. External Fable
review reproduced the catalog baseline and verified parser/callsite dependencies;
its sole minor wording finding separated four-tool catalog proof from the existing
one-tool runtime fixture proof. Applied in place; the round is clean under project
policy without another round for documentation-only findings. No product input
remains for Phase 2a. The reviewer requested an additional clean round, rejected as
contrary to that explicit documentation-only clean-round policy.

#### Phase 2b/2c: later package operations

Changelog is excluded from Phase 2a at the user's direction after exact-target
verification. Ref classification and exact-release/source selection naturally belong
to the backend; do not infer them from tag spelling, capped release scans, or an
unrelated code-diff call. A separately dispatched backend Codex worktree investigates
this contract (diagnosis only, no fix/deploy); independent hand-off is not supervised
here. After fixes are implemented, deployed and verified, reorient and detail the
compact changelog increment, preserving the accepted grammar below. Acceptance:
single pins select exactly one release; ranges preserve exclusive-start/inclusive-end
bounds; upper repository tags choose the requested CHANGELOG snapshot; missing
release/ref targets fail actionably rather than selecting unrelated entries.

Upgrade review remains unchanged. Later reorientation must settle its single/batch
MCP shape using existing CLI `@current..target` syntax. Acceptance: one addressing
form with equivalent single/batch normalized calls and review evidence, actionable
invalid endpoints, and unchanged CLI behavior. No tactical work is scheduled now.

Phase 2 interview history (2026-09-16; initial five-tool scope superseded by the
four-tool Phase 2a decision above):

- The next increment covers `docs_list`, `pkg_info`, `pkg_vulns`, `pkg_deps`, and
  `pkg_changelog`; upgrade-review redesign remains outside it.
- Include compact changelog release ranges in the same PR if implementation size
  stays within the user's simplicity budget. Use inline targets such as
  `npm:express@4.21.2..5.2.1` and
  `github:expressjs/express@v4.21.2..v5.2.1`, not a separate range field.
- The upper repository tag selects the CHANGELOG-file snapshot. Release entries
  use the corresponding exclusive-start/inclusive-end release bounds.
- A single package version, such as `npm:express@5.2.1`, selects exactly that
  release for changelog, not recent entries capped at that version. Unversioned
  package changelog targets retain the current recent-entry default.
- The user also requested single repository release tags to select exactly their
  release, while branch/commit targets select CHANGELOG snapshots; verification
  of backend support is recorded below before treating this as implementable.
- A production probe of the equivalent repository request (`fromVersion:4.21.2`,
  `toVersion:5.2.1`, `gitRef:v5.2.1`) returned nine release entries, confirming the
  backend accepts the combined inputs. It used the `releases` source, so it does
  not itself prove CHANGELOG-file snapshot behavior.
- Existing CLI upgrade-review code already parses `@current..target`; reuse its
  syntax rather than claiming the interval spelling is wholly undecided. The
  earlier separate-range proposal and addressing-only scope were not accepted.
- Single repository-tag behavior is selected but backend exact-target support
  remains unresolved. Open-ended repository intervals still need their source
  revision semantics settled before finalizing the Phase 2 implementation contract.

Repository exact-target verification (2026-09-16):

- Backend `main` source was inspected read-only through GitHub at
  `f29298eb1be0760185961131d876f05cbfe5242a`, not through the independent name
  diagnosis worktree. `priv/graphql/schema.graphql` exposes `refKind` through
  code-diff ref resolution, and internal ref facts include SHA/tag/branch/head.
  Changelog's API exposes only independent `gitRef`, `fromVersion`, `toVersion`,
  and latest-entry `limit`; it has no exact selector or ref classification result.
- Repository request `gitRef:v5.2.1,limit:3` returned recent release entries
  `v4.22.3`, `v4.22.2`, `v4.22.1`. The tag does not filter the releases source.
- Repository request `gitRef:v5.2.1,toVersion:5.2.1,limit:1` returned `v4.22.3`,
  not `v5.2.1`. The latest-entry cap is publication-ordered and not an exact lookup.
  A missing-version control `toVersion:5.2.999` also returned `v4.22.3`.
- Package control `npm:express,toVersion:5.2.1,limit:1` returned exactly `5.2.1`;
  package and repository addressing use different selection semantics. This
  positive case does not prove missing-version or prerelease exact-pin behavior.
- Therefore the earlier estimate of a thin adapter is invalid for exact repository
  releases. Ref classification and exact-release/source selection naturally belong
  to the backend. Exposing those facts by executing a whole code diff would be the
  wrong boundary; neither client tag-spelling guesses nor capped-list scans are
  accepted substitutes. Backend support must be resolved before finalizing the
  agreed exact repository-tag contract. No fixes or additional backend hand-off
  were authorized by the verification request.

**Dependencies:** Phase 2a needs no backend changes. Phase 2b requires backend
exact-release/source-selection support; Phase 2c depends on later product reorientation.

**Acceptance criteria:** Each package operation has one MCP addressing form; all
latest, pinned, range, repository, and batch semantics remain deterministic; invalid
versions retain actionable mapped errors; catalog size decreases under the same
inventory; CLI and service contracts remain stable.

### Phase 3: one MCP search-filter language

**Status:** MERGED — `ffc975d` (PR #397); name-qualifier production gap remains unresolved

**Expected outcome:** MCP callers express `kind`, `category`, `path`, `intent`,
`name`, and `lang` once inside `search.query`. The selected tool teaches that compact
syntax with representative examples, production validates it actionably, and
per-source loss remains visible. CLI users retain `--kind`, `--category`,
`--path-prefix`, `--intent`, `--name`, and `--lang`.

**Assumptions:** The production qualifier contract verified above remains deployed
through implementation and release. Existing query/warning fields and text rendering
continue to preserve backend parser and source-compatibility metadata.

**Unknowns or product decisions:** none.

Unknown MCP arguments continue to follow the SDK's existing stripping behavior. This
phase does not introduce global or search-only strictness: current schemas are
rediscovered by agents, canonical guidance does not teach the removed fields, and no
agent trace has shown stale or invented filter arguments. Changing unknown-field
semantics for every tool would be an unverified compatibility expansion unrelated to
qualifier consolidation. Release guidance still directs hard-coded callers to the
inline forms; runtime rejection is not part of the contract.

**Dependencies:** Phase 1 merged; production backend qualifier validation and
source-lane reporting deployed; existing context inventory, service mocks, smoke
suites, and agent-eval harness available. Canonical `@ref` syntax is merged and does
not change this phase's qualifier-only scope.

#### Behavioral contract

- Remove `category`, `kind`, `path_prefix`, `file_intent`, `name`, and `language`
  from `SearchArgs` and the generated MCP `search` input schema. Do not retain aliases
  or add strictness machinery; the advertised surface is the migration boundary.
- Keep `query`, `target`, `targets`, `source`, `public_only`,
  `allow_partial_results`, `limit`, `offset`, `wait_timeout_ms`, and `format`.
  `public_only` stays structured because no verified inline equivalent exists.
- After the existing required-query trim, `query` passes to the service without
  MCP-side qualifier parsing, compilation, or enum copies. Representative syntax is
  `kind:function`, `category:callable`, `path:lib/`, `intent:production`,
  `name:Router`, and `lang:typescript`; backend implicit-`AND`, explicit boolean,
  parentheses, quoting, escaping, and recovery semantics remain authoritative.
- Backend `INVALID_ARGUMENT` failures, parser warnings, `ignoredQueryFeatures`, and
  `incompatibleQueryFeatures` continue through the existing service, payload, and
  text-rendering paths unchanged. Source-incompatible inline qualifiers may complete
  with explicit warnings rather than using the shared structured `pathPrefix`
  preflight that remains for CLI flags; no inline-query filter loss is silent.
- Keep all CLI flags and `SearchCommandOptions` unchanged. The shared
  `buildUnifiedSearchParams()` support for structured kind/category/path/intent flags
  and compiled name/language qualifiers remains because the CLI owns that ergonomic
  adapter. Do not move backend query parsing into this shared helper.
- Preserve tool name, annotations, output schemas, search lifecycle, target parsing,
  first description sentence, and first 80 raw description characters. Tighten only
  qualifier-related copy; do not change the now-canonical `@ref` target syntax.

#### Implementation boundaries and likely files

1. In `packages/mcp/src/tools/search.ts`, remove the six fields and their Zod schemas,
   delete now-unused MCP conversions/imports, and stop forwarding them to
   `buildUnifiedSearchParams()`. Keep `public_only` forwarding through `filters` and
   pass `query` through the existing required-query trim without qualifier compilation.
2. Replace the current “prefer structured parameters” query copy and the long
   structured-filter paragraphs with compact caller-facing qualifier examples plus
   one source-compatibility instruction: inspect returned warnings/source status when
   a qualifier does not apply. Do not duplicate exhaustive enum lists; actionable
   backend validation owns the current vocabulary.
3. Leave `packages/mcp/src/shared/unified-search-request.ts`,
   `src/commands/search.ts`, their CLI option schemas, and their structured flag tests
   intact. They naturally own CLI adaptation; deleting that support would broaden the
   change without reducing the MCP catalog.
4. Update only current contract prose in `docs/implementation/tools.md`: remove the
   six fields from the MCP tool table and describe MCP inline qualifiers, CLI flag
   preservation, backend validation, and per-source reporting. Do not edit dated
   historical measurements or generated plugin assets.
5. Add `eval/agentic/workloads/search-inline-qualifiers.md` as a stable task that
   requires production JavaScript evidence under `lib/` from
   `npm:express@5.2.1`, and route it from the workload table. The task describes the
   desired evidence constraints, not tool-call instructions.
6. Add one independent `changes/<unique-name>.changed.md` fragment with pending
   `minor` impact for both `githits` and `@githits/mcp`. Include direct field-to-query
   migrations and state that CLI flags, `public_only`, results, and continuation
   behavior are unchanged. Do not edit `CHANGELOG.md`.

#### Tests and verification

- In `packages/mcp/src/tools/search.test.ts`, replace structured MCP filter calls with
  inline queries. Assert the six fields are absent, remaining fields are documented,
  representative qualifier examples are present once at the selected-tool surface,
  the first sentence/prefix remains stable, inline syntax reaches the service unchanged
  after the existing required-query trim, and `public_only` still produces its
  existing backend filter.
- In `packages/mcp/src/mcp/server.test.ts`, assert the generated stable schema has no
  six removed properties and retains `query` plus `public_only`. Do not add tests or
  production changes for the SDK's unchanged handling of undisclosed arguments.
- Keep `packages/mcp/src/shared/unified-search-request.test.ts` and
  `src/commands/search.test.ts` coverage for CLI structured flags and quoting. Run
  them explicitly as regression guards; they should need no production-code change.
- Preserve `src/tools/search-parity.test.ts` output parity. Request encodings may
  differ because MCP now sends inline syntax while CLI flags retain the existing
  adapter; completed results, errors, warnings, and continuation envelopes remain
  identical for the same service outcome.
- Exercise authenticated live MCP/CLI smoke with at least one successful combined
  inline query and the three invalid enum cases. Successful smoke must show no silent
  qualifier loss; invalid values must return non-retryable `INVALID_ARGUMENT` without
  a continuation. Unauthenticated smoke must retain its current auth assertions.
- Run the existing context inventory before and after. With descriptor text held to
  no net growth, stable `catalog.full` must be at most 40,821 characters; if compact
  replacement copy changes that ceiling, record the exact schema-only 1,838-character
  projection separately from the measured implementation result. Make no token or
  cost claim from either count.
- Run descriptor-only local evals for both Codex and Claude on
  `search-inline-qualifiers.md` and `unified-search-investigation.md`. Inspect
  `tool-calls.json`, raw tool results, `final.json`, `metrics.json`, and
  `isolation-violations.json`. Changed `search` calls must use query qualifiers rather
  than removed arguments, report returned qualifier warnings, avoid redundant
  constraints and futile retries, and have no isolation violations. Eval confidence
  is not a quality grade.

Run, at minimum:

```text
bun test packages/mcp/src/tools/search.test.ts
bun test packages/mcp/src/mcp/server.test.ts
bun test eval/agentic/context-loading/fixture-server.test.ts
bun test packages/mcp/src/shared/unified-search-request.test.ts
bun test src/commands/search.test.ts src/tools/search-parity.test.ts
bun test
bun run typecheck
bun run lint
bun run build
bun run validate:packages
bun run plugins:generate
bun run plugins:check
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
bun scripts/agent-context-load.ts sizes
```

Inspect generated diffs. No canonical plugin input is expected to change, so generated
assets must remain unchanged. Report any live backend variability as evidence; do not
hide it with retries.

#### Phase 3 acceptance criteria

1. Stable MCP `search` omits the six removed fields and advertises their inline
   equivalents compactly in `query`; `public_only` and every non-qualifier input remain.
2. Inline query text reaches the backend unchanged after the existing required-query
   trim, valid representative queries preserve ranked evidence, and backend
   validation/warning/source-status details remain visible in text and JSON without a
   duplicate client parser.
3. CLI search flags and their structured request-builder behavior are unchanged;
   MCP/CLI output and error envelopes retain parity for equivalent outcomes.
4. Authenticated smoke verifies one combined valid query plus prompt typed failures
   for invalid kind/category/intent; all source and built smoke modes pass their
   applicable authenticated or unauthenticated contracts.
5. The measured stable catalog records the exact reduction and does not exceed the
   schema-only 40,821-character projection unless every additional character is
   justified by compact target-facing call guidance.
6. Descriptor-only Codex and Claude traces use inline qualifier syntax without
   removed-field calls, duplicate constraints, futile retries, or silent warning loss.
7. Durable docs and the independent minor/minor fragment give direct migration
   examples, while quick-start/skill text and generated plugin assets remain unchanged.
8. Internal and external review are clean under repository policy.

#### Phase 3 implementation record

The implementation is committed on `jlitola/audit-tool-surface-simplification`:

- `beb7fe3` removes the six MCP fields, tightens selected-tool qualifier guidance,
  updates current durable contracts, adds the minor/minor migration fragment and
  eval workload, and adds schema/live-smoke assertions.
- `82be052` changes the combined live-smoke query term from `router` to
  `application`. The first live run completed the former query with zero results;
  targeted production inspection showed the qualifiers were accepted and the
  application term returned the required `lib/*.js` evidence. No assertion was
  weakened and no retry mechanism was added.

Two bounded Luna implementation slices returned uncommitted, verified changes;
the coordinator reviewed them, authored descriptor/docs/eval decisions, tightened
the smoke proof, and owns the commits and delivery. The Luna conformance preflight
and internal `code_reviewer` are clean. External Opus round 1 and its single
fresh-context final check are clean, with no findings. The review inspected the
complete implementation delta, warning/source-status preservation, unchanged CLI
adapters, migration guidance, and stale-field references. The reviewer was retained
in terminal `term_c9d8e9f4-7cee-495e-8f91-d195c5203445` under dispatch
`ctx_ceca16417782` through merge confirmation, then released on 2026-09-16.

Verification on 2026-09-16:

- `bun test packages/mcp/src/tools/search.test.ts packages/mcp/src/mcp/server.test.ts
  packages/mcp/src/smoke-test.test.ts eval/agentic/context-loading/fixture-server.test.ts
  packages/mcp/src/shared/unified-search-request.test.ts src/commands/search.test.ts
  src/tools/search-parity.test.ts`: 228 passed, zero failed.
- `bun test`: final full run passed all 4,776 tests across 210 files, zero failed.
  The first run exposed the new workload's missing exact-inventory registration;
  the manifest/test were corrected in place and its focused suite passed 48/48.
- `bun run typecheck`, `bun run lint`, `bun run build`, and
  `bun run validate:packages`: passed. Lint reports eight pre-existing warnings in
  the unchanged repository-target parser.
- `bun run plugins:generate` and `bun run plugins:check`: generated and validated
  all ten assets with no derived diff. Quick-start and public skill inputs are
  unchanged.
- `bun run smoke:cli` and `bun run smoke:mcp`: authenticated stable and
  experimental cohorts passed. The new combined query returned nonempty
  JavaScript evidence under `lib/`, preserved its exact raw query, and the three
  invalid inline enums returned non-retryable `INVALID_ARGUMENT` without
  continuation. The CLI structured path-prefix rejection remains covered.
- `bun run smoke:cli:built` and `bun run smoke:mcp:built`: passed their secret-free
  Node launch, unauthenticated, and registration contracts.
- `bun scripts/agent-context-load.ts sizes`: stable `catalog.full` is 40,738
  Unicode characters and `search` is 4,676, down from 42,659 and 6,597 respectively.
  The reduction is 1,921 characters (4.5%), 83 below the 40,821 schema-only ceiling.
  The catalog names/first-80 surface, quick-start, and public skill are unchanged.
  No provider-token or cost improvement is inferred from character counts.
- Descriptor-only local Codex 0.154.0 Luna/high runs on
  `search-inline-qualifiers.md` and `unified-search-investigation.md` completed
  successfully with high self-reported confidence. Their raw calls, results,
  finals, and metrics were inspected: 8 and 20 MCP calls respectively, all
  completed, no CLI fallback, no removed search arguments, no duplicate qualifier
  constraints, and no isolation violations. The inline run used all three required
  qualifiers, inspected JSON once for warning/source-status detail, then narrowed
  terms; its final explicitly reported no returned qualifier warnings. These are
  trace observations, not a quality grade or comparative token/cost result.
- The matching Claude 2.1.273 descriptor-only runs both failed before discovery
  with provider `authentication_failed`, one API-error turn, and zero tool calls.
  They do not verify Claude product behavior. Their failure artifacts are retained;
  Claude descriptor behavior remains an explicit validation limitation rather
  than being hidden by repeated runs.

Local eval artifacts are in `.agent-eval/runs/phase3-{codex,claude}-{inline,unified}`.
PR [#397](https://github.com/githits-com/githits-cli/pull/397) merged on 2026-09-16
at `ffc975d5523817199b0c9158c4109dd0d484295c`. PR Build & Checks,
Linux/Windows tests, MCP package validation, and Node 20/22/24/26 compatibility
passed. Bun compatibility initially failed before tests because GitHub artifact
download returned HTTP 403; rerunning only the failed job passed, and
[Main attempt 2](https://github.com/githits-com/githits-cli/actions/runs/35068091066)
completed successfully. Post-merge Main, Agent Evals, Release, and MCP Package
Release workflows all completed successfully at the merge SHA. Root npm/MCP
registry publication and GitHub Release steps, and MCP package tag/npm/Release
steps, were skipped; the minor/minor fragment remains pending. No hosted deployment
is verified by this lane. Local Claude descriptor-eval behavior remains unverified.
The final consistency audit found
canonical `@ref` target guidance and one inline MCP search-constraint language;
quick-start/skill parity and unrelated structured CLI/navigation controls remain
intact.

#### Phase 3 verification addendum: `name:` and isolated `lang:`

At the user's request on 2026-09-16, additional production probes against
`npm:express@5.2.1` closed the isolated language-filter gap and found a name-query
composition failure. Published CLI 0.17.1 and the current local source CLI reproduce
the symbol outcome against served commit
`dbac741a49a5a64336b70c06e85c2e2706e36336`:

- Code query `application lang:javascript` returned five JavaScript hits. Its
  ordered titles, paths, ranges, languages, and commit identities exactly matched
  `application --lang javascript`. Changing only the qualifier to `lang:python`
  returned a completed empty result, without ignored/incompatible warnings.
- Symbol queries `createApplication`, `name:createApplication`, and
  `name:"createApplication"` each returned `createApplication` at
  `lib/express.js:36-56`. A nonexistent name alone returned no symbols.
- Symbol query `createApplication name:createApplication` returned a completed
  empty result with current indexed source status and no warning. The explicit
  combination `name:createApplication AND kind:function` also returned no results.
  This contradicts the documented implicit-AND/composable-qualifier contract;
  positive standalone name discovery is not sufficient verification.
- On code search, `application name:createApplication` exactly matched the five
  ordered evidence locators from `application --name createApplication`, but
  included other names such as `createETagGenerator` and `createApp`. A nonexistent
  name, including its quoted form, still returned ranked code hits. Whether code
  name matching is intentionally fuzzy/ranking-oriented remains unverified; it
  must not be described as proven exact filtering.

The shared builder already compiles CLI `--name`/`--lang` into inline syntax, so
CLI equivalence proves migration parity, not independent backend correctness.
Local service inspection confirms the composed query is forwarded unchanged to
the backend. Query compilation and source-specific semantics belong to the
backend; the actual root cause is not established in this repository. No client
parser, workaround, code change, or cross-worktree hand-off was introduced.
Production verification is not complete. The user subsequently merged PR #397;
that merge does not establish a root cause, backend fix, or intentional fuzzy
name-matching contract. The gap remains open for backend diagnosis and targeted
reverification. No cross-lane hand-off is authorized by this readiness check.

#### Historical post-Phase-3 readiness check (superseded by Phase 2a interview)

`$next-steps` refreshed `origin/main` to `ffc975d` on 2026-09-16 and verified Phase 3
implementation commits are included. The next planned increment is Phase 2:
compact package-tool coordinates. Canonical repository `@ref` support is merged;
package MCP tools still advertise structured coordinates. Upgrade review still
advertises four single-package fields plus equivalent structured batch rows, while
changelog retains separate exclusive-start/inclusive-end versions and repository
refs. Existing code does not choose a compact single/batch upgrade-range format.

Verdict: **PRODUCT INPUT NEEDED**. The planned Phase 2 scope requires that range
representation decision before tactical implementation detail can be prepared.
It is not implementation-ready; after the user settles the representation,
`$do-plan` should detail its call contract, boundary cases, migration tests, narrow
catalog-size comparison, live smoke cases, and targeted descriptor evals. No phase
was split, reordered, or redesigned in this bookkeeping pass. The outstanding
backend name-composition gap and Claude descriptor-auth limitation remain explicit.

### Phase 4: essential navigation controls only

**Status:** PENDING PRODUCT DISCUSSION

**Expected outcome:** `code_files` and `code_grep` retain the smallest set of controls
that covers verified enumeration, scoping, context, pagination, and result-diversity
needs.

**Assumptions:** CLI may keep additional expert flags when they do not burden MCP.

**Unknowns or product decisions:** Decide singular/plural intent controls, selector
overlap, symmetric/asymmetric context, and total/per-file limits using real call-shape
evidence.

**Dependencies:** User discussion and call-shape evidence at reorientation.

**Acceptance criteria:** Each retained MCP knob has a distinct documented effect and
test; removed knobs have a supported replacement or verified lack of need; common
calls become smaller without reducing required evidence quality.

### Phase 5: actionable example-language recovery

**Status:** MERGED — PR #399, included in baseline `b2d4513`; `search_language` and `githits languages` removed;
`get_example` / `example --lang` rely on backend 400 recovery.

**Expected outcome:** `get_example` keeps language filtering and returns an actionable
supported-language correction when the requested language is invalid or ambiguous.

**Assumptions:** Backend `POST /search` fail-fast 400 strings list up to five
canonical names; the CLI mapper surfaces that string.

**Unknowns or product decisions:** none remaining for this phase.

**Dependencies:** Backend language-recovery contract.

**Acceptance criteria:** Wrong-language calls point directly to valid choices;
correct-language calls are unchanged; removing `search_language` does not remove
language filtering or force agents to guess names.

### Phase 6: concise answer/output routing copy

**Status:** PENDING EVAL

**Expected outcome:** Ask's description states its high-level answer role concisely,
lower-level follow-up routing stays discoverable, and repeated format guidance is no
longer paid per tool unless it demonstrably prevents wasteful JSON calls.

**Assumptions:** Ask remains available and answer quality is not reduced to save
descriptor tokens.

**Unknowns or product decisions:** Determine shorter Ask copy through descriptor
evals; run matched lower-cost-agent candidates before changing format descriptions;
discuss `search_status` separately before altering it.

**Dependencies:** Stable post-Phase-1/2 catalog and matched eval capacity.

**Acceptance criteria:** Ask selection and follow-up behavior remain correct;
lower-cost agents do not increase unnecessary JSON selection; every removed sentence
is owned by a surviving schema, response action, quick-start rule, or durable doc;
legacy read-name redirection remains explicit.

## Phase-boundary reorientation

After each increment merges and before detailing the next phase, run `$next-steps`
against current `origin/main`. Record observed catalog sizes, call shapes, agent-eval
limitations, compatibility feedback, and any new OP/product decision. Recheck whether
the next phase is still the largest settled simplification, then add tactical detail
for only the next one or two phases. Stop on `REPLAN` or `PRODUCT INPUT NEEDED` rather
than implementing from stale assumptions.

## Completion and plan cleanup

The overall effort is complete when every retained MCP tool and parameter has a
distinct verified job, settled duplicate addressing/filter paths are removed, Ask and
legacy read migration remain functional, agent behavior and exact catalog sizes are
recorded, and all durable contracts live under `docs/implementation/` and public
guidance as appropriate.

Keep this plan through the final implementation review. After the last increment is
merged, transfer any remaining durable decisions/evidence to implementation docs and
delete this temporary plan. Do not leave completed plan text as a competing source of
truth.

## Plan review record

- Phase 3 internal `code_reviewer`: its unknown-field finding was factually correct
  but rejected as a blocker after product calibration. The SDK has always stripped
  undisclosed arguments across all tools; no agent trace shows stale or invented
  filter fields, current schemas are rediscovered, and canonical guidance does not
  teach them. Global strictness would impose a new compatibility contract on every
  tool to guard an unobserved stale caller, while search-only strictness would add an
  inconsistent special path. The plan now neither changes that behavior nor promises
  removed-field rejection. Accepted and fixed its two minor factual findings: query
  text is trimmed by the existing request builder before service forwarding, and the
  opening problem statement incorrectly described the pre-Phase-1 catalog as current.
- Phase 3 external Fable round 1: one minor wording finding, otherwise clean. Accepted
  that the plan incorrectly called structured `pathPrefix` preflight rejection
  MCP-only even though the shared request builder also serves CLI. Reworded the
  behavioral contract to preserve that CLI path explicitly. Under repository policy,
  the round is clean once this documentation-only correction is applied.
- Post-review baseline refresh: PR #396 merged canonical `@ref` syntax to
  `origin/main` at `175c15c`. Updated the Phase 3 inventory baseline/projection and
  marked package-coordinate work deferred until after Phase 3. This changes no
  reviewed Phase 3 scope, architecture, or acceptance behavior, so no new review
  round was required.

- Internal `code_reviewer`: two valid test/documentation gaps. Accepted the need to
  enumerate the existing protocol, parity, and public-surface callers and to turn the
  context fixture's object-equivalence check into over-the-wire rejection coverage.
  Accepted the missing structured-site migration example and equivalent compact-site
  normalization test. Its smoke-helper subpoint was initially rejected after a narrow
  literal search missed the structured `SMOKE_PACKAGE_TARGET` constant; Fable supplied
  the missing evidence, so that adjudication is superseded and the exact smoke files
  and affected tools are now included.
- External Fable round 1: one valid factual finding. The smoke helper uses its
  structured package-target constant for seven `search`, `code_files`, and
  `code_grep` calls even though `read` already uses compact strings. Accepted and
  corrected the implementation/test boundary and the internal-review record. Also
  replaced the unsupported phrase “pre-1.0 release policy” with the verified prior-
  plan convention for a minor breaking-surface fragment. The internal closure pass
  caught that the same structured constant also feeds `docs_list`; accepted and
  corrected the plan to retain it and add a separate compact code/discovery constant,
  after which internal review was clean.
- External Fable round 2: prior findings were closed. Its permitted fresh-context
  check found one sibling missed by both earlier passes: `scripts/cli-smoke.ts` uses
  structured MCP targets for `code_files` and `code_grep`. Accepted; the plan now
  names that source/built CLI smoke entrypoint and preserves its compact CLI and
  structured `docs_list` sides. The bounded internal sibling scan then found the
  direct structured `code_diff` call in the already-named local-server test; accepted
  and made its required input/assertion preservation explicit. The final internal
  re-review found no remaining issue.
- External Fable round 3: clean. It re-verified every prior closure and ran a bounded
  `target: {` sweep across `packages/mcp`, `src`, `scripts`, and `eval`; remaining
  matches are covered Phase 1 callers, intentional post-parse service shapes,
  unrelated response data, or the existing negative test for string-only `read`.
  Phase 1 was implementation-ready. The plan-review terminal was released before
  implementation; the implementation review used a fresh Opus terminal.
