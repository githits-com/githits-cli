# Plan: Compact search provenance and accurate coverage fixtures

## Outcome

One increment corrects shared CLI/MCP search and search-status text: return each
source identity once, omit searched categories with zero hits, and remove the
routine code/docs/symbol breakdown from Sources. Keep supplied dates, refs,
requested aliases, snapshot freshness, hits, and follow-up actions.

The user authorized planning and orchestrated implementation on 2026-11-16.
There are no open product decisions. No backend, schema, request, JSON, release,
or deployment change is needed.

## Verified evidence and rejected premise

- CLI `searchAction()` and MCP search/status use the shared response/presentation
  helpers in `packages/mcp/src/shared/`.
- The reported Linux search returned ten code hits plus a SEARCHED repository-doc
  contributor with zero hits, at the same commit. `projectProvenance()` currently
  emits both and adds category and zero-count qualifiers. The renderer flattens
  these into Sources without grouping.
- Backend inspection at pkgseer-backend commit
  `3dd12cc9c55e4d645e5906ad58e168c7fece99b4` established:
  `search/discovery/contributors.ex` omits coverage on repository contributors;
  only DOCPACK constructors assign it. `search/discovery/result.ex` sets
  repository-source coverage to nil. GraphQL explicitly documents contributor
  coverage for DOCPACK, and `contributors_test.exs` asserts this exact shape.
  This establishes source behavior, not the deployed revision.
- The user rejected independently partial repository-doc indexing. Permissive
  client schemas and synthetic fixtures do not establish that state. Correct
  the misleading fixtures; do not design warning merging or category-tracking
  machinery around them. This rejection supersedes earlier review suggestions
  based on that premise and must not be reopened without backend evidence.
- Existing website-crawl coverage remains valid. An existing empty-site fixture
  reports 120 pages and partial coverage; preserve that diagnostic through the
  existing target details when its zero-hit provenance row disappears.
- The branch was fast-forwarded to current origin/main before implementation;
  the two intervening commits concern upgrade-review heuristics and Node.

## Ownership and design

Search presentation owns source selection and grouping because it has the
request, hits, source statuses, and full identities. Keep the generic
`source-provenance-text.ts` row grammar unchanged; it also serves other tools.
No new module, dependency, service, cache, flag, or infrastructure is required.

1. In `projectProvenance()`, emit no rows for an empty result page or an explicit
   zero-count source/contributor. Keep resolution records for existing
   preparation/requested-ref explanations. Missing source counts remain unknown.
2. Preserve existing repository-hit attribution for contributor-less sources.
   Docs contributors retain their existing SEARCHED plus positive-count rule;
   do not add a hit-locator requirement that changes that contract.
3. Remove routine content-category and per-category `no results` qualifiers.
   Preserve meaningful `requested:`, snapshot freshness, and website coverage
   qualifiers. Do not reinterpret partial search results as partial indexing.
4. Group compatible source facts before rendering. Repository identity uses raw
   URL and full SHA, never displayed eight-character prefixes. Equivalent
   request spellings may share a row when no meaningful displayed alias differs.
   Keep different requested package versions/explicit refs distinguishable.
   Exact package/site/identity-less rows may deduplicate without manufacturing
   a shared repository identity. Retain stable first-occurrence ordering.
5. Combine missing date/ref metadata only for matching full identities and
   compatible aliases/qualifiers. Keep conflicting nonempty metadata or trust
   facts separate rather than silently selecting a winner. Never infer dates
   or copy a read ref into indexed-ref provenance.
6. Keep existing preparation, unavailable/indexing, stale/provisional, filter,
   and terminal-status diagnostics. Empty stale/indexing pages still disclose
   the searched commit in target details; an older snapshot remains explicit
   even when requested SHA is unknown. Empty current pages need no Sources row.
   Retain existing website-crawl limits for omitted zero-hit sites using the
   existing target-detail formatter. No warning-placement redesign is in scope.
7. Public JSON and service selections remain unchanged. Initial/status and
   CLI/MCP share the behavior; ANSI and width are formatting inputs only.

Alternative considered: retain category-specific rows or nested category counts.
Both preserve the breakdown the user declined. Deduplicating formatted short-SHA
strings loses identity precision. Use the existing structured provenance facts.

## Single phase: source and fixture correction

Expected outcome: the Linux shape renders one row containing the repository,
commit, known date, and indexed ref. Shared-snapshot code/docs/symbol hits also
share one compatible row. Zero-hit categories add none. Existing unrelated
warnings/actions and structured metadata remain available.

Assumptions: existing response facts suffice (verified above). Unknowns: none.
Dependencies: current shared presentation/renderer, fixture factories, Bun/build
and ordinary smoke/eval authentication. No implicit login or credential output.

Implementation order:

1. Correct the misleading repository-doc coverage fixture(s). Coverage assertions
   that test website crawling use DOCPACK; repository freshness assertions stay
   repository-specific. Do not tighten the public schema in this correction.
2. Update `unified-search-presentation.ts` and targeted regressions for row
   selection, qualifier removal, and exact-identity grouping. Make the minimal
   `unified-search-text.ts` changes needed for empty-page snapshot disclosure and
   retained website diagnostics. Preserve per-request resolution records.
3. Update old zero-hit/type-qualifier expectations in search text/status/snapshot
   tests and `src/tools/search-parity.test.ts`. Add one compact mixed-source
   CLI/MCP initial/status regression, including unchanged JSON projection.
4. Update affected structural smoke assertions, permanent search snapshot docs,
   and one `changes/search-source-provenance.fixed.md` fragment: patch for both
   `githits` and `@githits/mcp`. Do not edit changelog history or versions.

Acceptance criteria:

- Linux-shaped zero-docs plus code hits: exactly one row, date/ref retained,
  no routine category/zero-hit qualifiers; hits and continuation/read actions
  unchanged. Same-snapshot positive docs/code/symbol results also coalesce.
- Empty pages have no Sources section for either hasMore value. Existing empty
  headlines/recovery stay correct. Stale/indexing empty pages retain commit,
  older-snapshot, and requested-ref facts in initial/status output without
  advising nonexistent reads or polling ended searches.
- Distinct repos/full SHAs (including equal eight-character prefixes), sites,
  requested versions/explicit refs, and conflicting metadata stay distinct.
  Missing counts/metadata and optional docs hit locators preserve existing truth.
- Exact duplicate package/site rows coalesce. No cross-request hit borrowing or
  invented commit metadata. Widths 40/80 and plain/ANSI preserve the same facts.
- A package with code hits and a zero-hit DOCPACK contributor with PARTIAL or
  CAPPED website coverage retains that site limit exactly once in target
  details, alongside its single code Sources row, in initial/status text.
- Repository-doc fixtures contain no invented crawl coverage. Existing website
  coverage, unavailable/indexing and snapshot diagnostics still render. Public
  JSON, including zero-count contributors, remains unchanged across CLI/MCP.

## Delegation sequence

Coordinator retains runtime selection/grouping, behavioral tests, docs, and
verification because they require attribution and contract judgment.

One worker, one concern: correct repository-doc crawl-coverage fiction in
`unified-search-presentation.test.ts`, preserving target-attribution coverage
using a DOCPACK fixture. Acceptance: the named target-alias test passes and
asserts stale repository facts separately from site coverage. Worker returns
uncommitted edits. Additional slices only if separately bounded and justified;
no parallel implementation or speculative scope.

## Verification and delivery

Run focused shared presentation/text/status/snapshot and search-parity tests,
then `bun run typecheck`, `bun run build`, `bun run smoke:cli`, and
`bun run smoke:mcp`. Run affected smoke-helper tests when their validators change.
Verify real initial search against dev with `GITHITS_ENV=dev` and inspect JSON
source facts without exposing credentials; remove unintended endpoint overrides
for that run. No production verification is needed.

Run one targeted agent eval because default agent-facing text changes:
`bun run agent:e2e --agent claude --server local --guidance-profile descriptors --workload eval/agentic/workloads/unified-search-investigation.md`.
Inspect tool calls, final answer/confidence, metrics, and isolation violations;
harness completion is not a quality grade. Report missing auth/runtime evidence
plainly. Announce a run expected to exceed five minutes with the question it
answers. This is a UX correction, not a runtime performance optimization; no
performance claim or benchmark infrastructure is proposed.

Internal technical review and external Claude review gate the plan; implementation
uses Luna preflight, internal technical review, and a fresh external Claude loop.
Commit stable verified deltas, push, and open a draft PR. No merge/release/deploy.
Both packages need later release preparation; hosted MCP additionally requires
its normal dependency update and deployment outside this increment.

After clean implementation review, move the final contract into
`docs/implementation/search-snapshot-presentation.md` and retire this plan in
that increment's final push. Verification/CI/eval results belong on the PR.
