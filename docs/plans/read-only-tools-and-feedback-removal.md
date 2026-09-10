# Read-only tools and feedback removal

Status: phase 1 merged; phase 2 skill cleanup complete and reviewed;
phase 3 release candidate prepared and reviewed; publication and hosted adoption pending.
Date: 2026-09-10.
Baseline: `dfbdf6b94be2afa552c4b0f62784c7ff0c0373d5`, branch
`skvark/fix-ask-readonly-hint`; both public packages are `0.15.1`.

## Objective and decisions

Every remaining GitHits MCP tool advertises `readOnlyHint: true`, including
local experimental `ask`. Remove feedback from the product and stop directing
agents to submit it. Keep runtime instructions, public skills, setup guidance,
tests, and shipped tool inventories consistent.

The user explicitly selected the annotation policy and removal of the feedback
tool, then requested implementation of this plan. The implemented scope retires
the corresponding `githits feedback` CLI command and service API as well.

The annotation describes the tool's information-retrieval/computation purpose.
Internal result storage, caching, preparation work, and research-thread state
do not by themselves change that classification under this product decision.
This is a chosen product interpretation, not a claim of OpenAI review approval
or proof that database writes do not occur. Preserve the current values of
`openWorldHint`, `destructiveHint`, and `idempotentHint`; changing those is not
part of this request. Do not make the annotation type incapable of representing
future write tools.

Expected outcome: a smaller, consistently annotated tool catalog and no active
feedback workflow. Dependencies: existing tool factories, config parsing,
canonical guidance generation, and normal release workflow. Assumptions:
feedback has no remaining product purpose; published clients must migrate away
from it. Blocking product decisions: none under the stated scope assumption.

## Verified baseline state

| Surface | Evidence and impact |
| --- | --- |
| Annotations | `packages/mcp/src/tools/types.ts` defines read-only and bounded-write constants. `get_example`, `search`, `code_files`, `code_read`, `code_grep`, `docs_list`, `feedback`, and local `ask` use the latter. Other tools already use the former. |
| Registration | `packages/mcp/src/mcp/server.ts` registers feedback and exempts it from the quick-start prerequisite. The stable catalog contains 16 tools; `local-server.ts` can add `ask`, `resolve_target`, and `code_diff`. Removal leaves 15 stable tools, or 18 with all local experimental tools. |
| CLI and service | `src/cli.ts`, `src/commands/index.ts`, and `src/commands/feedback.ts` expose the command. `GitHitsService.submitFeedback`, `GitHitsServiceImpl`, and `RefreshingGitHitsService` call `/feedbacks`. `GitHitsService` is publicly exported by `@githits/mcp`; the concrete clients are exported by `@githits/mcp/client`. Removing the method affects external TypeScript/runtime consumers. |
| Guidance | `buildMcpQuickStart()` in `packages/mcp/src/mcp/instructions.ts` recommends feedback and has an exact terminal-guide copy in `skills/githits-mcp/SKILL.md`. `get-example.ts` also recommends feedback. |
| Experimental reporting | `experimental.report_tool_issues` in `src/services/experimental-config.ts` flows through CLI/local-server policy into a prompt to call feedback. This is agent guidance, not an automatic submission service. The config schema already allows unknown keys with `.passthrough()`. |
| Setup and skills | `src/commands/init/init.ts` discloses feedback writes. Public `githits-code` recommends CLI feedback, and `githits-onboarding` repeats the disclosure. `githits-package` must be inspected for parity but currently has no direct feedback match. |
| Examples | MCP and CLI expose `solution_id`; `extract-solution-id.ts` describes feedback as its purpose. Preserve the identifier and existing text/JSON result shapes; removing it is a separate output-contract change. |
| Checks | Catalog assertions exist in MCP server/local-server tests, `src/mcp-public-surface.test.ts`, and CLI/MCP smoke suites. Feedback-specific tests also occur in auth, auto-login, service mocks, and instruction/skill tests. |
| Release boundary | Public skills are read from `main`. The stable MCP guide has an explicit same-PR parity exception; onboarding changes belong on the release branch with their backing behavior. Hosted clients adopt released `@githits/mcp` through the separate `remote-mcp` repository. |

The existing rationale in `docs/implementation/mcp-tool-annotations.md` treats
service-side state and preparation as writes. Replace that rationale with the
approved policy rather than leaving contradictory explanations beside new flags.

Comparable public implementations support more than one interpretation:
[Perplexity answer/research tools](https://github.com/perplexityai/modelcontextprotocol/blob/c73c8561bbc2d9eb666334a53c311b50f4f4cf76/src/server.ts#L589)
and [Exa resumable agent runs](https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/src/tools/agentRun.ts#L528)
advertise read-only. [Firecrawl crawl jobs](https://github.com/mendableai/firecrawl-mcp-server/blob/4db752ee00910e17ec73f28b40796f0830fe86da/src/index.ts#L2788)
do not. These are source precedents, not deployed-server measurements.

## Architecture and boundaries

Keep the existing factory/service/transport layering. Remaining tool factories
use `READ_ONLY_TOOL_ANNOTATIONS`; delete the unused bounded-write constant after
feedback is removed. Assert the policy at both descriptor and registered-wire
catalog boundaries so new tools cannot silently escape review.

Remove feedback registration, implementation, CLI command, and now-unused
service methods/types/decorators. Update explicit re-exports and mock factories
where needed. There is no replacement tool, feedback tombstone, or success stub.
Old MCP calls receive the existing unknown-tool error, and old CLI invocations
receive the existing unknown-command error without sending a feedback request.

Remove the experimental reporting setting from typed settings and instruction
composition. Existing valid TOML containing `report_tool_issues` remains readable
as an ignored unknown key through the existing passthrough behavior; do not
rewrite users' files or add a migration mechanism. Remove the setting from
examples and help. Preserve experimental tool gating and the hidden eval flag.

No backend endpoint/database removal, data migration, telemetry redesign,
transport change, new dependencies, or changes to answer generation, source
provenance, auth, rate limits, cancellation, caching, or thread semantics.
Do not add concurrency machinery or claim this fixes the reported serial calls.
The hosted server remains responsible for its own deployment and composition.

## Phase 1: implementation and canonical guidance

Status: complete and reviewed. The CLI/MCP catalog,
service APIs, runtime guidance, current documentation, and stable MCP skill now
follow the selected policy. All 15 stable tools and all three enabled local
experimental tools advertise read-only. Feedback is unavailable, and old reporting
settings are ignored. Catalog/unknown-invocation contracts, auth/error coverage,
result identifiers, and quick-start parity pass the checks recorded below.

The independent change fragments record patch impacts for annotations and minor
pre-1.0 breaking impacts for removal across both public packages. Versions and
historical changelogs remain unchanged. Plugin generation/check produced no
content changes. CLI/onboarding skill follow-through is recorded in phase 2.

Actual verification results and limitations are recorded under implementation
evidence below; full-suite and live-eval coverage are not claimed.

## Phase 2: public skill follow-through

Status: complete and reviewed.

After PR #378 merged at `d9b8f965`, the user explicitly requested a new PR
fixing the audited skill issues. This request moves the previously deferred
CLI/onboarding skill cleanup into this feature PR, overriding the usual
release-branch timing for this specific change. It does not change the general
release policy or authorize release/version changes. Skills read from main will
stop recommending feedback before the next CLI package release.

Removed feedback recommendations from the code skill and the onboarding
disclosure; changed the packaging assertion to reject retired feedback advice.
Onboarding troubleshooting follows the main skill's command policy. Both the
main verification step and troubleshooting now use CLI-emitted verification,
preserving project scope and guidance preference and keeping local CLI
authentication separate from Cursor OAuth/tool discovery.
The public MCP skill and package skill required no changes. A CLI-only patch
fragment records the packaged guidance impact.

Validation: 232 skill/setup tests passed; all 17 skill tests passed again after
the internal review's main-verification consistency fix. Plugin generation/check
(10 assets, no generated content changes), build, changed-file Biome checks,
and secret-free CLI/MCP smoke passed. Four Claude/Codex skill-eval dry runs
covered global-example and onboarding; they do not establish live agent behavior.
Live onboarding would change host configuration/authentication and is outside
this verification scope. The generic skill-creator validator rejects the
repository's existing `compatibility` frontmatter field; preserved that metadata
and used the repository's passing YAML/skill contracts instead.

Review follow-through: preserved the original removal fragment under the
independent-fragment rule. This PR's new fragment records completed skill
cleanup; when assembling release notes, omit the superseded "CLI and onboarding
public skill cleanup follows release preparation" clause from the older note.
Expanded the new feedback regression to every public skill Markdown file,
including references, so new files cannot escape the same inventory check.
Internal review and Claude Opus round 3 are clean; the one-time fresh-context
check ran in round 2. The release-note reconciliation above remains part of
phase 3, with the new fragment also recording that skill cleanup is complete.
Retained reviewer: `term_92a86fae-9864-489a-ba62-eae810b859a3`.

## Phase 3: release alignment and hosted adoption

Status: release candidate prepared and reviewed; publication and hosted adoption pending.
Expected outcome:
released CLI, skills, and hosted catalog reflect the same product policy.
Dependencies: phase 1 validated; release preparation includes its changes;
hosted adoption requires the new published MCP package.
Assumptions: existing independent CLI/MCP releases and hosted ownership remain.
Unknowns: actual release versions and remote deployment revision/date, resolved
during release preparation/adoption. No further product decisions are needed.

Include phase 2's skill cleanup in the next CLI release. Preserve stable MCP
builder/skill exact parity and verify generated assets at release preparation.

Release preparation on 2026-09-10 starts from merged main `53463de5` and covers
the complete `v0.15.1` and `mcp-v0.15.1` ranges: PR #376 (Ask diagnostics),
PR #378 (read-only annotations and feedback removal), and PR #379 (skills).
All four pending fragments cover those changes. Public export/build inspection
corrected the Ask diagnostic fragment's MCP impact: its Ask client, adapter,
mapper, and diagnostic detail type are not exported in the MCP package. That
fix ships in `githits` CLI/local MCP only, so its effective impacts are patch
for `githits` and none for `@githits/mcp`. Feedback retirement is minor for both;
annotations are patch for both; skill cleanup is patch/none. Aggregate impact
remains minor for both public artifacts, so both release versions are `0.16.0`.
Prepared separate changelog sections, consumed all four fragments, updated
package/registry/lockfile versions, and regenerated plugin manifests. The
superseded skill-deferral wording is omitted from the assembled release notes;
skill cleanup is included. Historical changelog sections remain unchanged.
Validation: 51 release/packaging tests pass, along with plugin generation/check,
build, packed public-consumer validation using Bun 1.4.2, and all four source
and built CLI/MCP smoke modes (25 CLI steps and nine MCP steps per mode).
Historical changelog content is unchanged. Pinned `mcp-publisher` v1.7.9 validates
`server.json`; public resource metadata returns 200 and the unauthenticated
hosted endpoint returns 401 with its resource-metadata challenge. These checks
do not establish deployment of the new tool catalog.
The unchanged runtime baseline `53463de5` has successful Main CI run
`34452636638`: Linux/Windows unit tests and Node 20/22/24/26/Bun compatibility.
Prior feature validation and skill-eval dry-run limitations remain recorded
above; no live agent behavior is newly claimed by release metadata changes.
Internal review and Claude Opus round 3 are clean. The fresh-context check ran
in round 1. Final notes preserve diagnostic compatibility and explicitly cover
hosted adoption for plugins and direct Cursor setup. The rejected suggestion
to document a removed public `createFeedbackTool` export was checked against
the historical `@githits/mcp/tools` entrypoint, which never exported it.
Retained release reviewer: `term_094ea670-44bb-4201-b0b0-2523e5fda328`.
Package publication, MCP registry publication, and hosted dependency adoption
remain pending after release PR preparation and require the normal merge gate.

Prepare coordinated artifact release notes, including removal of service APIs,
the ignored old config key, and client restart/tool-discovery refresh. Follow
the existing release PR workflow; release merge/publishing requires its separate
human approval. This planning request authorizes no release or deployment.

After publication, the `remote-mcp` maintainer updates the dependency, adjusts
any external feedback consumers, deploys, and checks actual `tools/list` for no
feedback and all returned `readOnlyHint` values true. Do not promote local-only
experimental tools into the stable public package as part of this change.

Acceptance: the published skills contain no active feedback advice, generated
assets are aligned, both released packages contain the intended changes, and
hosted adoption is verified or explicitly recorded as awaiting deployment.
Rollback: revert/release the relevant code and guidance together and restore the
prior hosted dependency if needed. No persisted-data rollback is necessary.

## Reorientation, completion, and review

After phase 1 merges, compare this plan with current `origin/main` and the
release branch before proceeding. Reorient scope and test evidence using the
repository's readiness workflow; if `$next-steps` is unavailable, perform the
same read-only comparison and record it here. Keep this plan until implementation
review and the release/skill follow-through are complete. Transfer the lasting
annotation rationale and migration facts into implementation documentation
before retiring the plan.

Overall acceptance: every remaining advertised tool is read-only, feedback is
unavailable on the agreed surfaces, guidance matches tool availability, retained
retrieval contracts pass their checks, and the release/hosted handoff is recorded.

Plan review completed on 2026-09-10:

- Internal `code_reviewer`: no blocking issue. Accepted its minor completeness
  finding and explicitly named `TOOL_GUARDRAILS.md` and `tools/shared.ts` in
  the existing active-tool-list cleanup.
- Fable (`claude-fable-5`, dispatch `ctx_9c2f803cac19`): approved with three
  minor completeness findings. Accepted and named `docs/experimental-tools.md`,
  `eval/mock-cli/githits.ts`, and the endpoint comments in core `config.ts`.
  Source inspection confirmed all three. The mock belongs to the separate
  security/skills fixture harness, not `agent:e2e`; reject that part of the
  reviewer's impact claim while retaining the valid fixture-consistency fix.
- These edits identify consumers of already-scoped removals; they do not change
  architecture, scope, phases, or acceptance criteria, so no further external
  plan-review round is needed under `do-plan`.
- Retain the Fable session for follow-up inspection:
  `term_a4223a8e-da8a-47ee-a642-5e6b6de2c696`.
- Planning validation: source/doc inspection and whitespace checks only.
  Production tests, builds, smokes, and agent evaluations are specified above
  for implementation and have not been run for this documentation-only change.

No production code, generated assets, installed user skills, or product service
state changed during planning.

### Phase 1 implementation evidence (2026-09-10)

Implemented the seven annotation switches and removed feedback from MCP, CLI,
service APIs, reporting settings, runtime guidance, and current documentation.
The stable MCP skill matches the quick-start builder. Legacy reporting keys are
ignored, and result/thread identifiers remain intact. Two change fragments
record the independent annotation and breaking removal impacts.

Validation:

- `bun test src packages eval/security-eval.test.ts scripts/smoke-scripts.test.ts scripts/smoke-launch-target.test.ts scripts/smoke-environment.test.ts scripts/validate-public-packages.test.ts scripts/generate-plugin-assets.test.ts`:
  4,198 passed, zero failed across 189 files.
- Typecheck, lint, build, plugin generation/check, changed-TypeScript formatting,
  and whitespace checks passed. Generated assets have no content changes.
- Source CLI unauthenticated smoke and MCP registration smoke passed, as did
  both built smoke modes (25 CLI steps and nine MCP steps per mode).
- Public packed-consumer validation passed with
  `npx --yes bun@1.4.2 --bun run validate:packages`. Installed Bun 1.3.9 hit its
  Windows path assertion during the MCP package build.
- Full `bun test` encountered an unrelated temporary-directory `EBUSY` failure
  in `scripts/agent-eval-suite.test.ts:2144` and later stalled after the publishing
  tests; the task-owned test process was stopped. The product suite above passed.
- Repository-wide `format:check` fails on existing CRLF formatting in unchanged
  files; all 56 changed TypeScript files pass the formatter independently.
- Six agent-eval dry runs completed: Claude and Codex, global-example with both
  descriptor/full guidance and experimental question-only Ask. No live agent
  behavior, answer quality, or concurrency result is claimed. A development
  backend was not configured; authenticated/live evaluations remain unverified.
- Internal implementation review initially found no actionable issues. External
  Claude round 1 identified two minor findings, both accepted and fixed: repair
  the setup-description conjunction after deleting feedback disclosure, and
  validate annotations on every advertised tool in the public smoke helper.
  The latter could miss an annotation regression on an additional tool such as
  local Ask; the fix is one loop change and a regression test. Related setup
  documentation, both smoke implementations, and catalog tests were checked for
  the same assumptions. The annotation fragment now describes the helper's
  stricter validation. All 67 smoke-helper tests, typecheck, and packed public
  consumer validation (Bun 1.4.2) pass after these changes.
  Round 2 confirmed both fixes; its fresh-context check found stale descriptions
  of issue-reporting opt-in/overrides. Removed them from the README, experimental
  tools guide, configuration and parity docs; a sibling scan also found and
  removed the resolver documentation's opt-in sentence and two stale module
  labels in the configuration guide. Renamed the old-policy
  test to describe a retired key (30 MCP startup tests passed). Kept the smoke
  assertion that the retired guidance is absent as intentional regression
  coverage, updating its error message to describe the forbidden content.
  Remaining reporting matches are removal assertions, migration fixtures, and
  ordinary diagnostics/setup/evaluation reporting unrelated to the retired tool.
  Internal review and external Claude round 3 confirmed closure with no
  outstanding findings. Claude completed one fresh-context check in round 2;
  round 3 directly checked the final documentation changes. Retained reviewer:
  `term_198c7156-7b0e-47c0-8405-c31f7eed4e42` (Opus), released after PR #378 merged.

The phase 2 skill edits moved into the user-requested follow-up PR after merge.
Hosted adoption still requires package publication and a remote server deployment.
