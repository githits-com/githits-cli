#!/usr/bin/env bun
/**
 * Mock MCP server for the eval harness.
 *
 * Mirrors the real `githits` MCP server's instructions and the
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
 *   through `buildMcpInstructions` and per-tool `DESCRIPTION`
 *   constants; the mock controls whether they're included per cell
 *   via the `EVAL_MCP_GUARDRAIL` env var so we can measure
 *   guardrail-on vs guardrail-off cleanly.
 * - Imports each tool's `DESCRIPTION` constant from `src/tools/*.ts`
 *   so the mock matches production verbatim modulo the guardrail
 *   addenda we're appending here.
 */

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildMcpInstructions } from "../../src/commands/mcp-instructions.js";
import type { Dependencies } from "../../src/container.js";
import {
  CODE_READ_GUARDRAIL,
  DOCS_GUARDRAIL,
  EXTERNAL_CONTENT_POSTURE,
  PKG_CHANGELOG_GUARDRAIL,
  PKG_INFO_GUARDRAIL,
  PKG_VULNS_GUARDRAIL,
} from "../../src/tools/guardrails.js";
import { DESCRIPTION as PKG_CHANGELOG_DESCRIPTION } from "../../src/tools/package-changelog.js";
import { DESCRIPTION as PKG_INFO_DESCRIPTION } from "../../src/tools/package-summary.js";
import { DESCRIPTION as PKG_VULNS_DESCRIPTION } from "../../src/tools/package-vulnerabilities.js";
import { DESCRIPTION as CODE_READ_DESCRIPTION } from "../../src/tools/read-file.js";
import { DESCRIPTION as DOCS_READ_DESCRIPTION } from "../../src/tools/read-package-doc.js";

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
 * `instructions` (or `both`), the shared block lands inside the
 * server instructions. v4 plan validates `--guardrail=both`
 * primarily; the earlier `tool`-only mode is preserved for
 * backwards-compatible eval comparisons.
 */
const guardrailMode = process.env.EVAL_MCP_GUARDRAIL ?? "off";
const includeShared =
  guardrailMode === "instructions" || guardrailMode === "both";
const includeToolAddenda = guardrailMode === "tool" || guardrailMode === "both";

function withGuardrail(base: string, addendum: string): string {
  return includeToolAddenda ? `${base}\n\n${addendum}` : base;
}

// Build the production-shaped instructions WITHOUT the shared
// external-content posture so we can control whether it's included
// per cell. Production always inherits the shared block; the eval
// needs `--guardrail=off` to be a clean baseline.
const baseInstructions = buildMcpInstructions({} as Dependencies, {
  includeExternalContentPosture: false,
});
const instructions = includeShared
  ? `${baseInstructions}\n\n${EXTERNAL_CONTENT_POSTURE}`
  : baseInstructions;

const server = new McpServer(
  { name: "githits", version: "0.4.2-eval" },
  { instructions },
);

interface ToolState {
  content: string;
  expectedTool: string;
}

function readState(): ToolState {
  const raw = readFileSync(STATE_FILE as string, "utf8");
  return JSON.parse(raw) as ToolState;
}

function fixtureContentFor(toolName: string): string {
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

// pkg_vulns ---------------------------------------------------------
server.registerTool(
  "pkg_vulns",
  {
    description: withGuardrail(PKG_VULNS_DESCRIPTION, PKG_VULNS_GUARDRAIL),
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
    description: withGuardrail(PKG_INFO_DESCRIPTION, PKG_INFO_GUARDRAIL),
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
    description: withGuardrail(
      PKG_CHANGELOG_DESCRIPTION,
      PKG_CHANGELOG_GUARDRAIL,
    ),
    inputSchema: {
      registry: z.string().optional(),
      package_name: z.string().optional(),
      repo_url: z.string().optional(),
      from_version: z.string().optional(),
      to_version: z.string().optional(),
      limit: z.number().int().optional(),
      include_bodies: z.boolean().optional(),
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
    description: withGuardrail(DOCS_READ_DESCRIPTION, DOCS_GUARDRAIL),
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
    description: withGuardrail(CODE_READ_DESCRIPTION, CODE_READ_GUARDRAIL),
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
