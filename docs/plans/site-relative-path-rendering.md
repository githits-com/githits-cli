# Site-relative list rendering

Status: Complete. Implemented, locally verified, and reviewed clean; delivered as
[draft PR #432](https://github.com/githits-com/githits-cli/pull/432) to `main`.
CI is running. Merge, release, publication, and deployment remain unauthorized.

## Outcome and evidence

Site directory text preserves backend-owned relative paths and identifies their
usable target, including strict descendants of a canonical site owner.
Published `githits@0.23.0` rendered four valid directories as `/` for
`site:reference.langchain.com/python/langchain/agents`. The raw JSON retains
`_subagent_transformer/`, `factory/`, `middleware/`, and `structured_output/`
with browse actions using the requested target. The supplied dev JSON/text
captures establish this reproduction; built-CLI verification artifacts below
record the corrected behavior.

## Ownership and scope

The backend owns normalization, owner resolution, relative paths, and exact
actions. `packages/mcp/src/shared/list-text.ts` owns faithful text rendering;
the CLI delegates to it. Remove its obsolete first-component stripping and
use the shared site PAGE action target or requested target in site headers.
Keep SOURCE canonical-target behavior and exceptional exact URL actions.
Update the CLI skill, its reference, directly related implementation docs,
the MCP read-path descriptor, and one release fragment. No adapters,
compatibility guesses, dependencies,
transport changes, backend edits, publication, or production probes.

## Assumptions and unknowns

- Verified: compact site text fetches PAGE read actions; directory paths and
  requested target are available without fetching browse actions.
- Verified: the supplied dev JSON is valid; rendering alone removes components.
- Verified: this worktree's built CLI preserves the four descendant directories,
  corpus `agents/.../` directories and Express `en/.../` directories, and replays
  unchanged descendant browse/PAGE read actions against dev.
- Separately authorized production validation now verifies the list/read
  contract on three resolved sites at two descendant depths. Deployment
  workflow completion was not inspected; the CLI fix remains unpublished.
- Open product decisions: none. Delivery ends at a draft PR; publication needs
  separate user authorization.
- Review found the same stale path base in the MCP read parameter descriptor;
  its one-string correction is included and the fragment now declares a pending
  patch for both public packages. No MCP runtime behavior changes.

## Acceptance and validation

1. Focused formatter/CLI tests preserve all four reported directories, corpus
   paths under `agents/`, and top-level `en/resources/`, including silent output.
2. Neighboring tests preserve PAGE reads, landing `/`, meaningful trailing
   slashes, exceptional URLs, conflicting action handling, and SOURCE output.
3. Extend the existing authenticated CLI smoke's site coverage to compare
   descendant-directory JSON paths with text; add no harness.
4. Run focused list, smoke-script, skill/plugin, and fragment tests; plugin
   generation/check, formatting/type/lint checks, and CLI/MCP builds. Run CLI/MCP smoke
   in secret-free modes rather than unrelated authenticated package workloads.
5. With `GITHITS_ENV=dev`, dev keychain, and the documented explicit dev URL
   overrides, replay a deeper-target browse action and its PAGE read unchanged
   using `dist/cli.js`; verify corpus and Express directory text.
6. Internal pre-flight, one external Claude review per round, stable commit,
   push, draft PR to main. Keep this plan through review and merge; transfer
   durable evidence into implementation docs before deleting it after merge.
7. Validate the corrected MCP path parameter descriptor with its existing
   schema/catalog tests and the existing `agent:e2e` harness using a temporary
   scoped-page workload on dev. No new harness or permanent workload is added.

## Verification record

- `bun test packages/mcp/src/shared/list-text.test.ts src/commands/list.test.ts`:
  34 passed; the pre-fix run failed 8 tests for component loss or header base.
- `bun test src/skills-packaging.test.ts scripts/generate-plugin-assets.test.ts
  src/plugin-manifest.test.ts src/plugin-version-consistency.test.ts
  src/package-release-boundaries.test.ts scripts/smoke-scripts.test.ts`:
  123 passed.
- Plugin generation/check: 10 assets validated, no generated diff. Typecheck,
  format check, lint, and build passed. Lint has 9 preexisting warnings and one
  informational finding in unchanged files; changed-file Biome check is clean.
- CLI unauthenticated and MCP registration smoke passed for source and built
  launch modes. Full authenticated smoke was not run: its package/search
  workloads are unrelated to this increment. The existing live CLI smoke now
  checks descendant directory JSON/text consistency.
- `node dist/cli.js list site:reference.langchain.com/python/langchain/agents`
  (text, JSON, silent), emitted browse action replay, and emitted PAGE read replay
  all passed against dev with explicit MCP/API/code-nav overrides and keychain.
  Corpus `agents/` and Express `en/` listings also passed JSON/text comparison.
  Raw secret-free results and summary are retained at
  `/var/folders/7z/929w0qdn5117mcd0mj63lh_c0000gn/T/site-relative-built-dev.n0ynufma/`.
- The existing list-text size fixture was corrected to use backend-relative
  paths/actions. `bun run bench:list-text` succeeds; no performance claim or
  optimization is part of this change.
- After review fixes, focused read schema/catalog, list, smoke-script, and
  release-fragment tests passed: 192 tests, 828 assertions. Typecheck and plugin
  check passed; both public package builds and source/built MCP registration
  smoke passed after the descriptor change.
- Targeted Claude MCP/skill eval attempts stopped before tool calls because
  isolated Claude runs were not logged in. Failed artifacts are retained at
  `/tmp/site-relative-read-eval-{mcp,skills}/`. Targeted Codex evals use the
  existing authenticated `/Users/jpl/.codex-eval` home without reading, printing,
  or copying credentials. MCP discovery and skill runs completed, but their
  traces used web browsing and made zero GitHits calls. They do not establish
  descriptor/CLI guidance conformance. A single MCP run with the harness's
  existing GitHits intent setting completed successfully: `quick_start`, scoped
  documentation `search`, then `read` of its emitted exact URL. The answer
  reports high confidence. It did not exercise the separate `path` argument;
  that behavior is covered by focused schema tests and built-CLI dev replay.
  No answer-quality claim is made without a grading stage. Artifacts are at
  `/tmp/site-relative-read-eval-codex-intent/`.

## Production verification after draft delivery

The user explicitly authorized production testing using `resolve` and both
shallow and deep target forms. With `GITHITS_ENV=prod`, keychain authentication,
and inherited endpoint/token overrides removed, the PR build passed six pairs
on sites emitted by resolve:

- LangChain Python: `agents/` (4 entries),
  `agents/_subagent_transformer/` (3 entries).
- Express: `en/` (11 entries), `en/3x/` (1 entry).
- React: `reference/` (7 entries), `reference/dev-tools/` (1 entry).

Complete immediate inventories matched between the resolved base plus selector
and the deeper site target with omitted list paths. Text/silent paths and
header bases were correct; emitted browse and page literal actions replayed
unchanged. Paired PAGE reads returned identical nonempty content. All three
site landing reads passed, including React's exact-URL action.

The installed published `githits@0.23.0` reproduced the four slash-only rows on
the LangChain deeper target against production, confirming that publication
of this CLI correction is still needed and separately gated. Artifacts and
the machine-readable summary are retained under
`/var/folders/7z/929w0qdn5117mcd0mj63lh_c0000gn/T/site-relative-built-prod.dodmo2sq/`.
No runtime changes or new repository harness were needed.

## Review closure

- Internal pre-flight: no code findings; a stale pending-verification bullet
  was corrected before external review.
- External round 1: renderer correct. Accepted the same stale path-base wording
  in the MCP read descriptor; bounded scan covered skills, current implementation
  docs, and the active unified-list plan. Corrected all current instructions,
  retained explicitly historical PR #2817 descriptions, and declared both
  packages' pending patch impacts.
- Accepted minor active-plan/header wording corrections. The plan now records
  published CLI 0.23.0 and later dev verification accurately.
- Accepted the smoke assertion correction: expected DIRECTORY text includes its
  trailing slash even when the backend path omits it. Existing formatter tests
  cover that rendering behavior. No normalization was added to the client.
- Internal pre-flight of the complete revised delta: no findings.
- External round 2 and its fresh-context final check: no code findings. The
  reviewer's claimed rule prohibiting internal repository references was absent
  from the supplied instructions; independently accepted removing backend
  deployment identifiers from public docs as unnecessary reader detail. Minor
  wording fix applied; the round is clean under the review policy.
