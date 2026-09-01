# Workspace Packages

The repository now has a Bun workspace scaffold under `packages/*`, while the
root package remains the publishable `githits` package until the CLI source and
manifest move is complete.

## Current Layout

- `packages/core-internal` is private and source-exported. It owns the
  transport-neutral API clients, shared request/header primitives, the
  host-supplied `ServiceDiagnostics` contract, neutral service errors, PKCE
  helpers, and `TokenProvider` contract. It does not own diagnostics environment
  discovery, process lifecycle, or output destinations.
- `packages/mcp` is the public `@githits/mcp` package boundary. Its public root
  export is intentionally small: transport-neutral MCP server factory, tool
  registration, static tool descriptors, instructions, and MCP-facing types. It
  builds from `packages/mcp/src/index.ts` to `dist/` and bundles private
  core-internal source into its Node-oriented artifacts. Its separate
  `@githits/mcp/tools` entry exposes the selected browser-callable
  `get_example` surface; that entry has its own narrow resolved runtime graph.
- `packages/cli` is a private placeholder package; the public `githits` manifest
  still lives at the repository root.
- Root TypeScript path aliases exist for workspace development imports:
  `@githits/core-internal`, `@githits/mcp`, and workspace-only
  `@githits/mcp/internal`.
- Root `src/services/**` still owns CLI/local integrations: filesystem-backed
  auth storage, keychain/keyring adapters, browser login, prompts, update checks,
  and the storage-backed `TokenManager`. `TokenManager` implements core's
  `TokenProvider` contract.
- Root CLI and local stdio MCP startup still live under `src/**` until the CLI
  package move. They import moved command helpers from workspace-only
  `@githits/mcp/internal`; the root build bundles that source, so the published
  `githits` artifact must not contain the internal import path.
- Root CLI/MCP code imports moved core modules through the bare
  `@githits/core-internal` package export. Do not import moved modules through
  stale `src/services/**`, `src/shared/**`, or `src/auth/**` paths.

## Public API Boundaries

- The production `remote-mcp` server consumes the published `@githits/mcp`
  package for tool registration, descriptors, `quick_start`, and tool logic.
  It supplies the hosted transport, request-scoped service composition,
  auth/session handling, deployment, and observability rather than duplicating
  package-owned behavior.
- External consumers, including the `remote-mcp` repository, must import only
  from `@githits/mcp`, `@githits/mcp/client`,
  `@githits/mcp/smoke-test`, `@githits/mcp/tools`, and
  `@githits/mcp/package.json`.
- `@githits/mcp/tools` is the browser-callable proof-of-concept boundary. It
  bundles the selected tool implementation and keeps Zod as its runtime
  dependency. Only this resolved `/tools` graph is browser-safe; installing
  `@githits/mcp` still brings the package's MCP SDK and Node-oriented
  dependency tree, while the root and `/client` entries remain Node entries.
  The `/tools` entry supplies no filesystem access, authentication
  implementation or storage, environment/config discovery, or other host
  behavior.
  Runtime-graph isolation is sufficient for the current browser-callable proof
  of concept; it is not a claim of install-time dependency-tree purity. If
  install-time purity becomes a requirement, the callable contract should move
  to a separate public browser SDK/package. That remains an open
  package/release-boundary decision, not an approved plan.
- `@githits/mcp/client` is the public runtime/client entry for remote MCP server
  composition. It re-exports bundled service implementations, token/header
  helpers, URL/config helpers, the injectable `ServiceDiagnostics` type, and
  registry helpers without publishing `@githits/core-internal`. Clients are
  silent by default; hosts own diagnostics implementations and destinations.
  The removed module-global telemetry lifecycle helpers are not part of this
  entry.
- `@githits/mcp/smoke-test` is the public validation-helper entry for remote MCP
  servers. It re-exports the shared smoke runner and assertions used by the
  local CLI smoke script without requiring local stdio startup.
- `@githits/mcp/internal` is not a package export. It exists only as a root
  workspace TypeScript alias for CLI transition code and internal tests.
- If remote MCP server setup needs a helper that currently lives behind
  `@githits/mcp/internal`, promote the smallest stable API through
  `packages/mcp/src/index.ts` rather than importing the internal alias.
- Local stdio MCP may use CLI-specific auth guidance such as `githits login`;
  remote MCP must use remote-appropriate auth guidance and must not assume local
  keychain, filesystem token storage, or Commander commands.

## Release Boundaries

- Independent files under `changes/` record pending changes and the required
  SemVer impact for every public artifact. `CHANGELOG.md` is updated only during
  release preparation. See `docs/implementation/release-process.md` for
  fragment and release-finalization rules.
- Root `githits` and public `@githits/mcp` releases are independent. Coordinated
  releases are allowed, but version equality is not required.
- When both are released together, keep the MCP minor aligned with the CLI minor
  for discoverability. The first MCP release for a CLI minor starts at
  `X.Y.0`; further MCP-package-visible changes in that CLI minor bump the MCP
  patch. Do not bump MCP just for CLI-only changes.
- CLI-only changes should update only the root `githits` version and its
  plugin/assistant manifests.
- `@githits/mcp` should bump only when its public API, tool behavior, MCP
  instructions, schemas, MCP auth/error behavior, or remote-server-facing types
  change.
- Release tags should use distinct namespaces so reruns and release notes stay
  unambiguous. Keep root `githits` on `vX.Y.Z`; use an MCP-specific tag namespace
  such as `mcp-vX.Y.Z` or `@githits/mcp@X.Y.Z` for MCP package releases.
- Successful `Main` workflow runs on `main` trigger both root and MCP release
  workflows. The MCP release workflow validates package artifacts, skips publish
  when the current `@githits/mcp` version is already on npm, and otherwise mints
  `mcp-vX.Y.Z`, publishes the package, and creates the GitHub Release. Manual
  dispatch remains for dry runs and recovery.

## Build Lessons

- Do not publish a package that still references `@githits/core-internal`,
  `core-internal`, source aliases, or `workspace:*` in shipped artifacts.
- Public package builds that consume private workspace source must bundle private
  source, not externalize it. The validated direction is `--packages=bundle` plus
  explicit `--external` entries for real third-party dependencies.
- The root `githits` build is configured this way before runtime source moves so
  temporary imports from private workspace packages are bundled into the existing
  root package instead of shipping private workspace references.
- The root build settings live in `bunup.config.ts`. It derives Bunup externals
  from root `dependencies` as `RegExp` subpath patterns, while deriving private
  workspace package exclusions and declaration resolution targets from
  `packages/*/package.json` so those imports still bundle into public artifacts.
  Bunup string wildcard entries did not externalize MCP SDK subpaths in
  validation.
- Bunup declaration generation cannot mix simple `--dts` with object-form
  `--dts.resolve`; use object-form flags such as `--dts.entry` when resolving
  private workspace declarations.
- Declaration output must resolve every workspace layer that should disappear
  from public artifacts. For MCP builds this means resolving both `@githits/mcp`
  and `@githits/core-internal` when validating a consumer-facing bundle.
- Minify whitespace or otherwise strip generated source-path comments before
  scanning JS output for private package names, because bundled output can include
  source path comments such as `packages/core-internal/...`.
- Validate package-boundary behavior from outside the repo root or without root
  `tsconfig` path aliases. A root-local entry can pass by resolving aliases and
  bypassing package manifest wiring.
- Scan both public package artifacts. Root `githits` is still public and bundles
  workspace MCP/core source during the transition, so root `dist/**`, root packed
  tarballs, MCP `dist/**`, and MCP packed tarballs must be checked for private
  workspace imports, `workspace:*`, and internal aliases.
- Keep artifact scans strict for code, declaration files, and manifests. README
  or docs may mention internal paths only as approved boundary warnings.
- The public-package validator separately scans non-test core TypeScript source
  for static filesystem imports and direct `process.stderr`/`process.stdout`
  access, then scans built and packed MCP code for static filesystem imports.
  It also bundles the packed MCP root, client, and smoke-test entries with a
  Node target and inspects each resolved import graph. This is a static
  string-literal/import-graph guardrail, not a browser-compatibility claim and
  not a ban on the root CLI's host-only filesystem code.
- The MCP package build settings live in `packages/mcp/bunup.config.ts`. Its
  runtime externals are the MCP SDK and Zod; `@githits/core-internal` is resolved
  and bundled into JS/declaration output so the packed public package does not
  reference private workspace internals.
- The packed-package validator installs the actual MCP tarball in an external
  temporary consumer. It typechecks and executes `@githits/mcp/tools`, checks
  `dist/tools.js` and `dist/tools.d.ts`, then builds a consumer that imports
  only `/tools` for a browser target. Its metafile and emitted output reject
  Node builtins/polyfills, MCP SDK runtime edges, Node globals, private aliases,
  and `workspace:*`; the same validator retains the root, `/client`, and
  `/smoke-test` consumer checks.

## Dependency Notes

- `src/commands/init/**` imports `@inquirer/core` directly for
  `ExitPromptError`, so it is a direct root dependency.
- Keep `@inquirer/checkbox`, `@inquirer/confirm`, `@inquirer/select`, and
  `@inquirer/core` pinned to the validated release set (`5.2.1`, `6.1.1`,
  `5.2.1`, and `11.2.1` currently) unless prompt abort handling is changed to
  avoid `instanceof` checks across package copies.
