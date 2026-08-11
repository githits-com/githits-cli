# Plan: Untrusted text control-sequence sanitization

## Goal

Prevent untrusted backend or caller-provided metadata from emitting ANSI, OSC,
C0, C1, or DEL control sequences through GitHits human/agent text formatters.
Preserve normal Unicode and printable text, existing formatter-owned ANSI
colors, JSON payloads, and raw source/document content contracts.

This work follows the local `sanitizeTerminalText` fix added for `githits
resolve`. It remains a separate increment because it spans existing CLI and
public MCP formatter contracts beyond target resolution.

## Verified issue

`packages/mcp/src/shared/resolve-target-response.ts` strips complete CSI, OSC,
and two-byte escape sequences followed by residual C0/C1/DEL controls from
candidate descriptions, canonical keys, repository links, command arguments,
and no-result names. Regression coverage proved that unsanitized values could
emit terminal styling, fake hyperlinks, title changes, and line rewriting.

The same class of untrusted metadata is rendered without equivalent sanitization
elsewhere:

- package summary identity, description, repository metadata, topics,
  advisories, and recent changes;
- vulnerability identities, summaries, aliases, ranges, fixes, and upgrade
  paths;
- dependency names, versions, constraints, groups, conflicts, and importers;
- upgrade-review deprecation, compatibility, advisory, changelog, and dependency
  evidence;
- changelog versions, URLs, headings, and rendered preview lines;
- caller/request echoes such as requested versions, lifecycle/filter values,
  changelog addressing, repository URLs, and version ranges;
- code/docs/search metadata, mapped errors, and language names.

The package formatters are shared by CLI and MCP text surfaces. Removing control
sequences from metadata on both surfaces is intentional: these controls are not
semantic package data, and downstream MCP clients may display text directly.
Structured JSON remains unchanged and continues to preserve backend strings via
JSON escaping.

## Assumptions

1. Backend, registry, and caller-provided metadata is untrusted even when it
   passed request or transport schema validation; schemas validate shape, not
   terminal safety.
2. Control characters have no valid meaning in package identity or metadata
   fields. Newlines used for layout are owned by formatters, not backend values.
3. Raw file contents, documentation bodies, and grep source lines have a
   different contract: callers may redirect or otherwise consume them as source
   content. They cannot use the metadata sanitizer without an explicit product
   decision.
4. Removing controls from shared package text output is a security hardening
   change, not a reason to alter tool schemas or public TypeScript APIs.

## High-level split

### PR 1: Package-intelligence text metadata

Extract the proven sanitizer and apply it to package-intelligence text
formatters. This is the next detailed increment and should remain below roughly
1,500 changed lines including tests and docs. Measure the delta before review;
if it approaches the limit, stop and split by package formatter rather than
weakening field coverage or tests.

### Later direction: Code, docs, search, and CLI errors

Apply the same field-level rule to code/docs metadata, search/status output,
language names, mapped service errors, and command-specific terminal errors.
Before planning that PR, re-inventory the exact call sites after PR 1 and decide
how raw-content commands should communicate their terminal risk without
changing round-trip content. Do not design a raw-content mode or new flag in PR
1.

## PR 1 design

### Shared helper

Move the existing regex and `sanitizeTerminalText(value: string): string` into
`packages/mcp/src/shared/terminal-text.ts`. Keep it package-internal in PR 1; do
not export it through `packages/mcp/src/index.ts`, `packages/mcp/src/internal.ts`,
or the public package export map. The later root CLI slice may expose it through
the workspace-only internal entrypoint when that concrete caller exists.

The helper remains a pure string transform. It strips complete ANSI CSI/OSC and
two-byte escape sequences before residual C0/C1/DEL controls so payload text
cannot survive as partial terminal instructions. It does not normalize,
truncate, wrap, quote, or filter printable content; those remain formatter
responsibilities.

No configurable mode, recursive object sanitizer, output stream wrapper, or
global hook is added. Field-level calls are more explicit and avoid corrupting
formatter-owned colors or raw content.

### Formatter integration

Replace the resolver-local helper with the shared helper without changing
resolver output. Then derive sanitized local display values for all untrusted
backend and caller/request strings in these shared package formatters:

- `package-summary-response.ts`;
- `package-vulnerabilities-response.ts`;
- `package-dependencies-response.ts`;
- `package-upgrade-review-response.ts`;
- `package-changelog-response.ts`.

Cover identity fields, descriptions, URLs, topics, advisory text, versions,
ranges, constraints, deprecation/compatibility text, dependency evidence,
changelog headings, and caller/request echoes such as requested versions,
filters, addressing, and version ranges. Sanitize each local display value after
semantic shaping but before display-oriented wrapping, width measurement,
truncation, padding, interpolation, or formatter-owned ANSI coloring. This keeps
layout calculations free of invisible hostile bytes without mutating shared
payloads. Multiline body previews are the explicit ordering exception: preserve
their existing line split first, then sanitize each untrusted line before any
per-line display transformation or formatter-owned indentation. Do not sanitize
a completed output string because that would remove formatter-owned ANSI colors
and line structure.

Keep payload builders and JSON formatters untouched. Do not change schemas,
fetch selections, response types, wrapping widths, truncation, ordering, or
normal output wording.

### Documentation

Add the text-output trust boundary to `docs/implementation/TOOL_GUARDRAILS.md`:
backend, registry, and caller/request metadata is untrusted data,
formatter-owned layout is trusted, and raw content has an explicit preservation
exception. Update package formatter implementation docs only where they describe
exact output contracts.

### Release boundary

This changes both the root CLI and public `@githits/mcp` package tool text. Bump
the root `githits` patch version and keep `server.json`, `.plugin/plugin.json`,
`.claude-plugin/plugin.json`, `plugins/claude/.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`, and `gemini-extension.json` aligned. Bump the
`@githits/mcp` patch version in `packages/mcp/package.json`; for a new root minor,
follow the coordinated-release rule and start the MCP package at `X.Y.0`.
Include the text-output security hardening in release notes. Review public Agent
Skills for wording impact, but do not change them unless their documented output
behavior is now inaccurate.

## Tests

1. Add focused helper tests covering CSI, OSC terminated by BEL and ST,
   two-byte escapes, residual C0/C1/DEL controls, incomplete sequences, benign
   Unicode, and ordinary printable text.
2. Keep the existing resolver hostile-text regression and change only its
   import path if needed.
3. Add one hostile metadata integration case per package formatter. Populate
   every rendered untrusted string category across compact and verbose paths,
   including caller/request echoes. With colors disabled, remove or account for
   expected formatter-owned line breaks before proving no untrusted escape or
   control characters remain; separately assert that expected line structure and
   ordinary text are unchanged. With colors enabled, prove hostile sequences are
   absent and only expected formatter-owned SGR sequences and line breaks remain.
4. Add changelog/upgrade-review coverage proving backend preview lines are
   sanitized while formatter-owned line structure remains intact.
5. Add a JSON regression proving corresponding backend and caller-derived
   strings remain present in structured output; sanitization belongs only to
   text rendering.
6. Assert public package declarations and manifests do not expose the helper or
   private aliases.

Use existing fixtures and formatter tests. Do not add a sanitizer parity harness
or broad snapshots.

## Verification

Run:

```text
bun test <terminal helper and affected formatter tests>
bun test
bun run typecheck
bun run format:check
bun run lint
bun run build
(cd packages/mcp && bun run build)
bun run validate:packages
bun run validate:packages:mcp-publish
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
```

Because shared formatter behavior reaches MCP package tools, run targeted
package workloads from `bun run agent:e2e` and inspect `tool-calls.json` and
`final.json` for unchanged normal usability. Live smoke rate limits are an
external failure only when the affected package probes completed first and the
failure is recorded exactly.

## Not handling

- Raw source-file bodies, documentation bodies, and grep source lines: altering
  them would break explicit content-preservation and redirection contracts.
- Generated example markdown: it is primary content rather than metadata and
  needs the same separate product decision as raw source/document bodies.
- JSON strings: `JSON.stringify` already produces safe transport encoding, and
  structured consumers require faithful backend values.
- Prompt-injection or prose-policy filtering: this increment addresses terminal
  control sequences only; printable third-party content remains data governed
  by existing tool guardrails.
- New CLI flags, output modes, stream wrappers, recursive sanitizers, or backend
  validation: none is required to fix the verified metadata rendering flaw.
- Code/docs/search/error metadata: verified but reserved for the next planned
  slice to keep PR 1 within the complexity budget.

## Completion

After PR 1 ships, transfer its durable trust-boundary rules to implementation
documentation, update this file with evidence needed to scope the next slice,
and remove completed PR 1 implementation detail. Delete this plan when all
retained work has moved to implementation documentation or a fresh active plan.
