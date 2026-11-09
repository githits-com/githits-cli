# CLI advisory lookup

`githits vulns <ids...>` looks up advisory IDs across packages. It is CLI-only;
`pkg vulns` and MCP are separate surfaces. Private core owns transport, schemas,
authentication and backend decoding. Root CLI owns admission, page drains,
`vulns-response.ts` (the public CLI projection) and `vulns-format.ts` (text).
PkgSeer owns package identity, alias relationships, grouping and range derivation.
The CLI never evaluates version ranges, guesses parent modules or joins other APIs.

## Text

The heading keeps the requested ID primary, with a separate resolved-advisory
line when it differs. Numeric CVSS scores from the resolved advisory and
verified aliases follow the heading, before the summary and packages;
related/unresolved record scores remain on their own source rows; differing
reports retain their source references. No CVSS score is invented from vectors
or severity-label approximations. Partial causes, incomplete package counts and
unavailable acquisition statuses precede package evidence. Healthy coverage,
generic follow-ups and safety disclaimers do not add a footer; help owns routine
usage guidance. Package blocks link to registry pages and show
backend-normalized affected spans and source-reported fixes. Up to ten spans are
shown, covering short branch lists without expanding redundant exact-version
entries. Larger lists carry explicit truncation/counts; raw expressions are
available with --verbose. Equal ordered raw expressions and equal normalized
views share a group within a package; source facts appear once per result.
Compact rows are labelled Advisory, Alias or Related advisory against the
resolved record. Unresolved results use a neutral Source label. A single
equivalent source appears beside the heading without numbered references or a
separate source section; distinct source URLs remain visible. A common summary
across equivalent sources fills a missing heading summary once in text, with
explicit source attribution. JSON retains each original source summary.
Multiple, unverified and verbose sources use numbered references; a merely
related source never supplies the root summary. Acquisition origin appears only
when repeated ID/URL rows need disambiguation. Verbose rows use `Package
evidence sources` and describe confirmed alias records as `same vulnerability`;
same-ID rows show the ID alone. JSON retains explicit relationship and origin
fields. A compact sole same-ID source adds no repeated identity line unless it
supplies additional facts or markers. Ambiguous/not-found diagnostics omit
repeated acquisition-status wording. Package references carry
withdrawn/malicious markers beside the number, so a caveat is visible without
following the reference. Single-source evidence retains those markers without a
reference number. Text source numbers start at 1.

Disagreements remain separate, even for the same advisory ID. Null raw ranges
are not grouped: a display fallback cannot establish equal underlying evidence.
`osv-invalid:` expressions render as `(unevaluable source range)`; JSON retains
the source expression. Empty arrays say `none reported`; null says `unknown`.
Source fixes are not verified releases or safe upgrades. Missing evidence never
establishes safety. Literal placeholder summaries are omitted from text and JSON using the existing
shared package-vulnerability summary policy. Explanation paragraphs keep uniform
indentation. Numeric source severity is emitted only for CVSS_V2, CVSS_V3
and CVSS_V4. SEVERITY_LABEL and untyped/unknown numeric scores are omitted from
text and JSON. The CLI does not calculate CVSS scores or infer severity labels
from numbers.

Free prose wraps to terminal width (80 when unavailable). Atomic URLs,
identifiers and command operands remain copyable. All terminal fields are
sanitized; printable backend Unicode survives. False malicious markers and
unchanged normalization boilerplate are omitted.

## Curated JSON

`--json` uses the same compact selection as default text. It emits one ordered
result per input, preserving raw input, duplicates and success/partial/error
outcomes. This replaces the initial **unreleased** raw `lookup` envelope.

```json
{
  "results": [{
    "inputId": "CVE-example",
    "status": "success",
    "advisory": {
      "id": "OSV-example",
      "url": "https://osv.dev/vulnerability/OSV-example",
      "summary": "Resolved source summary"
    },
    "sources": [{
      "id": "GHSA-example",
      "origin": "local",
      "relationship": "alias",
      "url": "https://osv.dev/vulnerability/GHSA-example",
      "severity": {"score": 7.5, "type": "CVSS_V3"}
    }],
    "packages": [{
      "target": "npm:minimatch",
      "url": "https://www.npmjs.com/package/minimatch",
      "evidence": [{
        "affectedRanges": [">=10.0.0 <10.2.1"],
        "sourceFixVersions": ["10.2.1"],
        "sourceIndexes": [0]
      }]
    }],
    "coverage": {
      "live": "AVAILABLE", "local": "AVAILABLE",
      "returned": 1, "total": 1, "complete": true
    }
  }]
}
```

- `sources` contains each distinct projected source report once per result.
  `origin` is `live` or `local`; ID/link, severity, withdrawal and malicious
  markers remain attributed to that report. `severity` contains only reported
  numeric CVSS with its version type; approximations and unknown types are omitted. Identical metadata is reused across
  packages. Different metadata for the same ID produces separate source rows.
- `sources[].relationship` describes the relationship to the resolved advisory:
  `advisory` for the same ID, `alias` when root or local recorded aliases explicitly
  establish it, otherwise `related`. It is omitted if no advisory was resolved.
  IDs and URLs remain exact; a different ID alone never proves alias equivalence.
- `sourceIndexes` contains **zero-based** indexes into that result's `sources`.
  For example, `sources[packages[0].evidence[0].sourceIndexes[0]]` resolves the
  first source for the first package's first range group. No cross-result joins.
- `affectedRanges` and `sourceFixVersions` are **independent lists, not index-aligned**.
  Never pair them by position or assume a span boundary is a fix event.
  `sourceFixVersions` (`fixedIn` on `pkg vulns`) is a complete source-reported
  fix list even when affected spans are truncated or some branches have no fix.
  Both fields are always present. Affected spans use the backend display when
  available, otherwise a bounded raw-expression fallback. `null` means unknown;
  `[]` means none reported, not that no affected/fixed version exists. Strings
  remain in source order, without sorting, deduplication or interpretation.
  These two lists provide neither a range-to-fix mapping nor a verified safe upgrade.
- If raw ranges are null but display evidence exists, `affectedDisplay` retains
  `ranges`, `totalCount`, and `truncated`. A truncated fallback is never silently
  presented as complete evidence. When known ranges exceed the display bound,
  affectedTruncated and affectedTotal describe the omitted spans. Verbose evidence
  detail retains rawAffected when normalization is missing/truncated or the registry
  is unsupported. A nonempty, complete backend display already represents the
  named-package constraints, so verbose text/JSON omit its redundant raw inventory.
  No client range evaluator compresses the expressions.
- `target` is a registry:name package locator. Append the installed version for
  `githits pkg vulns '<target>@<installed-version>'`. An exceptional `assessment`
  field describes what needs resolving first: `module_or_toolchain` for Go,
  `unsupported_registry` for unmapped/unsupported registries, or
  `unverified_provider` for a Swift provider without a known package URL. The Go
  qualifier does not claim that valid Go modules are unsupported: returned names
  can also be import paths or stdlib. Use their links to identify the module or Go
  release. No direct Go assessment command is advertised or parent path guessed.
- Unknown registries retain `name`, original `registry`/`ecosystem` when present,
  and no fabricated target or registry URL. Swift links use an explicit GitHub
  provider; registry URL path segments are escaped.
- `coverage.live` and `coverage.local` preserve independent acquisition statuses;
  the coverage object also retains returned and
  total package counts, and whether available pages were completely read. It is
  not worldwide advisory coverage. It is absent if no connection was obtained;
  `packages: []` with coverage is a checked empty mapping.
- `diagnostics[0]` is the primary failure, using the reader's acquisition-error
  precedence over NOT_FOUND. Each diagnostic retains code/message/retryability,
  optional section, candidate IDs/truncation, and supported action/hint/retry timing.
  AUTH_REQUIRED includes `action: "githits login"`; terms retains its acceptance
  action and updateCommand becomes `action`. `notAttempted: true` identifies reads
  stopped after an earlier access failure. Supporting display failures use a
  zero-based `packageIndex` into `packages`; raw backend paths are not emitted.
- Null/empty optional metadata, duplicate summaries, pagination cursors, page
  counters and duplicate error envelopes are omitted. Absence of a malicious
  marker means no true source marker was returned; it is not a safety claim.

### Verbose detail

`--verbose` adds original source evidence to text. Combine it with `--json` for
curated detail fields: advisory explanation, aliases, dates, severity vectors,
references, original affected/Git events and normalization changes. Null event
properties are omitted while event order and string timestamp precision survive.
Verbose raw severity entries use `vector` for strings beginning `CVSS:` or
`AV:` (including CVSS v2), or `value` for other opaque source strings; `score`
remains exclusively numeric on reported source CVSS. Type/source and exact
strings are preserved without calculation.
Limit/lastAffected boundaries are never described as fixes; CVSS vectors are not
converted to numbers. Text names the detailed advisory and labels CVSS vectors
explicitly. Displayed affected spans (including retained raw expressions),
explicit version/tag labels and source fix lists use numeric-aware natural
display order on copied arrays, not ecosystem precedence or upgrade
recommendations. JSON arrays and Git event sequences retain source order.

Verbose text omits alias IDs already identified by headings/source rows, an
update date equal to publication, exact same-record alias/date metadata already
shown under the root detail, and repeated per-event qualifiers. References are
grouped by type and exact duplicates omitted from text; JSON preserves their
original sequence, repeated entries and null URLs. Same-record package entries
already contained in the root advisory are omitted from package text; differing
observations remain visible. Consecutive original entries for the same nonnull
package share a heading/PURL; package-less entries keep separate headings, and
non-Git events are compact ordered lines. Git events keep their per-event
layout. JSON preserves original evidence inline or through exact same-record
references, without cross-record merging.

Source-wide aliases/dates belong to `sources`. Package-scoped original affected
entries, normalization changes and differing reported package identity belong to
`packages[].evidence[].details[]`, keyed by `sourceIndex`. When every original
affected entry from the same advisory ID exactly matches a root entry,
`advisoryAffectedIndexes` replaces `originalAffected`. Each zero-based index
resolves to `advisory.originalAffected[index]`; array order and repeated indexes
preserve the package observation exactly. A partly matching array or a different
source ID stays entirely inline. Other detail, including normalization and
reported package identity, remains beside these references. This preserves source
metadata deduplication across verbose package results. No mode emits raw lookup
or transport objects. Original prose/timelines are not fetched for default JSON.

## Transport, admission and failures

The backend contract is PR3918/head
`1bc64a0486dc2d0d1c0417ed57389bc41ef50375` (SDL hash `27116f8dd2a5`).
The existing authenticated GraphQL transport, token refresh, client headers and
host diagnostics are reused. OAuth/terms failures can refresh once; static token
providers do not refresh. Network configuration is validated at request time.

| Mode | IDs/request | Package groups | Display fallback |
| --- | --- | --- | --- |
| Compact text/JSON, all pages | 1 | 5 | maxRanges 10 |
| Verbose text/JSON, all pages | 1 | 5 | maxRanges 10 |

The CLI still accepts several IDs and reads them independently in input order.
Expanded display requests use the existing single-ID/five-group admission shape;
the former five-ID compact profile only admitted smaller displays. There is no
retry on a rejected profile or new caller serialization requirement.

Compact root and local rows select `aliases` for relationship classification;
full alias arrays remain verbose-only output. Compact local rows also select
`isMalicious`; compact source rows omit unused
`modifiedAt`. Detailed source revision is required by the detailed decoder.
Display fields provide backend-owned normalization and fallback evidence for nullable raw ranges.
`fixedVersionDetails` and `relatedAdvisories` are not acquired. Continuations omit
the already-read advisory body. Initial source/coverage remain authoritative.

IDs are trimmed, case-preserving, 1–512 UTF-8 bytes, with no embedded whitespace,
control or format characters. Exact IDs win over aliases. Invalid IDs produce
per-input errors while valid inputs continue. NOT_FOUND offers a casing hint
only for well-shaped CVE/GHSA IDs; the CLI never changes input or silently retries.
Producer enum strings and timestamps remain open/verbatim in JSON.

Each input independently drains its opaque cursor sequentially. Successful groups
append in backend order. Stale/null/failed continuations retain prior evidence,
report incomplete pagination and exit 1; they never reset or merge newer source
observations. Auth/terms/access/update failures stop further protected admissions.

The transport accepts GraphQL data+errors only for selected nullable display
leaves, with valid item/group/row indexes and a fully parsed required projection.
It appends neutral result-relative diagnostics; debug logs retain safe codes and
paths, never raw provider messages. The builder maps entry paths to packageIndex.
Unselected/required field errors and malformed responses remain fatal. A null
display without a GraphQL error is valid and is not an acquisition failure.

Exit 0 means a complete successful lookup, including checked empty mappings;
it never proves safety. Any validation, acquisition, supporting-display or
continuation failure exits 1 while retaining usable results. Action JSON goes to
stdout with clean stderr. Startup/parser/login failures before the action retain
the command-wide stderr JSON envelope.

### Typed OSV metadata and literal advisory text

The initial `--verbose` selection also requires `schemaVersion`, `relatedIds`,
`upstreamIds` and `credits { name contact type }`. Compact reads and package-page
continuations omit these fields. Verbose JSON puts them on `advisory`, preserving
empty arrays, null credit roles, open role strings and all contact strings.
Related/upstream IDs are not aliases and do not trigger traversal. Text labels
them separately and omits empty contacts. Contact strings and reference URLs are
displayed without following them or fetching linked resources.

Full advisory text follows an Advisory text label and uses the shared literal
Markdown emitter rather than prose wrapping, preserving fences, tables,
indentation and blank lines without a body cap. CRLF/CR normalize to LF, tabs
expand to four spaces and terminal controls are removed; JSON explanation
strings remain complete backend-normalized Markdown. Long Markdown lines can
exceed the caller's width; other prose still wraps. A source without advisory
text says so explicitly. This source material is untrusted evidence, not agent
instructions. This behavior requires a backend exposing the typed OSV metadata
fields.
