# GitHits Code And Docs CLI Reference

Package target syntax requires an explicit registry: `registry:name[@version]`, for example `npm:express@5.2.1`; omit `@version` for the latest release. Package targets inspect an indexed artifact/manifest root. Swift package targets use `swift:github.com/<owner>/<repo>` and Zig package targets use `zig:gh/<owner>/<repo>`. Use public repository targets for full repositories or sibling packages. Repository compact targets use `github:org/repo[#ref|@ref]`, `codeberg:owner/repo[#ref|@ref]`, `gitlab:group[/subgroup...]/project[#ref|@ref]`, `github.com/org/repo[#ref|@ref]`, or `https://github.com/org/repo[#ref|@ref]`; omitted refs request the backend default-branch intent. Exact standalone documentation sites use `site:<host[/path]>`. Output uses canonical `provider:path#ref` formatting so refs can contain `@` safely. `code` commands also support `--repo-url <url> [--git-ref <ref>]`.

## Search

`githits search "<query>" --in <target>` searches indexed dependency code, docs, symbols, and exact standalone documentation sites. Repeat `--in` for multiple targets. Use `--source code`, `--source docs`, or `--source symbol` to force a source; omit it for auto-routing. For a standalone site, pass `--source docs --in site:<host[/path]>`.

Search text shows producer-proven matched source and structural documentation previews. Path-only matches render as compact file headers; they do not prove a source-content match. Follow the emitted read locator when source context is needed. JSON preserves compatibility evidence and adds indexed-field provenance, matched source, and documentation previews.

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

For `githits docs read <target>`, use the search snippet when sufficient; otherwise run its generated `followUp`. From text, pass the displayed `[docs page]` target unchanged; from `docs list`, pass `docsReadTarget`. A fragment needs no `--lines` and returns its exact indexed section; add bounds only to replace it with a page-relative range. Historical `pageId` values remain supported. Use `--json` only for required range/source metadata.

For topic search, use `githits search "<topic>" --source docs --in <target>`, then run its generated follow-up or pass the displayed text target.

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

Direct repository targets accept approved full HTTPS URLs on github.com, codeberg.org, and gitlab.com. Codeberg requires exactly owner/repo; GitLab allows nested namespaces. Only GitHub supports host shorthand and HTTP compatibility. Never infer a provider from bare owner/repo. Refs may contain / and @ after # or @; empty refs and mixed suffixes are invalid. Credentials, queries, provider web subpaths, and unsupported/self-hosted hosts are rejected. Package targets keep registry-native coordinates, including `zig:cb/owner/repo` and `swift:gitlab.com/group/project`. Changelog repo URL fields remain full HTTPS URLs.

GitLab web paths with `/-/` or reserved routes such as `tree`, `blob`, and `raw` are rejected. Unreserved names such as `issues` can be repository path components; without a web-route marker, the client treats the complete nested path as repository identity.
