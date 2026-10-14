# Compact changelog tags

Status: READY FOR EXTERNAL REVIEW. Owner follow-up to open draft PR476, base f76afd3.

Remove the repetitive no-impact tag and tier words inside impact tags. The existing
shared changelog formatter owns presentation; no new module or backend change.
Keep JSON, GraphQL projections, filters, paging and upgrade review unchanged.

Use plain bullets for NO_IMPACT. Known impact kinds use [behavior]/[deprecation]
labels, with ! for MUST_ACT and i for SHOULD_KNOW. One short legend when either
tier appears keeps meaning visible without color, especially for kindless items.
Red/yellow remain optional highlighting; uncertain prefixes dim and retain the
explicit (uncertain) marker from backend ambiguous. Unknown and oversized
statements keep explicit assessment status; no client confidence policy.

Verified: existing formatter prepends [tier: kind] and [no impact identified]; CLI
and MCP share it. Those words are text-only; no query/JSON change is needed.
Tests cover untagged no-impact (including uncertainty and preserved JSON), kindless
severity, known kind/color equivalence, assessment gaps and existing nested code.
Focused tests started red before implementation. Baseline built output artifacts
from the reviewed PR are available for exactExpress4.20.0 and Biome2.4.2..2.4.15.

Implement the compact prefix in place, update durable docs and existing unreleased
fragment, run focused tests/build/typecheck and source/built credential-free smokes.
Use normal dev CLI/local MCP auth for representative text parity and byte counts;
query complexity remains85/88/113 since no selections change. Run the targeted
exact-release descriptor-intent workload because text severity cues changed.
Review internally then on retained Opus reviewer (owner changes before merge),
commit/push/update PR476 and complete CI; no merge/release. After clean review,
transfer validation to implementation docs and delete this completed plan.

Validation: 165 focused tests / 1,011 assertions pass; build, typecheck, Biome
and four source/built credential-free smoke modes pass. Authenticated dev built
CLI/local MCP text parity passes for Express4.20.0 and5.2.1; exact output is
5,658 bytes versus6,482 before tag shortening. Targeted descriptor-intent eval
passes, three logical calls in27.5s, inspected rollback/CVE evidence, no isolation
violations; no quality grade. Internal code reviewer: direction sound, no findings.
