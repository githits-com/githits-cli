# Phase 4: backend-owned read actions

Status: implementation complete; final review and live repository/site verification
passed. Draft PR [#434](https://github.com/githits-com/githits-cli/pull/434) opened
on 2026-09-29. Main integration and local CI-closure verification passed;
updated GitHub checks run on the closure commit.

Branch: `jlitola/unified-read-target-clients`.
Original implementation base: `1739290b03ebcb8dee920f536c30f9ac1e0145e8`.
Final reviewed implementation: `df53c08030bd0df74afca7c673c642a21cdb8c4d`.
Integration base: `c414f5d706e010cb130dea3d4905b87fe759e7b9`.
Governing design: backend `docs/plans/UNIFIED_READ_CLIENT_SIMPLIFICATION.md`, phase 4.
Retain this plan through PR review and merge. Permanent behavior documentation
already lives in `docs/implementation/{unified-read,unified-list,tools,cli-commands,mcp-cli-parity}.md`;
transfer any remaining relevant acceptance evidence before retiring the plan.

## Verified ownership and contract

- The backend owns target/path/selector/bounds. Core validates selected wire
  facts; shared presentation owns syntax, existing caps and public JSON projection.
  Opaque strings are preserved. No locator parser, resolver or recovery machinery
  was added.
- Search and served-read SDK descriptors remain optional for existing custom
  providers. Built-in selected fields must be present and valid; nullable actions
  accept explicit null. Docs inventory projects target-only metadata into the
  existing docsReadTarget field. Unified list selects target/path under its
  existing detail directive.
- Search/status text adds one unwrapped native action per hit while preserving
  producer headers, evidence ranges, snippets and source coverage. Public JSON
  retains its existing schema and MCP-syntax followUp strings on both surfaces;
  private readTarget/codeAction/docAction fields are excluded at all four serializers.
- Hosted heading actions use supplied selectors. Direct unbounded URL-fragment
  reads keep subtree semantics. Explicit bounds remain page-relative. Hosted
  HTTP(S) targets address mutable content; repository documents address snapshots.
- Concrete read continuations preserve served identity and the whole remaining
  endpoint, and clear the original selector. Plain-file compatibility retries
  preserve the explicit requested end, clamped to totalLines. Caps still apply per
  request; CLI output retains full selections. Legacy grep/files roots remain intact.
- CLI actions put dash-leading paths after an option terminator, following all flags.
- Stable MCP instructions and their public skill copy remain exactly aligned.
  Version-neutral public CLI guidance requires complete action replay without
  advertising unreleased layouts. Broader behavior promotion follows the existing
  public Agent Skill release boundary.
- Live closure exposed canonical Research read sources before core accepted them.
  Main subsequently merged the complete unified CLI/MCP source contract in PR #431.
  Integration adopts that upstream implementation and its tests exactly, removing
  this branch's duplicate legacy-source adapter. No legacy fallback is reintroduced.
- Integration also retains main's unified grep, plugin publisher metadata and
  target-relative site listing fixes. Those changes belong to their upstream PRs.

## Completed corrections and review

An internal review identified selection truncation across multiple MCP windows.
The fix retains the remaining selected end in both display and exact-file request
caps. Ten actual-handler replay cases prove nonoverlapping coverage through the
endpoint, served identity, cleared selectors, per-call caps and final hint absence.

Claude round 1 raised three accepted low findings: incomplete replay guidance,
stale durable hit anatomy, and redundant public-envelope enumeration. All were
fixed, including bounded sibling scans. The subsequent interrupted review found
one stale duplicate CLI guide assertion; its red test was corrected and all guide
parity checks passed. Dash-path parsing and the observed Research wire acceptance
failure were also fixed with regression coverage. Research behavior is now supplied
by upstream PR #431 rather than duplicated here.

The final internal full-delta review returned no findings. Claude Opus 5.5, high
effort, reviewed the full delta at df53c08 and returned no findings; its one
fresh-context code check also found no defects. Low-confidence notes about null
Ask arguments and pathless code continuation were rejected against recorded dev
shapes and owner replays. Claude independently replayed an emitted routermethod
heading action. The reviewer remains retained for follow-up inspection.

## Verification evidence

- Initial 32-file focused run: 1,011 tests / 3,667 assertions, all passed.
- Continuation closure: `bun test packages/mcp/src/tools/read.test.ts
  packages/mcp/src/tools/read-file.test.ts
  packages/mcp/src/shared/read-result-response.test.ts
  packages/mcp/src/tools/read-package-doc.test.ts` — 119 tests / 797 assertions.
- Latest implementation closure: eleven affected files, 437 tests / 1,676
  assertions, all passed; core wire/JSON/projection, handler, quoting and parity
  contracts covered.
- Final guide checks: `bun test src/commands/mcp-instructions.test.ts
  packages/mcp/src/mcp/instructions.test.ts src/skills-packaging.test.ts` —
  31 tests / 420 assertions, all passed after the single stale assertion failed red.
- Typecheck, changed-TypeScript Biome, build and `bun run validate:packages`
  passed. Packed external consumers checked old-provider optional descriptors
  and ReadTarget exports outside workspace aliases.
- `bun run plugins:generate` and `bun run plugins:check` validated 10 assets,
  with no generated diff. Both built secret-free CLI/MCP smokes passed.
- Clean-env authenticated dev source smokes passed without auth skips:
  `GITHITS_ENV=dev bun run smoke:cli` — 149 steps; and
  `GITHITS_ENV=dev bun run smoke:mcp` — 65 steps, including experimental tools.
- Final dev catalog inspection plus actual calls exercised all 15 evidence tools.
  quick_start registration was inspected; its guide is covered by prior smoke
  and final parity tests, without calling it again while its skill was loaded.
- 54 successful live reads: all 17 search-hit actions across package code/symbol/
  docs, exact repository snapshots and standalone sites; four emitted native CLI
  search commands; ten CLI inventory entries; grep/file/doc-list reads; initial
  Research sources and a real thread follow-up; indexing/status results; automatic
  docs/source results; and six continuation windows. Supplied selectors and bounds
  were checked, and no candidate response counted as a content read.
- Actual continuation chains: code file 1-300 then 301-550; hosted docs 1-300 then
  301-550; selected code handle symbol 136-285 then 286-331. All reached their
  selected endpoint without gaps, overlaps or over-read.
- Real older-version preparation returned INDEXING; two emitted search_status
  actions reached completion and both final read actions opened their exact ranges.
  No repeated search polling or fabricated references were used.

Representative actions opened Route at a pinned repository SHA (route.js 43-51),
routermethod at the 4.x Router URL (160-177/849), and router in hosted resources.txt
(503-508/571). The temporary replay parser's initial optional-argument omission was
corrected; its invalid first-pass cases were excluded and rerun. A subsequent
harness scope error was corrected in the separate successful finish stage. Original
failed evidence was preserved rather than reset or deleted.

Detailed local review/live evidence is retained in
`/tmp/read-target-final-{review-result,verification}.md` and
`/tmp/read-target-final-live-{discover,repair,finish}-records.json`.
These temporary artifact paths are operator evidence, not portable PR prerequisites.

## Main integration verification

The four Research resolution files exactly match origin/main at c414f5d; the
reviewed ReadTarget production files remain unchanged from df53c08. The separate
internal integration pre-flight returned no findings and found no adapter remnants,
conflict markers or incompatible SDK imports.

The nine affected Research/list/read/skills/release-boundary test files passed
357 tests and 1,552 assertions. Typecheck, root build, MCP package build and
external packed-package validation passed on the integrated tree. The local MCP
build emitted TS9010 warnings despite returning success; the later CI-mode
reproduction and fix are recorded below. A fresh cleaned-env
dev probe exercised both MCP and CLI Research; every returned canonical source
replayed through its native read interface and contained the cited Route code.
Logs: `/tmp/read-target-pr-integration-{tests,typecheck,build,mcp-build,packages}.log`
and `/tmp/read-target-pr-live-integration.jsonl`.

## PR CI closure

Initial PR CI at ae7ec93 exposed two declaration-generation TS9010 errors and
four stale assertions in sibling tests. `CI=true bun run build` in packages/mcp
reproduced the declaration failure. Explicit `z.ZodType<ReadTarget>` annotations
on both exported schemas fix declaration emission without changing runtime parsing
or output types; inferred input remains unknown and is validated at runtime.
The provider parity fixtures now supply backend descriptors with a contradictory
locator SHA, proving that actions retain backend ownership. The catalog assertion
checks the reviewed complete-action wording.

- `CI=true bun run build` in packages/mcp: failed before the annotations, passed
  after them without TS9010 diagnostics. `CI=true bun run build` at root passed.
- `bun run typecheck`: passed without diagnostics.
- Five affected core parser/service test files: 273 tests / 1,227 assertions.
- `bun test src/tools/repository-target-parity.test.ts
  packages/mcp/src/mcp/server.test.ts`: four failing cases before correction;
  32 tests / 434 assertions passed after correction and the explicit MCP locator-SHA
  rejection assertion.
- Full `bun test`: 5,210 passed, zero failed, 19,370 assertions across 225 files.
- `bun run validate:packages:mcp-publish`: external package validation passed;
  npm publish dry-run was skipped because @githits/mcp 0.23.0 already exists.
  No package was published.
- The internal CI-closure code review found no findings in the exact three-file
  delta. Claude CI-closure round 1 accepted the fixes and identified a Biome line-wrap
  mismatch and a missing explicit MCP locator-SHA rejection assertion. Both were
  corrected; the complete three-file Biome check and 32 affected tests passed.
  Claude CI-closure round 2 returned no findings; its required one-time fresh-context
  check also found no findings. The reviewer remains retained through merge approval.

Failure evidence: [MCP build](https://github.com/githits-com/githits-cli/actions/runs/36568191644/job/109405264216)
and [unit suite](https://github.com/githits-com/githits-cli/actions/runs/36568192257/job/109405266622).
Local closure logs: `/tmp/read-target-pr-ci-fixes-{full-tests,root-build,typecheck,packages-dry-run}.log`,
`/tmp/read-target-pr-schema-build-{red,green}.log` and
`/tmp/read-target-pr-stale-fixtures-{red,green}.log`.

## Remaining limits and delivery boundaries

The two isolated Codex qualitative workloads (`docs-search-followup.md` and
`unified-search-investigation.md`) still lack trusted dev credential provisioning.
They are not claimed as passed; normal authenticated CLI/MCP live verification is
separate evidence and no answer-quality grade is claimed. No credentials were
extracted, copied or exposed to provision a harness.

Dev automatic Router search with public_only:true rejected the unsupported source/
filter combination. Explicit symbol/public-only search succeeded but returned zero
Router symbols at express latest; default docs search returned usable Router actions.
This is a coverage/selection limit, not evidence that the package lacks that API.

Both public artifacts have pending patch impact in the independent change fragment.
Production descriptor availability and hosted MCP dependency adoption remain
publication gates. No versions or historical changelog entries changed. Push and
draft PR are authorized; merge, tag, release, publish and deploy remain separate
human-approved steps.
