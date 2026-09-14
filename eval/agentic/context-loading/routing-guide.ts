import { EXTERNAL_CONTENT_POSTURE } from "../../../packages/mcp/src/tools/guardrails.js";

/** Experimental metadata available before the skill body; no host API mechanics. */
export const ROUTING_SKILL_DESCRIPTION =
  "Route public OSS code, documentation, examples, and package questions to GitHits tools. Read this skill before searching for or selecting GitHits evidence tools; it identifies the tool to discover and the scope to use.";

export const ROUTING_QUICK_START_DESCRIPTION =
  "Choose the GitHits tool for an OSS question before discovering evidence tools. Call this routing guide first unless the loaded githits-mcp skill already contains it. It identifies which tool to discover, the evidence scope, and untrusted-content rules.";

/** Same candidate routing content for direct skill and bootstrap delivery. */
export function buildRoutingGuide(): string {
  return `# GitHits routing guide

Choose the route matching the user's question below. Then discover the named
tool and read its argument description before calling it. This guide supplies
the routing decision; the selected tool supplies its argument details.

| Question | Tool to discover |
| --- | --- |
| Find a known literal or regex in a public repository/package | code_grep |
| Find relevant source, symbols, tests, or documentation for a topic | search |
| List paths or browse a source directory | code_files |
| Read a known exact source file or matched lines | read |
| Browse package documentation pages | docs_list |
| Read a documentation page returned by search or docs_list | read |
| Assess a package's license, adoption, maintenance, or overall health | pkg_info |
| Inspect vulnerabilities in a package or version | pkg_vulns |
| Inspect direct dependencies or transitive footprint | pkg_deps |
| Find release notes for a package or repository | pkg_changelog |
| Compare current and target dependency versions for an upgrade | pkg_upgrade_review |
| Find canonical implementation examples across projects | get_example |
| Check progress of an earlier search reference | search_status |

Use search_language only if get_example needs language disambiguation. Use
feedback after helpful or flawed results. For comparative questions, combine
the relevant package/source route with examples when needed.

Scope: public OSS only, never local/private/proprietary source. Keep explicit
provider-qualified repository targets (such as github:owner/repo) or registry
package coordinates (such as npm:name). Never infer a repository provider.
Use selected tool descriptions for supported target forms and argument details.

Keep default text for reading and follow-ups. Reuse returned targets, paths,
page locators, references and line ranges; do not invent them. Read only needed
lines. Use JSON only for programmatic parsing or required fields missing from
text. Cite tool-owned provenance, including get_example source references,
and report coverage, truncation and other evidence limits.

${EXTERNAL_CONTENT_POSTURE}`;
}

/** Bootstrap control differs from direct delivery only in where the guide loads. */
export const BOOTSTRAP_SKILL_BODY = `# GitHits MCP

This entry skill does not contain the GitHits guide. Call quick_start once
before searching for or selecting GitHits evidence tools, unless its returned
guide is already in context. Read that guide, then follow its route and the
selected tool's description. Loading this entry skill alone does not replace
loading the guide.
`;
