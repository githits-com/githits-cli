# Repository `@ref` grammar

## Status

- Overall: **IMPLEMENTED — REVIEW PENDING**
- Current phase: Phase 1 — implementation and verification complete; internal
  and external code review remain before draft PR delivery
- Owner: repository maintainers
- Last verified: 2026-09-15 against `origin/main` at `fe553ce`

## Problem and expected outcome

Repository revisions currently accept both `#ref` and `@ref`, while emitted
targets prefer `provider:path#ref`. That makes `#` ambiguous with documentation
fragments and gives agents two spellings for one concept.

When this increment is complete:

- registry/package versions remain `registry:name@version`, including scoped
  registry names;
- repository revisions parse and emit only as `provider:path@ref` (or the
  equivalent supported full repository URL plus `@ref`);
- refs containing additional `@` characters are preserved after the first
  repository suffix delimiter;
- legacy caller input using `#ref` is rejected with a precise migration message;
- `#` remains available for backend-owned documentation fragments, including
  `provider:path@commit/file#section` and ordinary URL fragments;
- CLI, MCP, Ask/read/search follow-ups, status/recovery text, structured replay
  locators, help, descriptors, public skills, examples, and tests agree on the
  same grammar; and
- no symbol-reading syntax or implementation is added.

## Verified current state and evidence

- `packages/mcp/src/shared/repository-target.ts` is the single parser/formatter
  authority used by CLI and MCP target consumers. It currently accepts the first
  `#` or `@` delimiter and always emits `#`.
- The focused target/parity baseline passed 182 tests on 2026-09-15. Those tests
  explicitly prove the current dual-suffix contract and `#` emission.
- A bounded authenticated production search using
  `github:expressjs/express@master` returned a backend `targetLabel` in legacy
  `github:expressjs/express#master` form while also returning structured
  `repoUrl`, `gitRef`, and `commitSha`. Public search projection therefore must
  canonicalize typed legacy backend labels until the backend changes; merely
  tightening caller parsing would leak `#ref` into JSON/text output.
- `packages/mcp/src/shared/follow-up-command-text.ts`,
  `target-resolution.ts`, `unified-search-response.ts`,
  `unified-search-presentation.ts`, and list-files/search formatters already
  centralize emitted repository identities around the shared formatter.
- `targetDisplayFamilyKey()` in `unified-search-presentation.ts` separately
  removes revision/fragment suffixes for display grouping and must stay aligned
  with the new `@ref` grammar.
- Agentic Ask has separate typed source-pointer shapes. MCP projects typed
  `code_read` pointers in `packages/mcp/src/mcp/local-agentic-ask.ts`; CLI renders
  a validated fixed argv tuple in `src/commands/ask.ts`. Both currently pass a
  backend repository target through unchanged, including JSON.
- `packages/core-internal/src/services/agentic-ask-service.ts` also owns the
  client-authored fallback for an Ask target-validation failure and currently
  advertises a `github:owner/repo#ref` example.
- Unified `read` treats a target without `path` as an opaque documentation
  locator. That existing boundary preserves URL and repository-backed fragments
  without parsing or rewriting them. A target with `path` uses the repository
  parser and is a code target.
- `parsePackageSpec()` independently splits package versions at the last `@` and
  preserves leading `@` in scoped names. Repository changes do not need to alter
  it, but parity regressions must cover it.
- Current grammar wording exists in CLI help, MCP descriptions, README, durable
  implementation docs, the public `githits-code` skill reference, active eval
  workloads, smoke contracts, and formatter/parser tests. Checked-in
  context-loading inventories/protocols under
  `eval/agentic/context-loading/fixtures/` and `routing-protocol.json` are
  explicitly immutable historical measurement snapshots; their README requires
  preserving their exact content rather than silently editing them.

## Scope

In scope:

- make `@` the only compact repository revision delimiter in the shared parser;
- reject legacy `#ref` caller inputs with an exact `@ref` migration direction;
- keep a narrowly typed output migration path for legacy backend repository
  labels so public CLI/MCP output never re-emits them;
- update repository output identity, exact read follow-ups, resolution/recovery
  alternatives, search/status output, and Ask code-read sources;
- preserve documentation locators/fragments byte-for-byte;
- update all current help, descriptor, skill, example, smoke, parity, and durable
  documentation surfaces;
- add a release fragment for both public artifacts; and
- verify source and built CLI/MCP behavior, package artifacts, plugin generation,
  and targeted agent behavior.

Out of scope:

- symbol parsing or symbol reading;
- assigning any semantic meaning to fragments beyond preserving existing
  documentation locators;
- changing structured `--repo-url` plus `--git-ref` inputs, package version
  syntax, registries, providers, GraphQL selections, or backend APIs;
- editing PkgSeer, `remote-mcp`, or any other repository;
- rewriting immutable historical context-loading fixtures; and
- merging, releasing, publishing, or deploying.

## Target architecture

### Ownership

The shared repository-target module owns compact repository syntax because it
already validates every provider form and formats every public repository
identity. CLI/MCP commands remain thin consumers. The simpler alternative of
patching each command would duplicate parsing and would not cover status,
recovery, stored output, or Ask source pointers consistently.

Opaque documentation locators remain owned by the read/docs flow, not the
repository parser. Typed Ask code-source adapters own migration of their known
target field; documentation sources and URL sources remain unchanged.

### Grammar and migration contract

- Repository input: `provider:path` or `provider:path@ref`; the first `@` after
  the validated repository path starts the ref, and all remaining `@` bytes are
  part of the ref.
- A `#` in a compact/full repository code target is never parsed as a revision.
  A legacy `provider:path#ref` input fails locally and tells the caller to use
  `provider:path@ref`; an `@ref#fragment` code target fails because fragments are
  documentation-only today.
- Repository output: `provider:path@ref`. When resolution presentation needs
  both a floating ref and a resolved commit, it keeps one valid target and shows
  the commit as labeled metadata rather than concatenating a second `@` suffix.
- Typed backend repository labels may still arrive as `provider:path#ref` during
  rollout. Output-only normalization accepts that shape solely in repository
  label/source-pointer contexts and emits `@ref`; it is not exposed as caller
  input compatibility.
- Package output remains `registry:name@version`. Package resolution commit
  provenance is labeled separately rather than appended as a `#ref`-looking
  suffix.
- Documentation targets are passed through unchanged, including
  `provider:path@commit/file#section` and `https://...#section`.

### External rollout boundary

No PkgSeer change blocks this PR because typed client projection can normalize
the verified legacy `targetLabel`. PkgSeer should nevertheless switch repository
`targetLabel`, requested/fresh/served label, error/hint/note prose, and Ask
code-source locator generation from `#ref` to `@ref` so raw responses and
backend-authored text match the public grammar. The client must not rewrite
arbitrary backend prose, so that backend rollout is required before a literal
repository `#ref` can no longer appear inside preserved backend messages or Ask
answer Markdown. This is an exact follow-up dependency for the parent session,
not work in this repository.

Hosted clients receive the change only after `@githits/mcp` is released,
`remote-mcp` updates that dependency, and the hosted server is deployed. Those
steps are not authorized here.

## Assumptions

- The supplied product decision intentionally permits rejecting a previously
  shipped compact input spelling in the next minor releases of both public
  artifacts.
- Existing structured repository fields (`repoUrl`, `gitRef`, `commitSha`) remain
  authoritative for output projection and exact follow-ups.
- Immutable context-loading snapshots may retain historical `#ref` bytes because
  they are measurement evidence, not current guidance or generated output.

## Unknowns or product decisions

- None block implementation. The user already chose `@ref`, reserved `#`, legacy
  rejection, and no symbol reading.

## Cross-cutting considerations

- Security: preserve credential/query/unsupported-host rejection; do not log or
  expose authentication material during live verification.
- Compatibility: preserve package parsing, full structured repository addressing,
  docs fragments, URL fragments, provider/path validation, and exact commit
  follow-ups. The compact `#ref` input break is deliberate and gets a precise
  error plus minor release notes.
- Performance: this is local string parsing/formatting with no data-fetch or hot
  loop change; no optimization or benchmark is proposed.
- Rollback: reverting this PR restores dual input and `#` output. No stored data or
  schema migration is involved.
- Documentation: update current README, implementation docs, active plans that
  state the old current contract, public skill references, and active eval
  workloads; preserve explicitly historical immutable fixtures.

## Phase map

### Phase 1 — one canonical repository revision grammar (**EXTERNAL ROUND 3 PENDING**)

Expected outcome: every current githits-cli caller and emitted locator uses
`@ref`, legacy compact `#ref` fails precisely, documentation fragments and
package coordinates remain intact, and a reviewed draft PR contains the verified
change.

Assumptions: the shared parser/formatter remains the correct ownership boundary;
typed output adapters are sufficient for the verified legacy backend label.

Unknowns or product decisions: none.

Dependencies: current `origin/main`; local Bun toolchain; configured repository
push/PR access; Orca review runtime; optional existing local authentication for
deeper smoke/eval coverage.

Acceptance criteria:

- all supported provider/full-URL forms accept no ref or `@ref`, preserve refs
  containing `@`, and reject `#ref` with an exact migration message;
- client-formatted repository targets, target-resolution text, search/status
  text+JSON fields, resolve alternatives, list/read/grep output, and MCP/CLI
  follow-ups contain canonical `@ref` targets and never `#ref` targets; preserved
  backend prose is covered by the documented PkgSeer rollout dependency;
- Ask rejects an explicit legacy repository target before network work and
  canonicalizes typed code-read sources in both text and JSON while leaving docs
  and URL sources unchanged;
- `provider:path@commit/file#section` and URL docs fragments round-trip unchanged;
- scoped package names and `registry:name@version` still parse and emit correctly;
- descriptors/help/public skills show only the single `@ref` grammar and do not
  advertise symbol reads;
- current source/tests/docs contain no old grammar except explicitly labeled
  rejection/output-migration inputs and immutable historical measurement
  fixtures; emitted expectations, help, descriptors, and current documentation
  contain none;
- a valid changes fragment declares `minor` for `githits` and `@githits/mcp`;
- focused tests, full `bun test`, typecheck, format/lint checks, build, public
  package validation, plugin generation/check, applicable source+built smoke
  suites, and targeted `agent:e2e` evidence are complete or any external failure
  is reported with exact evidence; and
- the implementation passes internal pre-flight review and a clean Claude Opus
  review round, is committed and pushed, and has an open draft PR.

Implementation steps:

1. Add/adjust failing parser, output, Ask, docs-fragment, package, help/descriptor,
   smoke, and parity tests for the decided grammar.
2. Change the shared parser/formatter and resolution presentation without adding
   a second syntax owner.
3. Normalize typed legacy backend labels and Ask code-source targets at public
   output boundaries; keep opaque docs/URL sources byte-preserving.
4. Follow the repository-internal `githits-plugin-maintenance` workflow while
   updating current CLI/MCP wording, README, durable implementation docs, public
   skill references, active examples/workloads, and the release fragment.
5. Regenerate plugin assets from canonical inputs and inspect the generated diff
   as required by that workflow.
6. Run focused then full verification, update this plan and durable docs with
   actual evidence, complete internal/external review rounds, and deliver the
   draft PR.

Implementation and verification evidence (2026-09-15):

- Shared parsing now accepts only `@ref`, preserves later `@` characters, and
  rejects a single legacy hash suffix with its exact replacement. Typed output
  projection normalizes verified legacy backend labels without widening caller
  input compatibility.
- Ask validates explicit repository targets before auth/network work. MCP and
  CLI project only typed code-source targets; documentation and URL locators are
  unchanged.
- Resolution text uses one canonical target plus `(commit <sha>)` metadata when
  both a ref and commit are relevant, avoiding ambiguous stacked delimiters.
- The affected suite passed 1,331 tests with 3,576 expectations. The final full
  suite passed 4,766 tests with 16,526 expectations. Typecheck, lint, format check,
  build, plugin generation/check, and public-package validation passed.
- Authenticated source smoke passed for CLI (116 steps) and MCP (59 steps),
  including `github:expressjs/express@<commit>/History.md` documentation reads.
  Built MCP registration smoke passed (9 steps) and built CLI unauthenticated
  smoke passed (31 steps). The built CLI smoke was rerun serially after its first
  launch collided with package validation temporarily replacing `dist`; the
  isolated rerun passed.
- A live canonical repository search completed and projected the backend's
  legacy typed label as `github:expressjs/express@master`; its exact follow-up
  used `github:expressjs/express@<commit>`. The legacy CLI spelling exited 1 with
  the precise `@master` migration message.
- Targeted Claude and Codex agent evals produced no qualitative evidence. Codex
  hit its account usage limit before any tool call. Claude stopped before run
  artifacts were produced after the local credential handoff. These are
  reported as unavailable, not passes; deterministic agent-facing descriptor,
  instruction-parity, workload, smoke, and full-suite tests passed.
- Current source/help/docs/skills were audited. Remaining hash-delimited
  repository examples are limited to explicit migration tests/documentation,
  the verified PkgSeer dependency, this temporary plan's before-state evidence,
  and immutable historical context-loading fixtures.
- The first internal pre-flight found stale dual-syntax wording in the public
  code-skill reference and CLI implementation guide, plus unprojected repository
  labels in indexing-estimate progress. Both were fixed with regression coverage
  across initial search and `search_status` replay, including later `@`, package,
  and documentation-fragment preservation. The follow-up internal review of the
  full delta returned clean.
- External Opus review round 1 found that eager legacy-input validation also
  rejected non-repository URLs previously handled by fuzzy resolve or Ask. The
  parser now marks only the exact legacy-ref case; resolve and both Ask adapters
  preserve all other backend-classified inputs. The same closure pass restored
  trailing-`#` parser coverage and named the schema-owned Ask source tuple
  positions. Focused coverage passed 288 tests with 1,050 expectations, and the
  post-round full-gate counts above include those changes. Internal follow-up
  then found that the legacy marker also needed a validated pre-fragment
  repository path so provider web URLs such as `.../tree/main#readme` remain
  backend-classified in resolve and Ask. That boundary was tightened, focused
  coverage passed 291 tests with 1,054 expectations, and internal pre-flight
  returned clean before external round 2.
- External round 2 found that CLI Ask passed the shared legacy marker outside
  Commander's user-facing error domain, breaking its `--json` error envelope,
  and noted an unrelated expansion of commit-only identities to full SHAs. CLI
  Ask now translates only that marker into Commander's argument error, with a
  real-process JSON/footer regression test. Commit-only repository identities
  retain the prior short SHA using canonical `@` syntax. Focused coverage passed
  324 tests with 1,157 expectations, and internal pre-flight returned clean. The
  final broad rerun and external round 3 are pending.

## Phase-boundary reorientation and cleanup

This effort has one phase. Before opening the PR, reconcile this plan with the
actual delta and verification evidence. Keep it through implementation review.
After the PR merges, transfer any remaining current truth to
`docs/implementation/repository-targets.md` and delete this temporary plan in the
normal post-merge cleanup increment.
