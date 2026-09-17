# MCP tool-surface simplification

## Status

- Overall: ACTIVE
- Current boundary: Phase 6 instruction ownership and copy cleanup, IMPLEMENTED;
  draft PR #403 awaiting merge and disposition of the complete Ask smoke limitation
- Baseline: `9be81a9` (`origin/main`, 2026-09-17; PR #402 package targets merged)
- Planning branch: `jlitola/compact-agent-instructions`
- Last verified: 2026-09-17

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
- the selected tool's description/schema are self-sufficient for its minimum call
  contract, distinguishing behavior, exceptions, and representative examples,
  without requiring another evidence descriptor;
- `quick_start` and its exact public skill copy own recurring cross-tool policy:
  scope, target conventions, format choice, evidence reuse, citations, continuation
  discipline, and external-content posture;
- CLI skills independently carry equivalent common policy using CLI spelling,
  without requiring CLI users to load the MCP skill; and
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

Unresolved backend/navigation decisions do not block Phase 6. Shorter format copy
must pass its matched-eval acceptance gate; that result is not assumed in planning.

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
2. **Phase 2 — compact package-tool coordinates (PARTIALLY MERGED):** Phase 2a migrated
   `docs_list`, `pkg_info`, `pkg_vulns`, and `pkg_deps` in PR #402. Phase 2b changelog
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
6. **Phase 6 — shared instruction ownership and concise tool copy (IMPLEMENTED,
   draft PR #403):** recurring policy lives in skills/quick-start; tools retain their
   own call contract without repeating that policy at length. Ask and original
   format reminders remain. The shorter format candidate was rejected after evals.
   Search-status copy shrank without redesigning its continuation protocol.

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

**Status:** Phase 2a MERGED (PR #402, `9be81a9`); Phase 2b BLOCKED ON BACKEND; Phase 2c PENDING

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

**Merge closure (2026-09-17):** User confirmed PR #402 merged; GitHub verified
merge commit `9be81a9`. Full CI and the clean second Opus round apply to that delta.
The same Codex docs-discovery settings reran without changes in
`.agent-eval/runs/phase2a-codex-docs-rerun-20260917`: success, 47.5 seconds, five
completed MCP calls, zero failed calls and zero validation violations. It used
quick-start/search/read, not docs-list; earlier direct smoke/parity proof covers
docs-list. The original contaminated run remains retained and its cause unknown.
The implementation reviewer was released after the user's merge report. Historical
checkpoints below describe their state at the recorded time.

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
16 sequential bounded dispatches: the planned 12 (four schemas/unit callers, four parity
files, catalog contracts, runtime fixture, shared MCP smoke and CLI smoke fixtures),
one missed direct-smoke caller, one test-typing correction, one security-mock closure
and its header-wording correction. Every return was
inspected and its exact proof rerun independently. No worker interruptions. The
final type check required one correction dispatch, with one later wording correction;
the missed caller was a
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
Draft PR #402 CI supplied the required full-suite result on clean Linux and Windows
hosts: `ci / Test / ubuntu-latest` passed in 34 seconds and
`ci / Test / windows-latest` in 86 seconds. See
https://github.com/githits-com/githits-cli/actions/runs/35102852857.
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
No deadline was changed. Clean-host PR CI subsequently passed both built smokes:
CLI 13,083 ms / MCP 1,024 ms, within the existing combined 120-second gate;
`ci / Build & Checks` passed in 47 seconds. The later local queued rerun also passed
(CLI 440.4 seconds / MCP 52.4 seconds); local timing variability is retained as
evidence, not a performance claim.

Initial authenticated live validation stalled in local macOS Keychain access,
before the backend or package parser. A one-second sample of the coordinator-owned
CLI subprocess (cwd this worktree, own smoke parent chain) shows native keyring
`SecKeychainFindGenericPassword` waiting in Security server IPC before fetch.
No credential values were read or printed. The user was asked to approve an
existing Keychain prompt, if present. No credential-store reset, new fallback,
discovery flag, retry, or timeout workaround was added. The queued source smokes
subsequently completed: `bun run smoke:mcp` passed 60 live steps, including all four
compact package tools; `bun run smoke:cli` exited 0 with stable live initially
skipped (`AUTH_REQUIRED`) and experimental live passed. To close the affected stable
CLI path without repeating unrelated cohorts, `bun /tmp/phase2a-live-package-parity.ts`
passed all five existing changed-tool JSON parity fixtures against the built CLI
and MCP: info, deps, deps issues, vulnerabilities and docs. It reuses the existing
fixture arguments and MCP launch builder, requires successful authenticated JSON
on both surfaces and compares the same contract shapes as the smoke suite.
It is a temporary local proof script, not new product infrastructure. No credential
configuration was changed. A later MCP sample attempt found its process already
finished; no process was killed and no second sample result is claimed.

The first descriptor-only Codex run is incomplete and must not count as passing:
docs discovery returned inconclusive/low with zero calls; filtered vulnerabilities
left the isolated workspace to read repository skills and attempted CLI fallback,
producing isolation violations. The trace proves explicit external file access,
but its cause remains unresolved. The fresh app-server `skills/list` diagnostic
used an empty `HOME` and exposed only bundled system skills; it does not rule out
host-skill discovery in the actual eval environment. The earlier stronger inference
was corrected after checking the probe environment. The overview recorded valid compact `pkg_info`/`pkg_vulns` calls
that did not return before timeout; no complete aggregate metrics/report was
produced. Claude Haiku likewise submitted those two compact MCP targets but timed
out at 302.3 seconds. Its metrics report marks usage/logical telemetry unknown.
Preserve `.agent-eval/runs/phase2a-codex-low-20260916-1254` and
`.agent-eval/runs/phase2a-claude-haiku-probe-20260916-1254`; these are failed/blocked
validation evidence, not answer-quality or token-savings claims. Two tiny timeout
cleanup probes both completed normally, so no hypothesized harness timer fix was made.

After MCP credential access recovered, targeted runs completed. Codex
`.agent-eval/runs/phase2a-codex-low-20260916-1342` passed overview, filtered
vulnerabilities and dependencies; docs discovery returned a high-confidence final
answer and a successful compact `docs_list` call, but the run correctly failed
isolation validation for two external skill reads. All changed-tool calls used
compact targets; no old-coordinate schema fallback was observed. Actual metrics:
4 workloads, 3 succeeded / 1 failed / 0 timeouts, 14 logical calls, 319.2 seconds;
194,164 uncached / 632,832 cached input tokens, 4,621 output tokens. These are
current-run metrics, not baseline-relative savings. Cost remains a base-rate
estimate with long-context attribution uncertainty.

Claude Haiku overview and the other three targeted workloads all passed, each
with high reported confidence and no isolation violations, in
`.agent-eval/runs/phase2a-claude-haiku-probe-20260916-1342` and
`.agent-eval/runs/phase2a-claude-haiku-remaining-20260916-1342` (55.0 / 197.8 seconds).
Inspection covered actual compact calls, finals, metrics and violation artifacts,
not just harness status. Claude usage and logical-call telemetry remain unknown
(`adapter_not_implemented`, `tool_logical_count_not_implemented`); no provider-cost
comparison or answer-quality claim without grading. The Codex docs case remains
an open validation disposition, not a passing eval.

Read-only skill-discovery diagnostics followed the OpenAI-docs workflow. A second
fresh app-server probe retained the actual dedicated eval `CODEX_HOME` while
isolating `HOME` as the harness does; it likewise exposed only six bundled system
skills. This narrows the evidence but does not explain discovery/access in the
actual CLI run. No harness/discovery flag or configuration was changed, and no
credential values were displayed. Do not generalize either probe into a claim
that the Codex isolation cause is solved.

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
smoke, completed agent evals, and code review remained outstanding at pre-flight;
it did not establish those gates. Subsequent results are recorded separately.

Internal code review (2026-09-16): fresh `code_reviewer` inspected the complete
Phase 2a delta and reported no findings, with no edits or extra validation. It
retained the full-CI, authenticated-smoke, completed-eval and local built-smoke
budget gaps above. External Opus round 1 was pending at that checkpoint. Its first transport-accepted
dispatch had an empty composer and no review work; that dispatch was fenced and
the same reviewer terminal received one recovery task. That task was transport-
accepted with an initially empty transcript; terminal access first returned a stale
handle despite the worker projection reporting live. A subsequent bounded read
proved the recovery task submitted and Opus actively inspecting the implementation.
External round 1 subsequently returned the finding recorded below. No duplicate reviewer or speculative
Enter submission. Draft PR: https://github.com/githits-com/githits-cli/pull/402.

External round 1 (2026-09-16): accepted one low code finding. The security-eval
mock owns its intentionally framed responses and selected guardrails, but must
mirror the production coordinate schema when it imports production descriptions.
`eval/mock-mcp/server.ts` still required old coordinate fields for `pkg_info` and
`pkg_vulns`, so descriptor-following calls fail SDK validation in normal MCP
security-eval cells. Smallest remedy: migrate only those two schemas and their
header comment; keep fixture response behavior, guardrail modes, read and changelog
unchanged. Closure scan checked the mock server, state contract, security runner,
mock CLI and existing security tests; no other registered changed package tool.
A 15th bounded Luna slice changed only `eval/mock-mcp/server.ts` and new
`eval/mock-mcp/server.test.ts`; a 16th dispatch clarified the header to name only
the two migrated mock tools. Coordinator inspected and independently reran
`bun test eval/mock-mcp/server.test.ts`: 1 pass / 28 assertions, proving actual
listed schemas, successful compact calls and SDK failure for old-only/object
arguments without real auth or networking. `bun run typecheck` passed. The full
revised delta's internal closure review reported no findings. External round 2
returned clean in the same Opus session, including the single fresh-context final
check. No extra validation by reviewers. The standing plan-deletion note was
adjudicated not applicable because Phases 2b/2c remain open; retain this active plan.
Post-closure CI at `26e3fdc` is green: full Linux/Windows suites (35/85 seconds),
Build & Checks (56 seconds), MCP package validation and all runtime compatibility
jobs. See https://github.com/githits-com/githits-cli/actions/runs/35105196268.
The same Opus reviewer remains retained through human PR merge approval at
`term_3bfd3e56-bd5e-4b9a-96bd-17b1147cbb7f`.
The duplicated simple output-target string expressions were adjudicated separately:
they already exist consistently and do not justify a new helper in this increment.

Final current-instruction audit checked README/package guidance, public skills,
MCP/CLI implementation docs and both mock surfaces. The four migrated target
instructions and callable examples agree. Corrected minor existing documentation
drift in place: replaced the vague `docs_*` routing wildcard with `docs_list`/`read`,
and corrected the guardrails document to nine distinct third-party-content tools
and the actual `pkg_info` prose surfaces (no install/usage snippets). No stable
guide/public skill change, generated asset change or descriptor-prefix change.
Existing changelog exact-release wording is still ahead of the verified backend
contract; that is the already-deferred Phase 2b gap, not a compact-target regression.
Do not interpret this four-tool audit as proof that repository exact release
lookup works or that changelog/upgrade inputs have migrated.

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

### Phase 6: shared instruction ownership and concise tool copy

**Status:** IMPLEMENTED on `jlitola/compact-agent-instructions`, draft
[PR #403](https://github.com/githits-com/githits-cli/pull/403), awaiting merge.
Initial internal technical review is clean; external Opus round 1 found only minor
documentation issues, applied for a clean round under repository policy. Windows CI
subsequently found a test-only LF assumption; corrected in the eighth dispatch with
explicit LF/CRLF coverage. Full local closure and CI including Windows passed.
Internal round 2 is clean; external round 2 and its one fresh-context final checker
found only one minor description omission, accepted and restored: grep defaults to
the whole target unless scoped. This wording-only closure counts as a clean round;
no third external round is required. Focused copy/eval closure is recorded below.
Complete experimental live MCP smoke did not pass (mixed Ask timeout/503);
focused SDK thread/source proof and CLI smoke passed. The user accepted the
guidance-only bootstrap limitation on 2026-09-17; no deployment is included.

**Expected outcome:** Skills/quick-start consistently explain recurring policy once
per loaded guidance path. Tools remain self-sufficient for selection and their own
call contract without restating common policy or their parameter descriptions at
length. The combined loaded surface is smaller, not shifted into a larger guide.
Deliver one coherent copy-only PR, not per-tool or evidence-only increments.

**Assumptions:** The user approved this ownership boundary on 2026-09-17. Tool names,
parameter names/types/requiredness/defaults, service requests, selected fields,
formatters, evidence outputs, availability, and runtime behavior remain unchanged.
Description metadata and quick-start instruction text are the intended changes.
Ask keeps its source-cited answer depth and lower-level follow-ups. Exact skill/quick-start
parity and session bootstrap composition remain. Original format reminders remain;
the shorter candidate was rejected by the early probe.

**Unknowns or product decisions:** None missing. On 2026-09-17 the user accepted
continuing with bootstrap as guidance, not a guarantee, retaining tool-local essentials
and all safety wording. Report actual bootstrap calls; omission alone no longer stops
delivery. No enforcement mechanism is authorized. The short format candidate was
rejected after the early probe and all original format reminders are restored;
do not reintroduce that candidate. Navigation consolidation,
retiring/merging search-status, Ask depth, and backend changelog work remain separate.

**Dependencies:** Existing factories, catalog/schema/skill tests, context inventory,
local smoke suites, agent-eval harness, and authenticated Codex/Claude eval access.
No new infrastructure, backend change, deployment, or instruction-loading mechanism.

#### Verified planning evidence

At merged `9be81a9`, `bun scripts/agent-context-load.ts sizes` reports:

- 13 stable tools; `catalog.full`: 38,742 Unicode characters;
- `catalog.prefix80`: 1,207; `bootstrap.stable`: 5,038; `skill.file`: 5,569;
- catalog hash: `d09c4b970d048deabe318be7150300999e4c97f3b6ba54ea3d5b55a55cf343e8`;
- guide hash: `079c8b765eda371a30278a967371d8b9118bdd24b49f9a4dee15a00ab8aea652`.

These match the merged Phase 2a inputs. Measurements are serialized-content sizes,
not provider token, latency, cost, or independently graded answer-quality claims.
The public MCP skill guide equals the stable builder exactly. Twelve format-field
descriptions total 2,713 characters, plus format repetition in description bodies.
Twelve composition-time bootstrap footers repeat a 101-character prerequisite;
retain that mechanism because individual tools are discovered lazily.

Verified contradictions/repetition:

- Package CLI skill recommends JSON for comparisons/counting and calls text
  human-only, contradicting MCP's model-read-text default.
- Language recovery occurs in the guide, example description, and language field.
  Docs-fragment mechanics occur in guide/search/read/range fields. Package tools
  repeat verbose/filter/depth mechanics and neighboring-tool menus.
- Example/search/search-status first sentences are 113/132/116 characters; current
  tests permit their truncation. The guide does not reach deferred selection.
- Legacy reader redirects, source addenda, and bootstrap reminders have observed
  justification; they are not redundant cleanup targets.
- Changelog description/from-version prose promise exact selection via upper bound
  plus limit-one despite the recorded Phase 2b gap. Remove the unsupported promise;
  retain upper-cap/latest-mode documentation and inputs. Do not implement or claim
  the future exact-target API.

Existing matching-surface baseline evidence: Codex Luna/low overview, vulnerability
filter, and dependency workloads in `phase2a-codex-low-20260916-1342` passed without
isolation violations; the clean docs rerun above completes that set. Claude Haiku's
four recorded `phase2a-claude-haiku-*-20260916-1342` cases passed. The contaminated
Codex docs run is not a passing baseline. Reuse only runs whose settings and relevant
input hashes match; new routing cases need matched runs during candidate verification.
No shorter candidate has been evaluated or approved by this planning evidence.
Version check during planning: Codex remains 0.154.0; Claude is now 2.1.274 versus
2.1.273 in the retained runs. Those Claude runs are historical evidence, not eligible
matched baselines for the current CLI; collect fresh baseline cells before candidates.

Fresh current-Claude format baseline collected during planning in
`.agent-eval/runs/instructions-baseline-claude-haiku-20260917`: overview 20.4 seconds,
dependency assessment 30.6 seconds; harness success, no validation violations,
five observed evidence calls total, all omit format (zero explicit JSON calls).
Calls/finals/metrics were inspected. Usage and normalized logical-call telemetry
remain unknown. Both runs skipped quick-start despite descriptor-only guidance.
These are eligible format-call baselines, not proof that shared posture was loaded
or that bootstrap already works. This contradicts any assumption that the footer
guarantees common guidance delivery; use a copy-only discovery correction below.
Claude's documented harness guarantee is workspace isolation, not causal instruction
isolation. The omitted call is observed, but its cause and complete hidden guidance
are not established; do not conclude the safety posture was absent. Keep these runs
as bounded call-behavior baselines, not proof of fully isolated instruction effects.

#### Execution checkpoint — 2026-09-17

Before edits, the named inventory exactly matched the planning baseline. Captured
all sixteen local schemas/annotations through the existing local server factory,
excluding only recursive description metadata; local serialized catalog 47,040
characters, guide 6,870, runtime appendix 1,832 (serialization differs from the
stable inventory and is compared only with itself).

Fresh unchanged-surface baselines at `f22c4ac`, Codex 0.154.0 / Luna low and
Claude 2.1.274 / Haiku, in ignored `.agent-eval/runs/instructions-baseline-*`:
three descriptor routing cases per provider passed harness validation; each
skill-loaded docs case passed and skipped bootstrap. Both local Ask/diff cases
per provider passed; Codex Ask included one failed tool call and repeated that
follow-up before completing, so aggregate success is not error-free evidence.
Haiku bootstrapped only docs among its three descriptor routing cases and used
undeclared `offset`/`limit` fields on some reads. These are observations, not
proof of absent hidden guidance or root cause. No contaminated trace was discarded.

The coordinator shortened the stable guide/exact MCP skill copy, aligned CLI
text/JSON policy, corrected ownership/historical docs, and restored a literal-name,
72-character bootstrap opening. One Luna dispatch applied the exact decided short
format prose to thirteen schemas; its individually named format/default checks
all passed. The early inventory was catalog 37,341 / guide 4,266 / skill 4,797.
This is a provisional subset, not the completed Phase 6 candidate or savings claim.

Early matched Haiku package probe:
`.agent-eval/runs/instructions-bootstrap-probe-claude-20260917`, same version,
model, flags, workloads and harness as the eligible fresh package baseline.
Both harness cases passed without validation violations. Overview skipped
bootstrap and called info/vulns with JSON; its final used fields available in
text modes and no code consumed raw results. The vulnerability request is an
unjustified JSON increase versus baseline zero. Dependencies bootstrapped once;
its JSON dependency request sought complete issue rows, a retained exception.
Native traces, calls, finals, report and metrics were inspected; Claude usage and
logical-call telemetry remain unavailable, and answers were not independently graded.
The whole copy checkpoint is evaluated together; this does not isolate format
wording causality. The short format candidate is rejected; a second mechanical
dispatch restored baseline prose. At that rollback checkpoint the complete diff of
all thirteen owned producer files was empty, verified independently by the coordinator. Exact stable-guide/public
skill parity also passes. No worker error or interruption caused that correction.
Descriptor rewrites, tests, smokes, build, reviews, commit, and PR delivery were
pending at that pause; provisional edits and raw evidence were preserved.
The user subsequently accepted the guidance-only limitation and authorized continuing
with the original format reminders, tool-local essentials, and all safety wording.

Final-copy inventory after the round-2 grep reminder: stable catalog 34,971 /
guide 4,266 / MCP skill 4,797; catalog + guide 39,237 versus 43,780;
catalog + skill 39,768 versus 44,311.
Catalog hash `6b0123fe797b7b1175dcf3e2d013bec911f05828f0d394075f56335e3bd68ec9`;
prefix hash `2a8f01ac79574f3bf49544c5dbea9644605521f397d65d9f8884b794e70bc5a4`.
Local serialized catalog 43,233 versus 47,040, guide 6,098 versus 6,870, appendix
unchanged at 1,832. All sixteen schemas/annotations match the captured baseline
after recursively excluding only description metadata. The new local selection test
found the unchanged resolver sentence was 80, not <=79, characters; shorten `into`
to `to` and include resolver follow-up evals. Runtime behavior is unchanged.

Final package cases (`instructions-candidate-{codex,claude}-format-20260917`):
all four passed harness validation, zero JSON calls, bootstrap exactly once each.
No increase in unjustified JSON versus eligible baselines. Haiku omitted development
dependency analysis in its dependency answer; no answer-quality grading is claimed.
Final routing cases (`instructions-candidate-{codex,claude}-routing-20260917`):
all six passed, no validation violations or JSON calls. Both used get_example;
Haiku omitted bootstrap in all three. Docs calls reused emitted locators and source
calls followed grep matches. Codex used Ask for additional version verification.
Verified current experimental config is enabled and was last modified 2026-08-19,
before these baselines: local MCP settings enable experimental tools even without the
explicit override flag. This is existing configuration, not added public availability.
Calls, finals, reports and metrics were inspected. Telemetry/grading limitations remain.

Full-skill docs candidates (`instructions-candidate-{codex,claude}-full-20260917`)
both passed without validation violations, bootstrap calls, or JSON. Local candidates
(`instructions-candidate-{codex,claude}-local-20260917`) all passed harness validation,
but both Ask investigations received RATE_LIMITED/429 and switched to lower-level
evidence; these do not prove successful live thread continuity. Diff calls compared
the expected endpoints and obtained full returned patches through the documented JSON
exception. Haiku also used JSON for name-status inventory without an apparent missing
field or code consumer; disclose this, not general JSON reliability.

Initial repository verification: generation/check (10 assets), types, format, build
passed; lint passed with eight existing warnings in unchanged repository-target.ts.
Full tests: 4,811 pass / 8 old-wording assertions failed. Bounded sibling scan located
root MCP instruction tests, the transcript-derived deferred-catalog probe, and
diff/status metadata assertions; align them with the selected owner. Closure command
`bun test src/commands/mcp-instructions.test.ts eval/agentic/probes/claude-ai-deferred-catalog.test.ts
packages/mcp/src/tools/code-diff.test.ts packages/mcp/src/tools/search-status.test.ts`:
53 pass / 0 fail / 305 assertions. Full suite rerun remains required.
Live CLI smoke passed stable/experimental cohorts (116 steps). MCP stable smoke
passed; experimental URL-JSON Ask thread follow-up hit SDK timeout 60,000ms. Preserve
this failed evidence and investigate/rerun the missing proof, without changing client
timeouts, adding retries, or asserting rate limiting caused that separate timeout.

Focused sequential SDK Ask proof subsequently passed: initial callable source
references, same-thread follow-up, and URL-formatted JSON sources (four returned
sources). Client timeout and server behavior were unchanged. The original smoke
suite rerun without overlapping Ask requests again passed the stable cohort,
but experimental initial Ask failed. A one-call diagnostic using that same scoped
smoke environment returned BACKEND_ERROR with HTTP 503. The earlier timeout's cause
remains unknown. This closes live SDK thread/source proof, not the rate-limited
agent candidates' missing qualitative thread-use evidence.

Full unit rerun: 4,818 pass / one 30-second timeout in unchanged
`experimental CLI process policy > keeps stable recovery surfaces available for malformed config`
(17,107 assertions, 208 files, 248 seconds). No remaining old-copy failures.
Isolate the existing process case and rerun full verification without the live
smoke/eval load before attributing the timeout; do not increase its timeout or
change runtime behavior based on this single failure. Live Ask availability is
mixed and the complete experimental MCP smoke is not a passing result.

Closure: the exact isolated malformed-config case passed (one test, 28 assertions,
19.05 seconds). Sequential full suite then passed: 4,819 tests / zero failures /
17,109 assertions / 208 files / 79.12 seconds. Types, lint, format, build, plugin
check and diff check passed afterwards; lint retained the same eight existing
warnings. No code/timeout change; the earlier timeout's cause is not established.

Fresh Luna pre-flight: accepted two wording findings that describe tool-specific
argument ownership as descriptions alone; comment and permanent tool docs now say
descriptions plus schemas. Bounded sibling scan of changed guidance/comments found
no further conflicting ownership claim. Rejected its two requests to remove verified
bootstrap incident commit history: the approved plan explicitly preserves that
history and corrects the reverted-fix account; it is distinguished from current
implementation, not stale runtime behavior. Rejection dated 2026-09-17; no new
evidence warrants reopening it. Fresh internal technical review returned no findings;
no tests rerun by reviewers.

External Opus round 1: no code/schema/runtime/policy-scope/test-weakening findings;
accepted two minor documentation findings. Failure class: permanent tool copy still
described removed neighboring-tool menus, and the CLI skill's relocated continuation
reference was ambiguous. Bounded sibling scan covered the complete Current Tools
table, routing paragraphs, changed ownership docs and CLI code/package/MCP skills.
Aligned the table with current roles/selected contracts, replaced the reciprocal-menu
claim with guide-owned routing, removed the contradictory repeat-search polling
instruction, and pointed the CLI skill explicitly to references/code-and-docs.md.
No runtime or selection metadata changed. After affected documentation checks pass,
these wording-only fixes make this round clean; no additional round is required.
The reviewer ran no covered checks or final checker because it reported findings;
retain that settled reviewer for this PR rather than dispatching another round solely
for applied doc fixes. Closure checks: `bun test src/skills-packaging.test.ts`:
18 pass / zero fail / 223 assertions; plugin generation/check validated ten assets
with no generated diff; format and diff checks passed. All earlier production-copy
and runtime evidence still applies. External review is clean under the doc-only
policy. CI handoff is recorded with the draft PR.

Orchestration record: one reused Luna implementor, eight mechanical dispatches
including brief corrections and the Windows portability fix; one test portability
bug, zero validation-command errors or interrupts. Coordinator kept
copy/ownership judgment, non-mechanical metadata assertions, schema inventory,
live/eval verification and review adjudication inline. Two exact-wording corrections
were coordinator brief errors, not worker failures; the short-format rollback was
an eval decision. The worker chose LF-only fence matching, not a brief requirement;
the coordinator's local-only evidence contract missed CRLF and both review nets
missed it before CI. Cost: one correction dispatch, focused/full verification and
another required technical/external round, not runtime changes. Permanent policy is
in implementation docs and public guidance;
retain this overarching plan for the unfinished phases.

Initial PR CI ([run 35199561988](https://github.com/githits-com/githits-cli/actions/runs/35199561988)):
build/checks, Linux, MCP package validation and Bun/Node 20/22/24/26 compatibility
passed. Windows failed only the new CLI-output-policy test: Core Commands fence
matching assumed LF, but the checked-out skills use CRLF. Root fix is local to that
test's Markdown matcher (`\r?\n`); do not normalize the shared reader or alter source
documents/platform settings. Bounded sibling scan of skills-packaging.test.ts found
its two existing frontmatter matchers already accept CRLF. Worker focused proof:
`bun test src/skills-packaging.test.ts -t 'keeps CLI model-read output in text'`:
one pass / zero fail / 25 assertions, including each skill under explicit LF and CRLF.
All previous policy/safety checks remain; no handlers or guidance metadata changed.
Closure full suite: 4,819 pass / zero fail / 17,113 assertions / 208 files /
61.66 seconds. Types, format, plugin check and diff check passed; production-copy,
build/lint/smoke/eval evidence is unchanged. CI on `139ed81` confirmed the fix:
[run 35200157534](https://github.com/githits-com/githits-cli/actions/runs/35200157534)
passed Build & Checks, Linux, Windows, Bun and Node 20/22/24/26 compatibility;
[MCP package validation](https://github.com/githits-com/githits-cli/actions/runs/35200157340)
passed, with publishing skipped.

External Opus round 2: no code findings; the single fresh-context final checker
verified the full delta and raised one valid minor description omission. Finding
closure: grep's whole-target default had lost its explicit local owner. The request
builder sets `allowUnscoped: true` without path selectors, and existing scoping
fields/CLI references agree. Bounded scan covered the complete grep descriptor,
schema, request builder, metadata tests and guide/skill; no related contradiction.
Restored one clause after the unchanged selection prefix, with one metadata
assertion. No new mechanism, schema/default or runtime change; this doc-only
finding counts clean once applied. The reviewer is retained in
`term_bc4f5f0a-c344-481d-910a-42136f20a64f` for this PR. Opus itself reran no
validation; its final checker reran already-covered targeted files despite the
written brief. Record this review-protocol violation rather than claiming reviewers
ran no checks or using their duplicate runs as additional required proof.

Final wording closure: `bun test packages/mcp/src/tools/grep-repo.test.ts`:
25 pass / zero fail / 102 assertions; `bun test packages/mcp/src/mcp/server.test.ts
packages/mcp/src/mcp/local-server.test.ts packages/mcp/src/mcp/instructions.test.ts`:
24 pass / zero fail / 547 assertions. `bun run typecheck`, `bun run format:check`,
`bun run plugins:check`, `bun run build` and `git diff --check` passed. Inventory command
`bun scripts/agent-context-load.ts sizes` produced the final sizes above; all
sixteen local SDK schema/annotation contracts still equal the captured baseline
after excluding descriptions, and guide/skill/runtime appendices are unchanged
by the restored clause. Final publishing/deployment remain outside this PR.

Final descriptor-only grep follow-up (`instructions-final-{codex,claude}-grep-20260917`):
one unchanged code-grep-investigation workload per provider with the same model,
effort and intent. Both harness reports validated without isolation violations,
both selected whole-target grep and made no JSON calls. Codex bootstrapped once,
then its grep returned `AUTH_REQUIRED`; its neutral final correctly reports failure
to verify, not a successful source answer. Haiku skipped bootstrap, received two
import sites, read the returned files and answered from source. Inspected calls,
native tool results, neutral finals and report/metrics. Thus no clean cross-provider
live-grep completion claim; auth failure origin remains unestablished. No auth
changes/retries or extra eval sweep. Cost/quality telemetry limits still apply.

Resolver opening-only comparison (`instructions-{baseline,candidate}-{codex,claude}-resolver-opening-20260917`):
two existing fuzzy/site follow-up cases per provider, all final copy held constant
except `into` versus `to`. All eight harness cases passed with no validation
violations. Candidate cases made no JSON calls; baseline Haiku fuzzy resolution
used one JSON resolver call. Both candidate providers selected resolve_target and
continued to source/docs evidence; candidate Codex first omitted required `name`, received an
argument error, then corrected it. Codex preserved identity ambiguity; Haiku
selected the leading medium-confidence package candidate and reported it as most
likely. Site candidates used returned standalone targets and emitted locators;
Codex's candidate used sufficient snippets without a read. Baseline Codex had a
failed read after including the displayed locator label, then corrected it.
Baseline Haiku's site case skipped resolve_target, searched package docs, and
invented read locators; it is not passing resolver/site-locator behavior proof.
Candidate bootstrap: Codex once each, Haiku site once/fuzzy none. Inspect actual
calls/finals/metrics/violations, not harness success as error-free proof. This
narrow comparison covers the two-character opening change, not a matched
whole-original-Phase-6-guide baseline; no causal quality or savings claim.

#### Placement contract

| Concept | Shared guide/skill owns | Selected tool retains |
| --- | --- | --- |
| Discovery | Question-to-tool routing | Standalone first sentence and distinct job |
| Targets | Public scope and canonical conventions | Supported family, example, operation-specific pin/ref constraints |
| Output | Model-read text versus code-consumed JSON | Short reminder and real full-patch/missing-field exceptions |
| Evidence | Reuse locators, focused reads, provenance and limits | Tool-specific interpretation and callable follow-up mapping |
| Recovery | Follow rendered actions; do not invent locators or poll by repeating calls | Unique continuation conditions, status/range/wait exceptions |
| Safety | Existing external-content posture | Existing source addenda and input privacy constraints |

Keep shared guidance self-contained, not replaced with implementation-doc links.
CLI skills independently express equivalent shared rules: loading the MCP skill
must not become a CLI prerequisite. Cross-tool references may name an alternative
job, but are not needed to understand the selected tool's arguments. This placement
matches natural ownership; a new shared copy framework would reduce source repetition
without necessarily reducing agent-loaded content, so do not introduce one.

#### Implemented scope

- Stable routing guide and exact public MCP skill copy share recurring policy.
  Language recovery and docs fragment/range/wait mechanics remain selected-tool
  owned; routing, target conventions, evidence limits, and shared safety remain.
- Descriptor bodies remove duplicate parameter/output inventories and neighboring
  menus. Selected schemas preserve operation-specific arguments and exceptions.
  Changelog cap wording no longer promises exact lookup; dependency depth wording
  now accounts for importer and full-graph issue opt-ins.
- All stable/local selection sentences fit 79 characters. Quick-start restores
  literal-name discovery and first-call/safety purpose; loaded-skill exception and
  per-tool footers remain. Ask and experimental runtime appendices are unchanged.
- All thirteen original format descriptions, shared external-content posture,
  source addenda, and CLI safety text remain. CLI code/package skills independently
  use model-read text rather than unconditional JSON; ordinary examples omit JSON.
- Metadata tests cover retained meanings at their selected owner, complete
  selection sentences, guide parity, and independent CLI output policy. All sixteen
  schema/annotation contracts match baseline after removing description metadata.
- Permanent ownership and bootstrap-history docs are corrected; CLI changelog docs
  and package reference agree with upper-cap semantics. One patch/patch fragment
  records the copy-only changes. Plugin generation/check produced no asset diff.

No handlers, request builders, selected fields, formatters, transport, auth,
schema shapes/defaults, onboarding, version bumps, historical changelog edits,
publishing, or deployment changed. Verification and review results are recorded
above and below; the overall plan remains through its unfinished phases.

#### Verification and acceptance

- Re-run the named inventory: require lower full catalog, stable guide/skill, and
  sums of catalog plus each alternative bootstrap path (guide or skill). Measure
  enabled local descriptor/appendix sizes through existing local factory seams as
  well; stable totals must not hide experimental growth. Record changed prefix hashes
  intentionally. Do not equate Unicode characters with model tokens or bill savings.
- Run `bun test packages/mcp/src/mcp/server.test.ts
  packages/mcp/src/mcp/instructions.test.ts packages/mcp/src/mcp/local-server.test.ts
  packages/mcp/src/mcp/local-agentic-ask.test.ts src/skills-packaging.test.ts
  eval/mock-mcp/server.test.ts` and changed tools' tests. Run source
  `bun run smoke:mcp`/`smoke:cli`, build, types/lint, plugin generation/check, and
  the full `bun test` suite (or current full-suite CI with any local failures disclosed).
  Built smokes are additionally required if launch/CI product validation changes.
- Matched format cases: local MCP/descriptors/GitHits intent, Codex
  `gpt-5.6-luna`/low and Claude `haiku`, `package-overview-vulnerabilities.md` and
  `package-dependencies.md`. Keep CLI versions, model/effort, prompts, flags, and
  harness identical between baseline/candidate. Inspect each explicit JSON call:
  was raw data consumed by code or a required field absent from text? Require no
  increase in unjustified JSON calls per workload/provider. Restore old reminder
  if the candidate increases them; report evidence rather than add prompt machinery.
  Existing matching baseline traces may be reused; otherwise run these two baseline
  cases before candidate. Single pairs are bounded evidence, not reliability statistics;
  repeat only an inconclusive/disputed case.
  Record whether descriptor-only cases call quick-start before evidence and whether
  bootstrap is duplicated. The user accepted guidance-only bootstrap on 2026-09-17;
  omission is a disclosed limitation, not a delivery gate or permission to add enforcement.
  The short-format probe already failed the JSON criterion; original reminders are
  restored and retained for the final candidate.
- Matched routing cases for both agents: `docs-discovery.md`, `global-example.md`,
  and `code-grep-investigation.md`, same descriptor-only settings. Inspect actual docs
  locators, examples/topic selection, and focused source follow-ups. Run docs-discovery
  in full guidance as well: verify the loaded skill skips quick-start and record
  descriptor-only bootstrap behavior without treating guidance as guaranteed loading.
  For Ask, baseline/candidate `ask-version-followup.md` with experimental tools for
  both agents. A run never using Ask does not prove thread/source mechanics; retain
  unit proof and use the smallest focused Ask prompt if necessary to exercise changed
  selection copy. Do not force broad example questions down an inappropriate route.
  If candidate traces skip shared guidance, disclose that observation without claiming
  guaranteed policy loading. Retain tool-local call essentials, format reminders,
  bootstrap footers, and existing source protection. No guards/loaders are authorized.
- If resolution/diff descriptors or their local appendices change, add matched
  `experimental-resolution-follow-up.md`, `experimental-site-resolution-follow-up.md`,
  and `experimental-code-diff.md` for the affected surfaces, with experimental tools
  enabled and both named lower-cost agents. Inspect actual resolution/diff selection,
  ambiguity/actionability handling, site-to-docs follow-up, endpoint scope, truncation,
  and compatibility limits. Reuse baseline only under the same settings/hash rules;
  unchanged experimental bytes need no new cases. Existing workloads suffice.
- Run bounded groups separately, concurrency at most two per harness, not the whole
  suite. Before a group expected over five minutes, state its question and why narrower
  evidence is insufficient. No credential output, auth/config changes, or weakened
  isolation. Preserve and reject contaminated traces, not their underlying evidence.
  Inspect calls/finals/metrics/violations, not just harness status or confidence.
  Disclose telemetry and quality-grading gaps; no provider savings claims from sizes.
- Every removed instruction remains with its natural owner or is demonstrably
  redundant; no selected tool needs another evidence descriptor for its own arguments.
  Fresh internal technical review and one external Opus code reviewer per round close
  the full delta. Retain this overarching plan through remaining increments; transfer
  durable ownership policy before deleting it after the last increment merges.

**Planning verification:** The unchanged merged surface passed
`bun test packages/mcp/src/mcp/server.test.ts packages/mcp/src/mcp/instructions.test.ts
src/skills-packaging.test.ts`: 33 tests / 573 assertions on 2026-09-17. The inventory
was collected before instruction edits. At that planning checkpoint the branch changed
only the plan; production copy, behavior, plugin assets, and eval configuration were unchanged. Plan-review
findings and disposition are recorded after internal/external review.

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

- Phase 6 internal technical review (2026-09-17): accepted the experimental-copy
  eval coverage gap, calibrated as a bounded verification gap rather than an existing
  blocking product defect. Added existing resolution/site-resolution/diff cases for
  affected copy; no new harness. Full-delta closure returned no findings. Follow-up
  review of fresh bootstrap evidence found only an overly broad format-restoration
  condition; narrowed it to increased unjustified JSON calls, so intended bootstrap
  improvements are not rejected. Applied this minor wording fix; internal review is
  clean under project policy. Claude instruction-isolation limits remain explicit.
- Phase 6 external Fable plan review (2026-09-17): accepted one minor documentation
  scope finding, also found by its single fresh-context final checker. The stale
  literal-name bootstrap claim occurs in tools.md as well as TOOL_GUARDRAILS.md;
  verified both against current quick-start.ts and `2a02a2e`. Expanded step 7 to name
  both current-state/incident accounts and the revert, aligning them with step 3's
  tested descriptor while preserving historical measurements. Applied this wording
  correction; that documentation-only finding counts clean under project policy.
  However, the report says the plan does not require the literal quick-start name:
  this contradicts the newer explicit bootstrap criterion added during that review.
  The same reviewer receives a final round over the current snapshot for that
  material acceptance change, not another round for the minor wording finding.
  No tests/evals rerun by reviewers; no new runtime scope or product decision.
- Phase 6 external Fable round 2: clean over the complete current snapshot; no
  new reviewer or validation rerun. Confirmed bootstrap/format gates, observed
  baseline omissions and isolation caveats, and corrected its prior snapshot/policy
  statements. Accepted its no-action caveat that combined bootstrap/copy changes
  do not isolate reminder causality: acceptance concerns the complete candidate's
  observed calls, not a causal savings/reliability claim. No extra experiment or
  mechanism needed. The same Fable reviewer is retained for plan inspection.

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
