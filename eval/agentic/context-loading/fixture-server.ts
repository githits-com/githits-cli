import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpQuickStart } from "../../../packages/mcp/src/mcp/instructions.js";
import { getMcpToolDescriptors } from "../../../packages/mcp/src/mcp/server.js";
import {
  buildRoutingGuide,
  ROUTING_QUICK_START_DESCRIPTION,
} from "./routing-guide.js";

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
          args.target === "github:openai/codex" &&
          args.pattern === "tool_search" &&
          (args.pattern_type === undefined || args.pattern_type === "literal")
        ) {
          return {
            content: [{ type: "text" as const, text: GREP_FIXTURE }],
          };
        }
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "CONTEXT_FIXTURE_UNSUPPORTED: this offline fixture supports quick_start, literal code_grep for tool_search in github:openai/codex, and pkg_info for npm:zod only. No network request was made.",
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
