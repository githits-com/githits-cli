# Unified read

MCP advertises one `read` tool. CLI provides `githits read`; `githits code read`
and `githits docs read` remain compatible commands, marked deprecated in help.

## Locators and ownership

`packages/mcp/src/shared/read-request.ts` owns transport-neutral locator and range
validation. A nonempty `path` selects an exact code file; otherwise `target` is an
opaque documentation locator. Empty optional paths count as omitted. Preserve docs
target bytes, including URL query strings, percent encoding, fragments, and pinned
repository locators. Never infer the source from URL host or file extension, or
retry a failed read against the other backend.

The MCP tool accepts `target`, optional `path`, `start_line`, `end_line`,
`wait_timeout_ms`, and `format`. Targets for code are compact package/repository
strings; the structured code-target object accepted by other navigation tools is
not part of this read schema. Existing target parsers still own package/provider
syntax and exact Git revision handling.

The tool in `packages/mcp/src/tools/read.ts` injects both existing services and
routes to the source-specific read operations. Backend APIs and fetched fields are
unchanged. CLI uses the same locator interpretation but its own actions, retaining
complete, content-only output for pipes. JSON result models remain source-specific.

## Sections, windows, and waiting

- A docs URL fragment with no explicit bounds selects its exact indexed section.
  Do not synthesize line defaults before that backend call.
- Either explicit bound overrides a docs fragment with a page-relative range.
  Returned positions and continuation bounds are absolute page line numbers.
- Docs text displays at most 150 selected lines by default, or 300 with an explicit
  end. Docs JSON retains the full backend selection. Code reads cap before fetching
  at 150 lines by default or 300 with an explicit end, including JSON.
- Validate requested positive integer bounds and their order before applying caps;
  a fractional end beyond the cap must not silently become a valid bounded request.
- `wait_timeout_ms` is the code indexing wait: default 30,000 ms, range 0–60,000,
  including explicit zero. Docs validates supplied values but does not forward them,
  since its backend operation has no wait parameter. INDEXING retains backend
  metadata and supplies recovery through the same read locator. No client retry loop.

CLI uses `--lines` for either source. Code also retains `--start`, `--end`, path
suffix ranges and `--repo-url`/`--git-ref`. Docs rejects the code-only bound/ref
options. CLI `--wait` has the same applicability as the MCP wait parameter.

## Ask compatibility

The backend Ask contract still returns typed `code_read` and `docs_read` source
pointers. `projectAskReadSources()` beside the local MCP Ask adapter projects these
into callable `read` pointers before text or JSON rendering. Code preserves its
target/path/bounds; docs maps `page_id` to `target`. All other response metadata is
preserved and the original backend response is not mutated. URL and clarification
responses pass through unchanged. This keeps MCP and backend rollouts independent.

Core service consumers still see the backend contract. CLI Ask continues to display
backend-provided argv because the legacy CLI commands remain functional; do not
parse or rewrite opaque command strings. Catalog names belong to the MCP adapter,
not the backend service parser.

## Migration and future extension

```text
code_read(target, path, ...) -> read(target, path, ...)
docs_read(page_id, ...)      -> read(target=page_id, ...)
githits code read ...        -> githits read ...
githits docs read ...        -> githits read ...
```

MCP removes the legacy names rather than registering aliases. Clients must
rediscover the tool catalog. Local clients get the change with the CLI; hosted
clients require an @githits/mcp release, remote-mcp dependency adoption, and a hosted
deployment. Those are separate authorized delivery actions.

Symbols are future-only: a future `symbol` selector beside `target` and `path` can
select a backend-resolved symbol, with explicit bounds overriding semantic
selection. No symbol parameter is currently advertised or implemented. Git `#ref`
and file paths are not repurposed to encode symbols. The backend must own symbol
identity, revision resolution, and ambiguous/overloaded definitions when added.

## Public skill release follow-through

The stable MCP quick-start and embedded `skills/githits-mcp/SKILL.md` guide change
with this implementation under the exact-parity exception. Other public skills are
served from main before npm release and must follow their release-boundary policy.
At the release containing unified read, update `skills/githits-code/SKILL.md` and
`skills/githits-code/references/code-and-docs.md`: prefer `githits read`, retain
legacy commands only as compatibility guidance, and replace both retired MCP
mappings with `read` (target alone for docs, target plus path for code). Also audit
`skills/githits-package` and references for read examples. Regenerate/check plugin
assets after canonical skill edits. This release-boundary work is intentional;
CLI alias removal and working symbol lookup require separate product decisions.

## Validation evidence

Pre-change static descriptor measurement at 9697466: code_read 4,855 bytes,
docs_read 2,088 bytes, pair JSON array 6,946 bytes; stable catalog 15 tools /
56,176 bytes; quick-start guide 4,821 bytes. Measurement serializes name,
description, `z.toJSONSchema(z.object(schema))`, and annotations. These are byte
counts, not token estimates or runtime performance measurements.

After-change measurement with the identical serializer: read array 2,444 bytes
(64.8% smaller), stable catalog 14 tools / 51,619 bytes (4,557 bytes smaller),
and guide 4,845 bytes (24 bytes larger). The combined catalog-plus-guide is
4,533 bytes smaller. No before/after agent-token or runtime-speed claim is made.

The source-specific read regressions, CLI routing, Ask projection, catalog,
quick-start parity, smoke assertions, and deterministic eval fixtures are covered
by the test suite. Final build, smoke, package and agent-eval evidence is recorded
at delivery.

Deterministic validation: `bun test` passed 4,604 tests / 16,184 assertions;
`bun run typecheck`, changed-file Biome lint/format, `bun run build`,
`bun run plugins:generate`, `bun run plugins:check`, and
`bun run validate:packages` passed. Full-repository lint exits successfully with
pre-existing warnings in the unchanged repository-target parser.
