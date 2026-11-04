# Package registry input aliases

`cargo:` selects the same public crates.io package as `crates:` in CLI and MCP
package targets. Structured registry inputs also accept `cargo`. Registry spelling
is case-insensitive and trims surrounding whitespace, including the prefix segment
in compact addresses. Package names, versions, ranges and existing restrictions
(such as unpinned `pkg_info` and unversioned diff targets) remain unchanged.
This adds no alternate Cargo registry or PURL input syntax.

## Ownership and canonical identity

The pure `parsePkgseerRegistryArg` in private core registry code owns input
spelling. Both core entrypoints export it; canonical unions, type guards, registry
lists and GraphQL enums still contain `crates` / `CRATES`, never `cargo` / `CARGO`.
MCP package-spec owns compact address grammar. Shared summary, dependency,
vulnerability, upgrade-review, package-doc listing and resolver-filter builders
normalize registry spelling before enum conversion or capability checks. Resolver
filters deduplicate after normalization. Unknown prefixes do not fall back to npm.

Navigation, search, changelog and diff inherit compact normalization. Presentation
recognizes retained Cargo labels as packages and constructs canonical package
actions through package-spec. The deprecated code-files command uses shared prefix
admission for its conflicting `--repo-url` positional check, even for malformed
package-looking input. Version/ref recovery uses the same spelling parser to match
caller operands against canonical backend identities before building retry actions,
preserving version ranges and semantic fragments.

Unified read/list/grep intentionally preserve target bytes for backend parsing;
raw request/replay/attribution labels may retain `cargo:`. Do not duplicate address
grammar in those request builders or rewrite evidence labels merely for spelling.

## Delivery and rollout

Forwarded alias inputs require a backend build that admits Cargo spelling. A
backend merge does not establish deployment. Permanent smoke alias cases exercise
client-normalized metadata; verify forwarded aliases separately against the
actual selected backend before publication.

Configuration belongs to the client: `GITHITS_ENV=dev` selects dev services and
the dev credential namespace; `GITHITS_CODE_NAV_URL` independently overrides only
the package/source endpoint. Use the normal CLI credential store and refresh path,
never a manually extracted token. A parallel backend can pass while default dev
rejects the same input; verify the selected endpoint directly. Current rollout
evidence belongs in the
[rollout backlog](../plans/open-backlog.md#cargo-alias-rollout-and-hosted-adoption--2026-10-19).

Hosted MCP receives this behavior only after the public MCP package is released,
the hosted repository adopts it, and that server is deployed. Those are separate
approval gates. Revert client/package adoption for rollback; roll back clients
that forward aliases before removing backend alias admission. Public Agent Skill
alias notes follow the release lifecycle; this increment leaves their canonical
examples and stable quick_start unchanged.

## Verification

Focused tests cover alias/canonical params, compact grammar, raw target forwarding,
CLI/MCP parity and recovery actions, including missing-version failures. Root/MCP
builds, packed external consumers and private import boundaries are validated.
Unauthenticated smoke proves startup, registration and auth handling only; it
does not establish live alias support. The required qualitative eval completed
without GitHits calls and provides no alias-use or graded-quality evidence.
