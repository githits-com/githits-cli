# Unified grep

`githits grep <pattern> <targets...>` searches ordered package, repository and
`site:<host[/path]>` operands through `Query.grep`. MCP still exposes `code_grep`;
replacing it is Phase 2. Legacy `githits code grep` keeps its existing behavior.

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

Core `services/grep-service.ts` owns transport-neutral types, the query,
allowlisting/validation and typed failures, reusing shared HTTP, headers,
diagnostics and token refresh. Root composition owns configuration discovery.
MCP `shared/grep-{request,response,error-map,text}.ts` owns frontend normalization,
projection, failure classification and presentation. Projection reuses the
core wire schema rather than maintaining another allowlist. The root command
owns Commander syntax, auth gating, spinners, diagnostics and exits. Shared
helpers remain workspace-internal in Phase 1; no public MCP tool/service is added.

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

[1] https://github.com/expressjs/express@dbac741a49a5a64336b70c06e85c2e2706e36336 lib/express.js
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
target rather than inventing a version. These private formatter changes do not
register a new MCP tool.

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
It is not presented as target failure.

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
recovery data. Retryable preparation errors include CLI `--wait <ms>` recovery
guidance. Invalid cursors map to `INVALID_ARGUMENT` with distinct
`graphqlCode`. Protocol, transport, auth, terms, update, deadline and HTTP
failures retain mapped categories. There is no legacy fallback or automatic
preparation retry/cursor restart.

Focused tests cover query variables/selections, union validation, ordered
mixed hits, exact reads, coverage, context precedence, case flags, errors and
refresh. CLI smoke covers registration, unauthenticated errors and source
grep. Fresh mixed-site, pagination, read replay, case and corpus conformance
is checked against dev before Phase 1 signoff.

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
