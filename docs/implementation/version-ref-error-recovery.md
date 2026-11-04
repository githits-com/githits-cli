# Version and ref error recovery

Core services decode `VERSION_NOT_FOUND` and `REF_NOT_FOUND` using
`parseVersionRefRecovery()` and carry the decoded record in typed errors without
CLI or MCP wording. Package intelligence, code navigation, list, grep,
and target resolution preserve the same public facts. Registry publication
history (`available_package_versions`, strings) stays separate from indexed
snapshots (`available_versions`, ref/version records). Ref inventories preserve
nullable version associations, ordering, empty arrays, input paths and target
indices/counts. Unknown codes and malformed optional fields do not prevent
showing the backend message.

CLI `--json` and MCP `format: "json"` retain backend prose and complete decoded
recovery lists in the shared error envelope. They do not scrape suggestions out
of prose or truncate lists for presentation. Registry releases appear as
`details.availablePackageVersions`, indexed snapshots as `availableVersions`,
and ref corrections as `suggestedRefs`; `availableRefs`, `latestVersion`,
`latestIndexed`, requested identity and input context remain separate facts.
When the invocation has a matching operand, both JSON envelopes also include
`details.action` using CLI or MCP syntax, including on the CLI search error path.
Actions supplement the backend facts; they do not replace the original message
or lists. Unknown future extension fields are ignored, as before.

Producer ordering is authoritative: clients do not sort alternatives. Version
recovery prefers nonempty `availablePackageVersions`, then version-bearing
`availableVersions` entries, then code-diff `publishedVersions`, then
`latestVersion`. Ref recovery prefers nonempty `suggestedRefs`, then
`availableRefs`, then refs from `availableVersions`. Registry versions and Git
refs remain distinct even when their strings happen to match.

`formatMappedErrorText()` owns human wording for both surfaces. When the
identity and suggestions are present, it replaces backend prose with a concise
package/version or repository/ref sentence. A version miss does not claim the
registry lacks a published release: the same code also covers source-snapshot
resolution failures. Repository-snapshot version misses with tag suggestions
(`repoUrl` and nonempty `suggestedRefs`, with absent or empty
`availablePackageVersions`) retain backend prose and produce no recovery action;
they do not choose an older indexed version as a retry. Nonempty registry
alternatives and snapshot misses with only indexed versions keep concise recovery.
Code-diff ambiguity retains its original explanation and never selects an
arbitrary ref. Text shows at most five alternatives plus the omitted count, once.
Passthrough prose gets a supplemental inventory only for code-diff side/stage
context. The first candidate supplies the recovery action. With one suggestion
and an action, the value appears only in the action. Incomplete recovery shapes retain
backend prose; no guessed version or ref is introduced. Code-diff keeps its
side, stage, limit, ref kinds and compared commits when supplied.

CLI actions reuse the original invocation and replace the failed target or
native version/ref operand, preserving paths, filters and output flags. Shell
operands are quoted. MCP boundaries supply the actual tool and arguments;
actions name the argument or array member to change. Text and JSON include the
same native action; JSON also preserves the full backend message and lists.
Actions cannot be constructed when the original invocation has no matching
operand. Root color switches, grep short switches, unversioned upgrade-review
package operands and canonical package casing are supported.

`pkg info` remains unpinned. `resolve` still rejects canonical targets
locally. These tools preserve unexpected structured errors without inventing
new version parameters. Grep `target_issues`, validation, indexing and auth
recovery follow their existing contracts.

Structured validation recovery using `input_path` and `reason` is deferred until
PkgSeer phases 3-4 ship; the remaining work is recorded in the
[open backlog](../plans/open-backlog.md#validation-error-recovery-after-pkgseer-phases-3-4).

Tests cover service decoding, real tool boundaries, shared output, CLI
operands, malformed fields, forward compatibility and complete CLI/MCP JSON
facts and actions. Both live smoke suites include Go version and repository
ref recovery probes. Live production evidence belongs in the PR description.
