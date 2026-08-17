# CodeDiff client adapter

## Purpose

The transport-neutral adapter exposes PkgSeer's exact-tree `codeDiff` GraphQL
operation to the public `@githits/mcp/client` runtime. It provides the typed
boundary needed by the later CLI and MCP surfaces without choosing their
ergonomics or claiming that a patch proves compatibility.

Phase 1 deliberately adds no CLI command or MCP tool. Those surfaces must first
settle Git-like view names, path-glob behavior, output defaults, and parity
tests.

## Addressing and modes

`CodeNavigationService.codeDiff` accepts an unversioned package or repository
target plus explicit `from`, `to`, and `mode` values:

| Mode | File fields selected |
| --- | --- |
| `inventory` | identity, status, mode/type changes, content status, safety |
| `stats` | inventory fields plus additions and deletions |
| `patches` | stats fields plus patch and omission reason |

Package requests send only `registry`, `name`, `fromVersion`, and `toVersion`.
Repository requests send only `repoUrl`, `fromRef`, and `toRef`. Raw options are
omitted when empty. The adapter does not infer refs, synthesize patches,
detect renames, or fall back to a hosted compare endpoint.

The adapter rejects client values outside PkgSeer's raw bounds instead of
silently clamping them: `maxFiles` is `1..300`, `maxPatchBytes` is
`1024..2097152`, and each path prefix/glob is non-empty and at most 1024 UTF-8
bytes. Unknown raw option keys are rejected before token acquisition or a
network request.

## Response and error contract

Successful responses require a non-null `raw` result. The normalized result
preserves both exact resolutions, package identity when present, scoped
summary, scope, content coverage/failure, file identity/status/content status,
backend content-safety modifications, and `hasMoreFiles`. A non-null raw
inventory remains successful even when it contains `contentFailure`; that is
post-inventory partial content, not a transport failure.

Raw field-local GraphQL failures are represented by `CodeDiffError`. Its
`details` object retains only the bounded backend extension fields needed for
recovery:
the error code/retryability, side, published-version hints, registry, retry
delay, raw stage/limit, repository/ref hints, available/suggested refs, and
ambiguous ref kinds. Arbitrary GraphQL extensions are discarded. When the
backend returned valid `fromResolution` and `toResolution` data alongside a
field-local `raw` error, `partial` preserves that root identity (and any raw
data that was actually returned). A root error with no root data has no
fabricated result. Root authentication/access, client-update, and
schema-mismatch errors retain the existing CodeNavigation error mapping,
including authentication and refresh behavior; semantic CodeDiff resolver
failures use `CodeDiffError` without a fabricated partial result.
Malformed responses and unknown backend enum values remain
`MalformedCodeNavigationResponseError`.

The adapter uses the existing token-refresh, authenticated GraphQL transport,
HTTP, timeout, and debug-wire boundaries. It does not make a live query while
building package artifacts or validating the packed public TypeScript
consumer.

## Public boundary

The service method, CodeDiff request/result types, and `CodeDiffError` are
re-exported from `@githits/mcp/client`. This is a public TypeScript interface
change: custom `CodeNavigationService` implementations must add `codeDiff`
when adopting the package version containing this adapter. The existing test
factories provide deterministic default results so current tool tests remain
focused on their own behavior.

## Key reference files

| File | Responsibility |
| --- | --- |
| `packages/core-internal/src/services/code-navigation-service.ts` | GraphQL query, validation, schemas, normalization, and errors |
| `packages/core-internal/src/services/code-navigation-service.test.ts` | Wire-selection, variables, normalization, and failure fixtures |
| `packages/mcp/src/client.ts` | Public client type/value re-exports |
| `scripts/validate-public-packages.ts` | Packed-package runtime and no-network TypeScript consumer checks |
| `docs/plans/code-diff-cli-mcp.md` | Phase 2 CLI/MCP ergonomics and scope decisions |
