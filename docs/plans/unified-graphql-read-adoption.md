# Unified GraphQL Read Adoption

## Status

- Overall: **COMPLETE**
- Current phase: Phase 1 — client and MCP package adoption complete
- Owner: repository maintainers
- Last verified: 2026-09-14
- Deployment dependency: confirmed against the production package/source
  endpoint with authenticated compact code and docs reads through both the
  built CLI and built local MCP on 2026-09-14.

## Problem and expected outcome

Before this increment, the advertised MCP `read` tool and top-level
`githits read` command chose between `fetchCodeContext` and `getDocPage` in the
client. Each call made only one backend request, so replacing this split is not
a latency optimization. The problem was API identity: backend usage was
recorded as `code_read` or `docs_read`, even when the caller used the unified
public `read` surface.

The backend now exposes one `Query.read` field returning
`CodeContextResult | GetDocPageResult`. Adopting it for compact read callers will:

- record advertised MCP and compact CLI traffic under canonical `read` usage;
- leave legacy-root traffic visible as a compatibility cohort, so usage data can
  inform a later evidence-based deprecation decision;
- give future public API work one backend operation to expose; and
- preserve current CLI/MCP schemas, text, JSON, limits, errors, and exact
  locators.

This change does not combine two requests into one: current read callers already
perform exactly one source-specific request.

## Scope

In scope:

- add a transport-neutral unified read client for backend `Query.read`;
- use it for the advertised MCP `read` tool;
- use it for compact top-level CLI calls:
  - `githits read <docs-target>`;
  - `githits read <compact-code-target> <path>`;
- keep current source-specific validation, range behavior, formatting, output
  envelopes, error recovery, cancellation, token refresh, diagnostics, and MCP
  caps;
- export the new client contract and implementation through
  `@githits/mcp/client` and require it in `McpToolServices`;
- update the root CLI dependency container and the public MCP descriptor/test
  service fixtures;
- document the analytics and compatibility boundary; and
- add an independent release fragment for both public artifacts.

Out of scope:

- changing the public `read` tool name, description, arguments, annotations,
  text output, JSON output, or CLI flags;
- removing `fetchCodeContext` or `getDocPage` from either client or backend;
- changing deprecated command behavior;
- changing backend analytics storage, dashboards, or retention;
- selecting a legacy-removal usage threshold or date before real usage evidence
  exists;
- changing the separate public API, Python backend/Ask callers, or hosted
  `githits-remote-mcp` repository in this increment; and
- adding schema-negotiation fallbacks, feature flags, retries, caches, queues, or
  other rollout machinery.

## Verified current state and evidence

### Backend contract

- The backend worktree's `priv/graphql/schema.graphql` defines:
  - `read(target: String!, path: String, startLine: Int, endLine: Int,
    waitTimeoutMs: Int): ReadResult`; and
  - `ReadResult = CodeContextResult | GetDocPageResult`.
- A trimmed nonempty `path` selects code. Omitted, empty, or whitespace `path`
  selects docs and preserves `target` as an opaque docs locator.
- The resolver delegates exactly once to the existing code or docs resolver. It
  preserves the existing result types, GraphQL error codes, indexing behavior,
  and source-specific validation, with no cross-source fallback.
- Backend usage records the canonical tool name `read` while retaining a dynamic
  docs/code-navigation group and replay locators.
- The candidate union query containing every field consumed by the current CLI
  and MCP readers validates against the committed schema.
- Focused backend request/resolver tests passed: 20 tests, 0 failures.
- `mix graphql.check` passed the allowlist, hash, and compatibility checks. The
  schema addition is additive.
- The user confirmed on 2026-09-14 that the change was deployed in development
  and going to production; implementation verification later confirmed the
  production endpoint serves both union branches.

### Pre-change client behavior

- `packages/mcp/src/tools/read.ts` advertises one `read` tool but dispatches code
  to `CodeNavigationService.readFile()` and docs to
  `PackageIntelligenceService.readPackageDoc()`.
- Those methods send `FETCH_CODE_CONTEXT_QUERY` and `READ_PACKAGE_DOC_QUERY`
  respectively from `packages/core-internal/src/services/`.
- `src/commands/read.ts` similarly dispatches compact reads into the existing
  source-specific CLI actions.
- The MCP code path caps the requested backend range to 150 lines by default or
  300 lines with an explicit end. Docs JSON keeps the backend selection while
  docs text is locally capped. Top-level CLI output remains uncapped for piping.
- The current code and docs queries contain a few legacy selections that the
  unified readers do not consume: code `repoUrl`/`gitRef` and docs
  `page.linkName`. The unified query must omit them and select only the fields
  listed in this plan under the matching inline fragments.
- `McpToolServices` is a public request-scoped dependency seam consumed by the
  separate `githits-remote-mcp` repository. Adding a required service changes
  that public TypeScript contract, and that host must construct the new client
  after it adopts the released package.

### Compatibility constraint

- `githits code read` and `githits docs read` are deprecated aliases but remain
  supported.
- `githits read --repo-url <url> [--git-ref <ref>] <path>` accepts a structured
  repository target. Git permits `#` in a ref, while the compact target grammar
  uses `#` as its ref delimiter and rejects a second delimiter. Therefore the
  structured form cannot be converted losslessly into the new compact backend
  argument.
- The user decided on 2026-09-14 that compatibility paths may keep the legacy
  GraphQL roots. This preserves valid inputs and deliberately leaves their
  usage distinguishable from canonical `read` traffic.

## Assumptions

- Backend `tool_name = "read"` is the intended canonical analytics dimension;
  source grouping remains available separately when docs/code breakdown is
  needed.
- Existing legacy-root usage can include callers outside this repository.
  Backend usage counts therefore measure the whole legacy API cohort, not a
  perfect command-by-command attribution unless existing client metadata is
  also applied.
- A source-breaking addition to the pre-1.0 public `McpToolServices` contract is
  released as a minor version. The coordinated CLI and MCP release policy keeps
  both artifacts on the same new minor.

## Resolved product decisions

- Compact advertised reads use `Query.read` with no legacy fallback.
- Deprecated `githits code read` and `githits docs read` continue using their
  existing source-specific services and GraphQL roots.
- Top-level `githits read --repo-url ...` continues using the legacy code root
  because its structured ref contract is not losslessly representable as a
  compact target.
- Legacy usage statistics will inform a future removal decision. This plan does
  not invent a cutoff, threshold, or removal schedule.
- No public read schema or output change is needed.

## Unknowns

- None block implementation.
- The later decision to remove compatibility surfaces remains intentionally
  open until usage evidence exists.

## Target architecture

### Ownership

`packages/core-internal` owns the unified transport client because it already
owns pkgseer GraphQL execution, authentication refresh, diagnostics, and neutral
service errors. A new `ReadService` is the correct boundary because `read`
spans code navigation and documentation. Neither existing source-specific
service naturally owns both branches.

CLI commands and MCP tools continue to own caller-specific validation, range
caps, presentation, and recovery actions. Source response normalization remains
shared with the existing code/docs clients rather than being copied into a
second divergent implementation.

The simpler-looking alternative—adding docs reads to `CodeNavigationService` or
code reads to `PackageIntelligenceService`—was rejected because it puts one
domain under the wrong owner. Modifying both existing methods to send the new
query was also rejected because compatibility callers must remain on the legacy
roots and the structured repo target is not losslessly serializable.

### Data flow

```text
Advertised MCP read / compact top-level CLI read
  -> existing locator and source-specific option validation
  -> existing MCP cap policy or uncapped CLI range policy
  -> ReadService.read({ target, path?, startLine?, endLine?, waitTimeoutMs? })
  -> one GraphQL Query.read request
  -> __typename + matching inline fragment
  -> existing source-specific normalized result
  -> existing source-specific payload builder, formatter, and error recovery

Deprecated code/docs commands / top-level CLI --repo-url compatibility mode
  -> existing source-specific service
  -> existing fetchCodeContext or getDocPage request
```

### Service contract

Add a transport-neutral service interface and implementation under
`packages/core-internal/src/services/`:

- input keeps the backend's compact shape: opaque `target`, optional `path`,
  optional line bounds, and optional code wait;
- output is a semantic discriminated union for code versus docs that contains
  the existing `ReadFileResult` or `PackageDocResult`, without leaking GraphQL
  `__typename` into presentation layers. Those result members are optional by
  contract; legacy-only optional `PackageDocPage.linkName` remains unset on the
  unified path rather than forcing a duplicate public DTO family;
- the implementation selects `__typename` and exactly these fields under
  `... on CodeContextResult`: `content`, `filePath`, `language`, `totalLines`,
  `startLine`, `endLine`, `isBinary`, `codeIndexState`, `indexingRef`,
  `availableVersions` (with its current subfields), `indexingEstimate` (with its
  current subfields), and `targetResolution` (with its current subfields).
  Index-state fields are consumed by current error/recovery handling even when
  they do not appear in a successful payload;
- the implementation selects exactly these fields under
  `... on GetDocPageResult`: `registry`, `packageName`, `version`, `sourceKind`,
  `contentRange { startLine endLine totalLines anchor }`, and
  `page { id docsReadTarget title content contentFormat breadcrumbs
  lastUpdatedAt sourceKind source { url label } repoUrl gitRef requestedRef
  filePath baseUrl }`;
- transport `__typename` must match the source selected by `path`; a mismatch or
  missing branch is a malformed-response error, never a cross-source retry;
- GraphQL, HTTP, transport, indexing, and malformed-response failures map to the
  existing source-specific error families selected from the request shape, so
  current CLI/MCP error envelopes and recovery actions remain unchanged;
- token refresh, client headers, cancellation behavior, safe diagnostics, and
  endpoint construction match the existing pkgseer service clients;
- the implementation sends the new query through `postPkgseerGraphql` directly,
  not `CodeNavigationServiceImpl.postGraphqlWithTargetResolutionFallback`.
  That existing helper retries narrower nested selections for old backend
  schemas; the new root instead has the full field list above as its explicit
  minimum schema. The legacy code service retains its current fallback; and
- existing source response schemas/normalizers are extracted to small internal
  shared modules only where necessary to avoid duplicating wire contracts.

Export the public `ReadService` type and `ReadServiceImpl` from
`@githits/mcp/client`, matching the existing location of
`CodeNavigationService`, `PackageIntelligenceService`, and their concrete
implementations. The main `@githits/mcp` entrypoint continues to export the
composite `McpToolServices` provider contract rather than adding one standalone
service-type export. Add required `readService` ownership to
`McpToolServices`, the root `Dependencies` container, public/local descriptor
fixtures, test service factories, and server/provider tests. Do not make the
property optional and do not add an old-provider fallback: producer-first
deployment and a minor release are the compatibility mechanism.

### Request and response invariants

- Pass compact `target` through unchanged after existing client validation.
- Keep the existing client compact-target parser as the public input-validation
  and output-identity boundary, while the backend parses the same unchanged
  target for execution. The required relation is one-way: every target accepted
  by the public client must be accepted by backend `ReadRequest`, but the backend
  may accept transports that the public compact grammar does not advertise.
  Add a shared-subset table covering scoped and Maven packages, unversioned
  packages, GitHub/Codeberg/nested-GitLab aliases, currently approved HTTP(S)
  forms, `#` and legacy `@` ref suffixes, refs containing `@`, and the existing
  malformed/conflicting suffix cases. Also pin that backend-only `git://`,
  `git+https://`, SSH, `git+ssh://`, and SCP-style transports remain rejected by
  the client. A client-accepted/backend-rejected disagreement is a contract
  defect, not a reason to normalize or silently retry a different target.
- Treat only a trimmed nonempty `path` as code; preserve docs targets, including
  URL fragments, as opaque strings.
- Forward code `waitTimeoutMs`; validate but omit it for docs, matching current
  behavior even though the backend accepts and ignores it.
- Preserve omission of optional variables rather than serializing accidental
  `null` values.
- Apply MCP code caps before the network call. Keep docs JSON uncapped by the
  client and docs text locally capped. Keep CLI reads uncapped unless the user
  provides a range.
- Select no new fields. In particular, do not add fields merely because the new
  union exposes them; GraphQL minimal-fetch behavior is part of the contract.
- Preserve all current text/JSON bytes and keys for equivalent mocked results.
- Keep the backend's exact indexed target resolution and docs read target in
  existing response builders so follow-up reads remain reproducible.

## Compatibility, rollout, and analytics

1. Confirm the verified backend `Query.read` contract is deployed to
   production. No CLI schema fallback is added.
2. Merge and release the coordinated CLI/MCP minor containing the required
   `ReadService` provider contract.
3. The local CLI and local stdio MCP use the new service immediately after that
   release.
4. The separate `githits-remote-mcp` host must then adopt the released
   `@githits/mcp`, construct `ReadServiceImpl` with the same request-scoped token,
   headers, fetch function, endpoint, and diagnostics policy, pass its tests,
   and deploy. Until that happens, hosted MCP continues running its currently
   published package and does not contribute canonical `read` usage.
5. Observe canonical `read` versus legacy `code_read`/`docs_read` usage. Treat
   the legacy counts as deprecation evidence, not as authorization to remove a
   surface. Any removal needs a separate product decision and plan.

Rollback is a normal package/host revert to the previous client version. There
is no feature flag or runtime negotiation path.

`GITHITS_CODE_NAV_URL` and its legacy `PKGSEER_URL` alias may point at a custom
package/source endpoint. After this client release, that endpoint must implement
the `Query.read` contract for compact `read` calls. Compatibility commands keep
working against the legacy roots, but they are not a fallback for an outdated
custom endpoint. State this minimum schema requirement in durable configuration
documentation and the release fragment.

## Phase map

### Phase 1 — client and MCP package adoption

- Status: **COMPLETE**
- Expected outcome: all compact unified reads from the local CLI, local stdio
  MCP, and consumers that supply the new public service dependency issue one
  backend `Query.read` request while compatibility entry points keep their
  existing roots and all caller-visible behavior remains stable.
- Assumptions: source-specific backend result/error contracts are unchanged
  behind the new resolver.
- Unknowns or product decisions: none.
- Dependencies: backend production deployment; a coordinated minor release is
  required before the hosted MCP consumer can adopt the new provider contract.

Implementation work:

1. Add the core `ReadService` interface, discriminated result, implementation,
   union GraphQL query, response validation, source-specific error mapping, and
   focused unit tests. Reuse extracted source schemas/normalizers where needed;
   do not duplicate the complete code/docs DTO mappings.
2. Export the type and implementation through core-internal and
   `@githits/mcp/client`, then add required `readService` construction to both
   root container authentication branches. Keep standalone service types on the
   client entrypoint; the main entrypoint exposes the composite provider type.
3. Change the advertised MCP `read` handler to call `readService` once after its
   existing source resolution and range policy. Refactor only the smallest
   source execution seam needed to reuse current payload builders, formatting,
   cancellation, and recovery code. Leave deprecated source tool helpers on
   their old services.
4. Change `src/commands/read.ts` so compact docs/code forms use `readService`.
   Keep the explicit `--repo-url` branch delegating to the existing
   `pkgReadAction`; keep deprecated code/docs commands unchanged. Reuse existing
   request, output, and error primitives instead of duplicating formatters.
5. Update `McpToolServices`, provider types/fixtures, descriptor services, local
   MCP services, and test factories to require the new dependency. Add
   compile-time/runtime coverage for request-scoped service composition.
6. Update durable documentation and add
   `changes/<unique-slug>.changed.md` with `minor` impact for both `githits` and
   `@githits/mcp`. Do not edit `CHANGELOG.md`.

Acceptance criteria:

- A code compact target sends exactly one GraphQL operation rooted at `read`
  with the unchanged target/path, effective line bounds, and wait timeout.
- A docs target sends exactly one GraphQL operation rooted at `read`, preserves
  the opaque target, forwards explicit line bounds, and omits code-only wait.
- Wire tests assert `__typename`, both inline fragments, exact variables, and
  the exact field lists above, including the absence of code `repoUrl`/`gitRef`
  and docs `linkName`.
- Contract tests reject missing, unknown, or request-mismatched union branches
  as malformed responses without retrying the legacy roots.
- Compact-target contract tests mirror the shared subset of backend
  `ReadRequest` package/repository fixtures and assert that every client-accepted
  input reaches GraphQL byte-for-byte unchanged. Separate cases preserve the
  client's rejection of backend-only Git/SSH transport forms; this increment
  must not expand the public compact grammar.
- Auth refresh and source-specific HTTP/GraphQL/indexing errors map to the same
  public CLI/MCP errors and recovery actions as before.
- MCP code limits, docs text limits, docs JSON behavior, cancellation, and all
  text/JSON output remain unchanged.
- `githits read --repo-url ...`, `githits code read`, and `githits docs read`
  still invoke their original services; include explicit regression tests that
  prove those calls do not use `ReadService`.
- Root container tests cover both environment-token and stored-token service
  construction. Public MCP server/provider and descriptor fixtures require the
  new service without executing it during descriptor discovery.
- `docs/implementation/unified-read.md` explains the backend operation,
  canonical/legacy analytics boundary, `#` ref compatibility reason, and hosted
  MCP rollout dependency. Update `docs/implementation/tools.md`,
  `docs/implementation/config.md`, and public MCP client/provider examples for
  the service ownership and minimum custom-backend schema requirement.
- A release fragment records a coordinated minor for both public artifacts.

Required verification:

- focused new core service tests, including exact GraphQL body/variables and
  both union branches;
- focused MCP `read` tests and CLI `read`/deprecated compatibility tests;
- MCP server/provider, descriptor, local-server, container, export-map, and
  public-package validation tests affected by the required service;
- `bun test`;
- `bun run typecheck`;
- `bun run format:check` and `bun run lint`;
- `bun run build`;
- `bun run validate:packages` and
  `bun run validate:packages:mcp-publish`;
- `bun run smoke:cli` and `bun run smoke:mcp`;
- after build, `bun run smoke:cli:built` and `bun run smoke:mcp:built`; and
- an authenticated compact code read and docs read against the deployed
  environment when credentials are available through the repository's
  secret-safe smoke workflow. Report authenticated coverage as skipped if it is
  unavailable; never expose credentials.

`bun run agent:e2e` is not required because this phase does not change MCP
instructions, descriptors, schemas, output, or agent-facing behavior. If the
implementation changes any of those surfaces despite the plan, that is a scope
contradiction: stop, update the plan, and add targeted agent evals.

Verification outcome on 2026-09-14:

- `bun test`: 4,742 passed, 0 failed;
- typecheck, formatting, lint, build, public-package validation, MCP publish
  validation, and both built smoke suites passed;
- authenticated built CLI and local MCP compact code and docs reads passed
  against the production endpoint, confirming both `Query.read` branches;
- the broad live CLI smoke completed its relevant unauthenticated registration
  and read checks, then stalled on the unrelated REST `languages` probe and was
  interrupted; the broad live MCP smoke likewise passed registration checks,
  then timed out on the unrelated REST `search_language` probe. The focused
  authenticated reads above isolate and verify the changed GraphQL path. No
  timer or retry workaround was added for the separate REST endpoint; and
- `bun run agent:e2e` remained out of scope because no descriptor, schema,
  instruction, output, or other agent-facing behavior changed.

## Cross-repository handoff

This plan deliberately stops at the published CLI/MCP package boundary. After
the package release, the hosted service owner must update
`githits-remote-mcp/src/services/request-services.ts` and its tests to construct
the newly required `ReadServiceImpl`, then follow that repository's dependency
bump and dev/production smoke workflow. Do not claim hosted analytics migration
complete until that deployment is verified.

The public API and Python backend can independently migrate to `Query.read` once
the producer is in production. Their traffic will remain visible in the legacy
cohort until they do; changing them is not part of this CLI increment.

## Completion and durable documentation

Keep this plan through implementation and review. After the final increment is
merged, transfer any corrected contracts and verification evidence into
`docs/implementation/unified-read.md` (and other affected implementation docs),
then delete this temporary plan. Do not leave the plan as permanent API
documentation.
