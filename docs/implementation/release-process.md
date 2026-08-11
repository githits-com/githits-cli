# Release Process

## Public Artifacts

This repository currently releases two independently versioned public npm
artifacts:

- `githits`, whose version also owns the generated plugin and assistant
  manifests and the `com.githits/githits` MCP registry entry
- `@githits/mcp`, the reusable transport-neutral MCP package

Add future independently versioned public artifacts, including an SDK, to this
document and the changelog impact table when their package manifests are added.
Private workspace packages do not receive changelog rows or release versions.

## Continuous Changelog

`CHANGELOG.md` is the source of truth for curated release communication. Keep a
single `## [Unreleased]` section at the top and update it in the same change as
every notable user-, agent-, operator-, or public-API-visible change. Do not wait
until release preparation to reconstruct the whole release from commit history.

The unreleased section contains:

1. A release-impact table with every public artifact, its current published
   version, its pending SemVer bump (`none`, `patch`, `minor`, or `major`), and a
   short reason.
2. `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`
   subsections as needed.
3. Entries that identify the affected artifact when the scope is not obvious
   and explain user impact, compatibility, migration, or operational action.

The highest required bump for an artifact wins. Keep `none` explicit for
unaffected artifacts; that is the signal that an independent package release is
not required. When another public package is added, add its row immediately so
cross-package impact cannot remain implicit.

Exclude internal refactors, test-only changes, development-dependency updates,
and generated-file churn unless they materially affect behavior, security,
performance, reliability, packaging, or release operation. GitHub-generated
release notes remain useful PR-level detail, but they do not replace the curated
changelog.

## Historical Entries

Dated, versioned changelog sections are historical records. Do not rewrite,
reclassify, expand, or remove their entries after release. An omitted minor
detail, improved wording, or a later change in preferred terminology is not a
reason to edit release history.

Change a historical entry only when it contains a blatant, demonstrable factual
error, such as the wrong artifact, version, release date, shipped behavior,
compatibility statement, or migration requirement. Make the smallest correction
that restores factual accuracy. If the error could mislead current users or
operators, also describe the correction in `Unreleased`; do not silently rely on
the historical edit to communicate new guidance.

## Package Impact Rules

Use the verified changed surface, not the workspace location alone, to decide
release impact:

- Bump `githits` for CLI behavior, local auth or setup, local stdio startup,
  root package APIs, packaged plugin/assistant assets, or root runtime
  dependency changes.
- Bump `@githits/mcp` only for its public API, tool behavior, MCP instructions,
  schemas, MCP auth/error behavior, or remote-server-facing public types.
- A shared implementation change can require both bumps when it changes both
  shipped artifacts. CLI-only use of shared code does not by itself require an
  MCP bump.
- Documentation-only changes normally require no package bump. Public Agent
  Skills are also read from `main`; when their packaged behavior changes, state
  explicitly whether the next `githits` artifact must carry the same update.

Before assigning `none`, compare the delta against every public consumer and
package export. The release-impact table records the conclusion; it does not
replace that review.

## Release Preparation

For each artifact being released:

1. Inspect the complete package-specific tag-to-HEAD delta (`vX.Y.Z` for
   `githits`, `mcp-vX.Y.Z` for `@githits/mcp`) and reconcile it with
   `CHANGELOG.md`.
2. Confirm the pending bump matches the actual public surface and that every
   notable entry states required migration or compatibility effects.
3. Bump only the affected package manifests. For a root release, also update
   `server.json` and regenerate every plugin/assistant manifest.
4. Move each shipped artifact's entries into its own
   `## [<artifact> <version>] - YYYY-MM-DD` section. Keep separate sections for
   coordinated releases so each package tag has unambiguous notes.
5. Leave a fresh `## [Unreleased]` section with all current versions and
   pending bumps reset to `none`.
6. Run the release skill checklist, package validation, tests, build, and the
   smoke or agent evaluations required by the changed surfaces.

The version-boundary test requires release sections for the versions currently
declared in both public package manifests. A version bump without a matching
changelog section must fail before release.
