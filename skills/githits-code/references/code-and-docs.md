# GitHits Code And Docs CLI Reference

Package target syntax requires an explicit registry: `registry:name[@version]`, for example `npm:express@5.2.1`; omit `@version` for the latest release. Repository compact targets use `github:org/repo[#ref|@ref]`, `github.com/org/repo[#ref|@ref]`, or `https://github.com/org/repo[#ref|@ref]`; omitted refs request the backend default-branch intent. Exact standalone documentation sites use `site:<host[/path]>`. Output uses canonical `github:org/repo#ref` formatting so refs can contain `@` safely. `code` commands also support `--repo-url <url> [--git-ref <ref>]`.

## Search

`githits search "<query>" --in <target>` searches indexed dependency code, docs, symbols, and exact standalone documentation sites. Repeat `--in` for multiple targets. Use `--source code`, `--source docs`, or `--source symbol` to force a source; omit it for auto-routing. For a standalone site, pass `--source docs --in site:<host[/path]>`.

Useful filters: `--kind`, `--category`, `--path-prefix`, `--intent`, `--public`, `--name`, `--lang`, `--limit`, `--offset`, `--wait`, `--allow-partial`, `--json`.

If search returns a `searchRef`, continue with `githits search-status <searchRef> [--wait <seconds>]` only when the output explicitly supplies that follow-up, including for active `PENDING`, `INDEXING`, or `SEARCHING` progress or a completed result with an evidence notice. The bounded wait defaults to 20 seconds, and the explicit value must be an integer from 0 to 60. Terminal `DEFERRED`, `TIMEOUT`, or `FAILED` progress, and unrecognized statuses, do not advance: keep any disclosed evidence, do not poll the same reference, and follow the rendered new-search action.

Stale or provisional evidence remains queryable while refresh or indexing
continues. Treat the displayed served target as exact provenance and follow a
`searchRef` only when the output renders the continuation.

If discovery returns no useful hits, follow its rendered pivots instead of
repeating it unchanged. Once the query is an exact identifier or string, use
`code grep` and then read the focused match; symbol discovery may not include
re-exports or generated aliases.

If a missing or ambiguous site returns suggested site targets, retry one of those exact labels explicitly. They are advisory, not aliases, and GitHits does not select or retry one automatically. A truncation notice means more valid candidates were omitted.

## Code Files

`githits code files <spec> [path-prefix]` lists paths. Use this before `code read` when you do not know the exact file path.

Useful filters: `--path`, repeatable `--glob`, repeatable `--ext`, repeatable `--file-type`, repeatable `--language`, repeatable `--file-intent`, repeatable `--exclude-intent`, `--exclude-docs`, `--exclude-tests`, `--hidden`, `--limit`, `--wait`, `--verbose`, `--json`.

## Code Read

`githits code read <spec> <path>` reads one exact package-relative file. Use `--lines 10-80`, `--start`, or `--end` for focused windows. You can also append a range to the path: `src/index.js:10-80`.

For repository addressing: `githits code read --repo-url <url> [--git-ref <ref>] <path>`.

## Code Grep

`githits code grep <spec> <pattern> [path-prefix]` runs deterministic text grep. Use `--regex` for RE2 regex, `--case-sensitive`, `-C`, `-A`, `-B`, `--path`, repeatable `--glob`, repeatable `--ext`, `--exclude-docs`, `--exclude-tests`, `--limit`, `--per-file-limit`, `--cursor`, `--symbol-field`, `--wait`, `--verbose`, `--json`.

Use `search` for discovery and `code grep` only when you know the pattern.
When grep returns no matches, do not repeat it unchanged. Change or shorten the pattern, broaden the path/filter scope, or switch to `search` for conceptual intent.

## Docs

`githits docs list <spec>` browses available documentation pages. It is not topic search.

`githits docs read <pageId>` reads a page. Text output returns at most 150 lines per call, including larger explicit ranges; continue with explicit `--lines` windows when more context is needed. Use `--json` when extracting `startLine`, `endLine`, `totalLines`, or source metadata.

For topic search, use `githits search "<topic>" --source docs --in <target>`, then pass the returned page ID to `docs read`.

Partial and capped documentation coverage are usable published evidence. Report the disclosed limit, but infer neither indexing progress nor retryability from coverage; follow only `searchRef` and the evidence notice.

## Command Name Mapping

- `githits example` maps to MCP `get_example`.
- `githits languages` maps to MCP `search_language`.
- `githits search` maps to MCP `search`.
- `githits search-status` maps to MCP `search_status`.
- `githits code files` maps to MCP `code_files`.
- `githits code grep` maps to MCP `code_grep`.
- `githits code read` maps to MCP `code_read`.
- `githits docs list` maps to MCP `docs_list`.
- `githits docs read` maps to MCP `docs_read`.
