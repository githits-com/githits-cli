# Authentication error recognition

Status: implementation, verification, and internal/Claude review complete.
Scope approved on 2026-09-08, including
verification of actual backend and Supabase error contracts.

## Outcome and verified state

The original CLI required specific description phrases alongside a structured
OAuth `invalid_grant` response before treating refresh credentials as rejected.
RFC 6749 section 5.2 defines that error code independently of its optional
description. Recognize it without wording dependencies so subsequent calls do
not repeatedly try rejected refresh credentials.

The classifier accepts only `TokenRefreshError` with a 4xx status.
`TokenManager` reloads credentials after failure, then conditionally clears only
the active backend's unchanged tokens. Invalid-client cleanup is separate.
Token-response validation already rejects malformed expiry values and accepts
positive numeric strings; that policy remains in place.

The backend audit verified that MCP OAuth metadata forwards Supabase's discovery
document. Supabase's OAuth refresh handler returns native HTTP errors as well as
OAuth errors: legacy `error_code`/`msg` plus numeric `code`, or versioned string
`code`/`message`. Public source locators are recorded in `docs/implementation/auth.md`.
Refresh-token absence/reuse and session absence/expiry need explicit code handling.
No production refresh credentials were used to verify this contract.

API-side authentication is a separate layer: REST returns HTTP 401 and
package/source GraphQL returns `AUTHENTICATION_REQUIRED`. Package intelligence
and target resolution already recognize that code; general code navigation
recognized only `UNAUTHORIZED` and required the same mapping. `codeDiff` already
had an explicit authentication boundary. Access-denied responses remain separate.

## One implementation phase

Status: implemented. Dependencies: existing auth service and storage interfaces.
Assumptions: deployed services follow the verified source contracts; their exact
deployed revisions were not probed.
Unknowns and product decisions: none.

1. Add classifier and token-manager regression tests before changing behavior.
2. Recognize structured `invalid_grant` before description-based client hints;
   recognize the four verified Supabase refresh-token/session rejection codes
   in both native envelopes. Retain typed-error and HTTP-status boundaries.
   Add no new phrase fallback.
3. Verify rejected-token cleanup, client-registration retention, transient-error
   preservation, storage reload, and conditional-clear conflict handling.
4. Map general code-navigation `AUTHENTICATION_REQUIRED` to its existing auth
   refresh path, verifying one refresh maximum and no refresh for `FORBIDDEN`.
   Update permanent auth documentation and independent release fragments.
5. Remove the broken Smithery badge from `README.md` as requested.
6. Run unit tests, typecheck, lint, formatting, build, plugin generation/check,
   and CLI/MCP smoke tests using their isolated unauthenticated modes. Agent
   discovery evals do not exercise this local OAuth failure path; descriptors,
   instructions, and tool schemas are unchanged.
7. Complete internal and Claude reviews, record actual validation, commit, and
   open a draft PR. Keep this plan available through implementation review.

## Boundaries and acceptance

Production changes belong to the existing refresh parser/classifier in
`src/services/auth-service.ts` and GraphQL error mapping in
`packages/core-internal/src/services/code-navigation-service.ts`.
Injected auth/storage mocks verify token-manager
behavior without contacting a real OAuth server or touching real credentials.
No new dependencies, network requests, query selections, storage schema, or
container changes are needed. Runtime cost is constant. Reverting the classifier
change restores prior behavior without migration.

Acceptance: description-free and unfamiliar-description grant rejections are
terminal; client hints cannot override an explicit grant rejection; non-refresh,
non-4xx, and phrase-only grant-like errors remain nonterminal. Rejected tokens
are conditionally cleared without removing the client registration or newer
credentials. Existing expiry and transient-failure tests remain green. The
README no longer contains the broken badge. Both CLI and `@githits/mcp` release
impact are patch because the code-navigation mapping is shared. Supabase refresh
parsing itself belongs only to the CLI and its local MCP composition.

Automatic transport retries and broader OAuth parsing changes are out of scope.
Any review finding that changes those boundaries requires reorientation against
the approved outcome. Completion requires clean review and recorded evidence.

## Verification and review evidence

- Red/green: initial grant handling produced 7 expected failures before the fix;
  native Supabase fixtures produced 4 expected failures before parser support;
  `AUTHENTICATION_REQUIRED` produced 1 expected failure before mapping it.
- `bun test src packages`: 4,102 passed, 0 failed, 14,059 expectations across
  186 files in 28.81 seconds, including expiry, transient-failure, active-backend,
  concurrency, and auth-envelope regression coverage.
- `bun run typecheck` passed. `bun run lint` passed with 12 pre-existing warnings
  and one informational diagnostic in unchanged repository-target files.
- `bun run format:check` encountered Windows checkout CRLF differences. A
  temporary source snapshot with only line endings normalized and the changed
  TypeScript files overlaid passed `biome format .` for all 466 files.
- `bun run build` passed. The MCP build hit a Bun 1.3.9 Windows path assertion;
  `npx --yes bun@1.4.2 --bun run --cwd packages/mcp build` passed. CI uses latest
  Bun. `npx --yes bun@1.4.2 --bun run validate:packages` passed, exercising packed
  package consumers outside workspace path aliases.
- `bun run plugins:generate` and `bun run plugins:check` generated/validated
  10 assets with no content changes.
- `bun run smoke:cli --mode unauthenticated` passed all 24 steps;
  `bun run smoke:mcp --mode registration` passed all 8 stable/experimental steps.
- Unrestricted `bun test` encountered unrelated agent-eval-suite Windows
  `EBUSY` cleanup and agent-eval global-instruction isolation failures, then
  stalled. That process was stopped; the complete product suites above passed.
- Internal review: initial and expanded deltas both returned no findings.
- Claude round 1: one accepted low finding. The legacy Supabase `msg` field was
  recognized for classification but absent from the shared user-message field
  list. Added it to `OAUTH_ERROR_DETAIL_FIELDS`; the constructor, registration,
  and code-exchange callers all use that list. A real legacy-envelope regression
  failed before the fix and passed afterward, preserving bounded single-line
  detail and nonterminal 5xx behavior. The three auth unit/integration files
  passed 116 tests and 317 expectations after this fix.
- Claude round 2: no correctness findings. Accepted its minor observation that
  the doctor recommendation attributed every refresh rejection to reuse/expiry.
  Generalized it to server-rejected refresh credentials and removed the
  unsupported concurrency diagnosis. Updated the matching auth documentation;
  a bounded source/documentation scan found no other copies. Doctor tests passed
  18 tests / 57 expectations; its Biome check, root build, and all 24 CLI smoke
  steps passed after the copy change. Internal and Claude round 3 reviews clean.
  The remaining observation about trimming hypothetical whitespace in error
  codes needs no change: verified OAuth/Supabase codes are exact enum values,
  and no affected server response was demonstrated.
- No production credentials or deployed refresh sessions were used for validation.
