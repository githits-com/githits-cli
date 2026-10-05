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
raw. Grep translates verified pending reasons and offers a fresh first-page
request with the same ordered targets and matching controls, without a cursor.
Continuation pages available matches and cannot retry omitted targets.

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
