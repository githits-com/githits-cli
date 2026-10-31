# Repository target grammar

`packages/mcp/src/shared/repository-target.ts` owns direct repository recognition,
validation, normalization, and public target formatting. Its frozen provider table
owns host aliases, HTTP/shorthand compatibility, and provider path validators.
Callers supply contextual help and explicit response identity; they do not
select providers or infer them from bare paths. Public Googlesource hosts use
the same parser with a DNS host validator and no compact prefix.

| Provider | Compact form | Full URL | Compatibility |
| --- | --- | --- | --- |
| GitHub | `github:owner/repo` | `https://github.com/owner/repo` | `github.com/owner/repo` shorthand and HTTP |
| Codeberg | `codeberg:owner/repo` | `https://codeberg.org/owner/repo` | Exactly two path components; HTTPS only |
| GitLab | `gitlab:group[/subgroup...]/project` | `https://gitlab.com/group/subgroup/project` | Nested namespaces; HTTPS only |
| Googlesource | Full HTTPS only | `https://go.googlesource.com/time` | Public `*.googlesource.com` DNS hosts; no ports or inferred review aliases |
| Launchpad Git | `lp:project` or `launchpad:~owner/+git/repo` (see below) | `https://git.launchpad.net/<complete-path>` | Case-insensitive `lp:`; HTTPS `code.launchpad.net` roots; complete `git://git.launchpad.net` roots on default/9418 port |

Each form accepts an optional `@ref`. The first `@` in the repository path
separates the repository identity from the ref; `/` and later `@` characters
remain part of the ref. `#` is reserved for semantic fragments and is not a
repository revision delimiter. Legacy `#ref` input is rejected with the exact
`@ref` replacement. Fragments, query strings, mixed suffixes, and empty refs
are rejected. Omitted refs retain default-branch intent. Output uses
`provider:path@ref` for compact providers and full HTTPS `@ref` for Googlesource,
preserving repository path/ref case.

For GitHub, GitLab and Codeberg the parser validates raw paths before URL
normalization: dot traversal, percent-encoded components, backslashes, empty
components, credentials, query strings, unsupported hosts/nondefault ports,
and provider web subpaths are rejected.
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
`swift:gitlab.com/group/project`. They remain scoped to the package subpath,
including within monorepos. Direct repositories retain full-repository scope.
Bare `owner/repo` never selects a provider.

## Googlesource HTTPS targets

Use a full HTTPS project URL, for example
`https://go.googlesource.com/time@v0.16.0` or
`https://go.googlesource.com/sync@04914c20`. The ref suffix uses the shared
first-`@` split and preserves branch, tag and short/full SHA bytes. Paths and
symbol selectors keep their existing separate read/list/grep handling. Emitted
HTTPS targets and exact commit pointers remain HTTPS; there is no public
`googlesource:` compact form.

Hosts must end at a `.googlesource.com` DNS boundary, contain only valid ASCII
DNS labels (up to 63 characters each and 253 total), and are folded to lowercase.
Project components preserve case and allow ASCII letters, digits, `.`, `_` and
`-`, excluding empty, `.` and `..` components. One terminal `.git` and one
trailing slash are removed; a remaining terminal `.git` is rejected to keep
normalization stable. Nested project paths are accepted. Public `-review`
endpoints follow the same grammar and keep their own host identity.

HTTP and other transports, every explicit port (including `:443` and an empty
port), credentials, queries, fragments, percent-encoded identity, traversal,
backslashes, Unicode identity, Gitiles `+` web routes and suffix lookalikes are
rejected. Authority checks retain raw spelling so URL normalization cannot
silently admit an encoded host or erase a port. These rules match backend
provider canonicalization from PR 3815 at `ab4e8e9`.

Search, navigation, resolve canonical-input recognition and code-diff target
identity all share this grammar. Canonical full URLs do not need fuzzy resolve.
The backend owns native source access and raw-diff availability; the client adds
no transport or provider API. Existing provider syntax and protocol-default-port
compatibility remain unchanged.

The public `githits-code` reference must add Googlesource to its HTTPS list in
the release branch containing this behavior, following the public Agent Skill
lifecycle. The current stable MCP guide already permits supported full URLs and
its exact public-skill parity is unchanged. Hosted MCP receives parser changes
only after `@githits/mcp` release, dependency adoption and hosted deployment.

## Launchpad Git targets

Launchpad Git accepts project defaults and complete owner-qualified paths.
Use `launchpad:` or case-insensitive `lp:` with any of these paths:

| Repository | Target |
| --- | --- |
| Project default | `lp:project` |
| Distribution-source default | `lp:distro/+source/source` |
| Owner/project default | `lp:~owner/project` |
| Owner/distribution-source default | `lp:~owner/distro/+source/source` |
| Personal | `lp:~owner/+git/repo` |
| Project | `lp:~owner/project/+git/repo` |
| Distribution source | `lp:~owner/distro/+source/source/+git/repo` |

For example:

```sh
githits list lp:beautifulsoup
githits search func_file_conv --in lp:ubuntu/+source/hello --source code
```

Append `@ref` for a branch, tag or commit. HTTPS URLs on either
`git.launchpad.net` or `code.launchpad.net` accept the same paths. Short
addresses select mutable Git defaults; the backend acquires their current
owner-qualified repository. The CLI performs no Launchpad HTTP lookup and
does not guess an owner. Bazaar is unsupported. Package association remains
a separate backend capability.

### Parsing and service boundaries

Backend errors retain the actual missing/private/provider diagnosis; list
no longer substitutes an obsolete "shortcuts unsupported" message.

Paths preserve case. Namespace names begin with an ASCII letter/digit and may
then contain letters/digits and `+._-`; repository names also allow `@`.
A `.git` suffix on a complete repository name is rejected; default namespace
names follow the backend namespace grammar unchanged.

Git transport on `git.launchpad.net` accepts complete owner-qualified paths
only (default port 9418); short Git-transport defaults are rejected. HTTPS
defaults to port 443. HTTP,
SSH, nondefault ports, credentials and browse subpaths are rejected.

Split the first raw path `@` before decoding Launchpad repository components
once. Encoded separators, whitespace, unsafe/malformed escapes and traversal
are rejected. Encoded `%40` becomes literal `@` in the canonical HTTPS URL;
formatting a structured URL escapes that `@` back to `%40` before appending
a ref. Later `@` and `/` in refs stay unchanged. Other providers retain their
existing percent-encoding restrictions. Input correlation echoes may retain
the typed prefix.

Search, diff and legacy navigation translate compact inputs at the shared
parser into URL-only service arguments; they never send `lp:` in a repository
URL field. Unified read/list/grep preserve compact targets byte-for-byte, so
the backend continues to own code/docs/page-ID and fragment classification.
Repository page IDs preserve encoded refs and paths. List `canonicalTarget`
uses the acquired canonical URL plus full SHA; compact read actions use
`launchpad:` with the complete owner-qualified path. Output formatters never
compact unresolved defaults into identities. Short correlation labels remain
unformatted; the client does not infer their equivalence to a canonical identity. JSON correlation echoes remain lossless.
Short addresses can be passed directly to navigation or to `resolve` for an
exact backend lookup; complete identities bypass fuzzy resolution.

Dev verification on 2026-10-19 returned nonretryable `RAW_DIFF_UNAVAILABLE`
for unequal raw diffs; the backend owns availability.
The shared error mapper preserves that code and the resolved endpoint facts
on both CLI and MCP rather than collapsing it to `BACKEND_ERROR`.
Equal-SHA comparisons return a complete empty inventory. Structural comparison
of indexed snapshots is separate and proves neither compatibility nor upgrade
safety.

## Backend rollout dependency

Post-deployment production verification on 2026-09-15 confirmed that raw search
results emit `@ref` in `targetLabel`, `requestedTargetLabel`, `freshTargetLabel`,
and `servedTargetLabel`; repository-backed documentation locators also retained
their `provider:path@commit/file` form. A missing-ref probe returned structured
ref prose without a legacy compact target.

The raw Agentic Ask response still emitted repository code-source targets as
`github:expressjs/express#<commit>`. The production Ask source producer therefore
still needs the corresponding `@ref` deployment. This client normalizes typed
repository labels and Ask code sources during rollout, but does not rewrite
arbitrary backend prose because doing so could corrupt semantic documentation
fragments. The component authoring each backend string owns its target syntax.

Hosted MCP adoption separately requires publishing the matching
`@githits/mcp` release, updating `remote-mcp` to that package, and deploying it.
Neither external repository is changed from this worktree.

The backend still receives canonical HTTPS `repo_url` and optional `git_ref`
(the service layer names these `repoUrl`/`gitRef`). A supplied ref selects a
specific branch, tag, or commit; omitting it delegates default-branch resolution
to the backend. No provider field or API selection is added. Existing structured
URL addressing remains separate from compact strings. `pkg changelog` is
package-only and rejects repository targets.

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

The stable MCP guide and its public skill copy stay byte-for-byte aligned.
The 0.33.0 release includes Launchpad CLI addressing, canonical replay and
backend-owned raw-diff guidance in `skills/githits-code/SKILL.md` and its
`references/code-and-docs.md`, completing the release-boundary skill update.
Generate and check plugin assets from canonical inputs; no manifest content
change is needed when metadata is unchanged.

Release 0.33.0 adds Launchpad Git shortcuts to `githits` and `@githits/mcp`,
superseding the qualified-only shortcut restriction. Hosted users
receive MCP changes after the package is released, adopted by `remote-mcp`, and
deployed there.

## Verification

Direct tests cover all providers, nested `@` refs, legacy migration errors,
malformed/unsupported inputs,
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

## Launchpad verification (2026-10-19)

Built CLI development checks used these indexed snapshots:

| Repository | Commit |
| --- | --- |
| software-properties | `02bfa5ae3026843835e540bc507a517863e39c64` |
| apport | `81be06ba7e01ac616921789ea99392258a58b2dd` |
| GNU hello (distribution source) | `c80e07d07e4ea27e0847ed731da7138b9e1df5d0` |

All three passed CURRENT list, positive grep/CODE/SYMBOL search, exact-SHA
reads and unchanged replay of emitted read actions. Built stdio MCP passed
hello navigation/replay and software-properties diff checks. Both surfaces
returned an empty equal-SHA diff and nonretryable `RAW_DIFF_UNAVAILABLE` for
tag `0.100` versus the pinned software-properties commit, preserving both
resolved endpoints. Personal repository paths have parser/adapter coverage.

Source smoke suites passed unauthenticated contracts. Their isolated homes
could not access Keychain credentials, so authenticated checks used the built
CLI/MCP with normal credential handling. The descriptor-only agent probe
loaded `quick_start` and attempted Launchpad search, then hit `AUTH_REQUIRED`;
this demonstrates routing only, not authenticated answer quality.

Shortcut qualification followed the phase 2B backend deployment. The built CLI
passed all four mutable forms using Beautiful Soup at
`c772c5e6b335c1dbd8ee59a01ea6b75b272cd737` and GNU hello at the commit above:
CURRENT list, exact-SHA read, positive grep/CODE/SYMBOL search, exact resolve,
and unchanged emitted-action replay. Both HTTPS hosts and mixed-case `LP:`
were exercised. Built stdio MCP passed list/read/grep/CODE/SYMBOL/resolve,
equal diff and nonretryable unequal `RAW_DIFF_UNAVAILABLE`. Production passed
all four default shapes through list and project/distribution-source symbol
search for both repositories.

Read JSON's top-level `repoUrl` may echo the normalized request address;
`targetResolution.served.repoUrl` and `.commitSha` identify the acquired
snapshot. Missing `4.15.O` returned REF_NOT_FOUND with canonical repository,
requested ref, available HEAD and no suggested refs. These facts remain intact;
no client retry action guesses shortcut identity equivalence. Search composes
ref-alternative retry targets only from complete canonical identities; backend
alternatives remain visible for unresolved short addresses. A missing project
returned nonretryable `BACKEND_ERROR` with `REPOSITORY_NOT_FOUND` in
`details.graphqlCode` and concrete typo/public-access guidance. The existing
error envelope preserves that backend classification.

The revised descriptor-only Codex probe started from `lp:software-properties`
and `lp:ubuntu/+source/hello`, resolved exact owners, searched pinned commits
and replayed emitted read actions. It first used the wrong `target` argument
for `resolve_target`, then recovered using `name`. The run completed in 25.0s
with nine MCP calls; its neutral answer cited canonical repositories, full SHAs
and source lines, with reported high confidence. No isolation violation artifact
was emitted. This is observed tool-use evidence, not an independently graded
answer-quality score. The earlier qualified-only probe above remains historical.

### Release validation (2026-10-20)

The production CLI skill eval completed with 12 CLI calls and a source-cited
answer at both requested commits, with reported high confidence. Five calls
failed with provider-resolution timeouts before searches acquired canonical
owners and five canonical reads succeeded. No isolation-violation artifact was
emitted. This is observed tool use, not an independently graded quality score.
A subsequent built Node CLI comparison passed both short and canonical list
inputs for each repository. Intermittent resolution timeouts and the remaining
backend investigation are recorded in
[the backlog](../backlog.md#investigate-intermittent-production-launchpad-shortcut-timeouts).

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

**Historical replay record:** The settings and results below document that
run's endpoints and outcomes; they are not the current setup recipe.

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

Current dev setup uses `GITHITS_ENV=dev` to select the development defaults for
each service. Set an individual URL override only when that service needs a
custom endpoint.

### GitLab Swift package regression

The public [CoreKit repository](https://gitlab.com/corekit/corekit) supplies
an independently verified, pinned Swift fixture:
`swift:gitlab.com/corekit/corekit@1.0.0-rc.2`, resolving to
`14df5f6fd76f579124a26c6ce03bd08d0446e6de`. The tag is a prerelease; the
fixture is pinned for reproducibility, not presented as a stable release.
Its `Package.swift` was read at that exact commit.

Built CLI and built stdio MCP CODE searches completed on both dev and
production, returning two Swift source hits per surface. Assertions verified
the registry-native package target, canonical GitLab URL, exact commit, and
emitted compact `gitlab:corekit/corekit@<sha>` read follow-ups. Both hits were
read through each surface, and the served commit matched exactly. Initial
indexing returned provisional hits; the final pinned replay completed with
current exact reads. Local evidence is under
`/tmp/r3b-swift-package-production` and `/tmp/r3b-swift-package-dev`.
The shared consumer parity test includes the real package coordinate
(20 tests passed after adding this row).

Additional direct CoreKit checks passed files, grep, read, CODE/DOCS search,
exact code follow-ups, and same-commit CodeDiff on both environments at HEAD
`bf062e154dc59394bc32a7c7c1fbf1c6e6c3ccd7`. Its changelog probe returned
`NO_CHANGELOG_ENTRIES`; body preservation is covered by the Codeberg changelog
and Express upgrade-review fixtures above. The Swift source regression is
complete and requires no user-supplied fixture coordinate.

This historical direct-target replay used the then-unpublished build. To repeat
the provider checks with the current build, use
`node dist/cli.js` for CLI commands and a Node stdio MCP client launching
`node dist/cli.js mcp start --experimental-tools`. Exercise each compact
fixture through `list`, `grep`, `read`, CODE/DOCS `search`,
emitted documentation locators, and `code diff <target> <sha>..<sha>
--name-status`; current MCP counterparts are `list`, `grep`, `read`, `search`,
and `code_diff`. `pkg changelog` is package-only; do not pass repository
targets to it. Set `GITHITS_CODE_NAV_URL` to the verified dev endpoint
for its replay; never print authentication state or credential values.


## Googlesource development verification (2026-10-31)

Validation used freshly fetched main `6f937fb` plus this parser change, the built
`node dist/cli.js`, `GITHITS_ENV=dev`, no endpoint overrides, and a dev credential
passed privately through the existing `GITHITS_API_TOKEN` path. No credential
values were logged. The original `search Limiter --in
https://go.googlesource.com/time@v0.16.0 --source code --limit 5 --wait 60000`
returned five hits and an executable HTTPS short-SHA read command.

| Project / tag | Served commit | File / exact bytes |
| --- | --- | --- |
| time / `v0.16.0` | `fb013b3d305a26f5ef5350a6eaffc7c87a200383` | `rate/rate.go`, 12,635 bytes |
| sync / `v0.17.0` | `04914c200cb38d4ea960ee6a4c314a028c632991` | `errgroup/errgroup.go`, 4,007 bytes |

For both projects, CODE and SYMBOL searches returned positive hits; exact
literal grep found the type declaration; scoped/root list and full-SHA file
read succeeded. Qualified symbol reads with `--selector` selected
`golang.org/x/time/rate.Limiter` (lines 57-66) and
`golang.org/x/sync/errgroup.Group` (25-34). Root-list browse actions retained
full HTTPS commits and their exact `paths` arrays (`rate/*`, `errgroup/*`);
replaying them returned short-SHA read actions (`@fb013b3d`, `@04914c20`). Those
target/path pairs replayed unchanged and returned content identical to full-SHA
reads. SHA-256 matched the list inventory hashes:

- time: `91e9f16a4b3b71c524d64b6125f1a8059f2fd1f1f0b7046c0708df0322d29330`
- sync: `696b0385dd5f1a165c7d0251160afc3d652b9f64f4a8f64b9a9495e6ac4695eb`

The emitted time CODE-search read command replayed with its target, path and
`--lines 100-106` unchanged. Equal-SHA `code diff` for time with `--name-status
--json` returned an empty complete inventory with both expected commit endpoints.
Canonical full-URL resolve was rejected locally with the existing "does not
need resolution" guidance. Fuzzy resolves of `golang.org/x/time` and
`golang.org/x/sync` returned their package/repository candidates, but repository
`target` still contained backend-internal `googlesource:` keys. Backend PR 3818
owns that public serialization correction; this client deliberately does not
accept those keys or infer a compact alias. Direct HTTPS use has no dependency
on that follow-up.

The retained Express control used `npm:express@5.2.1` at
`dbac741a49a5a64336b70c06e85c2e2706e36336`: CODE search for
`createApplication`, `list lib/`, literal grep scoped to `lib/express.js`, and
full-file read all succeeded. Its native-v6 format designation comes from the
backend handoff; the CLI responses expose served commits, not native artifact
format versions.

Deterministic checks: focused parser/parity 482 passed; complete `bun test`
6,840 passed (27,726 expectations, 259 files); typecheck, build, formatting,
lint, plugin consistency and public-package validation passed. Source and built
unauthenticated CLI smoke each passed 33 steps; source and built MCP
registration smoke each passed seven steps. Authenticated `smoke:cli` and
`smoke:mcp` both stopped at the pre-existing Docker recovery fixture: dev
successfully resolves `go:github.com/docker/docker@v20.10.0`, which the fixture
expects to fail. This is recorded in the
[authenticated smoke backlog](../plans/open-backlog.md#authenticated-smoke-recovery-fixture--2026-10-24);
the suites did not reach later live cohorts and are not reported as passing.

The existing descriptor-only `code-file-navigation` agent eval completed
against local MCP/dev with Codex (`gpt-6-luna`, high effort): quick_start, list,
and two read calls completed; the final answer identified the factory and
prototype attachment in Express 5.3.0 with self-reported high confidence.
Raw tool calls, final answer and run-level metrics were inspected. No
`isolation-violations.json` was emitted (the harness writes it only for detected
violations). Duration was 22.017 seconds, four logical MCP calls, 29,675 uncached
input tokens, 168,832 cached input tokens and 877 output tokens. Artifacts remain
local under `.agent-eval/googlesource-navigation`; this is behavior evidence,
not a graded quality claim.
