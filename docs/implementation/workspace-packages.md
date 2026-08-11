# Workspace Packages

The repository now has a Bun workspace scaffold under `packages/*`, while the
root package remains the publishable `githits` package until the CLI source and
manifest move is complete.

## Current Layout

- `packages/core-internal` is private and source-exported. It owns the
  transport-neutral API clients, shared request/header/telemetry primitives,
  neutral service errors, PKCE helpers, and `TokenProvider` contract.
- `packages/mcp` is the public `@githits/mcp` package boundary. Its public root
  export is intentionally small: transport-neutral MCP server factory, tool
  registration, static tool descriptors, instructions, and MCP-facing types. It
  builds from `packages/mcp/src/index.ts` to `dist/` and bundles private
  core-internal source into its artifacts.
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

- External consumers, including the future remote MCP server repo, must import
  only from `@githits/mcp`, `@githits/mcp/client`,
  `@githits/mcp/smoke-test`, and `@githits/mcp/package.json`.
- `@githits/mcp/client` is the public runtime/client entry for remote MCP server
  composition. It re-exports bundled service implementations, token/header
  helpers, URL/config helpers, telemetry helpers, and registry helpers without
  publishing `@githits/core-internal`.
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

- `CHANGELOG.md` continuously records pending changes and the required SemVer
  impact for every public artifact. See
  `docs/implementation/release-process.md` for entry and release-finalization
  rules.
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
- The MCP package build settings live in `packages/mcp/bunup.config.ts`. Its
  runtime externals are the MCP SDK and Zod; `@githits/core-internal` is resolved
  and bundled into JS/declaration output so the packed public package does not
  reference private workspace internals.

## Dependency Notes

- `src/commands/init/**` imports `@inquirer/core` directly for
  `ExitPromptError`, so it is a direct root dependency.
- Keep `@inquirer/checkbox`, `@inquirer/confirm`, `@inquirer/select`, and
  `@inquirer/core` pinned to the validated release set (`5.2.1`, `6.1.1`,
  `5.2.1`, and `11.2.1` currently) unless prompt abort handling is changed to
  avoid `instanceof` checks across package copies.
