# Upgrade-review verification footer

Status: Implementation and verification complete; final code review pending.

## Outcome and evidence

Reduce dependence on detailed dependency-update prompts by returning concrete
verification guidance alongside upgrade evidence. No claim of improved agent
quality is made until a matched candidate run is independently scored.

Verified current state:

- `formatPackageUpgradeReviewTerminal()` owns CLI and MCP text rendering. Its
  output ends after the final package's evidence; it has no verification footer.
- The selected-tool description already frames signals as a starting point and
  routes callers to release notes and source diffs. Keep that description stable
  to isolate the footer's contribution.
- CLI `--json` and MCP `format: "json"` serialize the normalized response directly.
- The existing external `proto-evals/upgrade-review` scorer runs original tests,
  compares API responses to a cached reference, and checks dependency pins and
  lockfile consistency. Its answers must remain outside the acting workspace.
- A baseline was launched against frozen GitHits commit
  `744901894b1414e91ab10ea8b73c0e48e637a185` and wholesale-orders fixture commit
  `4724f7faba2b49fd941d5bff323aabc659efdefd`. Its external wrapper seeds the
  existing harness workspace and captures the result before cleanup.

## Scope, ownership, and constraints

The shared text formatter owns the reminder: both consumers already share it,
so no MCP-only adapter or backend field is needed. Add one footer after all
package evidence in nonempty reports, in compact and verbose text, using existing
width wrapping. Preserve the existing empty-report headline-only behavior.
Keep JSON, schemas, descriptors, network requests, and public skills unchanged.
No new infrastructure or eval runner is introduced into the product repository.

Footer copy:

> Heuristic signals come from changelog keywords; their absence does not prove the
> upgrade is compatible. Check how the code uses changed APIs and compare behavior
> before and after the upgrade, including paths existing tests miss. Preserve
> intended logic, public API contracts, and stored-data compatibility unless the
> user asks otherwise. Run relevant tests and report verification gaps.

## Assumptions and unknowns

- Verified: formatter changes reach source-based local MCP without publication.
- Verified: the baseline source is a separate checkout with its own installed
  dependencies, so candidate edits cannot alter it.
- Assumption: a result-side reminder can influence verification after an agent
  calls upgrade review. It cannot influence agents that never call the tool.
- Unknown: the footer's quality impact and run-to-run variance. A later matched
  run resolves this; shipping the text does not establish improvement.
- Product decisions: none for this bounded implementation. The baseline uses
  the available dedicated Codex eval home and the existing default Luna/high
  configuration, recorded independently from the earlier OpenHands trials.

## Phase 1 — baseline running and footer ready for comparison

Status: Implemented. Dependencies: existing formatter, tests, live smoke
suites, and external scoring workflow.

Expected outcome: every nonempty text report ends with one actionable verification
reminder; machine-readable data remains unchanged. The baseline result remains
available for independent scoring and a later matched candidate run.

Implementation:

1. Append a `Verification` heading and wrapped prose once after the package loop
   in `packages/mcp/src/shared/package-upgrade-review-response.ts`.
2. Add formatter assertions for single/batch reports, missing signals or release
   notes, verbose output, and narrow widths. Existing parity tests must pass;
   explicitly assert the footer reaches both text surfaces and not JSON.
3. Add structural footer assertions to `scripts/cli-smoke.ts` and the public
   `packages/mcp/src/smoke-test.ts` helper: one heading, after package evidence,
   with no exact-copy dependency for remote-server consumers.
4. Update the text-v1 section-order list and representative output in
   `docs/implementation/pkg-upgrade-review.md`, documenting the report-level
   footer and empty-report exception. Add a dual-package patch fragment. No
   package versions or historical changelogs change.

Acceptance and verification:

- `bun test packages/mcp/src/shared/package-upgrade-review-response.test.ts
  packages/mcp/src/tools/package-upgrade-review.test.ts
  src/commands/pkg/upgrade-review.test.ts
  src/tools/package-upgrade-review-parity.test.ts` passes.
- `bun run typecheck`, `bun run lint`, and `bun run build` pass.
- `bun run smoke:cli` and `bun run smoke:mcp` pass, with authenticated coverage
  only when available. Report the actual coverage.
- The baseline uses `agent:e2e` with local descriptor-only MCP and the exact
  realistic prompt plus `Use GitHits.`; its existing reporting contract is held
  constant. Inspect tool calls, final report, metrics, and isolation violations.
- Baseline scoring uses the existing external scorer, without revealing it to
  the acting agent. Preserve raw artifacts and the captured candidate tree.
- A matched candidate run is intentionally left for the user's next trigger;
  record no quality improvement or performance claim before that comparison.

## Review, completion, and cleanup

Review this bounded direction and implementation through the internal preflight
and one external Claude reviewer per round. Fix accepted findings and re-review
code findings until clean. Record actual verification before opening a draft PR.
Once implementation review is clean, move durable behavior into implementation
docs and delete this single-increment plan in the final commit. Eval artifacts
and result summaries remain in the external evaluation repository.

## Plan review and baseline record

- Internal preflight: direction sound, no blocking findings. Empty-report
  boundary clarified against the existing exact-output assertion.
- External plan round 1: direction sound. Accepted minor wording, structural
  smoke, and documentation specificity findings; applied above. No code findings.
- Rejected on 2026-10-07: reviewer proposed a mandatory scored-candidate merge
  gate and automatic PR closure on a neutral result. The user explicitly scoped
  this turn to baseline and adjustment, leaving the matched candidate for a later
  trigger. Routine delivery ends at a draft PR; merge already requires separate
  human approval. No efficacy claim will be made. Adding an experiment decision
  policy here would change the user's requested workflow without authorization.
- Baseline: original 37 tests passed; 5 of 48 probe calls differed; 5 of 8 known
  breakages fixed; no unexplained field differences. Tests unchanged, lock check
  and locked sync passed, and latest pins checked at scoring time. One run does
  not establish variance or footer impact. Artifacts and summary reside in
  `proto-evals/runs/2026-10-07-upgrade-review-local-codex-baseline-131612`.

## Implementation verification record

- New tests failed before the footer was implemented, then targeted four-file
  `bun test` run passed: 50 tests, 0 failures, 307 expectations.
- `bun run typecheck` and `bun run build`: passed. `bun run lint`: exit 0,
  nine preexisting warnings outside changed files. Changed TypeScript files
  formatted; `git diff --check` passed.
- Default `bun run smoke:cli` and `bun run smoke:mcp` hit system-keychain errors
  in isolated HOME before upgrade review. Direct host CLI authentication worked.
  No auth state was reset or copied, and smoke environment code is unchanged.
- `GITHITS_AUTH_STORAGE=file bun run smoke:cli` and
  `GITHITS_AUTH_STORAGE=file bun run smoke:mcp`: exit 0; unauthenticated handling
  passed and live cohorts skipped with `AUTH_REQUIRED`.
- Targeted authenticated CLI call:
  `bun run src/cli.ts pkg upgrade-review pypi:sqlalchemy@2.0.54..2.1.3
  --no-transitive-security`: exit 0, one final footer, maximum footer line width 78.
- Targeted local stdio MCP launched through `bun run --cwd <repo> dev mcp start`:
  `pkg_upgrade_review` for the same range with `skip_transitive_security: true`
  returned the same footer and width; JSON keys remained `reviews` and `summary`.
- Implementation internal preflight: no findings. Final external code review
  pending. Matched candidate agent run remains intentionally unstarted.
- `bun test packages/mcp/src/smoke-test.test.ts scripts/smoke-scripts.test.ts`:
  175 pass, 0 failures, 410 expectations after updating the mocked report and
  covering missing, empty, and repeated verification guidance. The first run
  exposed the old mock report; fixed in-place. Type checking passed again.
