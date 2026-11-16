# Path handling

## Address contract

A target and path form one address. Package paths start at the resolved package
root, repository paths at the repository root, and hosted-documentation paths
at the emitted site target. The package's repository directory can differ from
its registry name and can change between versions.

Backend `PathContract` and version-specific package scope own coordinate
conversion. Clients preserve emitted addresses; they must not infer a package
root from the registry name or remove a directory from arbitrary input.

| Surface | Path authority | Client behavior |
| --- | --- | --- |
| Search | Hit locator and its read action | Keep action target/path together; repository provenance is separate. |
| Grep | Requested scope for filtering; emitted read action for matches | Preserve original retry operands; use each match's read target/path. |
| List | Entry path belongs to the listed target; a read action can use another target | Compact package listing uses its package target and entry path; actions retain their own complete address. |
| Read | Requested target plus exact path or selector | Shared request builder validates the locator; the backend resolves its package scope. |
| Symbol candidates | Requested base target | Text explicitly labels candidate/suggestion paths with that target. |

`ReadTarget` parsing, `read-target-text`, and `follow-up-command-text` are the
shared client address/rendering helpers. JSON is the lossless transport surface;
CLI commands use `shellQuoteExact`, with an option terminator for symbol-search
queries that can begin with a dash. CLI `buildCliListRecoveryCommand` shares
list recovery formatting and terminates options for dash-leading paths.
Error-recovery commands use the same quoting helper. Shell escaping does not
change which target owns a path.

## Audit evidence, 2026-10-22

The audit covered current search, grep, list, exact/symbol read, legacy code
commands, preparation replies, recovery actions, quick-start guidance, and the
backend scope helpers. Backend source inspection used commit
`3887bbd63902f14f98488e826f43a53d1afaf3e6`; a historical incident trace used backend
revision `1ea763faebf45f8096a86296b62440c52625f2de`.

- A package-relative prefix and its equivalent repository target/prefix each
  selected 73 files and returned four matches at the same snapshot. Adding the
  repository package directory to the package-relative prefix selected zero
  files. Both emitted read-address forms opened the same source.
- Live search and list responses retained correct package entry/locator paths
  and repository-root paths when a read action addressed the repository.
  The presence of both forms in one response did not make either form wrong.
- An unindexed package version with a one-millisecond wait returned a successful
  pending response without a replacement path. Retrying the original scope
  unchanged returned four matches. This did not reproduce a path rewrite.
- Live ambiguous-symbol text previously displayed repository provenance beside
  package-relative candidate paths without identifying their target. The shared
  formatter now labels that target.
- Recovery command tests execute harmless shell-substitution operands through a
  stub command and the actual list argument parser, including dash-leading
  paths, and verify that the original literal operands survive.

For the investigated historical retry, usage rows preserve request arguments
and result summaries but have null result content. The initial result was a
successful non-resumable partial response with one unavailable target, not an
error response. Neither that data nor the trace establishes which caller layer
changed the retry path. A hypothetical error formatter forwarding `file_path`
does not establish the cause: the historical backend target-issue type did not
include that field, and the request did not take the error path.

## Literal file paths

Shared read request builders preserve leading and trailing filename whitespace.
Empty or whitespace-only optional paths still count as omitted; required file
paths reject them. Recovery listing prefixes preserve the same filename bytes.

CLI `read` and legacy `code read` retain `:N`, `:N-M`, and `:N-` shorthand.
Use `--literal-path` to disable that parsing for filenames such as
`src/example:12`; explicit `--lines`, `--start`, and `--end` still work.
The shared read-action formatter emits the flag for numeric-colon paths, and
generic source-file list/grep read templates include it because their paths
come from the source inventory. MCP paths are always literal.

Backend grep also performs package-prefix composition/removal outside
`PathContract`. The inspected implementation uses directory boundaries and the
resolved package scope, and the live equivalence probe passed. Consolidating
that conversion into `PathContract` is a refactoring opportunity; the audit did
not establish a conversion bug there. The separately assigned backend warning
work should use the resolved version-specific scope and preserve valid nested
paths and original request semantics.
