# CLI advisory lookup

`githits vulns <ids...>` is a CLI-only consumer of PkgSeer's cohesive
`vulnerabilityLookup(ids:)`. It leaves `githits pkg vulns` and MCP unchanged.
Private core owns schemas/transport/auth and operation-local decoding; root CLI
owns admission, page drains, rendering and exit behavior. PkgSeer owns package
identity, direct alias relationships, grouping and range derivation. There are
no browser-query joins, synthetic local advisory rows or client range matchers.

## Transport and selection

The reader uses the existing authenticated direct GraphQL endpoint,
`postPkgseerGraphql`, injected `TokenProvider`, client headers/diagnostics and
`executeWithTokenRefresh`. OAuth auth/terms failures can refresh once; opaque
API tokens do not refresh. Network configuration is validated at request time.

The contract is backend PR3918 / head `1bc64a0486dc2d0d1c0417ed57389bc41ef50375`,
SDL hash prefix `27116f8dd2a5`. The backend's executable query fixture and SDL
are authoritative for selected field meanings and admission:

| Mode | Inputs per request | Package groups | Both display branches |
| --- | --- | --- | --- |
| Initial compact | 1–5 | 2 | maxRanges 3 |
| Compact continuation | 1 | 10 | maxRanges 3 |
| Verbose/JSON, all pages | 1 | 5 | maxRanges 10 |

Initial detailed selection is exactly the defined `LookupCoreDetailed` evidence
projection, excluding `fixedVersionDetails` and `relatedAdvisories`. Scalar
`fixedInVersions` remains complete. Compact selection omits full source prose,
references and original source timelines; help directs these to verbose/JSON.
Continuations retain the same package evidence selection, add `after` and omit
the already-read `advisory` body. Initial source/coverage remain authoritative.

Every request validates returned cardinality/requested-ID order and selected
required fields. Producer ecosystem, range, severity, reference, status, section
and diagnostic code strings remain open. Source timestamps are strings, without
Date parsing or precision loss. No additional advisory resolution is performed.

## JSON and exit contract

JSON goes to stdout as one envelope:

```json
{
  "results": [
    {
      "inputId": " CVE-example ",
      "status": "error",
      "error": {
        "error": "Authentication required. Run `githits login` to authenticate.",
        "code": "AUTH_REQUIRED",
        "retryable": false
      }
    }
  ]
}
```

Successful or partially usable reads also include `lookup` and
`packagePagination`. `lookup` preserves the selected typed source,
sourceEvidence and real local advisory fields, including nulls, raw ranges,
contentSafety, withdrawal and revisions. Its accumulated package entries are
in backend page order; final/last-successful `pageInfo` remains intact.
`packagePagination` exists only when a connection was read; `pagesRead` includes
the initial page, and `complete` records whether all available pages were read.
`inputId` retains the caller's raw input; `lookup.requestedId` is trimmed and
`advisory.osvId` identifies the actual served source.

`status` is `success`, `partial` (usable source/package evidence plus a failure),
or `error` (no usable evidence). Non-success results include `error` with the
existing CLI `{error,code,retryable,details?}` shape. Typed diagnostics remain in
`lookup.unknownDetails` as well. Acquisition failures take precedence over
NOT_FOUND when choosing the item error. Ambiguity retains `candidateIds` and
`candidateIdsTruncated`. Failed requests can omit `lookup`; later admissions
stopped by access/terms failure have `error.details.notAttempted=true`.
Parser/startup/interactive-login failures retain the existing command-wide
stderr JSON envelope before the action starts.

Any invalid ID, expected source/local acquisition failure, optional display
failure, unknown acquisition state or failed continuation produces exit status 1.
Checked empty mappings with source AVAILABLE and local AVAILABLE and no unknowns
are success; they are never a safety claim. Output retains successful inputs
when another input fails.

## Partial data and continuation

Only this operation accepts GraphQL data+errors for verified nullable
`sourceEvidence.affectedVersionDisplay` or
`advisories[index].affectedVersionDisplay` paths. Item/group/row indices must
exist, the leaf must be null and the complete selected required data must parse.
Unselected fix/release paths, required/unexpected errors and malformed data are
fatal. Other operations retain their existing reject-on-error policy.

Supporting-field errors append an operation-local diagnostic with section
AFFECTED_PACKAGES, producer code/retryability, a neutral local message, null
ambiguity fields and a result-relative `path` into the retained lookup. The GraphQL root/item
prefix is removed and continuation group indices are offset into accumulated
entries; backend debug diagnostics retain the original response path. Raw provider messages are not
rendered. Debug diagnostics retain safe code/path information. Null display
without an error is valid unsupported/missing display evidence, not itself an
acquisition failure. Full typed source/local evidence remains available.

Each input drains its own opaque cursor sequentially. A valid continuation
connection is the backend's proof of matching evidence; the CLI does not compare
or recompute revisions. Successful pages append groups and optional-field
errors without duplicating acquisition diagnostics. A stale/null/failed page
keeps earlier source/packages/pageInfo, preserves diagnostics, records incomplete
pagination and exits nonzero. It never resets/retries a cursor or merges a newer
source into the earlier report. No partial result is promoted to complete after
continuation fails. `hasNextPage` concerns paging, not worldwide coverage.

The new root must be deployed before authenticated live smoke can establish
support. Local fixture/decoder tests demonstrate consumer behavior only.
