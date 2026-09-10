import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpQuickStart } from "../../../packages/mcp/src/mcp/instructions.js";
import { getMcpToolDescriptors } from "../../../packages/mcp/src/mcp/server.js";
import {
  codeTargetSchema,
  resolveCodeTarget,
} from "../../../packages/mcp/src/tools/code-navigation-shared.js";
import {
  buildRoutingGuide,
  ROUTING_QUICK_START_DESCRIPTION,
} from "./routing-guide.js";

/** Target syntax belongs to the production parser; fixtures own only their corpus. */
function isCodexRepository(value: unknown): boolean {
  const parsed = codeTargetSchema.safeParse(value);
  if (!parsed.success) return false;
  const target = resolveCodeTarget(parsed.data);
  return (
    "repoUrl" in target &&
    target.repoUrl === "https://github.com/openai/codex" &&
    (target.gitRef === undefined || target.gitRef === "HEAD")
  );
}

/**
 * Exact production descriptors with a deliberately narrow, network-free workload.
 * This measures loading/selection, not live repository coverage or answer quality.
 */
export function createContextFixtureServer(
  guide: "canonical" | "routing" = "canonical",
): McpServer {
  const server = new McpServer({
    name: "githits-context-fixture",
    version: "1.0.0",
  });
  for (const tool of getMcpToolDescriptors()) {
    server.registerTool(
      tool.name,
      {
        description:
          tool.name === "quick_start" && guide === "routing"
            ? ROUTING_QUICK_START_DESCRIPTION
            : tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
      },
      async (args) => {
        if (tool.name === "quick_start") {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  guide === "routing"
                    ? buildRoutingGuide()
                    : buildMcpQuickStart(),
              },
            ],
          };
        }
        if (
          tool.name === "pkg_info" &&
          args.registry === "npm" &&
          args.package_name === "zod"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "pkg_info | npm:zod | license: MIT | latest version: 4.4.3\nEvidence: fixed context-loading fixture; not live package coverage. License and version are fixture facts only.",
              },
            ],
          };
        }
        if (
          tool.name === "code_grep" &&
          isCodexRepository(args.target) &&
          args.pattern === "tool_search" &&
          (args.pattern_type === undefined || args.pattern_type === "literal")
        ) {
          return {
            content: [{ type: "text" as const, text: GREP_FIXTURE }],
          };
        }
        if (
          tool.name === "code_read" &&
          isCodexRepository(args.target) &&
          args.path ===
            "codex-rs/app-server-protocol/schema/json/ClientRequest.json"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: 'code_read | codex-rs/app-server-protocol/schema/json/ClientRequest.json | lines 3118-3132\n3120: "required": ["call_id", "name"],\n3126: "type": "tool_search_call"\nEvidence: synthetic context-loading fixture, not current repository source. Only these fixture fields can be concluded.',
              },
            ],
          };
        }
        if (
          tool.name === "search" &&
          (JSON.stringify(args.target ?? args.targets) ?? "").includes(
            "express",
          ) &&
          (args.source === undefined || args.source === "docs")
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "search | documentation result\nTitle: Express routing\ndocsReadTarget: docs:fixture:express-routing#snapshot-1\nLines: 40-48\nsourceUrl: https://expressjs.com/en/guide/routing.html\nSnippet: route-handler reference; read the emitted locator for the handler signature and ordering rule.\nEvidence: synthetic context-loading fixture, not live documentation.",
              },
            ],
          };
        }
        if (
          tool.name === "docs_read" &&
          args.page_id === "docs:fixture:express-routing#snapshot-1"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "docs_read | docs:fixture:express-routing#snapshot-1 | lines 40-48\n40: A route handler receives (req, res, next).\n44: Multiple handlers run in registration order; next() passes control onward.\nsourceUrl: https://expressjs.com/en/guide/routing.html\nEvidence: synthetic context-loading fixture; not a fresh upstream read.",
              },
            ],
          };
        }
        const upgrades = Array.isArray(args.packages) ? args.packages : [args];
        if (
          tool.name === "pkg_upgrade_review" &&
          upgrades.length === 1 &&
          upgrades[0]?.registry === "npm" &&
          upgrades[0]?.package_name === "zod" &&
          upgrades[0]?.current_version === "4.3.6" &&
          upgrades[0]?.target_version === "4.4.3"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "pkg_upgrade_review | npm:zod | 4.3.6 -> 4.4.3\nDirect advisory delta: 0 added, 0 resolved\nChangelog: unavailable in this fixture\nCompatibility: not established; inspect migration notes and run application tests.\nEvidence: synthetic context-loading fixture, not a live security or upgrade assessment.",
              },
            ],
          };
        }
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "CONTEXT_FIXTURE_UNSUPPORTED: no fixture is defined for these arguments. No network request was made.",
            },
          ],
        };
      },
    );
  }
  return server;
}

const GREP_FIXTURE = `code_grep | 3 matches in 2 files | pattern="tool_search"

codex-rs/app-server-protocol/schema/json/ClientRequest.json (2)
  3125-               "enum": [
  3126:                 "tool_search_call"
  3127-               ],
  --
  3331-               "enum": [
  3332:                 "tool_search_output"
  3333-               ],

codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json (1)
  18471-                 "enum": [
  18472:                   "tool_search_call"
  18473-                 ],

Evidence: fixed context-loading fixture derived from a prior public-source response; not live repository coverage. Only this three-match workload is supported.`;

if (import.meta.main) {
  const mode = process.argv[2] ?? "canonical";
  if (mode !== "canonical" && mode !== "routing")
    throw new Error("Unknown fixture guide mode");
  await createContextFixtureServer(mode).connect(new StdioServerTransport());
}
