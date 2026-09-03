#!/usr/bin/env bun
/**
 * Mock MCP server for the eval harness.
 *
 * Mirrors the real `githits` MCP server's quick-start guide and
 * production tool descriptions so the agent under test sees the same
 * orientation it would see against the real CLI.
 *
 * Behavior:
 * - Registers five production tools: `pkg_vulns`, `pkg_changelog`,
 *   `pkg_info`, `code_read`, `docs_read`. Only the one named in the
 *   state file's `expectedTool` returns the framed fixture; the
 *   others return a `no data for this fixture` placeholder so
 *   accidental cross-tool calls don't conflate results.
 * - Imports the external-content posture (shared block) and per-tool
 *   addenda from `src/tools/guardrails.ts`. Production wires both
 *   through `buildMcpQuickStart` and per-tool `DESCRIPTION`
 *   constants; the mock controls whether they're included per cell
 *   via the `EVAL_MCP_GUARDRAIL` env var so we can measure
 *   guardrail-on vs guardrail-off cleanly.
 * - Imports each tool's guardrail-free base description so the mock matches
 *   production after composing the selected addenda and stable MCP-session
 *   prerequisite here.
 */

import { readFileSync } from "node:fs";
import {
  buildMcpQuickStart,
  READ_FILE_DESCRIPTION_BASE as CODE_READ_DESCRIPTION,
  CODE_READ_GUARDRAIL,
  DOCS_GUARDRAIL,
  READ_PACKAGE_DOC_DESCRIPTION_BASE as DOCS_READ_DESCRIPTION,
  EXTERNAL_CONTENT_POSTURE,
  PACKAGE_CHANGELOG_DESCRIPTION_BASE as PKG_CHANGELOG_DESCRIPTION,
  PKG_CHANGELOG_GUARDRAIL,
  PACKAGE_SUMMARY_DESCRIPTION_BASE as PKG_INFO_DESCRIPTION,
  PKG_INFO_GUARDRAIL,
  PACKAGE_VULNERABILITIES_DESCRIPTION_BASE as PKG_VULNS_DESCRIPTION,
  PKG_VULNS_GUARDRAIL,
  QUICK_START_DESCRIPTION,
} from "@githits/mcp/internal";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { composeEvalMcpDescription } from "./descriptions.js";
import type { EvalMcpFixtureToolName } from "./state.js";

const STATE_FILE = process.env.EVAL_MCP_STATE_FILE;
if (!STATE_FILE) {
  console.error(
    "mock-mcp: EVAL_MCP_STATE_FILE env var is required (writer is eval/run.ts).",
  );
  process.exit(1);
}

/**
 * Optional guardrail toggle. When `tool` (or `both`), per-tool
 * descriptions get the production guardrail addendum appended. When
 * legacy `instructions` mode (or `both`), the shared block lands inside the
 * quick-start guide. v4 plan validates `--guardrail=both`
 * primarily; the earlier `tool`-only mode is preserved for
 * backwards-compatible eval comparisons.
 */
const guardrailMode = process.env.EVAL_MCP_GUARDRAIL ?? "off";
const includeShared =
  guardrailMode === "instructions" || guardrailMode === "both";
const includeToolAddenda = guardrailMode === "tool" || guardrailMode === "both";

// Build the production-shaped quick-start guide WITHOUT the shared
// external-content posture so we can control whether it's included
// per cell. Production `quick_start` always includes the shared block; the eval
// needs `--guardrail=off` to be a clean baseline.
const baseQuickStart = buildMcpQuickStart({
  includeExternalContentPosture: false,
});
const quickStartGuide = includeShared
  ? `${baseQuickStart}\n\n${EXTERNAL_CONTENT_POSTURE}`
  : baseQuickStart;

const server = new McpServer({ name: "githits", version: "0.4.2-eval" });

interface ToolState {
  content: string;
  expectedTool: string;
}

function readState(): ToolState {
  const raw = readFileSync(STATE_FILE as string, "utf8");
  return JSON.parse(raw) as ToolState;
}

function fixtureContentFor(toolName: EvalMcpFixtureToolName): string {
  const state = readState();
  if (state.expectedTool === toolName) {
    return state.content;
  }
  // The cell expects a different tool. Return a structured "no data"
  // placeholder so the agent's behavior diverges from the
  // expected-tool path. Using a recognizable shape so post-hoc
  // analysis can see the cross-tool call happened.
  return `[eval-mock] this cell expected the agent to call \`${state.expectedTool}\`, not \`${toolName}\`. No data returned.`;
}

server.registerTool(
  "quick_start",
  {
    description: QUICK_START_DESCRIPTION,
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text" as const, text: quickStartGuide }],
  }),
);

// pkg_vulns ---------------------------------------------------------
server.registerTool(
  "pkg_vulns",
  {
    description: composeEvalMcpDescription(
      PKG_VULNS_DESCRIPTION,
      PKG_VULNS_GUARDRAIL,
      includeToolAddenda,
    ),
    inputSchema: {
      registry: z.string(),
      package_name: z.string(),
      version: z.string().optional(),
      min_severity: z.string().optional(),
      include_withdrawn: z.boolean().optional(),
      format: z.enum(["json", "text", "text-v1"]).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text" as const, text: fixtureContentFor("pkg_vulns") }],
  }),
);

// pkg_info ----------------------------------------------------------
server.registerTool(
  "pkg_info",
  {
    description: composeEvalMcpDescription(
      PKG_INFO_DESCRIPTION,
      PKG_INFO_GUARDRAIL,
      includeToolAddenda,
    ),
    inputSchema: {
      registry: z.string(),
      package_name: z.string(),
      format: z.enum(["json", "text", "text-v1"]).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text" as const, text: fixtureContentFor("pkg_info") }],
  }),
);

// pkg_changelog -----------------------------------------------------
server.registerTool(
  "pkg_changelog",
  {
    description: composeEvalMcpDescription(
      PKG_CHANGELOG_DESCRIPTION,
      PKG_CHANGELOG_GUARDRAIL,
      includeToolAddenda,
    ),
    inputSchema: {
      registry: z.string().optional(),
      package_name: z.string().optional(),
      repo_url: z.string().optional(),
      from_version: z.string().optional(),
      to_version: z.string().optional(),
      limit: z.number().int().optional(),
      omit_bodies: z.boolean().optional(),
      format: z.enum(["json", "text", "text-v1"]).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [
      { type: "text" as const, text: fixtureContentFor("pkg_changelog") },
    ],
  }),
);

// docs_read ---------------------------------------------------------
server.registerTool(
  "docs_read",
  {
    description: composeEvalMcpDescription(
      DOCS_READ_DESCRIPTION,
      DOCS_GUARDRAIL,
      includeToolAddenda,
    ),
    inputSchema: {
      page_id: z.string(),
      start_line: z.number().int().optional(),
      end_line: z.number().int().optional(),
      format: z.enum(["json", "text", "text-v1"]).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text" as const, text: fixtureContentFor("docs_read") }],
  }),
);

// code_read ---------------------------------------------------------
server.registerTool(
  "code_read",
  {
    description: composeEvalMcpDescription(
      CODE_READ_DESCRIPTION,
      CODE_READ_GUARDRAIL,
      includeToolAddenda,
    ),
    inputSchema: {
      registry: z.string().optional(),
      package_name: z.string().optional(),
      repo_url: z.string().optional(),
      git_ref: z.string().optional(),
      version: z.string().optional(),
      path: z.string(),
      start_line: z.number().int().optional(),
      end_line: z.number().int().optional(),
      format: z.enum(["json", "text", "text-v1"]).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text" as const, text: fixtureContentFor("code_read") }],
  }),
);

await server.connect(new StdioServerTransport());
