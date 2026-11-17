# Typed package read versions

Typed package query/read selectors accept an exact published version or an
ecosystem-agnostic numeric component prefix. A prefix selects the newest eligible
stable release whose components match: `npm:express@5` selects 5.x.y,
`crates:tokio@1.43` selects 1.43.x, and `crates:log@0.4` selects 0.4.x.
This does not apply native Cargo caret semantics. Manifest, SBOM, and audit
dependency resolution retain their native constraint behavior.

General typed read ranges (`^`, `~`, comparisons, unions, and intervals) are
rejected. Existing equality markers and dotted `x`/`*` aliases remain accepted by
the generic grammar. As a compatibility exception, Cargo `=1.43` keeps the public
exact label while internally selecting the 1.43 prefix. Omitted versions,
`latest`, and default aliases retain their existing selection policy.

These rules do not redefine changelog release intervals, code-diff comparisons,
or dependency constraints reported from manifests. `pkg_info` remains unversioned.

## Ownership and evidence

The backend owns version interpretation and release selection. CLI/MCP parse
target coordinates and forward version inputs through existing normalization;
they do not implement an ecosystem-specific prefix parser. Cross-tool agent
guidance belongs in `buildMcpQuickStart()` and its exact public `githits-mcp`
skill copy. CLI code/package skills express the same policy independently;
schemas and help give concise syntax hints.

Prefixes use `package_version_prefix` and `prefix_current`/`prefix_provisional`
evidence; exact versions keep their existing exact kinds and reasons. Detailed
kind/freshness values are extensible strings. The legacy nullable
`DiscoveryRequestedRefKind` stays null for prefixes and constraints; no strict
enum addition is needed. Preserve served-version provenance rather than
presenting a prefix as an exact published version.

Instruction availability does not prove backend rollout. Hosted MCP also needs
the released MCP package adopted and deployed by its owning server. Verification
and rollout evidence belong on the delivery PR; this documentation change does
not authorize release or deployment.
