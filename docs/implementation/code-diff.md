# CodeDiff client adapter

## Purpose

The transport-neutral adapter exposes PkgSeer's exact-tree `codeDiff` GraphQL
operation to the public `@githits/mcp/client` runtime. The root package also
registers `githits code diff` as an intentionally unpromoted CLI dogfood
surface. The local MCP composer also exposes a config-gated `code_diff` adapter
for the same exact-tree evidence, but the public and remote MCP surfaces remain
stable and do not include it. Neither layer claims that a patch proves
compatibility.

The local adapter is enabled only when the host experimental-tools policy is
enabled. Its MCP-native target union, separate endpoints, bounded projections,
and structured error envelope are internal to local composition; combined MCP
instructions are composed only for the local server; remote/public exposure
and Agent Skill guidance remain later rollout steps after dogfood and
evaluation.

## Addressing and modes

`CodeDiffService.codeDiff` accepts an unversioned package or repository
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

Both addressing forms return repository-wide raw results. Package addressing
resolves package, repository, version, and exact-commit identity, but does not
discover or filter to a package subpath. Caller-supplied `pathPrefix` and
`pathGlob` narrow repository-relative paths without changing
`scope.status: REPOSITORY` or proving package ownership. Sibling package paths
may appear, and deterministic repository-relative relevance ranking plus
`maxFiles` can produce a bounded result with no files from the addressed
package. That absence does not prove the package is unchanged.

Target selection uses own-key presence: an opposite target key is rejected even
when its value is `undefined`.

The adapter rejects client values outside PkgSeer's raw bounds instead of
silently clamping them: `maxFiles` is `1..300`, `maxPatchBytes` is
`1024..2097152`, and each path prefix/glob is non-empty and at most 1024 UTF-8
bytes. Unknown raw option keys are rejected before token acquisition or a
network request.

## Response and error contract

Successful responses require a non-null `raw` result. The normalized result
preserves both exact resolutions, package identity when present,
repository-wide summary and scope, caller filters, content coverage/failure,
file identity/status/content status, backend content-safety modifications, and
`hasMoreFiles`. A non-null raw inventory remains successful even when it
contains `contentFailure`; that is post-inventory partial content, not a
transport failure. Current successful results use `REPOSITORY`; `PACKAGE` and
`UNKNOWN` remain accepted only for compatibility with older backends.

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

The additive `CodeDiffService` capability, CodeDiff request/result types, and
`CodeDiffError` are re-exported from `@githits/mcp/client`.
`CodeNavigationServiceImpl` implements both `CodeNavigationService` and
`CodeDiffService`, while custom `CodeNavigationService` implementations remain
source-compatible and do not need to implement the unpromoted diff capability.
The existing test factories provide deterministic default results so current
tool tests remain focused on their own behavior.

## Silent CLI dogfood contract

The CLI accepts either an unversioned package/repository target followed by an
explicit `from..to` range, or `--repo-url <url>` followed by that range:

```sh
githits code diff npm:express 4.18.1..4.18.2
githits code diff npm:express 4.18.1..4.18.2 --name-status
githits code diff --repo-url https://github.com/expressjs/express v4.18.1..v4.18.2 -- 'lib/**/*.js'
```

The default is bounded patch output. `--patch`, `--stat`, `--name-only`, and
`--name-status` are mutually exclusive; the inventory-backed name views avoid
requesting stats or patches. One optional repository-relative glob follows
`--`. It is the backend's bounded `*`/`?`/exact-`**` grammar, not a Git
pathspec. A backslash escapes exactly one following non-slash character; this
mirrors PkgSeer's `CodeDiff.Raw.PathGlob` compiler rather than shell or Git
escaping. `--max-files` applies to every view and `--max-patch-bytes` applies
only to patch output. Omitted bounds remain absent on the wire so the backend
owns its defaults.

Plain stdout contains only the selected Git-like projection. Resolution,
scope, truncation, unprojectable-file, content-coverage, path-encoding, and
content-safety diagnostics go to stderr. `--verbose` adds exact identity and
scope diagnostics without changing the primary stream, including
`scope: repository` for current results. Repository scope is normal and does
not produce a warning; legacy `UNKNOWN` remains visibly repository-wide.
`--json` emits a lean camel-case data envelope whose separate package target,
exact resolutions, effective `scope: {status: "repository"}`, caller filters,
and completeness fields preserve the contract without presentation prose. File
objects include only fields relevant to the selected view, except that
`pathEncoding` is always retained to distinguish display-only byte escapes.
Text views use reversible Git-style quoting for control characters, quotes, and
backslashes instead of changing path identity.
Stat rows measure quoted paths in terminal cells rather than JavaScript string
length, keeping dividers aligned for wide Unicode and emoji filenames. On an
interactive color-capable terminal, patch additions/deletions, stat bars, and
summary direction markers use green/red, hunk headers use cyan, and name-status
letters reflect the change kind; redirected output and `NO_COLOR` remain plain.
The response projector replaces the raw content service's `a/file` and
`b/file` patch placeholders with the authoritative Git-quoted file path, so
plain and JSON patches agree; added and deleted sides use `/dev/null` like Git.

An empty authoritative diff exits 0. Name, stat, and JSON views retain partial
evidence with explicit completeness fields and diagnostics. Plain patch mode
suppresses stdout and exits 1 when unexpected truncation, failed or unavailable
content, binary/metadata-only changes, display-only paths, unprojectable files,
or content-safety changes would make the stream unsafe to apply. An explicit
`--max-files` authorizes file-count truncation, and an explicit
`--max-patch-bytes` authorizes aggregate patch-budget omissions; neither
authorizes unrelated failure classes. Suppression diagnostics name
binary/metadata-only causes and direct humans to stat/name views while JSON
retains structured partial evidence. The applicable patch stream is unified
diff content; the backend does not provide Git index or mode headers.
Validation, authentication, resolution, and raw-field errors exit 1 through
the shared CLI error envelope. The local `code_diff` MCP adapter maps the same
classes of failures into the structured MCP error envelope and uses compact
MCP-native text by default. Its `text-v1` patch previews are bounded at 320
UTF-8 bytes; each affected file is labeled `patch preview (truncated)` and one
aggregate `Next:` recovery directs callers to `format: "json"` for the full
returned patch content. That JSON remains subject to backend limits and content
coverage, and cannot recover content omitted by the backend. `Content: complete`
describes backend-returned coverage, not that every returned byte was printed
in the compact preview.
It is not included in public/remote descriptors or smoke inventories, and its
guidance is not promoted through public/remote MCP instructions, Agent Skills,
or plugin guidance during this phase.

## Deferred rollout boundaries

Public MCP and agent exposure remains deferred until post-merge CLI dogfooding
resolves the MCP view vocabulary, evidence-backed `maxFiles` and
`maxPatchBytes` defaults, automation semantics for partial or failed content,
and whether `pathPrefix` or any CLI signature correction is actually needed.
Before implementation, reverify the merged CLI contract and deployed backend
rather than carrying these open decisions forward as assumptions.

The next rollout stage is a public `code_diff` tool with mode-minimal fetching,
CLI/MCP JSON parity, agent-native errors and descriptions, concise generated
guidance, targeted Claude and Codex evaluation, and the corresponding smoke,
package, plugin, and release validation. Structural CodeDiff remains unexposed.

Typed changelog steering is a separate later stage, blocked on both a stable
public CodeDiff invocation and a committed/deployed PkgSeer changelog-action
contract. Its discriminator, field names, result placement, and fallback
behavior must come from that future backend contract rather than inferred
prose. Package range outcomes may then steer to valid CLI and MCP calls;
repository/latest outcomes and unknown actions must remain unchanged.

## Key reference files

| File | Responsibility |
| --- | --- |
| `packages/core-internal/src/services/code-navigation-service.ts` | GraphQL query, validation, schemas, normalization, and errors |
| `packages/core-internal/src/services/code-navigation-service.test.ts` | Wire-selection, variables, normalization, and failure fixtures |
| `packages/mcp/src/client.ts` | Public client type/value re-exports |
| `packages/mcp/src/shared/code-diff-{request,response,text,mcp-text}.ts` | CLI normalization, lean projection, Git-like rendering, and local MCP text |
| `src/commands/code/diff.ts` | Commander syntax, service call, stream routing, and CLI errors |
| `packages/mcp/src/tools/code-diff.ts` | Local-only MCP schema, handler, and structured error mapping |
| `scripts/validate-public-packages.ts` | Packed-package runtime and no-network TypeScript consumer checks |
| `docs/implementation/cli-commands.md` | Config-gated CLI surface and local-only MCP rollout status |
