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
default 100), unlike grep/rg's per-file `-m`. `--wait` accepts 0–300,000 ms.
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
from caller attribution in `requestedInputIndices`; text shows input attribution
when explaining coverage gaps.

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
Free prose wraps to caller width; source rows and locator headers remain intact.

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

Like search, one `Sources:` summary identifies the resolved scopes and each
numbered evidence header begins with a copyable read locator. `[1]`, `[2]` number
file/page groups in first-appearance order, never sources or backend scopes.
Multiple pages share one canonical website in the summary. Its short repository
SHA is provenance shorthand; each file locator retains the exact opaque
backend target and repository-root path. The formatter does not canonicalize
or substitute any read target, path or ref. A differing hosted display URL is
secondary `[page: ...]` metadata after the actual read locator.

```text
Sources: npm:express - site:expressjs.com, github:expressjs/express@dbac741a
# Read files: read --lines $start-$end -- $target $path
# Read pages: read --lines $start-$end -- $url

[1] github:expressjs/express@dbac741a lib/express.js
19: var Router = require('router');

[2] https://expressjs.com/en/4x/api/
51: ...
```

Read templates appear once for each returned hit kind. Substitute the chosen
row range and copy the target/path or page URL from its header. CLI uses
`--lines` and `--` for both structures; MCP templates use `target`, `path`,
`start_line` and `end_line`. There is no per-hit executable command, numeric
source alias or read footer. JSON retains original display paths and every
backend action with its exact bounds. Unversioned package grep does not expose
the resolved package version, so text uses the supplied pinned repository read
target rather than inventing a version. The stable MCP catalog registers
`grep`; its handler and the top-level CLI use the same request builder, result
projection, and formatter.

Healthy CURRENT readiness, retryable false, equal requested/served refs and
routine input indices stay quiet in text. Repository files and hosted pages
have their own numbered locator headers. A normal page limit says more is
available and prints one opaque cursor instruction below all evidence, with the
identical ordered operands/controls rule. The continuation guidance and cursor
option use the same dim styling as the header read templates when colors are
enabled; wrapping happens before ANSI styling and the cursor stays on one line.
Plain and NO_COLOR output retain the same text. Coverage and expiry warnings
remain above evidence. `--cursor` help explains that hosted pages can change
between grep and read; result text does not repeat that caveat.

`UNSPECIFIED` readiness means this page stopped before visiting that scope.
The scope stays in `targets`, retains its input attribution, and reports
`RESUMABLE_LIMIT` traversal. Continue with `nextCursor` and identical ordered
operands/controls to inspect it. Readiness has not yet been observed; this
status does not indicate target failure or unavailable content. Text explains
the unvisited scope, while JSON preserves the backend enum and full status.

Stale/failed scopes, skips, issues, omitted issue counts, safety normalization
and unavailable targets stay visible on zero-hit pages. `No matches.` is
exhaustive only for complete traversal without coverage gaps. Other empty
pages report incomplete coverage. Cursors and terminal omissions can coexist;
both are shown. Continue with identical ordered operands and controls.
`CURSOR_EXPIRED` is a successful result requiring explicit restart; retained
sibling hits and omissions remain visible.

Complete/partial pages exit zero, including zero hits. Failures exit nonzero;
JSON errors go to stderr with clean stdout. Preparation errors map to `INDEXING`
and preserve up to 20 public `targetIssues` with backend keys and per-input
recovery data. Retryable preparation errors include CLI `--wait <ms>` or MCP
`wait_timeout_ms` recovery guidance. Invalid cursors map to `INVALID_ARGUMENT` with distinct
`graphqlCode`. Protocol, transport, auth, terms, update, deadline and HTTP
failures retain mapped categories. There is no legacy fallback or automatic
preparation retry/cursor restart.

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
