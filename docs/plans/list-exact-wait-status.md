# Exact list wait status companion

Status: IMPLEMENTING. One bounded increment executing the user-approved
2026-10-04 handoff at `/tmp/pkgseer-p21a-cli-wait-outcomes-handoff.md`.

## Verified state and ownership

The clean checkout matches `origin/main` at `896a765`. Both public packages
are version 0.25.1. The core list service currently selects `awaited.outcome`
and validates four values. CLI and MCP share the result projector and compact
path-only formatter; `@githits/mcp/client` exports the service and outcome type.
The core service naturally owns the wire selection and validation because both
surfaces consume it. No new placement or infrastructure is needed.

## Outcome, scope, and assumptions

Preserve the response key `outcome` while consuming the exact backend `status`
field. Accept exactly COMPLETED, DISCARDED, CANCELLED, TIMEOUT, FAILED, and
SUPERSEDED; reject unknown values. Keep `mode` and existing text behavior.
Change only the awaited selection to `outcome: status`, widen the type/parser,
extend existing boundary and surface fixtures, and document rollout.
No fallback, permissive parser, flag, backend edit, version bump, or publication.

The approved backend contract permanently retains its old four-value field:
FAILED projects to DISCARDED, SUPERSEDED to CANCELLED, never to COMPLETED.
The new nonnull status field exposes all six exact outcomes. These are supplied
handoff facts, not independently verified backend deployment evidence.
Dependency: status must be deployed to dev and production before either updated
public client artifact is published. Existing users need no forced upgrade.
Unknown: deployment availability; the coordinator owns verification and ordering.
Open product decisions: none. No performance claim or optimization is made.

## Acceptance and verification

1. Existing service tests assert the actual outgoing awaited alias and retain
   mode, compact/detail conditional selections, and all six parsed outcomes;
   an unknown outcome fails after one request.
2. Existing CLI and MCP tests preserve each exact value in JSON and keep the
   established compact text for the same fixture.
3. Focused Bun tests, release fragment validation, typecheck, formatting, build,
   and source CLI/MCP smoke pass. A targeted list agent eval validates available
   paths; authenticated exact-status claims require deployed backend evidence.
4. One internal pre-flight and one external Claude review run to a clean round,
   followed by a draft PR. Merge/tag/release/publish/deploy remain unapproved.

Pending patch fragments cover both githits and @githits/mcp because the shared
client and exported union change both artifacts. Permanent knowledge goes into
`docs/implementation/unified-list.md`; delete this plan in a final commit after
the implementation review is clean. Record actual verification before cleanup.
