# Open-world MCP tool annotations and patch release

Status: implemented; verification and release preparation in progress.
Date: 2026-09-14.
Baseline: `613dccb2` (`origin/main`, `v0.17.0`, `mcp-v0.17.0`).

## Outcome and verified scope

Classify public-evidence tools with `openWorldHint: true`, preserving
`readOnlyHint: true`, `destructiveHint: false`, and omitted `idempotentHint`.
Keep `quick_start` and `search_language` closed-world: their scope is static
guidance and the supported-language catalog. This supersedes only the
open-world preservation decision in the earlier read-only/feedback plan.

The stable catalog has 14 tools, currently sharing closed-world read-only
annotations in `packages/mcp/src/tools/types.ts`. Twelve evidence tools become
open-world, including `search_status`, whose results contain public evidence.
The three local experimental tools (`ask`, `resolve_target`, `code_diff`) also
become open-world. Both the root CLI's local MCP and public MCP package ship
these factories; both require a patch release, expected to be `0.17.1`.

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
   MCP registration and read-only behavior using the existing smoke suites.
3. Update `docs/implementation/mcp-tool-annotations.md`, correcting its stale
   stable tool count and documenting classification, Codex effects, and rollout.
   Review public skills for contradictory annotation claims; do not rewrite
   unchanged routing or descriptions.
4. Add one independent `changes/open-world-tool-annotations.fixed.md` fragment
   with patch impact for both public packages.
5. Refresh both tool lists and annotation justifications in the user's local
   `githits-1-0-0.json` from registered descriptors. Keep that credential-bearing
   submission export untracked and out of reviews/PRs; it is a post-deployment
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

Status: planned. Dependency: phase 1 implementation and verification.
Assumption: no other unreleased changes exist; verify both tag-to-HEAD ranges
and all fragments before assigning versions. Unknowns: publication and hosted
adoption timing, which do not block preparation.

Prepare a coordinated release PR containing the implementation and a separate
release commit. Consume the fragment into separate artifact changelog sections,
preserve historical sections, update both package versions and `bun.lock`, and
update canonical registry metadata. Regenerate plugin assets, inspect the diff,
and run release/package checks. Update this plan with actual evidence and review
outcomes before opening the draft release PR.

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
  no external review approval is claimed.
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
