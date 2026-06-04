# Workspace Packages

The repository now has a Bun workspace scaffold under `packages/*`, while the
root package remains the publishable `githits` package until the CLI source and
manifest move is complete.

## Current Scaffold

- `packages/core-internal` is private and source-exported.
- `packages/mcp` is private for now and source-exported through `./src/index.ts`.
- `packages/cli` is a private placeholder package; the public `githits` manifest
  still lives at the repository root.
- Root TypeScript path aliases exist for workspace development imports:
  `@githits/core-internal` and `@githits/mcp`.

## Build Lessons

- Do not publish a package that still references `@githits/core-internal`,
  `core-internal`, source aliases, or `workspace:*` in shipped artifacts.
- Public package builds that consume private workspace source must bundle private
  source, not externalize it. The validated direction is `--packages=bundle` plus
  explicit `--external` entries for real third-party dependencies.
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

## Dependency Notes

- `src/commands/init/**` imports `@inquirer/core` directly for
  `ExitPromptError`, so it is a direct root dependency.
- Keep `@inquirer/prompts` and `@inquirer/core` pinned to the validated pair
  (`8.4.3` and `11.1.10` currently) unless prompt abort handling is changed to
  avoid `instanceof` checks across package copies.
