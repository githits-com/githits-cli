# Plan: Stable hosted-documentation follow-ups

## Status

- Overall: **COMPLETE**
- Phase 1: **COMPLETE**

## Overall objective

Automatic CLI and MCP follow-ups generated from unified-search evidence must
treat hosted/crawled `documentation_page` HTTP(S) locators as mutable
current-content addresses. They forward the backend-emitted page URL or exact
heading fragment unchanged and omit observed search line bounds. Repository
documentation remains snapshot-addressed and keeps its focused ranges, while
explicit caller-supplied documentation read bounds continue to cross the public
read boundary unchanged.

### Problem

GitHits 0.17.1 fixed fragment follow-ups but still attaches a search hit's
`startLine` / `endLine` to a page-only hosted documentation URL. Those values are
display/evidence coordinates from one publication, while the URL resolves the
publisher's current body. If the page changes, the automatic follow-up can read
the wrong current excerpt or fail instead of reading the current page.

### Verified current state and evidence

- Planning baseline is clean `origin/main` at
  `ce93eb1f80742d88162d8a07ec7c0009f307dfd7`, fetched on 2026-09-17.
- `packages/mcp/src/shared/follow-up-command-text.ts`
  `documentationReadLocator()` is the shared pure owner for the read target used
  by CLI text and MCP text/JSON. `buildUnifiedSearchSuccessPayload()` uses
  `buildSearchHitFollowUpCommand()` for the MCP-syntax JSON `followUp`; CLI text
  displays `documentationReadLocator().target` rather than an executable command.
  The helper's CLI command syntax remains an internal/tested representation, not
  a currently emitted CLI-search field.
- A direct baseline probe against current main produced:
  - hosted page: `read target="https://docs.example.test/guide" start_line=81 end_line=93`
  - hosted CLI page: `githits read 'https://docs.example.test/guide' --lines 81-93`
  - repository doc: the snapshot target with the same range on both surfaces.
- Existing fragment branches already return the exact emitted HTTP(S) fragment
  without bounds, including mixed-case schemes. They do not decode, normalize,
  or synthesize anchors.
- `packages/mcp/src/shared/unified-search-response.ts` retains the original
  locator ranges independently of the generated `followUp`. The fix therefore
  need not discard search evidence from JSON.
- Explicit manual reads bypass follow-up selection. MCP
  `packages/mcp/src/tools/read.ts`, CLI `src/commands/read.ts`, shared request
  validation, and `ReadServiceImpl` already forward caller bounds. Current tests
  cover CLI fragment-range override and the public service wire variables; the
  phase adds a direct MCP public-tool regression.
- Focused baseline tests passed: 148 tests across the shared follow-up, search
  response, MCP read, and CLI read suites.
- Backend contract is already deployed in pkgseer-backend PR #2595 at
  `d1d5ef9c377b6f06f5eed81c2c9c473e54ead9d8`: hosted/crawled docs are mutable
  current-content URL addresses; repository docs are a separate snapshot
  contract; search lines are evidence coordinates; headings select their full
  subtree. No backend work is required or in scope.

### Scope

- Change shared automatic follow-up generation so an HTTP(S)
  `documentation_page` target never inherits observed search bounds.
- Preserve exact page-only target bytes and the existing exact
  `docsReadTarget#fragment` promotion rule; do not derive anchors.
- Preserve ranges for `repository_doc` targets and other snapshot-addressed
  repository reads.
- Preserve structured locator evidence, manual read arguments, schemas, backend
  queries, and read-service behavior.
- Update stable MCP routing guidance, CLI Agent Skill guidance, tool guidance,
  and permanent implementation documentation to distinguish mutable hosted URLs
  from snapshot-addressed repository documentation.
- Add one change fragment with patch impact for both `githits` and
  `@githits/mcp`; do not prepare or execute a release.

### Non-goals

- Backend, pkgseer-backend, remote-mcp, or other-worktree changes.
- Docpack IDs, page-row IDs, versions, historical storage, snapshots, retries,
  fallback reads, compatibility branches, feature flags, or inferred anchors.
- Curated answers or repository-doc addressing changes.
- Changing explicit `read` / `docs read` line-range semantics.

### Target architecture and ownership

`documentationReadLocator()` remains the sole automatic documentation follow-up
selector. For `documentation_page` plus an HTTP(S) effective target, it returns
the exact target without search bounds, except that it continues to promote an
exact backend-emitted `target#nonempty-fragment` source URL unchanged. Every
other documentation locator retains the existing target and evidence bounds.

The shared follow-up formatter naturally owns this policy because it translates
search evidence into CLI and MCP actions. The read request/service layers own
explicit caller selections and remain unchanged. Putting the rule in either CLI
or MCP entrypoint would duplicate policy; putting it in the read service would
erase the distinction between generated evidence coordinates and intentional
caller bounds.

```text
search hit locator
  -> shared documentationReadLocator
       hosted documentation_page HTTP(S): exact URL/fragment, no evidence bounds
       repository_doc: exact snapshot target + evidence bounds
  -> CLI command / MCP followUp string

manual read arguments
  -> existing read request boundary
  -> exact caller target and optional bounds (unchanged)
```

### Cross-cutting considerations

- **Security:** Locator bytes remain opaque and shell quoting remains unchanged;
  no URL parsing beyond the existing case-insensitive HTTP(S) classification and
  exact fragment-prefix comparison is added.
- **Performance:** This changes one constant-time pure branch and adds no I/O.
  No performance claim or benchmark is needed because no performance path is
  being optimized.
- **Compatibility:** The structured search locator continues to expose original
  evidence ranges. Only generated hosted-doc follow-ups stop replaying them.
  Repository-doc and explicit manual ranges stay compatible.
- **Migration/rollback:** No data migration exists. A rollback restores the prior
  formatter branch; it would also restore the publication-replacement defect.
- **Operations:** Hosted clients receive the MCP behavior only after the normal
  `@githits/mcp` release, remote-mcp dependency update, and deployment. None of
  those last-mile steps is authorized here.
- **Documentation:** Update `docs/implementation/tools.md`,
  `docs/implementation/cli-commands.md`, and `docs/implementation/unified-read.md`.
  Keep `buildMcpQuickStart()` and the terminal guide in
  `skills/githits-mcp/SKILL.md` byte-for-byte aligned; update the canonical CLI
  files `skills/githits-code/SKILL.md` and
  `skills/githits-code/references/code-and-docs.md`, then regenerate/check plugin
  assets. Follow the repository-local `githits-plugin-maintenance` workflow and
  its required `docs/implementation/plugin-packaging.md` guidance; never author
  generated plugin assets directly.

### Overall assumptions

- `resultType: DOCUMENTATION_PAGE` is the authoritative discriminator for the
  mutable hosted/crawled contract, and `REPOSITORY_DOC` remains the independent
  snapshot contract. This is verified by the deployed backend contract supplied
  for the task and by current typed result handling.
- `docsReadTarget`, falling back to `pageId`, is the exact read target. The client
  must not manufacture a different address.
- An exact emitted `sourceUrl === target + "#" + nonempty-fragment` remains the
  only allowed source-URL promotion.

### Unknowns or product decisions

None. Current main confirms the requested boundary and the backend contract
settles hosted-versus-repository semantics.

### Dependencies

- Deployed backend contract from pkgseer-backend PR #2595.
- Existing shared search formatter, unified read surface, plugin generator, smoke
  harness, and agent-eval harness.

### Planning review

- Internal pre-flight found that the first draft treated the helper's CLI command
  representation as emitted CLI search output. Accepted and corrected: CLI text
  displays the shared target, while JSON `followUp` uses MCP syntax. The draft
  also now names both canonical CLI skill files and the plugin-maintenance flow.
- Fable plan review was clean. Its final fresh-context check noted only that the
  existing shell-quoting test encodes the defective page-only `--lines` suffix;
  Phase 1 step 1 already requires rewriting that assertion bounds-free while
  retaining its quoting coverage.

### Implementation and verification evidence

- The implementation remains at `documentationReadLocator()`. Hosted/crawled
  HTTP(S) `documentation_page` targets now forward the exact page URL or exact
  emitted fragment without observed bounds. `repository_doc` targets retain
  snapshot ranges, structured search locators retain their evidence coordinates,
  and explicit CLI/MCP documentation-read bounds still cross the public boundary.
- Stable guidance now describes hosted documentation as mutable current content,
  distinguishes repository documentation as snapshot-addressed, and documents
  heading-subtree reads through the next equal-or-higher heading. Canonical MCP
  guidance and its packaged skill copy remain in exact parity. Plugin generation
  produced no unexpected generated changes, and `plugins:check` validates all 10
  assets.
- Regression coverage includes page-only hosted URLs, exact fragments, mixed-case
  schemes, repository ranges, retained JSON evidence, CLI output, direct MCP read
  bounds, publication-replacement semantics, and the live smoke assertion. The
  final full suite passes 4,826 tests across 208 files with zero failures.
- Final static/product checks pass: `bun run typecheck`, `bun run format:check`,
  `bun run lint`, `bun run build`, `bun run plugins:check`,
  `bun run validate:packages`, `bun run smoke:cli:built`, and
  `bun run smoke:mcp:built`. Lint reports only eight pre-existing
  `noNonNullAssertion` warnings in
  `packages/mcp/src/shared/repository-target.ts` and exits successfully.
- Source CLI unauthenticated smoke and source MCP registration smoke also pass.
  After resolving a local keychain prompt, a live source search for `routing`
  against `site:expressjs.com` returned hosted `documentation_page` hits whose
  locators retained observed ranges while every generated `followUp` omitted
  `start_line` and `end_line`. Human-readable CLI output displayed the exact
  hosted target without coordinates, and an unbounded live read of the returned
  `https://expressjs.com/en/5x/guide/routing/` target returned the current page
  from line 1 through its reported total. The 16,278-line aggregate target also
  completed through both source and built CLIs and produced valid JSON. The full
  Express corpus refresh was then verified with a live `route methods` search:
  the hit retained evidence lines 56–66, emitted
  `https://expressjs.com/en/5x/guide/routing/#route-methods`, and generated the
  exact bounds-free follow-up. Executing that emitted fragment returned lines
  56–112 beginning at `## Route methods`, confirming the full heading subtree
  rather than the narrower search coordinates. The full
  authenticated MCP smoke progressed through live package calls but stopped on
  an unrelated `pkg_upgrade_review` success assertion before reaching its docs
  block; the focused live search-to-read path itself is verified.
- Targeted agent evaluation was attempted. Claude could not start because its
  isolated harness was not logged in. Codex invoked `search` and `docs_list` but
  the run timed out after 302 seconds while the service calls remained in
  progress; its tool-call and metrics artifacts were inspected, and it produced
  no final or isolation artifact. No qualitative answer-quality claim is made.
- Internal pre-flight found one missing CLI read-help clarification; it was fixed.
  The retained Opus reviewer completed three rounds. Valid findings covering
  heading guidance, discriminating CLI assertions, live smoke coverage, and the
  real incomplete-search envelope were fixed and rechecked. The final report is
  **CLEAN** at commit `c277fa2`; the rejected opaque-`pageId` expansion was not
  re-raised because it is outside the verified HTTP(S) contract.
- Stable commits through review are `267f459`, `c4feb8f`, `cccbd37`, `4425df7`,
  `a42da6c`, and `c277fa2`, following the committed plan `dc553ae`.
- Delivery is complete through draft PR
  [#405](https://github.com/githits-com/githits-cli/pull/405), labeled `fix` and
  `documentation`. Merge, release, publication, and deployment remain outside
  this plan and were not performed.

### Overall acceptance criteria

- Page-only hosted search hits emit bounds-free CLI and MCP follow-ups while
  retaining their structured evidence coordinates.
- Hosted fragment hits remain bounds-free and preserve the exact emitted fragment.
- Repository docs keep their snapshot locators and ranges.
- Explicit caller-supplied docs-read ranges reach CLI, MCP, and service boundaries
  unchanged.
- Tests model publication replacement by treating hosted search coordinates as
  stale evidence and proving they are absent only from the automatic current-URL
  action. No snapshots, retries, or compatibility machinery are added.
- Focused and full tests, typecheck, Biome format/lint, build, plugin generation
  and validation, package validation, CLI/MCP smoke suites, built smoke suites,
  and one available live/dev search-to-read path complete or are reported with
  exact environmental limitations.
- Targeted agent evaluation covers the changed stable guidance and its artifacts
  are inspected for actual calls, final answer, metrics, and isolation violations.
- The implementation passes internal pre-flight and the required Opus review loop,
  is committed in stable increments, pushed, and opened as a draft PR.

## Phase map

1. **Phase 1 — hosted current-content follow-ups omit search bounds while every
   snapshot/manual range contract remains intact: COMPLETE.**

## Phase 1 detailed plan

### Status

**COMPLETE**

### Expected outcome

Every automatic search-to-read action uses the stable address appropriate to its
source: mutable hosted docs use the exact current-content URL or emitted fragment
without search coordinates, while repository docs keep exact snapshot ranges.
Callers can still intentionally request any valid documentation range.

### Assumptions

- The overall assumptions above remain true at implementation start.
- Existing live smoke credentials, if present, can be consumed by repository
  smoke commands without being displayed. Their absence is an evidence limit,
  not a reason to add a fallback.

### Unknowns or product decisions

None.

### Dependencies

- Overall dependencies above.

### Implementation steps

1. Add failing shared-formatter and response regressions for page-only hosted
   URLs with stale publication coordinates, exact fragments, repository-doc
   snapshot ranges, and the internal CLI plus emitted MCP command
   representations. Add a CLI command-level search regression proving the public
   hit displays the exact hosted target without coordinates, and a focused MCP
   read-tool assertion that explicit documentation bounds are forwarded unchanged.
2. Tighten `documentationReadLocator()` at the existing boundary: classify only
   HTTP(S) `documentation_page` targets as mutable, retain exact fragment
   promotion, and omit bounds for their page-only fallback. Leave structured
   locators and manual read construction unchanged.
3. Update the search tool descriptor and its contract tests, stable MCP guide and
   exact public-skill copy, CLI Agent Skill/reference and packaging assertions,
   and the three permanent implementation documents. Keep wording explicit that
   generated actions differ from explicit reads.
4. Add a cross-package fixed change fragment (`githits: patch`,
   `@githits/mcp: patch`), regenerate plugin assets from canonical inputs, and
   inspect every generated diff.
5. Run focused tests first, then the full required validation. Run targeted stable
   agent evals because stable instructions/tool guidance change, and inspect their
   artifacts rather than treating harness exit status as quality evidence.
6. Run internal pre-flight and Opus review rounds to a clean result, applying and
   verifying every valid in-scope finding. Update this plan to actual evidence,
   commit review fixes, push, and open a draft PR without merging or releasing.

### Edge cases and boundaries

- Mixed-case HTTP(S) schemes receive the same hosted classification.
- A target with an existing nonempty fragment is forwarded byte-for-byte.
- A page-only target is forwarded even when `sourceUrl` is identical, absent, or
  a distinct non-promotable URL.
- Only an exact byte-prefix `target#nonempty-fragment` is promoted; encoded,
  normalized, reordered, or guessed alternatives are not.
- A repository-doc hit keeps bounds even if it carries URL provenance because its
  result type, not provenance shape, owns snapshot semantics.
- Missing `docsReadTarget` continues to fall back to `pageId`; an HTTP(S) page ID
  follows hosted current-content semantics, while opaque IDs retain ranges.
- Explicit zero/one/two-sided manual ranges keep current validation and forwarding.

### Verification strategy

- Focused unit tests:
  - `bun test packages/mcp/src/shared/follow-up-command-text.test.ts`
  - `bun test packages/mcp/src/shared/unified-search-response.test.ts`
  - `bun test packages/mcp/src/tools/read.test.ts src/commands/read.test.ts packages/core-internal/src/services/read-service.test.ts`
  - affected instruction, descriptor, skill-packaging, and parity tests.
- Repository checks: `bun test`, `bun run typecheck`, `bun run format:check`,
  `bun run lint`, `bun run build`, `bun run plugins:generate`,
  `bun run plugins:check`, and `bun run validate:packages`.
- Smoke checks: `bun run smoke:cli`, `bun run smoke:mcp`, then after build
  `bun run smoke:cli:built` and `bun run smoke:mcp:built`.
- Live/dev acceptance: exercise a real docs search that returns a hosted page,
  copy the exact displayed CLI `[docs page]` target into `githits read`, and
  separately inspect and execute the MCP `followUp` with absent bounds. If CLI
  JSON is inspected, record that its shared `followUp` uses MCP syntax. Also
  retain the smoke harness's explicit ranged docs read. Use the available
  local/dev or live mode only; do not expose auth state or secrets.
- Agent guidance: run targeted `docs-search-followup` workloads for Claude and
  Codex when practical, then inspect `tool-calls.json`, `final.json`,
  `metrics.json`, and any `isolation-violations.json`.

### Phase acceptance criteria

- All overall acceptance criteria hold.
- The code delta stays at the shared formatter owner with no backend/service
  behavior change and no new infrastructure.
- Documentation and generated plugin surfaces agree with the implemented rule.
- Review is clean and the draft PR is open with required labels/check status
  reported.

## Phase-boundary reorientation

This is the only implementation phase. Before implementation, compare HEAD and
the plan to freshly fetched `origin/main`; stop if the shared owner or backend
contract changed. Before PR creation, replace planned verification with actual
results and reconcile any contradictions. No later implementation phase begins
from this plan.

## Completion and cleanup

Phase 1 is complete when its acceptance criteria are verified, review is clean,
the plan records actual evidence, and a draft PR is open. Keep this plan through
PR review. After the PR merges, transfer any remaining durable facts to the named
implementation documents (already part of this phase) and delete this temporary
plan in the repository's normal post-merge cleanup increment.
