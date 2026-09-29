# Site-relative list rendering

Status: Implemented and locally verified; review and draft PR delivery pending.

## Outcome and evidence

Site directory text preserves backend-owned relative paths and identifies their
usable target, including strict descendants of a canonical site owner.
Published `githits@0.23.0` rendered four valid directories as `/` for
`site:reference.langchain.com/python/langchain/agents`. The raw JSON retains
`_subagent_transformer/`, `factory/`, `middleware/`, and `structured_output/`
with browse actions using the requested target. Evidence is retained under
`/tmp/pkgseer-site-cli-dev.RSEeBA/deeper-target.{json,txt}`.

## Ownership and scope

The backend owns normalization, owner resolution, relative paths, and exact
actions. `packages/mcp/src/shared/list-text.ts` owns faithful text rendering;
the CLI delegates to it. Remove its obsolete first-component stripping and
use the shared site PAGE action target or requested target in site headers.
Keep SOURCE canonical-target behavior and exceptional exact URL actions.
Update the CLI skill, its reference, directly related implementation docs, and
one release fragment. No adapters, compatibility guesses, dependencies,
transport changes, backend edits, publication, or production probes.

## Assumptions and unknowns

- Verified: compact site text fetches PAGE read actions; directory paths and
  requested target are available without fetching browse actions.
- Verified: the supplied dev JSON is valid; rendering alone removes components.
- Verified: this worktree's built CLI preserves the four descendant directories,
  corpus `agents/.../` directories and Express `en/.../` directories, and replays
  unchanged descendant browse/PAGE read actions against dev.
- Production deployment is reported running; its result is unverified.
- Open product decisions: none. Delivery ends at a draft PR; publication needs
  separate user authorization.

## Acceptance and validation

1. Focused formatter/CLI tests preserve all four reported directories, corpus
   paths under `agents/`, and top-level `en/resources/`, including silent output.
2. Neighboring tests preserve PAGE reads, landing `/`, meaningful trailing
   slashes, exceptional URLs, conflicting action handling, and SOURCE output.
3. Extend the existing authenticated CLI smoke's site coverage to compare
   descendant-directory JSON paths with text; add no harness.
4. Run focused list, smoke-script, skill/plugin, and fragment tests; plugin
   generation/check, formatting/type/lint checks, and build. Run CLI/MCP smoke
   in secret-free modes rather than unrelated authenticated package workloads.
5. With `GITHITS_ENV=dev`, dev keychain, and the documented explicit dev URL
   overrides, replay a deeper-target browse action and its PAGE read unchanged
   using `dist/cli.js`; verify corpus and Express directory text.
6. Internal pre-flight, one external Claude review per round, stable commit,
   push, draft PR to main. Keep this plan through review and merge; transfer
   durable evidence into implementation docs before deleting it after merge.

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
  launch modes. Full authenticated smoke and agent evals were not run: their
  package/search workloads are unrelated to this increment. The existing live
  CLI smoke now checks descendant directory JSON/text consistency.
- `node dist/cli.js list site:reference.langchain.com/python/langchain/agents`
  (text, JSON, silent), emitted browse action replay, and emitted PAGE read replay
  all passed against dev with explicit MCP/API/code-nav overrides and keychain.
  Corpus `agents/` and Express `en/` listings also passed JSON/text comparison.
  Raw secret-free results and summary are retained at
  `/var/folders/7z/929w0qdn5117mcd0mj63lh_c0000gn/T/site-relative-built-dev.n0ynufma/`.
- The existing list-text size fixture was corrected to use backend-relative
  paths/actions. `bun run bench:list-text` succeeds; no performance claim or
  optimization is part of this change.
