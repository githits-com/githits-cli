import type { Dependencies } from "../container.js";

/**
 * Server-level MCP instructions.
 *
 * The MCP `instructions` field gives clients a short, cross-tool
 * orientation for the server — rationale, workflow glue, and
 * relationships that the per-tool descriptions cannot cover on
 * their own. Per upstream guidance it should stay terse: anything
 * that belongs to a single tool lives in that tool's description.
 *
 * Composition mirrors tool registration in `mcp.ts`. Each bullet is
 * emitted only when its backing service is wired, so MCP clients
 * never see guidance for a tool that isn't registered in the
 * current session.
 */

const CORE_BLOCK = `GitHits surfaces verified, canonical code examples from global open source. Use it when you're stuck, the user is frustrated by repeated failed attempts, you need up-to-date API usage, or the user mentions GitHits.

Workflow: call \`search_language\` first if the language name is uncertain → call \`search\` with one focused question → send \`feedback\` on the returned solution_id so quality improves. Each search addresses a single issue; reuse context from prior results before re-searching.`;

const PACKAGE_TOOLS_PREAMBLE = `Package tools work with third-party dependency source and registry metadata. Use them when a stack trace points into a dependency, you need to verify how a library actually works, or you're evaluating a package.

Package spec: \`registry:name[@version]\`.`;

const PACKAGE_SUMMARY_BULLET =
  "- `package_summary` — instant package overview.";

const PACKAGE_VULNERABILITIES_BULLET =
  "- `package_vulnerabilities` — known CVE / OSV advisories for npm, PyPI, Hex, or Crates packages (optionally pinned to `@version`). Malicious-package advisories surface in a disjoint `malware` bucket; filter with `min_severity` or include retracted advisories with `include_withdrawn`.";

const PACKAGE_DEPENDENCIES_BULLET =
  "- `package_dependencies` — direct runtime deps plus, when the backend has them, dev / peer / optional / feature groups. Pass `lifecycle` to filter groups server-side, or `include_transitive` for the full graph, conflict detection, and circular-dependency flags. Supports npm, PyPI, Hex, Crates, vcpkg, and Zig.";

const SEARCH_SYMBOLS_BULLET =
  "- `search_symbols` — text search across a dependency's source. On an INDEXING response, retry with a larger `wait_timeout_ms` (up to 60000).";

const SEARCH_VS_SYMBOLS_TIP =
  "Prefer `search` for natural-language example questions; prefer `search_symbols` for exact-token lookups inside a specific package.";

/**
 * Whether the MCP session should register and describe package tools.
 *
 * Narrower than the CLI gate by design: agents must not see tools
 * or guidance that would silently fail, so a bare `unknown`
 * capability (no env token to probe further) keeps the gate closed.
 *
 * Single source of truth — tool registration in `mcp.ts` and the
 * package-tools fragment in `buildMcpInstructions` must share this
 * predicate to prevent drift between what's advertised and what's
 * documented.
 */
export function isPackageToolsCapabilityOpen(deps: Dependencies): boolean {
  return (
    deps.codeNavigationCapability === "enabled" ||
    (deps.codeNavigationCapability === "unknown" &&
      deps.envApiToken !== undefined)
  );
}

/**
 * Build the server-level instructions string for the current session.
 *
 * Emits the core block unconditionally. Appends a package-tools
 * section composed of a preamble plus one bullet per service that
 * is actually wired. Mirrors `getMcpToolDefinitions` so the
 * instructions never reference a tool that isn't registered, even
 * in half-open states where only one service is available.
 */
export function buildMcpInstructions(deps: Dependencies): string {
  const sections = [CORE_BLOCK];

  if (!isPackageToolsCapabilityOpen(deps)) {
    return sections.join("\n\n");
  }

  const bullets: string[] = [];
  if (deps.packageIntelligenceService) {
    bullets.push(PACKAGE_SUMMARY_BULLET);
    bullets.push(PACKAGE_VULNERABILITIES_BULLET);
    bullets.push(PACKAGE_DEPENDENCIES_BULLET);
  }
  if (deps.codeNavigationService) {
    bullets.push(SEARCH_SYMBOLS_BULLET);
  }

  if (bullets.length === 0) {
    return sections.join("\n\n");
  }

  const parts = [PACKAGE_TOOLS_PREAMBLE, bullets.join("\n")];
  // The decision tip contrasts `search` with `search_symbols`, so
  // it is only meaningful when the latter is actually registered.
  if (deps.codeNavigationService) {
    parts.push(SEARCH_VS_SYMBOLS_TIP);
  }

  sections.push(parts.join("\n\n"));
  return sections.join("\n\n");
}
