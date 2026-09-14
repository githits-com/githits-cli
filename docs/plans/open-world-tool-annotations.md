# Open-world MCP tool annotations and patch release

Status: implementation and release preparation verified and reviewed; two-PR handoff ready.
Date: 2026-09-14.
Baseline: `613dccb2` (`origin/main`, `v0.17.0`, `mcp-v0.17.0`).

## Outcome and verified scope

Classify public-evidence tools with `openWorldHint: true`, preserving
`readOnlyHint: true`, `destructiveHint: false`, and omitted `idempotentHint`.
Keep `quick_start` and `search_language` closed-world: their scope is static
guidance and the supported-language catalog. This supersedes only the
open-world preservation decision in the earlier read-only/feedback plan.

At baseline, all 14 stable tools shared closed-world read-only annotations
in `packages/mcp/src/tools/types.ts`. Twelve evidence tools now advertise
open-world, including `search_status`, whose results contain public evidence.
The three local experimental tools (`ask`, `resolve_target`, `code_diff`) also
became open-world. Both artifacts ship the stable evidence factories;
experimental tools ship through the root CLI's local composition. Both
artifacts require a patch release, prepared separately as `0.17.1`.

Authentication does not close the tools' public evidence domain. Internal
caching/preparation remains covered by the existing read-only product policy.
OpenAI's current review guidance includes public-internet retrieval in the
open-world category. Public Codex source at `5b1d656` uses it for app enablement
and approval-review context; ordinary read-only, non-destructive approval and
parallel-call behavior remain unaffected by the open-world value.

Evidence:
- `packages/mcp/src/tools/types.ts`, tool factories, `mcp/local-agentic-ask.ts`,
  `mcp/server.test.ts`, and `mcp/local-server.test.ts`.
- [OpenAI review guidance](https://developers.openai.com/plugins/deploy/app-review#review-and-approval-faqs).
- [Codex approval logic](https://github.com/openai/codex/blob/5b1d656/codex-rs/core/src/mcp_tool_call.rs#L2322).
- [Codex app policy](https://github.com/openai/codex/blob/5b1d656/codex-rs/connectors/src/app_tool_policy.rs#L205).

No handler, schema, description, auth, transport, instruction, or output changes
are intended. No changes to private backend or hosted-server code are required
in this repository. No product decisions remain for implementation.

## Phase 1: implementation

Status: implemented. Dependency: baseline and tool inventory verified above.
Assumption: the approved classification applies to all public evidence tools,
including experimental tools and retrieval of previously prepared results.
Unknowns: none affecting implementation.

1. Retain the existing closed-world read-only constant and add an explicitly
   named open-world read-only constant beside it. Switch only public-evidence
   factories to the latter; no new runtime configuration or registry is needed.
2. Update focused annotation assertions and stable/local catalog contracts to
   cover both closed-world exceptions and every evidence tool. Verify actual
   MCP registration and annotation policy using the existing local smoke suites
   and the published `runMcpSmoke()` helper used by hosted consumers.
3. Update `docs/implementation/mcp-tool-annotations.md`, correcting its stale
   stable tool count and documenting classification, Codex effects, and rollout.
   Review public skills for contradictory annotation claims; do not rewrite
   unchanged routing or descriptions.
4. Add one independent `changes/open-world-tool-annotations.fixed.md` fragment
   with patch impact for both public packages.
5. Refresh both tool lists and annotation justifications in the user's local
   `githits-1-0-0.json` from registered descriptors. Keep that credential-bearing
   submission export locally ignored and out of reviews/PRs; it is a post-deployment
   review candidate until the production catalog matches it.

Acceptance: 12/14 stable and all three experimental tools are open-world;
the two exceptions are closed-world; every tool stays read-only and
non-destructive; catalog and focused tests pass; JSON metadata matches the
candidate and has complete, accurate justifications.

Verification: `bun test`, typecheck, build, plugin generation/check, source CLI
and MCP smokes, and public packed-consumer validation. Use unauthenticated smoke
modes so no production verification queries are needed. Run targeted
`agent:e2e` descriptor workloads; if no authorized development backend is
configured, use dry runs and explicitly report that live agent behavior was
not measured. No descriptions change, so do not claim a routing improvement.
Internal and Claude reviews must cover the complete proposed delta.

## Phase 2: release preparation and handoff

Status: prepared and reviewed on `skvark/release-0.17.1`; awaiting PR merge approval.
Dependency: phase 1 implementation and verification.
Assumption: no other unreleased changes exist; verify both tag-to-HEAD ranges
and all fragments before assigning versions. Unknowns: publication and hosted
adoption timing, which do not block preparation.

The user requested two separate PRs: implementation first, release second.
Open the implementation PR from `skvark/open-world-tool-annotations` to `main`
with its patch fragment and unchanged package versions. Open the dependent
release PR from `skvark/release-0.17.1`, initially targeting the implementation
branch. After the implementation merges, retarget the release PR to `main` and
recheck the release delta and CI before its separately approved merge.
The release PR consumes the fragment into separate artifact changelog sections,
preserves historical sections, updates both package versions and `bun.lock`,
and updates canonical registry metadata and generated plugin assets. Update
this plan with actual evidence and review outcomes before opening the draft
PRs. Preserve existing commits when carrying implementation follow-ups into
the release branch.

Acceptance: reviewed implementation and release metadata, valid generated
assets, successful required checks or clearly evidenced limitations, and an open
release PR with its current CI status. Stop for separate human merge approval
identifying that PR, as required by `AGENTS.md` and the release skill. Do not
merge, enable auto-merge, tag, or publish before that approval.

After approval/merge, publication follows the existing workflows. Hosted clients
need `remote-mcp` to adopt the MCP package and deploy; then verify production
`tools/list`, re-scan tools in the OpenAI portal, and reupload the local JSON.
This request does not authorize submitting to OpenAI or deploying remote-mcp.
Rollback is a follow-up release restoring the prior annotations; no data
migration or rollback is involved.

## Completion and reorientation

Before each phase, compare scope, versions, fragments, and acceptance criteria
with the actual branch. Resolve routine discrepancies in this plan; ask only
for newly required product decisions. Record achieved checks, review closure,
PR details, and remaining merge/publication/deployment work here. Keep durable
classification and rollout guidance in the implementation document.

## Verification and review record

- Internal plan review: clean. External Fable plan dispatch `ctx_ad94f15c6d07`
  could not execute because Claude reported an expired login. The user was asked
  to reauthenticate while authorized implementation and verification continued;
  Fable subsequently approved the plan after authentication was restored.
  Its validation-record and CRLF-churn notes were covered by the release
  preparation: package checks passed and line-ending-only files were excluded.
- Baseline catalog suite: 11 tests passed. After changing the expected domain
  contract, three tests failed on `get_example`'s old closed-world annotation.
  After implementation, 374 focused MCP/tool tests passed with 1,826 assertions.
- `bun test`: 4,713 passed, zero failed across 209 files (16,428 assertions).
- `bun run typecheck` and `bun run build`: passed. `bun run lint`: exited zero
  with 12 pre-existing warnings and one informational diagnostic in unchanged
  repository-target files.
- `bun run plugins:generate` and `bun run plugins:check`: passed (10 assets).
  No generated content changes at the implementation stage.
- `bun run agent:e2e --agent claude --server local --guidance-profile descriptors
  --workload eval/agentic/workloads/express-router.md --dry-run
  --out .agent-eval/runs/open-world-annotations`: succeeded. Artifacts report
  `dry-run`, zero tool calls, and unknown token/duration metrics; this is harness
  preparation only. No development endpoint overrides are configured, so live
  agent behavior and approval effects were not measured.
- Both local review-export catalogs exactly match registered candidate
  descriptors: 14 tools, 12 open-world, all read-only and non-destructive.
  Credentials and submission identity remain local and unchanged.
- Source and built smokes passed: `bun run smoke:cli --mode unauthenticated`
  and `bun run smoke:cli:built` each completed 31 steps; `bun run smoke:mcp
  --mode registration` and `bun run smoke:mcp:built` each completed nine steps,
  including stable and experimental annotation checks.
- Internal implementation and release reviews are clean. Two minor scope
  wording findings were accepted: the MCP release note and this plan now
  distinguish stable evidence tools from CLI-only experiments.
- On release commit `c021db5d`, release/packaging checks passed (35 tests, 296
  assertions), and plugin generation/check validated 10 assets. Historical
  changelog content was preserved. Both package/tag ranges contained only this
  implementation and release preparation; the single patch/patch fragment was
  consumed into separate `0.17.1` sections on the release branch only.
- `bun run validate:packages` hit the known Bun 1.3.9 Windows bundling assertion.
  `npx --yes bun@1.4.2 --bun run validate:packages` passed, including builds and
  packed-consumer checks; the toolchain workaround changed no repo dependencies.
  Direct Node import of the built MCP entry confirmed the exact annotation
  classification, and `node dist/cli.js --version` returned `0.17.1`.
- Checksum-verified `mcp-publisher` v1.7.9: `validate server.json` passed.
- Opus round 1 found no implementation/release-content defects. Accepted its
  local export-handling finding by adding `/githits-1-0-0.json` to the local
  Git exclude file. `git check-ignore -v` confirms the rule; `git ls-files`
  confirms the export is untracked. The sibling scan covered branch histories,
  staged files, and package allow-lists; no export contents entered Git or npm
  artifacts. Updated the PR workflow above per the user's two-PR decision.
  Round 2's fresh-context check found that the published `runMcpSmoke()` helper
  still checked only read-only status. Accepted: a stale hosted catalog could
  pass ordinary deployment validation; two annotation checks and regression
  cases close the gap without new infrastructure. Added optional annotation
  fields to its caller interface and rejection cases for wrong/missing domain
  hints, both closed-domain exceptions, an experimental tool, and destructive
  hints. Local smoke diagnostics now include expected and actual domain values.
  Bounded closure inspected both smoke entrypoints, catalog tests, caller
  fixtures, and packed-consumer validation. Rejected the suggested exported
  shared exception list (2026-09-14): independent literal expectations are useful
  conformance oracles; a new public export solely to deduplicate two names is
  unnecessary for this fix. The other round-2 notes were rejected as already
  covered: the fixed language catalog is the approved exception, documentation
  prose states classification, sibling tests assert exact 14/17 inventories,
  and fragment line length follows the existing format.
- Separate release review at `a99c41c8` is clean, including a fresh-context
  check. Opus dispatch `ctx_33ecf59d4071` is retained in terminal
  `term_e0a12eec-61e3-4a55-adeb-bff4153a39b9`. The later smoke-helper correction
  was carried into release commit `8a775f3a` and both artifact notes.
- Smoke-helper follow-up: `bun test packages/mcp/src/smoke-test.test.ts`
  passed 80 tests (89 assertions); typecheck passed. The internal full-delta
  review is clean. Re-generated plugin manifests after branch-switch line-ending
  changes; no generated content changed. Plugin checks and the Bun 1.4.2
  packed-consumer validator passed again with the revised helper.
  Source and built MCP smokes passed again (nine steps each).
- Final implementation review: clean at `e8195d9a`, including the fresh-context
  closure check. Opus dispatch `ctx_3de5a9a41d14` is retained in terminal
  `term_26ddbb39-6548-40f3-8497-51bd02bae63f`. The missing-idempotent assertion
  note is covered by exact catalog tests; unnamed destructive-case errors are
  appropriate because the fixture mutates every tool. Removed a cosmetic blank
  line in this record while closing the status; no product changes followed review.
- Final release-only review: clean at `8a775f3a`, including its fresh-context
  check; retained dispatch `ctx_3997d8ce9363`. The fragment is fully consumed,
  both notes accurately name the MCP smoke helper, and the release delta is
  still 13 files with no implementation or plan difference from its base.
  The combined `0.17.1` public-package validator passed again with Bun 1.4.2.
- Draft PRs: implementation [#391](https://github.com/githits-com/githits-cli/pull/391)
  targets `main`; release [#392](https://github.com/githits-com/githits-cli/pull/392)
  targets the implementation branch. Release CI is deferred until retargeting.
- Remaining work: obtain explicit merge approval, merge implementation first,
  retarget and check the release PR,
  then complete the separately approved release merge and publication.
  Hosted adoption/deployment and OpenAI resubmission remain subsequent work.
- Initial PR CI exposed TS9015 in the new annotation constant's object spread.
  The local Bun 1.4.2 package build had exited zero while emitting that warning;
  CI treats it as fatal. Replaced the spread with explicit literal flags,
  preserving the exact runtime and inferred readonly literal type. With
  `CI=true`, `npx --yes bun@1.4.2 --bun run build` in `packages/mcp` now passes
  without the diagnostic. This corrects the earlier build-pass evidence:
  successful exit status alone did not establish a clean declaration build.
