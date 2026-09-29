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

Compact text selects complete line/context slices, exact reads, scope
provenance/statuses, scan/skip counts, issue summaries, omissions, page count,
traversal and cursor. JSON additionally selects duplicate `lineContent`, hit
repository identities, display/physical byte coordinates, safety modifications,
issue byte details and full scope identities. Those fields use conditional
`@include(if: $includeDetailedFields)` selections. Missing selected fields or
unknown hit branches fail. Selected nulls stay null; excluded details stay
absent. JSON keeps camelCase fields without `hasMore` or an invented global total.

## Results and recovery

`totalMatches` counts this page. Physical scope `targetIndex` differs from
caller attribution in `requestedInputIndices`; producer order is retained.
Only consecutive compatible hits group together. Overlapping context merges,
match/context lines are numbered, and omitted line bytes are marked. Prose
wraps to caller width; source and executable actions remain intact. Terminal
controls and locator backslashes are escaped; backend Unicode is preserved.

Read actions are backend-authored. Display paths can be package-relative while
read paths are repository-root paths at an exact commit. Hosted actions use
persisted URLs and read latest active content, which can change after search.
The client never hydrates hits or guesses paths.

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
