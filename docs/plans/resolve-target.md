# Plan: `resolve` CLI dogfood surface

## Goal

Add `githits resolve <name>` so we can test backend target resolution from a
normal local/source CLI build. Phase 1 is CLI-only; it establishes the request,
JSON, error, and ranking-language contracts that the later MCP tool will reuse.

**Assumption:** "internally test" means the command may be implemented and
dogfooded from this branch/local builds, but must not be included in a published
CLI version until the release gates below pass. No hidden command or client-side
feature flag is added.

## Verified baseline

Verified 2026-08-03 against:

- CLI repo `479b276`
- backend `4fbebb1975e614ffd1c21cb4cfc6eafbe77d6e27`

Backend contract:

- `resolveTarget(name!, query, registries, preferredKinds, intentHints, limit)`
  returns `best`, ranked `candidates`, unbounded `protectedMatches`, `ambiguous`,
  and `ambiguousReason`. Default limit is 8; accepted range is 1-20.
- Candidate non-null fields: `kind`, `canonicalKey`, `displayName`,
  `matchedAliases`, `docsAvailable`, `codeAvailable`, `protected`, `matchTier`,
  `score`, and `confidence`. Nullable fields: `description`, `registry`,
  `packageName`, `latestVersion`, `repositoryUrl`, `repositoryOwner`,
  `repositoryName`, `stars`, `downloadsLastMonth`, `downloadsTotal`,
  `documentationUrl`, and `reason`.
- Kinds are `PACKAGE | REPOSITORY`; confidence is
  `EXACT | HIGH | MEDIUM | LOW`; ambiguity reasons are `NOT_AMBIGUOUS`,
  `DUPLICATE_EXACT_NAME`, `CLOSE_CANDIDATES`, and `LOW_CONFIDENCE`.
- The ranker deduplicates candidates by `{kind, canonicalKey}`. `best` is null
  only for no candidates. Protected matches come from the same candidate
  population but are not bounded by `limit`, so terminal sections must remove
  cross-list overlap.
- `inspection` is lazy and expensive. This feature never selects it.
- The authenticated GraphQL field is enabled by default and can be disabled by
  the backend `graphql_enabled` kill switch. Fuzzy retrieval separately has the
  `TARGET_RESOLUTION_FUZZY_ENABLED` runtime control. `FEATURE_FLAG_REQUIRED`
  already maps to `ACCESS_DENIED` in the client.
- The current backend corpus has 11 cases (6 unique names) and no
  ambiguous-expectation case. Existing
  backend guidance requires quality, fuzzy-latency, and rate-limit review before
  advertising this resolver.

Client constraints:

- `PackageIntelligenceService` is public through `@githits/mcp/client` and
  `McpToolServices`; adding a required method would be a public MCP API change.
- `postPkgseerGraphql` handles only one HTTP request. HTTP, GraphQL, transport,
  schema-mismatch, and token-refresh handling currently lives inside
  `PackageIntelligenceServiceImpl` and cannot simply be reused as the old plan
  claimed.
- The existing `TargetResolution` type/module describes index freshness, not
  fuzzy target discovery. New APIs use `ResolveTarget*` names.

## Scope and release gate

Implementation and branch-local dogfooding may proceed now. Do not merge the
implementation to `main`, bump the root package version, or publish a CLI
containing `resolve` until all of these are true:

1. `mix target.smoke --env prod` passes an expanded corpus covering exact names,
   curated aliases, duplicate exact names, close candidates, and low confidence.
2. No known exact-package case resolves to the wrong `best`; ambiguity wording
   is useful in manual dogfooding.
3. The backend team revalidates fuzzy latency against expected CLI/MCP volume,
   optimizes it, or explicitly launches with fuzzy retrieval disabled.
4. Backend rate limiting and GraphQL complexity are confirmed adequate for the
   expected call volume.

Resolver defects found during dogfooding go in the findings log at the end of
this file with exact input, hints, expected result, actual result, and date.
Move each finding into the backend `cases.json` corpus, then remove its log
entry. The client PR does not add another quality-eval harness.

## Product decisions

1. Add an always-registered top-level command: `githits resolve <name>`.
   Resolution spans packages and GitHub repositories, so it does not belong
   under `pkg`.
2. Add an internal-only `ResolveTargetService`; do not modify
   `PackageIntelligenceService`, `McpToolServices`, `packages/mcp/src/index.ts`,
   or `packages/mcp/src/client.ts` in Phase 1.
3. Extract the existing package-intelligence HTTP/GraphQL/transport classifier
   methods into package-local reusable functions and use them from both service
   implementations. Duplicating the classifier was rejected because auth,
   schema-drift, client-update, and retry behavior would diverge.
4. Fetch a compact field set for terminal output and conditionally select
   diagnostic fields for `--json`. No `inspection`, separate query, or future-
   only field is selected.
5. Define the compact structured envelope now and keep it for MCP parity. Do not
   ship a temporary raw-backend JSON shape that Phase 2 knowingly breaks.
6. Keep one compact text mode; no `--verbose`. `--json` is the diagnostic and
   machine-readable mode.
7. Keep all ranking inputs needed for dogfooding. Use `--intent-hint` rather
   than vague `--hint`; use `--prefer-kind` because `search --kind` is a hard
   filter while this is a soft preference.
8. No candidates means resolution failed: print a valid result, set
   `process.exitCode = 1`, and let stdout flush. Other failures use the existing
   mapped error exits.

## CLI contract

```text
githits resolve <name> [options]

Arguments:
  name                         package or GitHub repository name

Options:
  -q, --query <text>           task context used as a soft ranking hint
  --registry <list>            comma-separated package registries
  --prefer-kind <kind>         soft preference: package | repository
  --intent-hint <text>         soft intent hint (repeatable)
  -n, --limit <n>              ranked candidates (1-20, default 8);
                               protected exact matches may be additional
  --json                       emit structured diagnostic JSON
```

Command help must state that `--query` and `--intent-hint` are sent to the
service and must not contain credentials, personal data, private code, or
proprietary content.

Normalization and validation, in `buildResolveTargetParams`:

- Trim `name`; reject empty with `INVALID_ARGUMENT`.
- Trim `query`; omit an empty value.
- Parse registry CSV case-insensitively, trim entries, drop empty entries,
  validate against `PKGSEER_REGISTRY_ARGS`, deduplicate by first occurrence,
  and omit an empty result.
- Normalize `prefer-kind` case-insensitively and send it as a one-element
  `preferredKinds` array; reject unknown values.
- Trim intent hints, drop empty values, and case-insensitively deduplicate while
  preserving the first spelling and order.
- Map validated registries through `toPkgseerRegistry`; map `prefer-kind` to the
  GraphQL `PACKAGE | REPOSITORY` enum before constructing service params.
- Parse CLI limit lexically with `parseIntCliOption`; independently require an
  integer from 1-20 in the shared builder. Apply the shared default of 8 there.
- Omit all unset optional resolver variables. The client always sends its
  explicit default `limit: 8` plus the query-only `includeDetailedFields` flag.

Do not use Commander `.choices()` for validated options: action-level
validation must preserve the standard terminal/JSON error envelopes.

## Wire contract

`RESOLVE_TARGET_QUERY` selects only identity/confidence for list rows, adds
presentation fields to `best`, and conditionally selects diagnostic fields for
JSON.

Always select for every candidate position:

```text
kind canonicalKey confidence
```

Also select for `best` in terminal mode:

```text
description stars downloadsLastMonth docsAvailable codeAvailable
```

For JSON, select the best presentation fields on every candidate plus:

```text
displayName registry packageName latestVersion repositoryUrl repositoryOwner
repositoryName downloadsTotal documentationUrl matchedAliases matchTier score
reason
```

Never select `protected` or `inspection`; protected membership already comes
from the containing `protectedMatches` list. Use mode-specific candidate schemas: always-selected
non-null fields are required in both modes; conditionally selected non-null
fields are required only in detailed mode. Model enum-like response fields as
`z.string()` so a new backend enum value remains parseable. The formatter
narrows known values and uses safe generic wording for unknown values. Missing
or wrongly typed fields required for the active mode are
`MalformedPackageIntelligenceResponseError`.

Service flow:

```text
resolveTarget(params)
  -> withTelemetrySpan("resolve-target.request")
  -> executeWithTokenRefresh(... AuthenticationError ...)
  -> postPkgseerGraphql(...)
  -> shared package-intelligence response/error classifiers
  -> Zod response parsing
```

## Output contract

Default terminal output is compact and scannable:

```text
Best: npm:express [exact] · package · 66k stars · 89M downloads/mo · docs · code
  Fast, unopinionated, minimalist web framework

Also consider:
  github:expressjs/express [high] · repository
  npm:express-validator [medium] · package

Next: githits search '<query>' --in npm:express
```

Rules:

- Use `Best` only for non-ambiguous `EXACT`/`HIGH`; otherwise use `Top`.
- If ambiguous, print one plain-language line before the result. Give specific
  guidance for duplicate exact names (`--registry`), close candidates, and low
  confidence; unknown reasons get neutral generic wording.
- Render protected matches excluding `best` in `Protected exact-name matches`.
  Render other ranked candidates excluding `best` and all protected keys in
  `Also consider`. Preserve backend order and first occurrence.
- Show one normalized, single-line best description capped at 120 characters.
  Alternative rows do not repeat descriptions.
- Reuse `formatCompactNumber`, colors, `shellQuote`, and canonical keys. If
  `--query` was supplied, the `Next` command uses it; otherwise it contains the
  literal `<query>` placeholder. Repository and package targets use the same
  valid `search --in` follow-up.
- In text mode, no candidates prints `No targets found for '<name>'.`; in JSON
  mode, emit the empty envelope below. Both exit 1.

`--json` emits a stable, camelCase envelope. Nullable fields are omitted; enum
values are lowercase. Build `candidates` from backend ranked candidates followed
by protected matches absent from that list, preserving each source order and
deduplicating by `{kind, canonicalKey}`. Candidate objects occur only once;
every `best` and `protectedMatches` canonical-key reference resolves to one
candidate object:

```json
{
  "best": "npm:express",
  "ambiguous": false,
  "candidates": [
    {
      "target": "npm:express",
      "name": "express",
      "kind": "package",
      "confidence": "exact",
      "description": "Fast, unopinionated, minimalist web framework",
      "registry": "npm",
      "latestVersion": "5.1.0",
      "stars": 66000,
      "downloadsLastMonth": 89000000,
      "docsAvailable": true,
      "codeAvailable": true,
      "matchedAliases": ["express"],
      "matchTier": 0,
      "score": 100,
      "reason": "Exact package identity match"
    }
  ],
  "protectedMatches": ["npm:express"]
}
```

Emit `ambiguousReason` only when `ambiguous` is true. Empty success is
`{"ambiguous":false,"candidates":[],"protectedMatches":[]}` with exit 1.
JSON errors remain on stderr so stdout is clean.

## Files

| Concern | File |
|---|---|
| Reusable existing error classifiers | `packages/core-internal/src/services/package-intelligence-service.ts` |
| Service, query, Zod schemas, params/results | `packages/core-internal/src/services/resolve-target-service.ts` (new) |
| Private core export | `packages/core-internal/src/index.ts` |
| Request/default/validation | `packages/mcp/src/shared/resolve-target-request.ts` (new) |
| JSON projection + terminal formatter | `packages/mcp/src/shared/resolve-target-response.ts` (new) |
| Workspace-only CLI exports | `packages/mcp/src/internal.ts` |
| Container construction in both token branches | `src/container.ts` |
| Command action/registration | `src/commands/resolve.ts` (new), `src/commands/index.ts`, `src/cli.ts` |
| Product docs and smoke | `docs/implementation/cli-commands.md`, `scripts/cli-smoke.ts` |

Register `resolve` unconditionally with lightweight commands and add it to root
`Getting started` help and `EXPECTED_TOP_LEVEL_COMMANDS`.

## Tests

- Core service: exact compact/detailed query selections and variables; prove
  `inspection` is absent; optional arguments omitted; detailed fields parse;
  malformed required fields fail; HTTP/GraphQL classification reuse; GraphQL
  auth refresh; `FEATURE_FLAG_REQUIRED` and validation mapping.
- Existing package-intelligence service: run its focused suite after classifier
  extraction to prove no behavior change.
- Request builder: trim/default/empty inputs, registry CSV, dedupe, exact
  lowercase-to-GraphQL enum conversion, strict integer/range validation, and
  normalized wire params.
- Response/terminal: stable JSON shape, null omission, lowercase/unknown enums,
  all ambiguity reasons, best/top wording, protected overlap partitioning,
  unbounded protected extras and JSON reference closure, no candidates,
  120-character description, scoped target and quoted-query follow-ups, ANSI
  on/off.
- Command: auth before service call, text and JSON success, detailed-mode service
  flag, stdout/stderr discipline, mapped errors, no-result `exitCode = 1`
  (restored after each test), registration/help/privacy warning.
- CLI smoke: command set; unauthenticated terminal and clean-stdout JSON auth
  failures; authenticated success-only text/JSON probes; one all-options probe;
  empty-name `INVALID_ARGUMENT`. Do not accept `ACCESS_DENIED` in live mode.
- No MCP parity test or agent eval until the MCP tool exists.

Verification:

```text
bun test <focused resolve + package-intelligence + container/CLI registration tests>
bun test
bun run typecheck
bun run format:check
bun run lint
bun run build
(cd packages/mcp && bun run build)
bun run validate:packages:mcp-publish
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
```

Target size: roughly 1.2-1.5k changed lines including tests and docs. If the
implementation requires a new generic GraphQL executor or exceeds this budget,
stop and re-slice rather than broadening the refactor.

## Not handling

- MCP tool/instructions/public service types/version bump: Phase 2 after CLI
  dogfooding; it reuses the stable request and JSON contracts above.
- Standalone documentation sites: absent from the backend resolver kind.
- Candidate `inspection`: separate exact-inspection concern.
- Interactive selection, caching, client feature flags, or a second eval
  harness: no verified need.
- Verbose terminal mode: diagnostics are already available through `--json`.
- Public release before the backend gates pass.

## Phase 2 direction

Add `resolve_target` using the shared request and JSON projection, promote the
smallest required service API through `@githits/mcp`, add parity/smoke coverage,
teach agents when to resolve fuzzy names, and run targeted Claude/Codex agent
evals. Plan that PR from Phase 1 usage rather than expanding this plan now.

## Resolver findings log

```text
- [ ] <date> `<input>` (query/registries/preferred kind/intent hints: <values>)
      expected: <canonical key and ambiguity expectation>
      actual:   <best, ambiguity, and relevant candidates>
```

- [ ] 2026-08-03 `guava` (query/registries/preferred kind/intent hints: none)
      expected: `maven:com.google.guava:guava`, not ambiguous
      actual:   `maven:com.github.ben-manes.caffeine:guava`,
                `CLOSE_CANDIDATES`; Maven/package hints produced the same best

## Acceptance criteria

- Local authenticated `githits resolve` produces the compact partitioned text
  output and stable JSON envelope above; no-result and error exits are correct.
- Unauthenticated and invalid-input paths use standard terminal/JSON envelopes
  with clean JSON stdout.
- No public MCP API or artifact contains the new internal service.
- All verification commands pass. Live smoke is success-only when credentials
  are available; skipped authenticated probes are reported, not represented as
  quality validation.
- Durable command/output decisions are copied into
  `docs/implementation/cli-commands.md` during implementation.
- After publication gates pass and implementation is complete, dispatch every
  findings-log entry to the backend corpus and delete this temporary plan.
