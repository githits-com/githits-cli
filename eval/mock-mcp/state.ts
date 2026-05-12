/**
 * Shared state-file contract between the eval runner (writer) and the
 * mock MCP server (reader). The runner writes one cell's fixture to
 * disk before invoking the driver; the mock MCP server reads it on
 * every tool call.
 *
 * File is JSON. Path is passed via `EVAL_MCP_STATE_FILE` env var so
 * the server inherits it when Claude/Codex spawn it as a subprocess.
 */

import { readFileSync, writeFileSync } from "node:fs";

export interface EvalMcpState {
  /** Stable attack id, surfaced for debugging only. */
  attackId: string;
  /** Variant id, surfaced for debugging only. */
  variantId: string;
  /**
   * Tool name the cell expects the agent to invoke. The mock-MCP
   * server only returns `content` from the matching tool; any other
   * tool call returns a structured "no data" response so the agent
   * doesn't conflate fixtures across tools.
   */
  expectedTool:
    | "pkg_vulns"
    | "pkg_changelog"
    | "pkg_info"
    | "code_read"
    | "docs_read";
  /**
   * Tool-shaped text the mock server returns verbatim from the
   * `expectedTool` handler. Already includes the framing variant
   * applied to the embedded injection text.
   */
  content: string;
}

export function writeState(path: string, state: EvalMcpState): void {
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

export function readState(path: string): EvalMcpState {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as EvalMcpState;
}
