# Repository target grammar (R3B)

`packages/mcp/src/shared/repository-target.ts` owns direct repository recognition,
validation, normalization, and compact formatting. Its frozen provider table
owns host aliases, HTTP/shorthand compatibility, and provider path validators.
Callers supply contextual help and explicit response identity; they do not
select providers or infer them from bare paths.

| Provider | Compact form | Full URL | Compatibility |
| --- | --- | --- | --- |
| GitHub | `github:owner/repo` | `https://github.com/owner/repo` | `github.com/owner/repo` shorthand and HTTP |
| Codeberg | `codeberg:owner/repo` | `https://codeberg.org/owner/repo` | Exactly two path components; HTTPS only |
| GitLab | `gitlab:group[/subgroup...]/project` | `https://gitlab.com/group/subgroup/project` | Nested namespaces; HTTPS only |

Each form accepts an optional `#ref` (preferred) or compatibility `@ref`.
The first suffix delimiter separates the repository path from the ref. `/`
and `@` remain part of the ref thereafter. `@ref#other`, repeated `#`, and
empty refs are rejected. Omitted refs retain default-branch intent. Output
uses `provider:path#ref` and preserves repository path/ref case.

The parser validates raw paths before URL normalization: dot traversal,
percent-encoded components, backslashes, empty components, credentials,
query strings, unsupported hosts/ports, and provider web subpaths are rejected.
GitLab's `/-/` web-route separator is not a namespace component. A path such
as `gitlab:group/subgroup/project` is repository identity, never an inferred ref.
A single trailing slash on the repository path is accepted.

Packages retain registry-native coordinates: `zig:gh/owner/repo`,
`zig:cb/owner/repo`, `swift:github.com/owner/repo`, and
`swift:gitlab.com/group/project`. They remain package artifact/manifest scope.
Direct repositories remain full-repository scope. Bare `owner/repo` never
selects a provider.

The backend still receives canonical HTTPS `repo_url` and optional `git_ref`
(the service layer names these `repoUrl`/`gitRef`). No provider field or API
selection is added. Existing structured URL addressing remains separate from
compact strings. `pkg changelog --repo-url` and MCP `repo_url` remain full URL
fields; this increment widens their wording only.

## Consumers and response identity

Navigation and unified search share this grammar through their target parsers.
CLI files/grep/read use `resolveCliCodeNavTarget`; MCP uses `resolveCodeTarget`.
CodeDiff parses an unversioned target and keeps comparison endpoints separate.
Resolve rejects canonical targets locally and formats repository candidates
through the shared formatter. Search recovery classifies repository targets
through the parser rather than provider-prefix branches.

Search hit locators and target-resolution identities provide the host for
providerless backend labels. Bare labels without explicit identity remain
unchanged. A label is rewritten only when its path matches the supplied
repository URL. Package labels are preserved even when package evidence also
carries a repository URL. Exact read follow-ups prefer the locator commit SHA
over a floating ref; semantic preferred reads retain backend attribution.

Shared formatting covers search hits/progress/source status, list files,
resolve candidates, freshness/retry targets, and follow-up commands. CLI
follow-ups may use the full `--repo-url` plus `--git-ref`; MCP follow-ups use
the compact provider form. Both retain the exact commit.

## Packaging and release

The canonical code and MCP skills are updated with the implementation under
this handoff's explicit authorization. The MCP stable guide and public skill
copy remain byte-for-byte aligned. Plugin generation/check runs from canonical
inputs; generated manifests need no content change when their metadata is
unchanged. One atomic fragment declares pending minor releases for both
`githits` and `@githits/mcp`; this increment changes no consolidated versions
or changelog. Hosted users receive the change only after the MCP package is
released, adopted by remote-mcp, and deployed separately.

## Verification

Direct tests cover all providers, both suffixes, malformed/unsupported inputs,
case/trailing-slash compatibility, and providerless label handling. Consumer
parity covers navigation service parameters, CLI/MCP search, resolver rejection,
URL addressing, CodeDiff, changelog, package coordinates, and exact follow-ups.
Live and suite evidence is recorded below when validation completes.

Initial validation on 2026-09-07: `bun test` passed 4,331 tests across 198
files; `bun run typecheck`, `bun run build`, `bun run validate:packages`,
`bun run plugins:generate`, `bun run plugins:check`, and all four source/built
CLI/MCP smoke suites passed. Subsequent catalog-contract assertions passed
in a focused 132-test run.

The unpublished built CLI and local MCP against production completed Codeberg
files/grep/read, CODE and repository DOCS search, exact read follow-ups,
resolve, CodeDiff, and changelog. `codeberg:zigil/decimal` resolved to
`6a5cfb379036e0506ceab5f45f4f45dcf3e6842b`; `zig:cb/zigil/decimal` CODE search
also returned two hits. Comparing that commit to itself produced the expected
empty CodeDiff on both surfaces. Changelog returned its body-bearing release.

The descriptor-only `code-file-navigation` Codex eval completed with five
logical MCP calls (quick_start, code_files, and three code_read), high reported
confidence, and a concrete Express navigation answer. The Claude eval failed
before tool use because its isolated session was not logged in; it provides no
agent-quality evidence. Raw local artifacts are under `.agent-eval/r3b-codex`
and `.agent-eval/r3b-claude` (ignored, not published).
