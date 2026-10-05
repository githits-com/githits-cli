# Search snapshot commit dates

Status: IMPLEMENTED, awaiting code review. One implementation increment; user authorized delivery through a draft PR, no merge or release.

## Problem and outcome

Coding agents cannot see known commit dates in repository snapshot provenance. Show independent absolute UTC calendar dates for served and resolved requested commits in the existing compact sentence, preserving read-now actions and exact served read pointers.

## Verified state and ownership

- Branch starts at origin/main 5a95c46. Read both /tmp/githits-cli-commit-date-handoff.md and /tmp/commit-date-dev-verification.md in full.
- Backend dev independently verified committedAt on served and resolvedRequested, retained progress and exact served reads. Transformers served date was unknown; requested date was 2026-10-05. Jason current HEAD date was 2026-05-05.
- packages/core-internal/src/services/code-navigation-service.ts owns TARGET_RESOLUTION_SELECTION, nullable identity schema and normalization. This selection is reused by search, progress, retained results and navigation queries. Add only committedAt to served/resolvedRequested, never requested; no additional requests. Existing navigation consumers (read/list/context/symbol and lean grep JSON) also receive this additive metadata; cover read JSON explicitly.
- packages/mcp/src/shared/target-resolution.ts owns lean identity whitelisting. Preserve known timestamps, omitting null in the existing lean convention without borrowing between identities.
- Existing unified-search-presentation.ts repository_snapshot trust limit owns structured display provenance; unified-search-text.ts owns shared CLI/MCP copy. Derive servedCommitDate/requestedCommitDate there with slice(0, 10) of verified UTC backend DateTime, only alongside the corresponding full SHA. The trust limit carries calendar dates; shared text renders them. Existing evidence attribution and lifecycle gates remain unchanged.
- Healthy current results do not emit the existing snapshot sentence. Keep that compact text behavior; dates remain in structured JSON for all returned identities.

## Assumptions and unknowns

- Assumption, verified by supplied dev record: committedAt is nullable UTC committer time of exact repository + full SHA, not indexing time, freshness, ancestry, current branch membership or commit distance. Future and reversed dates are valid.
- Assumption, verified in source: all affected consumers share the existing identity selection. Regression tests will assert served/resolvedRequested selection and undated requested selection in initial and status requests, including compact/detailed modes.
- Product decisions: none. Production schema availability is unknown and must be confirmed before user-owned release; never probe production or add compatibility fallback machinery in this increment.
- Historical enrichment remains backend scope and is not included.

## Increment 1 — dates survive transport and compact provenance (READY)

Dependencies: backend dev field, supplied verification artifacts; no backend edits.
Expected outcome: agents see served commit date and independently dated different requested commit, use visible hits immediately, and wait only when existing freshness/exact-ref guidance warrants it.

1. Extend shared domain/schema/normalizer and lean projection with committedAt?: string (wire null becomes absent, as for sibling fields). Select it only on resolvedRequested and served in existing identity fragment.
2. Add date-only copy to existing snapshot clauses: commit: github:owner/repo@sha (committed YYYY-MM-DD, indexed from ref HEAD); requested HEAD resolves to a different commit (committed YYYY-MM-DD) and is indexing. Omit unknown clauses. Never transfer requested date into served clause even for same SHA. Keep date wording attached to the relevant commit.
3. Extend existing tests for both/served/requested/neither known, same/different SHA, old/future/reversed dates, omitted SHAs, retained status, current/no-wait, provisional, terminal, withheld and searched zero-hit behavior. Verify readTarget unchanged and date-independent presentation actions. Check search/status service transport and MCP/CLI JSON/text parity using existing patterns.
4. Focused verification: bun test affected core service, target-resolution, search presentation/text/status/response and CLI/MCP parity files; bun run typecheck; bun run build; scoped Biome checks; GITHITS_ENV=dev bun run smoke:cli and smoke:mcp with unintended endpoint overrides unset. Attempt focused local dev search/status/read if authenticated. Run GITHITS_ENV=dev bun run agent:e2e --agent claude --server local --intent-profile githits --workload eval/agentic/workloads/unified-search-investigation.md and inspect tool-calls.json, final.json, metrics.json, isolation-violations.json. No performance claim or optimization; no benchmark required.
5. Update docs/implementation/search-snapshot-presentation.md with final contract, examples, evidence and rollout limit; add changes/search-commit-dates.changed.md with minor impact for both public artifacts.
6. Internal pre-flight then fresh Claude review to a clean round; commit, push and open draft PR against main. After clean review move durable evidence to implementation docs and delete this completed plan in a final commit before PR creation.

Acceptance: independent dates survive initial and retained responses/projections; concise grammatical shared copy; missing dates disappear; identity, completeness, lifecycle, read pointers and conditional actions unchanged. No extra network calls, inference, date age, polling, new modules/dependencies/infrastructure or runtime backfill. Validate exact wire selection and shared compact/JSON behavior. Report checks, limitations and any findings/refactoring opportunities.

## Completion / reorientation

Single increment: no later phase. If verified backend behavior contradicts this contract, stop and report evidence. Keep plan through review; remove only after clean review and durable docs are complete. Production rollout confirmation belongs to release preparation: client release or hosted adoption before schema deployment makes the existing fallback issue sequential requests and ultimately omit targetResolution, losing served provenance and prior-HEAD guidance. State this failure mode in permanent docs and the change fragment.

## Plan review evidence

Internal preflight clean. Claude Opus 5.5 plan round 1: direction sound; accepted six documentation/copy refinements: concrete release failure mode, shared navigation JSON consumer coverage with read assertion, sibling null-to-absence convention, comma within date/ref parentheses, calendar slicing in presentation, minor/minor SemVer impact. No architecture, phase boundary or product change. The revised plan corrects these documented contracts; no unresolved findings. Bounded scan: shared selection consumers, fallback query builders, identity normalizers/projections, date copy and release fragment precedent.

## Observed implementation evidence

668 focused tests pass with 3,258 expectations across the 14 listed files; final typecheck, scoped Biome and diff checks pass. Root/MCP builds and public-package validation pass. Both dev smoke suites pass auth handling but skip live cohorts. Direct file-auth dev search requires auth; normal auth keychain access was blocked and that probe stopped. Targeted Claude e2e run 2026-10-05T17-25-30-431Z failed before tool calls because Claude was not logged in; no behavioral quality claim. Full wire timestamps are retained in domain/JSON, wire null is omitted; presentation alone slices UTC dates. Actual retained status JSON parity is tested. No new infrastructure or refactoring opportunity was required.
