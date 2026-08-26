# Plan: Phase 2 browser/WebMCP boundary

## Status

Phase 1 is complete. Core service clients now accept optional host-supplied
`ServiceDiagnostics`; core and MCP have no diagnostics output implementation;
the CLI owns telemetry/debug lifecycle; MCP error mapping is pure; and public
MCP artifacts are checked for the removed filesystem edge. The implementation
was verified with targeted service, mapper, CLI, container, MCP, and typecheck
suites.

This document is now only the forward-looking Phase 2 plan. It intentionally
does not claim browser or WebMCP compatibility.

## Objective

Build a real browser-target WebMCP proof of concept from the smallest useful
GitHits descriptor, schema, handler, and HTTP-client surface. Keep Node-only
CLI and remote-server conveniences behind explicit host entrypoints or
injected values. Choose the public browser export boundary from the observed
dependency graph rather than from source assumptions.

## Verified remaining blockers

Filesystem access has been removed from core and packed MCP artifacts, but the
remaining direct host assumptions still require investigation:

- `node:crypto` in core PKCE helpers for CLI verifier, state, and challenge
  generation.
- `node:crypto`, `process`, and `Buffer` in core request headers for session
  hashing/fallback, agent detection, and byte limits.
- `process.env` in core config helpers for Node/CLI URL and token defaults.
- `node:async_hooks` in MCP error options for request-local auth remediation
  text.
- `process.stdout`, `process.env`, and `Buffer` in MCP text formatting for
  terminal width/color defaults and UTF-8 byte limits.
- The MCP SDK package advertises a Node engine and has Node-specific
  subpaths/dependencies; importing its Node server path does not establish
  browser safety.

These are verified inventory findings, not a compatibility claim. The Phase 2
PoC must re-check the resolved graph because dependency versions and imports
can change.

## Verified remaining ownership issue

Core recovery prose still names CLI commands and environment variables. This
includes the schema-mismatch examples `githits update-check` and
`GITHITS_DEBUG`, plus the terms-acceptance helper at
`packages/core-internal/src/shared/terms-acceptance.ts:19`, which names
`githits settings terms accept`. The root correction is to move host-specific
remediation to host mapping. Phase 1 did not change this runtime prose; Phase
2 should address it at that host boundary.

## Open decisions

- Should browser support use a new public subpath, or should an existing public
  entry become browser-safe?
- Which MCP SDK modules, if any, belong in the browser entry after a real
  browser-target dependency trace?
- Should remote Node convenience helpers remain in `@githits/mcp/client`, or
  move to an explicit Node-specific entry?
- Which descriptors/handlers are in the first WebMCP PoC, and what browser
  bundler/target is the compatibility gate?

## Rolling-wave implementation

1. Build a minimal browser-target probe from the exact descriptors, schemas,
   handlers, and concrete HTTP clients the WebMCP adapter will import. Record
   every remaining GitHits and third-party Node edge in the probe output.
2. Move CLI-only PKCE generation out of core or behind a host-provided crypto
   implementation, preserving the CLI behavior.
3. Split request-header formatting from Node terminal/session discovery; inject
   precomputed session identity and use web-standard byte counting where
   needed.
4. Split pure URL validation/default constants from `process.env` config
   resolution and make browser configuration explicit.
5. Replace MCP `AsyncLocalStorage` auth-action propagation with explicit
   request-handler closure/context threading if the selected browser surface
   reaches it.
6. Make terminal color/width defaults explicit at the formatter host boundary;
   browser handlers must not infer terminal output settings.
7. Trace the selected MCP SDK imports in the browser target and isolate Node
   server transport code from descriptor/handler reuse.
8. Decide the public browser export only from the completed dependency trace,
   then add a browser build/import test with no Node polyfills.

## Acceptance criteria

- The chosen browser entry builds for the recorded browser target with no Node
  built-ins or Node polyfills in its resolved graph.
- A browser-target test imports the chosen descriptor/handler surface and
  executes one representative tool call against mocked `fetch`.
- Node CLI and remote MCP entrypoints retain their current behavior and remain
  separately validated.
- The public export decision and every intentionally retained host boundary are
  documented with the probe evidence.

## Constraints

- Do not infer WebMCP support from a Node-target bundle or from package
  dependency declarations alone.
- Do not remove Node assumptions globally before the PoC identifies the exact
  browser import set.
- Do not add a general runtime abstraction, logger bridge, polyfill bundle, or
  compatibility claim without a verified need from the browser probe.
