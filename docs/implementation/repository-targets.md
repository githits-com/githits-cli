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
query strings, unsupported hosts/nondefault ports, and provider web subpaths are rejected.
GitLab's `/-/` separator and published reserved top-level/project routes
(such as `tree`, `blob`, and `raw`) are rejected by its path validator.
The reserved route rules come from [GitLab's path rules](https://docs.gitlab.com/user/reserved_names/).
Unreserved names such as `issues` or `merge_requests` remain valid repository
path components; without `/-/` they cannot be distinguished from nested
repository identity. The client does not guess a repository boundary. A path such
as `gitlab:group/subgroup/project` is repository identity, never an inferred ref.
A single trailing slash on the repository path is accepted. Protocol-default
ports normalize away (HTTPS 443 and GitHub HTTP 80).

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

The production nested GitLab matrix also passed on
`gitlab:gitlab-org/security-products/analyzers/secrets` at
`68ba274f1f283b93e85ba490bc16ea16f60cbfb5`: files, grep, read, CODE/DOCS
search (two hits each), exact source follow-ups, emitted repository-doc
locators through both `docs read` and `docs_read`, same-commit CodeDiff,
and changelog. The corresponding Codeberg repository-doc reads passed too.
`npm:express@4.18.1..4.18.2` upgrade review retained changelog body fields
on CLI and MCP. Fuzzy resolve calls completed but did not discover either
fixture as a matching repository; these calls do not prove provider-specific
fuzzy discovery. Direct canonical targets bypass fuzzy resolve by contract.

## Review disposition (2026-09-07)

One fresh Claude Opus review inspected the full delta and reported no runtime
correctness regression. Valid findings were closed in the same increment:

- GitLab web routes: verified upstream reserved paths, added provider-local
  route checks and rejection/valid-namespace tests, and documented the
  irreducible ambiguity of unreserved names. No provider branches were added
  to consumers.
- Corrected the `repositorysitory` typo in both documentation locations;
  scanned changed prose for the same replacement error.
- Formatted all changed source/tests and included the residual fixes in the
  delivered commit; retained the existing CI formatting contract.
- Trimmed duplicated negative rules in the stable preamble and its exact
  public skill copy, and completed the Codeberg/GitLab full-URL help.
- Rejected the speculative providerless Go/Swift label concern: no backend
  trigger was demonstrated; verified registry-prefixed package labels remain
  package scope. Do not add a new guard for that hypothetical output shape.

The inline compatibility audit additionally restored URL normalization of
protocol-default ports and tested authority strings that URL would otherwise
reinterpret as paths. A redundant GitHub owner check was removed; provider
validation remains centralized. No broader refactor was needed.

Final deterministic validation after review fixes: `bun test` passed 4,358
cases across 198 files (19.35 s), `bun run typecheck` passed,
`bun run format:check` passed, and build/public-package validation passed.
Plugin generation/check passed with no generated metadata changes.

The targeted `eval/agentic/probes/multi-provider-navigation.md` probe was run
in two distinct descriptor-only conditions. The neutral run answered without
GitHits (zero MCP calls), so it provides no tool-use evidence. Under the existing
GitHits-intent profile, Codex completed with 12 MCP calls: one quick_start,
one code_files, four code_grep, four code_read, and two search calls. The final
answer cited the exact Codeberg and nested GitLab commits above and inspected
source lines; reported confidence was high. Tool calls, final answers, and
metrics were inspected. No isolation-violations artifact was emitted and the
reports had no validation warnings; this is not a claim of independently graded
answer quality. Artifacts: `.agent-eval/r3b-providers-codex` and
`.agent-eval/r3b-providers-intent`.

### Dev replay

The built CLI and built stdio MCP replay passed with the user-supplied settings:

```text
GITHITS_MCP_URL=https://mcp-dev.githits.com
GITHITS_API_URL=https://api-dev.githits.com
PKGSEER_URL=https://pkgseer-backend-dev.fly.dev
```

Both direct repository fixtures passed files, grep, read, CODE/DOCS search,
exact read follow-ups, same-commit CodeDiff, and full-URL changelog. Codeberg
resolved to `6a5cfb379036e0506ceab5f45f4f45dcf3e6842b` and the nested GitLab
fixture resolved to `68ba274f1f283b93e85ba490bc16ea16f60cbfb5`, matching the
production replay. Each surface returned two CODE and two DOCS hits per
repository; assertions verified their provider, exact commit, and emitted
follow-up revision. Emitted documentation locators read successfully on both
CLI and MCP. `zig:cb/zigil/decimal` CODE returned two hits on each surface.
Codeberg changelog retained one nonempty body on CLI and MCP, and
`npm:express@4.18.1..4.18.2` upgrade review retained two body fields on each.
Fuzzy resolve calls completed with the same discovery limitation described
above. Local replay evidence is under `/tmp/r3b-live-dev-codeberg` and
`/tmp/r3b-live-dev-gitlab`.

### Remaining acceptance evidence

The specific stable GitLab Swift fixture coordinate remains unidentified.
That live regression is pending the coordinate; no stable GitLab Swift live
pass is claimed. Registry-native Swift GitLab parsing is covered
deterministically. The draft PR records this remaining check explicitly
rather than substituting a guessed fixture.

To repeat the live direct-target checks with the unpublished build, use
`node dist/cli.js` for CLI commands and a Node stdio MCP client launching
`node dist/cli.js mcp start --experimental-tools`. Exercise each compact
fixture through `code files`, `code grep`, `code read`, CODE/DOCS `search`,
emitted documentation locators, and `code diff <target> <sha>..<sha>
--name-status`; MCP counterparts are `code_files`, `code_grep`, `code_read`,
`search`, `docs_read`, and `code_diff`. Keep `pkg changelog --repo-url` /
`pkg_changelog.repo_url` in full-URL form and inspect body fields rather than
summary-only output. Set `GITHITS_CODE_NAV_URL` to the verified dev endpoint
for its replay; never print authentication state or credential values.
