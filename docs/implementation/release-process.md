# Release Process

## Public Artifacts

This repository currently releases two independently versioned public npm
artifacts:

- `githits`, whose version also owns the generated plugin and assistant
  manifests and the `com.githits/githits` MCP registry entry
- `@githits/mcp`, the reusable transport-neutral MCP package

Add future independently versioned public artifacts, including an SDK, to this
document and the changelog fragment schema when their package manifests are
added. Private workspace packages do not receive changelog impact entries or
release versions.

## Changelog Fragments

Every notable user-, agent-, operator-, or public-API-visible change owns one
independent file under `changes/` following `changes/README.md`. Normal pull
requests do not edit `CHANGELOG.md`; only release preparation consolidates the
fragments into versioned release sections.

Each fragment contains:

1. YAML front matter naming every public artifact and its pending SemVer impact
   (`none`, `patch`, `minor`, or `major`).
2. One concise Markdown bullet whose category comes from the filename suffix:
   `added`, `changed`, `deprecated`, `removed`, `fixed`, or `security`.
3. User impact, compatibility, migration, or operational action, identifying
   the affected artifact when the scope is not obvious.

Keep `none` explicit for unaffected artifacts; that is the signal that an
independent package release is not required. When another public package is
added, add it to `changes/README.md`, fragment validation, and every new
fragment so cross-package impact cannot remain implicit. The highest impact
across an artifact's fragments determines its release bump.

A fragment with non-`none` impact on multiple artifacts is atomic: release all
of those artifacts together or leave the fragment untouched. A fragment with
`none` for every artifact records repository or release-operation impact; it
does not trigger a release and is consumed into the next `githits` release.

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
operators, also add a fragment for the correction; do not silently rely on the
historical edit to communicate new guidance.

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
package export. A fragment's impact records the conclusion; it does not replace
that review.

## Release Preparation

For each artifact being released:

1. Inspect the complete package-specific tag-to-HEAD delta (`vX.Y.Z` for
   `githits`, `mcp-vX.Y.Z` for `@githits/mcp`) and reconcile it with
   all files in `changes/`; fragments do not replace range review.
2. Confirm each fragment's impact matches the actual public surface, compute
   the highest pending bump for each artifact, and verify every notable entry
   states required migration or compatibility effects.
3. Bump only the affected package manifests. For a root release, also update
   `server.json` and regenerate every plugin/assistant manifest.
4. Group each affected artifact's fragment entries by category into its own
   `## [<artifact> <version>] - YYYY-MM-DD` section. Keep separate sections for
   coordinated releases so each package tag has unambiguous notes. Exclude an
   entry from artifacts marked `none`; include all-`none` repository entries in
   the root `githits` section.
5. Delete every consumed fragment. Leave fragments unrelated to the artifacts
   being released untouched, and never partially consume a cross-artifact
   fragment.
6. Run the release skill checklist, package validation, tests, build, and the
   smoke or agent evaluations required by the changed surfaces.

The release-boundary tests validate fragment names, front matter, and body
shape during development, and require release sections for the versions
currently declared in both public package manifests. A version bump without a
matching changelog section must fail before release.
