# Unified grep

`githits grep <pattern> <targets...>` and MCP `grep` search ordered package,
repository, and `site:<host[/path]>` operands through `Query.grep`. The stable
MCP catalog exposes `grep` in place of `code_grep`. Legacy `githits code grep`
keeps its single-target repository-file behavior and controls.

```sh
githits grep 'router' npm:express --path lib/express.js
githits grep -Fi 'router' npm:express site:expressjs.com
githits grep 'router' npm:express site:expressjs.com --json
githits grep -F -- '--foo' github:example/repository
```

## Matching and scope

Pending repository and documentation preparation is described in plain language,
with advisory total indexing duration when available and a fresh-request retry
action. Opaque progress IDs stay in JSON. Empty results say `No matches available
yet` only when retryable preparation omissions account for every coverage gap.
The headline says `some requested content` is still being prepared when another
scope was searched. Independent failures, cursor expiry and skipped evidence
retain their warnings. Partial hits
and real continuation cursors remain usable. Retry only preparing or explicitly
retryable requested targets with the original pattern and matching controls,
without a cursor; only first-page preparation honors the wait budget. Continuation
keeps the original ordered targets. Unknown reasons are not relabeled as indexing.

See [uniform indexing estimates](indexing-estimates.md) for shared field placement,
duration semantics, wait recommendations and the production deployment prerequisite.

The client explicitly sends RE2 regex mode, case-sensitive matching, zero
context on each side and `ALL` repository corpus. Backend defaults differ.
`-F/--fixed-strings` opts into literal matching; `-i/--ignore-case` uses backend
Unicode folding. `-s/--case-sensitive` follows rg; traditional grep uses `-s`
to suppress errors. The last case flag wins, including short flag clusters.
RE2 and backend anchoring restrictions apply. Invalid or unsupported regexes
fail without a literal retry.

`-A/--after-context`, `-B/--before-context` and `-C/--context` accept 0–10.
An explicit side overrides `-C` regardless of order. Every supplied value is
validated without clamping. `--limit` caps the entire page (1–1,000, backend
default 100), unlike grep/rg's per-file `-m`. `--wait` accepts 0–300,000 ms, default 30,000 on the first page.
Explicit zero returns without preparation wait; cursor continuation never waits.
Empty cursors start page one; nonblank cursors remain opaque and unchanged.

Repeatable `--path`, `--path-prefix` and `--glob` selectors are OR-ed within
each source operand. `--corpus source|documentation|all` controls repository
files. Global CLI source controls apply uniformly to source operands. Sites
receive only their target; source flags with only site operands fail.
Packages can also expand to selected hosted docs independently of repository
corpus and paths. `--corpus source` therefore does not exclude hosted docs.

The backend owns resolution, expansion/deduplication, package boundaries, site
authority, selector matching and continuation. The client accepts 1–20 caller
targets and up to 1,000 selectors per source target. It sends `allowUnscoped:
true` for sources without weakening explicit selectors. Native expanded limits
remain eight repositories and eight sites.

## Ownership and selection

`packages/core-internal/src/services/grep-service.ts` owns transport-neutral
types, the query, allowlisting/validation and typed failures, reusing shared
HTTP, headers, diagnostics and token refresh. Root composition owns
configuration discovery. `packages/mcp/src/shared/grep-{request,response,error-map,text}.ts`
owns frontend normalization, projection, failure classification and
presentation. Projection reuses the core wire schema rather than maintaining
another allowlist. `packages/mcp/src/tools/grep.ts` owns the MCP schema,
invocation, cancellation and result envelope;
`packages/mcp/src/tools/tool-services.ts` requires `GrepService`.
`packages/mcp/src/client.ts` exports `GrepService`, its types, and
`GrepServiceImpl` for host composition. `packages/mcp/src/index.ts` exports
the provider-facing `McpToolServices` contract, whose `grepService` field uses
that service. `src/commands/grep.ts` owns Commander syntax, auth gating,
spinners, diagnostics and exits. The CLI reuses shared helpers through the
workspace-only `@githits/mcp/internal` entry point; the MCP tool imports those
helpers inside the package.

Compact text selects complete line/context slices, native UTF-8 display match
offsets, exact reads, scope provenance/statuses, scan/skip counts, issue summaries,
omissions, page count, traversal and cursor. Display offsets are required in
both modes and validated for ordered, in-bounds UTF-8 character boundaries in
the returned slice. JSON additionally selects duplicate `lineContent`, hit
repository identities, physical source byte coordinates, safety modifications,
issue byte details and scope URL-prefix detail. Nullable scope `repoUrl` and
`canonicalSite` are required in both modes for the Sources summary. The JSON-only
fields use conditional `@include(if: $includeDetailedFields)` selections. Missing selected fields or
unknown hit branches fail. Selected nulls stay null; excluded details stay
absent. JSON keeps camelCase fields without `hasMore` or an invented global total.

## Results and recovery

`totalMatches` counts occurrences on this page. The text headline also counts
distinct matching physical lines and files/pages; multiple occurrences on one
line still count as multiple matches. JSON retains producer order. Text groups
the whole page by physical scope, hit kind and exact read target/path, in first
file/page appearance order, then sorts rows by line and slice position. It does
not gather all files from one source into a separate section. Display
paths alone never establish file identity. Physical scope `targetIndex` differs
from caller attribution in `requestedInputIndices`. Human text uses target labels;
backend input numbers remain in JSON. Recovery uses original ordered operand
names supplied by the CLI/MCP caller; repeated names include their one-based
target position to distinguish different per-input options. Without original
request context, the formatter labels affected sources rather than claiming the
resolved labels are original retry operands.

Identical `(line, startByte, endByte, content)` windows share one numbered row,
with every native match span retained. Match rows use `:`, context uses `-`, and
match role wins over identical context. Conflicting context and distinct windows
on a long line remain separate. Zero-context output has no gap separators;
disjoint blocks with context use `--`. Omitted native line bytes use `[...]`.
No client clipping, match-text annotation or extra read request is added.
ANSI-capable CLI output highlights the native spans without re-running the
pattern. Splitting raw UTF-8 bytes precedes escaping and color; zero-width
matches count without fabricated highlight text. Removing ANSI leaves the same
content. Native source/context tabs, backslashes and Unicode remain intact;
other C0/C1/DEL controls are escaped. Copyable CLI locator operands use exact
shell quoting when they contain spaces, backslashes, Unicode, controls or shell
metacharacters; MCP uses JSON quoting.
Free prose and source rows wrap to caller width; exact locator headers remain intact.

Read actions are backend-authored. Display paths can be package-relative while
read paths are repository-root paths at an exact commit. Hosted actions use
persisted URLs and read latest active content, which can change after search.
The client never hydrates hits or guesses paths. Repository actions require a
string path; hosted actions require a null path. Core types and validation
express these hit-specific contracts. Both hit branches select
`read: readTarget { target path startLine endLine }`: the schema defines this
as the same one-line action as legacy `read`. The alias preserves the existing
structured JSON shape and selected nulls without fetching an unused selector.
Missing or malformed selected fields remain protocol errors; no legacy query
fallback is added.

One `Sources:` list identifies resolved sources, one per line, and each
numbered evidence header begins with a copyable read locator. `[1]`, `[2]` number
file/page groups in first-appearance order, never sources or backend scopes.
Scopes combine their page-result status only when served identity, corpus,
readiness and coverage facts agree.
Multiple pages share one canonical website in the summary. Hosted documentation
is labeled separately from repository evidence. A `requested` label appears only
when a backend-reported full requested commit differs from the served commit;
index freshness alone and a named ref compared to a SHA do not prove that a
different snapshot was served. Named-ref mismatch needs resolved requested
identity metadata that grep does not currently expose. Ordinary and hosted
documentation results carry no requested label.
Pending repository/documentation targets appear under `Preparing`, grouped by
actual work identity with one advisory total estimate and input-specific child
rows. Other unavailable targets appear under `Not searched`, with their reason and
suggestions. Grep supplies no commit-date or observed-HEAD proof.
Sources not yet reached by pagination are marked `(not reached on this page)`.
Other sources without matches on an incomplete search are marked `(no matches
returned)`.
Completed searches use `(no results)`. This
does not claim that the source has no matches overall. Independent coverage
failures remain visible. Affected native scopes and non-preparation omissions
state `you can retry` or `do not retry unchanged` beside the supplied cause.
These follow backend retryability: they promise neither eventual retry success
nor permanent unavailability. Failed scopes without a public reason or error
code say that no further failure details were provided. The short repository
SHA is provenance shorthand; each file locator retains the exact opaque
backend target and repository-root path. The formatter does not canonicalize
or substitute any read target, path or ref. A differing hosted display URL is
secondary `[page: ...]` metadata after the actual read locator.

```text
Sources:
  - github:expressjs/express@dbac741a (source files)
  - site:expressjs.com (hosted documentation)
[1] github:expressjs/express@dbac741a lib/express.js
19: var Router = require('router');

[2] https://expressjs.com/en/4x/api/
51: ...

Read:
  Files: githits read --lines $start-$end -- $target $path
  Pages: githits read --lines $start-$end -- $url
```

Read templates appear after all matches and before pagination/retry guidance,
once for each returned hit kind. Substitute the chosen
row range and copy the target/path or page URL from its header. CLI uses
`--lines` and `--` for both structures; MCP templates use `target`, `path`,
`start_line` and `end_line`. There is no per-hit executable command or numeric
source alias. JSON retains original display paths and every
backend action with its exact bounds. Unversioned package grep can expose the resolved package version in canonical
input provenance; text continues to use the supplied pinned repository read
target rather than inventing a version. The stable MCP catalog registers
`grep`; its handler and the top-level CLI use the same request builder, result
projection, and formatter.

Healthy CURRENT readiness, retryable false, equal requested/served refs and
routine input indices stay quiet in text. Repository files and hosted pages
have their own numbered locator headers. A normal page limit says more is
available and prints one opaque cursor instruction below all evidence, with the
identical ordered operands/controls rule. The continuation guidance and cursor
option use the same dim styling as the read templates when colors are
enabled; wrapping happens before ANSI styling and the cursor stays on one line.
Plain and NO_COLOR output retain the same text. Coverage and expiry warnings
remain above evidence. `--cursor` help explains that hosted pages can change
between grep and read; result text does not repeat that caveat.

`UNSPECIFIED` readiness means this page stopped before visiting that scope.
The scope stays in `targets`, retains its input attribution, and reports
`RESUMABLE_LIMIT` traversal. Continue with `nextCursor` and identical ordered
operands/controls to inspect it. Readiness has not yet been observed; this
status does not indicate target failure or unavailable content. Text lists
the source with `(not reached on this page)`; the shared continuation action
provides the cursor. JSON preserves the backend enum and full status.

Stale/failed scopes, skips, issues, omitted issue counts, safety normalization
and unavailable targets stay visible on zero-hit pages. `No matches found.`
is reserved for complete traversal without coverage gaps. Other empty results
say `No matches returned; some requested content could not be searched.` Without
a cursor, `None of the requested content could be searched.` applies when native
scopes were reported and each failed or was unavailable before scanning; or when
only omissions were reported and either they include more than retryable
preparation or overall traversal failed or the cursor expired. An empty
CURRENT + COMPLETE corpus remains an authoritative negative. Otherwise,
preparation-only retryable gaps retain
`No matches available yet; requested content is still being prepared.` when
no scope was searched, or `some requested content` when another scope was searched.

Healthy empty continuation pages say `No matches on this page.`; pages with
gaps say `No matches on this page; some requested content could not be searched.` Attributed
explanations carry failure details without a second generic caveat. Otherwise
unexplained overall traversal limitations remain visible with or without hits
and beside any sibling cursor. Because overall traversal has no cause or retry
flag, those unattributed limits explicitly say the service did not explain why
some content was not searched or whether retrying would help. Cursors and terminal omissions can coexist; both are
shown. Continue with identical ordered operands and controls.
`CURSOR_EXPIRED` is a successful result requiring explicit restart; retained
sibling hits and omissions remain visible. Expired cursors offer only the
explicit full-search restart in Follow-up, naming `--cursor` (CLI) or `cursor`
(MCP) to omit, with no competing target-subset retry hint.

Complete/partial pages exit zero, including zero hits. Failures exit nonzero;
JSON errors go to stderr with clean stdout. Preparation errors preserve up to
20 public `targetIssues` with backend keys and per-input recovery data, and use
reason-based codes as described below. Invalid cursors map to `INVALID_ARGUMENT` with distinct
`graphqlCode`. Protocol, transport, auth, terms, update, deadline and HTTP
failures retain mapped categories. There is no legacy fallback or automatic
preparation retry/cursor restart.

### Preparation error classification

For `GREP_TARGET_PREPARATION_REQUIRED`, CLI and MCP classify the per-target
`reason` values using the following table, rather than labelling every failure
`INDEXING`. The vocabulary was verified against PkgSeer `origin/main` 8159ac80b:
`lib/pkg_seer/public_error/grep/preparation_copy.ex`, `lib/pkg_seer/grep/preparation.ex`,
`lib/pkg_seer/grep.ex`, and the documentation inventory. Documentation omissions
normally arrive in successful grep results; their known reasons are also handled
if a preparation error carries them. Known progress reasons match PkgSeer's
`usage_tracking/grep_classifier.ex` pending-reason set: repository indexing,
documentation publishing/discovery, publication-format preparation, and pending
starting URLs. They map to `INDEXING` when waiting can complete preparation,
unless the backend explicitly marks the issue nonretryable.

| Reason | Mapped code |
| --- | --- |
| `repository_indexing`, `documentation_publishing`, `documentation_discovery`, `site_v6_required`, `starting_url_pending` | `INDEXING` unless the issue explicitly has `retryable: false` |
| `repository_not_found`, `package_not_found`, `package_source_not_found` | `NOT_FOUND` |
| `repository_ref_not_found`, `ref_not_found` | `REF_NOT_FOUND` |
| `package_version_not_found`, `package_version_unresolved`, `package_source_ref_not_found` | `VERSION_NOT_FOUND` |
| `repository_ref_ambiguous`, `site_ambiguous` | `INVALID_ARGUMENT` |
| `repository_resolution_error`, `repository_unavailable` | `BACKEND_ERROR` |
| `repository_legally_blocked` | `UNRESOLVABLE` |
| `package_source_unsupported`, `package_security_removed`, `package_scope_unavailable`, `package_release_unusable` | `UNRESOLVABLE` |
| `no_grep_scopes`, `no_site_pages`, `site_not_indexed`, `site_no_docs`, `site_redirected`, `site_failed` | `UNRESOLVABLE` |
| `documentation_site_not_admitted`, `documentation_source_resolution_required`, `documentation_site_no_docs`, `documentation_site_identity_blocked`, `documentation_site_failed`, `documentation_unavailable` | `UNRESOLVABLE` |
| `starting_url_missed_at_cap`, `starting_url_absent_from_current_corpus` | `UNRESOLVABLE` |
| Unknown future reason | `INDEXING` only with per-issue `retryable: true` and a nonblank string `progress_ref`; otherwise `UNRESOLVABLE` |

For mixed targets, choose the **first non-INDEXING blocker in backend issue
order**. Use `INDEXING` only for a nonempty list containing exclusively progress
issues and when aggregate `retryable` is not false. PkgSeer computes aggregate
retryability before bounding its published issues to twenty; aggregate false
with only published progress issues therefore maps to `UNRESOLVABLE`. Empty,
missing, or malformed issue lists also map to `UNRESOLVABLE`. Known terminal
reasons cannot become `INDEXING` merely by carrying progress metadata. This
classification does not override the backend's top-level or per-issue
retryability. Dedicated `REF_NOT_FOUND` / `VERSION_NOT_FOUND` recovery envelopes
keep their existing mapping.

JSON retains `details.graphqlCode` and the existing bounded public
`details.targetIssues` projection, including raw reason strings. For
non-`INDEXING` errors, the backend diagnostic already describes the first issue,
so hints omit its reason-only row while preserving path facts. `INDEXING` text
uses a shared headline instead; its hint retains the first target and translated
reason. Additional blockers use their backend message or translated reason;
unknown error-hint prose describes preparation for `INDEXING` and is neutral
otherwise.
Successful omission text keeps unrecognized backend reasons for diagnostics; the
neutral fallback is local to error hints. Wait
guidance appears only for `INDEXING` with aggregate `retryable: true`.

Focused tests cover query variables/selections, union validation, ordered
mixed hits, exact reads, coverage, context precedence, case flags, errors and
refresh. CLI/MCP smoke covers registration, unauthenticated errors, mixed grep,
pagination, and exact reads. Focused production and dev replays verify retained
unvisited scopes and two-page repository/hosted-doc continuation.

Dev and production support package/mixed `--limit 1` pages, including retained
unvisited scopes. Production client replay on 2026-09-29 verified the exact
source repro, mixed two-page CLI continuation and compact/detailed service
pages: both scopes and input attribution are retained, with a source hit on
page one and a hosted-doc hit on page two. Unknown readiness values and other
malformed output still fail validation.

The fixed public formatter cases live in `shared/fixtures/grep-text` beside
their source/license attribution. Measure the built Node formatter at width 80,
without color, including all native windows and the continuation cursor:

```sh
bun build scripts/grep-text-size-benchmark.ts --target node --outfile /tmp/grep-text-bench.mjs
node /tmp/grep-text-bench.mjs --output-dir /tmp/grep-text-output
```

The script compares the two 100-occurrence pages against their captured byte
baselines and requires at least 65% reduction per case. On 2026-09-29, mixed
output fell from 23,509 to 6,965 bytes and repository output from 19,487 to
5,767. Separate temporary tiktoken `o200k_base` measurement gave 8,038 to 2,115
and 7,506 to 1,699 tokens respectively. No tokenizer dependency or runtime
performance claim is added. JSON equality, Unicode/color parity and coverage
regressions establish evidence retention independently of the size budget.

## Adoption and validation record

CLI/output adoption merged in PR #433 on 2026-09-29. MCP adoption merged in
[PR #439](https://github.com/githits-com/githits-cli/pull/439) on 2026-10-01 as
`78b181a2119ae25d1bc0e4b37180cbec39664f03`. This completes client adoption.
Hosted MCP adoption requires a subsequent `@githits/mcp` release, provider
composition supplying `grepService`, and the separate hosted server updating
its dependency. Tool behavior remains owned by this package.

The 2026-09-30 copy pass preserved discovery prefixes, strict request/output
validation, guardrails, and exact public quick-start/skill parity. The actual
MCP `listTools` descriptor fell from 4,105 to 3,522 UTF-8 bytes and from 887 to
781 `o200k_base` tokens; descriptor plus guide fell from 2,194 to 2,114 tokens.
These are static message-size measurements, not billing or runtime performance.

Acceptance included 5,134 passing unit tests, 51 final focused copy/guide tests,
clean internal and external reviews, typecheck, build, plugin checks, public
package validation, and green PR CI. Live CLI stable/experimental smoke and the
stable MCP cohort passed. The full live MCP suite failed at the unchanged
experimental `research` text success assertion; this remains a verification
limit for that separate surface. Isolated CLI-skill evals without GitHits
credentials are not authenticated UX proof.

[The release comparison](agentic-eval-metrics.md#unified-mcp-grep-versus-release-0240--2026-09-30)
records the successful 64-cell Braintrust run, exact release baseline, matched
inputs, inspected grep/read traces, and source-investigation overhead. Broader
instruction optimization, including the unresolved search-versus-grep usage
comparison, is recorded in [the backlog](../plans/open-backlog.md).

## Shared source and preparation rows

Human output uses the shared `Sources` row grammar for served repository pins
and hosted documentation. It preserves separate corpora, readiness, coverage
and input aliases. Pending repository/documentation omissions move under
`Preparing`; other omissions remain under `Not searched`. Each supplied estimate is
printed once, with each requested target alias once and input-specific suggestions beneath it.
Grep does not fetch commit dates or resolved HEAD intent, so it does not claim
either. Scan counts, skipped files, issues, cursors and backend read actions stay
with their original scopes.


Search/grep share optional Read, More results and Follow-up footers in that
order. Grep leads with a page count such as `Found 4 matches on 3 lines in
2 files.` Multiple occurrences on one physical line count as separate matches
but one line; file/page groups use exact read identities. Sources/Preparing and
attributed failure notes explain limitations without an abstract partial label.
Healthy pagination does not claim a coverage failure, including unvisited
UNSPECIFIED+RESUMABLE_LIMIT targets. The strict exhaustive predicate still owns
source `no results` claims. Retryable preparation-only omissions explain that
requested content is still being prepared; cursor pages explicitly limit the
empty result to that page.
Other empty gaps use qualified coverage copy. Read templates are absent without
hits. Cursor continuation and fresh retries remain separate: preparation gets
a bounded wait suggestion stating the maximum wait in seconds; other retryable
omissions and native scope gaps get a fresh-query action without a preparation
wait. Recovery names only eligible original operands and tells callers to keep
the pattern/options and omit `--cursor` or `cursor`. Operand rows are quoted,
unwrapped and color-independent. Non-preparation omissions appear under
`Not searched`; supplied site alternatives say `Search hosted documentation
instead`. A terminal `no_grep_scopes` without a suggested alternative advises a
different package, repository or site target; unknown reasons are not given an
invented remedy. Native public messages and error codes have their own reason
line. Terminal preparation reasons receive no preparation retry. Auth, requests
and JSON are unchanged. The shared helper owns only footer layout; grep owns these semantics.

## Package-path advisories

The backend owns path diagnosis using the selected snapshot's canonical package
repository subpath and native path observations. Clients do not infer package
roots from names, probe alternatives, rewrite selectors or retry automatically.
`GrepResult.pathWarnings` is a required array, selected and validated in both
compact and detailed modes. Each warning preserves `requestedInputIndices`,
`target`, `path`, `repositorySubpath`, `message`, and `suggestions { target path }`.
An empty list means no supported diagnosis was returned; zero matches alone are
not path evidence. Missing or malformed fields are protocol errors.

The shared projection validates and deep-copies the page, retaining hits, native
statuses/public messages, omissions, preparation estimates, traversal and cursors.
It replaces advisory objects with `pathWarnings: string[]` for CLI `--json` and
MCP `format: "json"`. Text uses the same compact sentences, one physical line
per distinct warning, after coverage/preparation and before matches:

```text
Warning: Path is prefixed with package path "packages/example". Did you mean "src"?
```

The package root and correction come directly from backend fields: the correction
is the suggestion whose target equals the warning's target. There is no local
prefix-stripping heuristic. When no same-target suggestion exists, the sentence
stops after the package path. The shared summary JSON-quotes values and escapes
DEL/C1 controls for both text and JSON. Text keeps each warning on one physical
line. Identical sentences are emitted once.
Neither output format dumps the verbose backend message or alternative pairs.
A question suggests a possible correction; it does not assert that a path exists.

The core `GrepService` contract retains complete backend metadata, including the
public `GrepPathWarning`/`GrepPathSuggestion` types exported by
`@githits/mcp/client`. Injected providers must supply the required array. Short
waits use the same parser: pending-only pages without evidence have no warning,
and mixed pages keep proven warnings beside pending targets. No warning changes
native failures, real results or search behavior.

### Deployment and release prerequisite

Backend PR [#3550](https://github.com/githits-com/pkgseer-backend/pull/3550)
merged at `b26172c5fc97287256e55d22bc64aa384297184c`. On 2026-10-24,
read-only GraphQL validation of a skipped `grep` selection accepted every
warning field at `https://oss-dev.githits.dev/api/graphql`. Production at
`https://oss.githits.dev/api/graphql` rejected `GrepResult.pathWarnings`.
A recheck at **2026-10-24 10:25 UTC** accepted every field on production. The
original package/prefix request returned one advisory with zero hits and
`COMPLETE`; the backend deployment prerequisite is now satisfied.
Introspection is disabled at both endpoints; the validation query uses
`@skip(if: true)` to check selections without executing grep.

Before releasing a client that selects this field, verify the configured
backend accepts the full selection below; merging its PR is not proof of
deployment. No schema fallback or downgraded query is provided: an older
endpoint rejects the entire grep query. Native advisory generation additionally requires the backend's released
aigrep 0.27.3/API56 path-evidence integration. Schema support alone does not
prove native advisory behavior; qualify an applicable request on that endpoint.

```graphql
query {
  grep(targets: [{target: "npm:express"}], pattern: "router") @skip(if: true) {
    pathWarnings {
      requestedInputIndices target path repositorySubpath message
      suggestions { target path }
    }
  }
}
```

Ship both the root `githits` CLI and public `@githits/mcp` package for their
respective consumers. Hosted MCP clients receive this behavior only after
`remote-mcp` upgrades that published package and deploys it through its own
approved workflow. This client PR authorizes no merge, release, publication or
deployment. The backend backlog's client-adoption entry remains for its owner
to close after this client work ships; it is not edited across worktrees.

### Client qualification (2026-10-24)

The compact implementation at `8e5ab06` was verified through built Node CLI and
local stdio MCP against dev. Prefix and exact selectors returned the same compact
warning string in text and JSON. Prefix returned zero hits with `COMPLETE`;
exact returned zero hits with `NON_RESUMABLE_PARTIAL` and the original
`GREP_PATH_NOT_INDEXED` failure. Hits, statuses, traversal and cursors matched.

The targeted `eval/agentic/probes/package-path-advisories.md` local MCP/dev run
used Codex (`gpt-6-luna`, high). Its trace contained one `quick_start` and two
grep calls with the same requested prefix (text, then JSON); no alternative
query was executed. The final answer recognized the correction and reported
`status: inconclusive` / `confidence: high`. No isolation violations were
recorded. This is observed behavior, not a graded usefulness/quality result.

Validation at that revision: 6,681 unit tests and 184 focused grep tests passed;
CI passed Linux/Windows tests, build checks, MCP package validation and Bun/Node
20/22/24/26 compatibility. Regression coverage includes projection, deduplication,
no same-target suggestion, one-line warnings, unusual values and DEL/C1 parity,
zero hits, native failures/cursors and mixed/pending-only short-wait results.

Source and built unauthenticated smoke modes passed. Full authenticated smoke
stops before grep at an existing recovery fixture; see the
[backlog entry](../plans/open-backlog.md#authenticated-smoke-recovery-fixture--2026-10-24).
The affected grep qualification above passed independently; no failure assertion
was weakened to bypass that broader-suite gap.


## Package source correspondence

`GrepResult.targetResolutions` is the canonical source-provenance list on a
successful wire response: one `{inputIndex, target, targetResolution}` record per
known original repository/package input, ordered by input index. `target` keeps
the original label. Physical `targets[].requestedInputIndices` and
`unavailableTargets[].inputIndex` link outcomes; neither carries another copy of
resolution. Native scope deduplication never merges input-local assessments.
Site-only and unresolved-before-result inputs have no record. Pending-only
success retains resolved-only/indexing records even without a physical scope.

Core reuses the existing target-resolution schema and normalizer. The primary
query selects notice identity fields in all modes; JSON-only request metadata,
including requested version, committer dates and lifecycle/recovery fields use
the existing detailed directive.
JSON retains the independent requested, resolved-requested and served state,
including null/unknown scalars, without confidence inference. Injected providers
may omit the new DTO property; the concrete wire parser still requires the root
array and every non-null record/resolution. No schema probing or extra query.

Shared text consumes one record at a time, keeping uncertainty independent of
readiness/traversal. Prepared provenance on an unvisited `UNSPECIFIED` scope is
selected source, not a claim that this page searched it. CURRENT/STALE repository
readiness, including searched zero hits, or a validated repository hit supplies
page-execution evidence through input links. Hosted readiness alone does not.
Notes use `Selected source:` for prepared/unvisited or resolved-only sources,
and `Source:` with repository execution evidence. Backend no-hit failure
already clears serving; clients never reconstruct it from labels or hit absence.

The shared [correspondence policy](search-snapshot-presentation.md#package-source-correspondence)
handles Maven and cross-ecosystem recovery. Existing source rows, omissions,
reason/retry classification, cursor behavior and path advisories remain separate.
The backend's pre-execution fallback message now says `Selected indexed version`
rather than `Serving indexed version`, with the same version/ref; clients neither
parse nor rewrite that prose. Root provenance does not authorize broader scope.
These additive fields must be deployed and verified, including production,
before the coordinated public CLI/MCP release selects them.
