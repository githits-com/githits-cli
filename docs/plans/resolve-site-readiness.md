# Resolver site readiness without blocking on-demand search

## Status and governing correction

Replanned S2b, reviewed and implementation-ready. The user's 2026-09-07 correction supersedes
all earlier S2b clauses requiring `docsAvailable` for actionability or blocking
search. The backend source plan at
`/Users/jpl/orca/workspaces/pkgseer-backend/anemone/docs/plans/DOCUMENTATION_CORPUS_STABILIZATION.md`
is read-only here and is being corrected by its owning coordinator.

## Problem and outcome

Resolver documentation readiness must be honest without disabling on-demand
indexing. `docsAvailable: false` is a current readiness fact, not a prohibition
on search. A confident, unambiguous, security-safe site identity keeps the
existing search continuation. Search of package-referenced or otherwise admitted
sites can initiate ordinary backend preparation. Never substitute another product.

## Verified state and ownership

Baseline `origin/main` and HEAD are `d48415792499f61b3203e700267a21617269419c`.
The original guard was uncommitted and has been fully withdrawn.

- `packages/mcp/src/shared/resolve-target-response.ts` owns the shared identity
  and security predicates, JSON projection, and per-target evidence used by both
  renderers. Its current actionability rule has no docs availability gate.
- `packages/mcp/src/tools/resolve-target.ts` and the shared terminal renderer
  already suggest docs search for a safe EXACT/HIGH site best. Both retain
  security warnings and confidence/ambiguity gates.
- `src/commands/search.ts` and `packages/mcp/src/tools/search.ts` normalize the
  exact target and call `CodeNavigationService.search` without consulting
  resolver availability. Backend search owns admission and preparation.
- The resolver service already selects/parses `best`, full-target security
  status and `docsAvailable` in compact and detailed modes. No request change.
- Existing `src/commands/search.test.ts` and MCP search tests cover site target forwarding and backend INDEXING
  response rendering. New tests connect these existing boundaries explicitly.

The shared evidence formatter naturally owns the new readiness label because
both text surfaces consume it. A separate client state machine or guard would
misplace backend admission/preparation ownership and is excluded.

## Scope and acceptance

One implementation increment; product decisions and unresolved assumptions: none.
On-demand preparation semantics are supplied by the explicit user correction.
Client fixtures prove request forwarding and response rendering, not actual
backend crawl execution. No live corpus changes or production verification.

1. A SITE row with false docs availability displays `documentation not currently
   ready`, whether page count is absent, zero, or positive. This label applies
   only to SITE; package and repository evidence remains unchanged. Do not claim
   queued, preparing, or a retry time. Available sites retain existing docs evidence.
2. Non-ambiguous EXACT/HIGH safe site best remains actionable with docs false.
   Its existing concrete CLI/MCP docs search continuation remains. Best identity,
   confidence and candidate order stay unchanged, including mixed alternatives.
3. MEDIUM/LOW remain uncertain, ambiguity remains ambiguous (including all sites
   unready), and unknown empty results remain unknown. Security UNKNOWN/AFFECTED,
   unknown status and absent full best fail closed as before. Combined security
   and readiness preserves the actual security warning.
4. CLI/MCP text is verified in compact/verbose modes; JSON retains best,
   confidence, docsAvailable, counts and order. Package/repository controls pass.
5. Invoke the existing search adapters using the same unready site's canonical
   identity (and a package-target control). Verify exactly one ordinary search
   call with the original target and DOCS source. Feed a backend INDEXING outcome
   and assert indexing wording appears only in the search response. Do not claim
   a mocked client test proves crawl admission or completion in the backend.

## Ordered implementation and evidence

A single callable Luna worker previously completed the now-superseded guard-test
slice. Its second dispatch failed due to a provider usage limit before edits.
The owning coordinator explicitly takes back remaining work; no substitute
implementor or new worker fanout. Both share danger-full-access, not isolation.

1. After plan review, change only site readiness evidence in
   `packages/mcp/src/shared/resolve-target-response.ts`; leave actionability,
   both renderer routing branches and search runtime unchanged.
2. Add named `S2b readiness` cases in its existing `.test.ts` and
   `src/tools/resolve-target-parity.test.ts` for acceptance 1-4. Use established
   factories and restored spies. Shared fixture meaning: best SITE
   `site:ai.pydantic.dev`, EXACT, full target NOT_APPLICABLE, docs false,
   retained docsPageCount 12 (also exercise zero/absent counts);
   related package/site alternatives remain in backend order.
3. Add named `S2b readiness` parser cases in
   `packages/core-internal/src/services/resolve-target-service.test.ts`, with
   the same retained-best meaning, in compact/detailed modes.
4. Add named `S2b readiness` search continuation cases in
   `src/tools/search-parity.test.ts` for acceptance 5, using existing factories.
5. Update resolver sections in `docs/implementation/cli-commands.md` and
   `docs/implementation/mcp-cli-parity.md`, and the durable S2b delivery record
   `docs/implementation/resolve-site-availability.md`. Add one independent
   patch fragment for both public artifacts; no version bumps or release.

Focused commands (each prints individual named cases, not only aggregate counts):

```sh
bun test packages/mcp/src/shared/resolve-target-response.test.ts --test-name-pattern 'S2b readiness'
bun test src/tools/resolve-target-parity.test.ts --test-name-pattern 'S2b readiness'
bun test packages/core-internal/src/services/resolve-target-service.test.ts --test-name-pattern 'S2b readiness'
bun test src/tools/search-parity.test.ts --test-name-pattern 'S2b readiness'
```

Then run affected complete files including CLI/MCP resolve and search tests,
`bun test`, `bun run typecheck`, `bun run build`, formatting/lint checks, and
secret-free `bun run smoke:cli --mode unauthenticated` /
`bun run smoke:mcp --mode registration`. No production smoke or corpus mutation.
The live agent harness has no reviewed unready-site fixture mode; do not invent
one or treat a dry run as behavioral evidence. Record that qualitative live
coverage remains outside this deterministic acceptance, per the user's boundary.

## Reviews, compatibility, and completion

Review this documentation-only plan inline under the user's reviewer-sizing
policy, then one external Fable plan review. Implementation gets one preflight,
at most one internal code_reviewer, then an external Opus review with no nested
reviewers. Retain the settled code reviewer through PR approval.

No schema, requests, new flags, tables, retry/crawl machinery or caller constraint.
No optimization claim or benchmark is needed. Security and backend ownership
are unchanged. No migration, client-first dependency, or mandatory client upgrade.
Normal publication will carry the readiness wording; old clients already retain
search continuation. Backend S2a retrieval work remains independent and outside
this lane. Merge/release/deploy require separate authorization.

Transfer actual verification and review results into durable implementation docs,
delete this temporary plan after implementation review, then commit, push and
open a verified draft PR. Report the source-plan correction/completion needs to
the user without editing or messaging another lane.

Plan review: coordinator inline assessment plus one Fable pass. Accepted minor
clarifications for absent counts, SITE-only wording, and the existing indexing
fixture location. No scope/architecture change, no second plan round needed.
