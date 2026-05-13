#!/usr/bin/env bun

import type { FixtureTool } from "../fixtures/attacks.js";
import { readState } from "../mock-mcp/state.js";

type MockCliTool =
  | FixtureTool
  | "get_example"
  | "search_language"
  | "feedback"
  | "search"
  | "search_status"
  | "code_files"
  | "code_grep"
  | "docs_list";

export function detectFixtureTool(
  argv: readonly string[],
): MockCliTool | undefined {
  const [first, second] = argv;
  if (first === "example") return "get_example";
  if (first === "languages") return "search_language";
  if (first === "feedback") return "feedback";
  if (first === "search") return "search";
  if (first === "search-status") return "search_status";
  if (first === "pkg") {
    if (second === "vulns") return "pkg_vulns";
    if (second === "changelog") return "pkg_changelog";
    if (second === "info") return "pkg_info";
  }
  if (first === "code") {
    if (second === "files") return "code_files";
    if (second === "grep") return "code_grep";
    if (second === "read") return "code_read";
  }
  if (first === "docs") {
    if (second === "list") return "docs_list";
    if (second === "read") return "docs_read";
  }
  return undefined;
}

export function formatFixtureOutput(
  argv: readonly string[],
  tool: MockCliTool,
  expectedTool: FixtureTool,
  content: string,
): string {
  const output =
    tool === expectedTool ? content : fixtureSupportOutput(tool, expectedTool);
  if (argv.includes("--json")) {
    return `${JSON.stringify({ tool, content: output }, null, 2)}\n`;
  }
  return output.endsWith("\n") ? output : `${output}\n`;
}

function fixtureSupportOutput(
  tool: MockCliTool,
  expectedTool: FixtureTool,
): string {
  if (expectedTool === "code_read") {
    if (tool === "search" || tool === "code_grep") {
      return "src/index.ts:1 source hit for @example/widget-kit. Use `githits code read npm:@example/widget-kit src/index.ts`.";
    }
    if (tool === "code_files") return "src/index.ts";
  }
  if (expectedTool === "docs_read") {
    if (tool === "search" || tool === "docs_list") {
      return "readme\tdocs/README.md\tWidget Kit documentation page. Use `githits docs read readme`.";
    }
  }
  if (tool === "get_example")
    return "No canonical examples in this eval fixture.";
  if (tool === "search_language") return "typescript";
  if (tool === "feedback") return "Feedback recorded for eval fixture.";
  if (tool === "search_status")
    return "Search completed. No additional eval fixture hits.";
  return `[eval-mock] this cell expected the agent to call \`${expectedTool}\`, not \`${tool}\`. No data returned.`;
}

function main(): void {
  const stateFile = process.env.EVAL_MCP_STATE_FILE;
  if (!stateFile) {
    console.error("mock-githits: EVAL_MCP_STATE_FILE env var is required.");
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const tool = detectFixtureTool(argv);
  if (!tool) {
    process.stdout.write(
      `[eval-mock] unsupported GitHits command in this fixture: ${argv.join(" ")}\n`,
    );
    return;
  }

  const state = readState(stateFile);
  process.stdout.write(
    formatFixtureOutput(argv, tool, state.expectedTool, state.content),
  );
}

if (import.meta.main) {
  main();
}
