# Field report agent UX

## Outcome and scope

Deliver one review PR for the four Softlandia recovery/output fixes. Agents can
retry unavailable package inventories using a pinned repository and their original
paths, request excessive grep context successfully, see package empty-inventory
hints, and receive timing plus bounded native wait instructions while preparation
continues. No merge, release, deployment, unrelated backend fixes, tool-description length
changes, or init guidance changes are authorized.

## Verified state and ownership

Base: main 36dde57d. The list mapper currently constructs a bare URL@SHA action
without request paths. ListErrorContext reaches both CLI and MCP but carries only
cursor presence. Existing repository-target helpers own provider formatting.
At the base revision, the grep MCP schema and shared builder reject context above ten; the existing
CLI grep-context helper already validates and clamps values and exposes structured
contextClamping facts. Reuse it rather than introduce a second policy.
Shared formatters own CLI/MCP prose; tool/command boundaries supply native retry
syntax. Existing indexingWaitMs already uses total upper bounds plus ten seconds,
rounded up, with per-tool caps and a no-history wait. List/read indexing errors
and search progress already used it. At the base revision, grep errors replaced it with generic advice;
grep/list suggestions deliberately cap at 120 seconds despite a 300-second input ceiling.
Readable read results can include preparation estimates without retry guidance.
The default wait remains 30 seconds; the optional adaptive default is not needed.

Core list-service owns wire selection/decoding; list-response owns projection;
list-text owns human empty-result wording. The local backend SDL at3255bc9ea
and its List adapter have no success hint. The user approved a bounded backend
worker in child worktree `field-report-list-hint` to add nullable `ListResult.hint`
String, null for nonempty/repository/site/pending responses. SourceInventory owns
the certified package root, validated selection and full served snapshot identity;
it builds neutral repository-relative locator guidance with no additional fetch,
and the List adapter forwards it. Client decoding/selection/rendering uses this
confirmed contract. No compatibility fallback infrastructure is added.

## Architecture and constraints

Keep existing service injection and GraphQL boundaries. Keep native retry syntax at the list tool/command boundaries; produce copy-ready repository list actions and
retain the broader-scope explanation. Preserve exact full commit identity and
literal path strings. Normalize context before service invocation, report the
existing structured clamping facts in JSON, and a concise note in MCP text.
Preparation timing is advisory total execution evidence, never remaining ETA.
Keep established suggestion caps: grep/list/search 120 seconds and read 60 seconds. Reuse existing wait and formatter helpers; no automatic polling, retry, cache,
new infrastructure, dependencies, or caller constraints. JSON retains backend
facts. Raw read output and silent list output stay pipe-friendly.

## Ordered phases (one delivery PR)

1. Context and preparation is implemented: MCP grep clamps excessive context with
   text/JSON facts; grep/read refresh and ended mixed searches expose bounded
   native wait advice while preserving hits, local recovery, raw output and active
   status actions. Durable contracts live in
   [unified grep](../implementation/unified-grep.md) and
   [indexing estimates](../implementation/indexing-estimates.md).
   No open product decisions for this independent slice.
2. Repository-scope recovery is implemented through the existing list error
   module and native caller boundaries, preserving literal paths and explaining
   that monorepos may need their package directory prefix. The explicit user
   requirement to retain paths is authoritative; no inferred package root or
   backend extension is added. Contract: [unified list](../implementation/unified-list.md).
3. Empty package inventory hint: client selection, decoding, projection and
   empty-result rendering implement the approved nullable String contract.
   Annotated text and JSON select the field; silent paths do not. Durable contract
   lives in [unified list](../implementation/unified-list.md).
   Remaining dependency: backend child implementation, review and draft PR;
   client and backend review/test evidence must confirm exact contract agreement.
   No open product decisions. Backend deployment must precede client release;
   this task authorizes neither deployment nor release.

The new GraphQL field must be deployed before either public artifact is released. The client changes share one review PR, with a separately approved bounded backend dependency PR; neither is merged, deployed or released by this task. Keep both PRs explicit about the backend-first release dependency; do not add a fallback or omit the requested hint.

## Verification and completion

Run focused bun tests for changed layers, typecheck, build, source CLI/MCP smoke,
format/lint, and one targeted local MCP grep agent eval using the existing harness.
Inspect trace calls, final answer, metrics and isolation violations; no quality
claim without grading. Use unauthenticated smoke modes if auth is unavailable;
never print credentials. No performance optimization or benchmark claim.
Update unified-list, unified-grep and indexing-estimates durable contracts and
add independent patch fragments for each notable fix covering both public
artifacts. Run internal and one external review per round. Fix minor findings
in place. Open the single draft PR for review with its remaining backend-hint gate explicit. After the backend contract implementation is reviewed and the final full review is clean, retire this plan with the final commit. Record execution evidence on the PR and report CI status.
