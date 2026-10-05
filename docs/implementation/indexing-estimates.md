# Uniform indexing estimates

The backend owns preparation state and duration evidence. The core service module
`services/indexing-estimates.ts` owns the shared GraphQL selection and decoding.
The MCP shared `indexing-wait.ts` and `indexing-estimates-text.ts` own the existing
wait recommendation policy and human timing wording, reused by the CLI.

Existing waiting clients select result-level `indexingEstimates` on grep, list,
read's `CodeContextResult`, fetchCodeContext, listRepoFiles, grepRepo and
listPackageDocs. Discovery already selects the same array in progress. Nonwaiting
documentation and symbol-ambiguity read branches select none. This client has no
structural diff, versionDiff, codeOverview or listSymbols API; raw codeDiff does
not wait and receives no added selection.

Each entry retains kind, requested target labels, repository URL and commit when
known, unavailable reason, and estimate lower/upper/elapsed seconds, sample count
and source. All entries survive normalization and JSON projection. Null wire
values normalize to optional fields. The wire array is required; ready results
retain `[]`. Newly added public provider fields are optional so injected service
implementations can adopt them without breaking source compatibility. This does
not relax backend response validation.

Bounds are advisory total repository indexing execution seconds. They exclude
queue, retry, query and hosted-documentation time and are neither remaining ETA
nor guaranteed bounds. Active elapsed execution is observable evidence only;
never subtract it from bounds. NO_HISTORY may carry elapsed-only evidence or no
estimate. DOCUMENTATION/UNSUPPORTED_WORK has no duration model. Coalesced work can
have no commit SHA. Readable results can coexist with a pending refresh.
Existing statuses, partial evidence, cursors and singular estimate semantics
remain independent. In particular, pending read's deadline handoff can carry
uniform timing while the singular estimate is null.

The shared wait recommendation takes the largest upper bound, adds ten seconds,
and rounds up to ten seconds. Uncovered work adds a 30-second floor; no bounds
uses the unchanged 30-second default. It never sums work or target labels.
Discovery and grep/list suggestions cap at 120 seconds; read and legacy navigation
cap at 60 seconds. These are request budgets, not completion promises. Search CLI
renders wait seconds; grep/list/read/code CLI and MCP use milliseconds. Request
defaults do not change, and there is no automatic retry, polling or new status API.

Annotated text displays total duration and active elapsed evidence; JSON preserves
provenance and work identity. Pipe-friendly raw paths and source content remain
raw. Grep combines a pending target's indexing status and estimate in one paragraph,
labels results as partial when sources were omitted, and identifies only sources
that returned matches. Hosted-site matches do not establish package-version
provenance. The existing cursor instructions stay at the end; a short final note
suggests rerunning the original query with the recommended wait. That retry is a
fresh first-page request with the same ordered targets and matching controls.
The cursor retrieves more matches from searched targets and cannot retry omitted
targets.

## Deployment prerequisite

Backend PR [#2980](https://github.com/githits-com/pkgseer-backend/pull/2980)
merged as `884d09bda21666d63386bc23e267e0812a4d06e7`. Containing revision
`bd9043e8305b24255c9a623d373d50afaa15da83` deployed to dev through
[run 37301772368](https://github.com/githits-com/pkgseer-backend/actions/runs/37301772368).
Backend-owner authenticated checks verified pending/ready metadata, both diff
sides, null-singular read handoff, retained pagination and clearing to `[]`.

Production field support is unverified. Verify production schema deployment
before releasing/adopting these client selections. Dev or local tests do not
establish production support; no compatibility flag or missing-field fallback
is provided.

## Client verification (2026-10-05)

The client increment passed 2,302 focused core/service/shared/grep parity/smoke/
files/search tests, plus 95 formatter/read/files tests for the final shared hint
correction. Positive responses exercise every distinct waiting service normalizer,
including multiple work entries and pending read with null singular timing.
Regression cases cover unknown history, unsupported documentation, caps, elapsed
time beyond estimated bounds, partial evidence, native retries and pagination.

Typecheck, format/lint, builds, packed public-package validation and built CLI/MCP
smoke passed. Authenticated source CLI dev smoke passed both stable and experimental
cohorts. Source MCP stable dev smoke passed; its experimental Research URL-source
thread follow-up failed after 200 seconds and remains a separate backend
investigation in the backlog. Smoke assertions were corrected for verified short
changelog bodies and URL-based site root read actions.

The first full local unit run had 5,354 passes and nine failures: one optional
provider projection defect, corrected here, and subprocess timeouts. All failed
files passed isolated rechecks (104 tests). Initial Linux and Windows CI each had
5,381 passes and one stale list-footer expectation; that expectation and the
related smoke fixture were corrected. CI's Bun 1.4.2 declaration build also
required explicit annotations on the new exported selection and schemas. With
those annotations, the same MCP build passed locally, as did 645 focused
service/list/smoke tests. The updated CI run supplies final full-suite validation.
The targeted local-dev grep agent eval completed six calls successfully, with no
failed calls or isolation violations. It used warm data and did not exercise
pending indexing; no grading or quality claim is inferred from its final confidence.

Internal review and three external rounds completed clean after fixing conflicting
fixed/evidence-based wait instructions and sharing multiline CLI hint formatting.
The single final fresh-context check found no material issues. An optional missing
entry wait-floor guard was rejected: the verified backend contract emits entries
for all pending work, including hosted docs and coalesced targets, so the suggested
trigger lacks evidence. No speculative fallback or new duration model was added.

The user's subsequent Express 1.0.2 reproduction exposed misleading attribution:
the matches came from the documentation site while package source was indexing.
The correction combines target status and timing, marks partial data, shows only
matched sources, and moves the short wait suggestion to the end. The shared/grep
regression suite passed 1,587 tests; build, CLI stable/experimental unauthenticated
smoke and MCP stable/experimental registration smoke passed. Repository request
label duplication found in review was removed and covered by a regression. The
repeated targeted agent eval completed with zero tool calls, so it supplies no
evidence for the corrected tool output.
