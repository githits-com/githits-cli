import { stripVTControlCharacters } from "node:util";
import { z } from "zod";

/** Normalized native authentication result used by interactive init. */
export type HostAuthStatus = "authenticated" | "required" | "unknown";

const MCP_URL = "https://mcp.githits.com";

const codexRowSchema = z
  .object({
    name: z.literal("githits"),
    enabled: z.literal(true),
    transport: z
      .object({
        type: z.literal("streamable_http"),
        url: z.literal(MCP_URL),
      })
      .passthrough(),
    auth_status: z.enum([
      "not_logged_in",
      "o_auth",
      "bearer_token",
      "unknown",
      "unsupported",
    ]),
  })
  .passthrough();

/** Classify only the canonical enabled GitHits row from Codex MCP list JSON. */
export function parseCodexAuthStatus(stdout: string): HostAuthStatus {
  let output: unknown;
  try {
    output = JSON.parse(stripVTControlCharacters(stdout)) as unknown;
  } catch {
    return "unknown";
  }

  if (!Array.isArray(output)) return "unknown";
  const matchingRows = output.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" &&
      row !== null &&
      !Array.isArray(row) &&
      row.name === "githits",
  );
  if (matchingRows.length !== 1) return "unknown";

  const row = codexRowSchema.safeParse(matchingRows[0]);
  if (!row.success) return "unknown";

  switch (row.data.auth_status) {
    case "not_logged_in":
      return "required";
    case "o_auth":
    case "bearer_token":
      return "authenticated";
    default:
      return "unknown";
  }
}

const CLAUDE_HEADING = /^githits:\s*$/;
const SERVER_HEADING = /^[A-Za-z0-9_.-]+:\s*$/;

/** Classify Claude Code `mcp get githits` output when it names user config. */
export function parseClaudeAuthStatus(stdout: string): HostAuthStatus {
  const lines = stripVTControlCharacters(stdout).split(/\r?\n/);
  const headings = lines.flatMap((line, index) =>
    CLAUDE_HEADING.test(line.trim()) ? [index] : [],
  );
  if (headings.length !== 1) return "unknown";

  const start = headings[0];
  if (start === undefined) return "unknown";
  const nextHeading = lines.findIndex(
    (line, index) => index > start && SERVER_HEADING.test(line.trim()),
  );
  const block = lines.slice(
    start + 1,
    nextHeading === -1 ? undefined : nextHeading,
  );

  const scope = getSingleField(block, "Scope");
  const status = getSingleField(block, "Status");
  const type = getSingleField(block, "Type");
  const url = getSingleField(block, "URL");
  if (
    scope === undefined ||
    status === undefined ||
    type !== "http" ||
    url !== MCP_URL ||
    !/^User config(?:\s+\([^\r\n]*\))?$/.test(scope)
  ) {
    return "unknown";
  }

  if (/^(?:✓\s*)?Connected$/.test(status)) return "authenticated";
  if (/^(?:[!✘✗⚠]\s*)?Needs authentication$/.test(status)) return "required";
  return "unknown";
}

function getSingleField(lines: string[], name: string): string | undefined {
  const values = lines.flatMap((line) => {
    const match = /^\s*([A-Za-z]+):\s*(.*?)\s*$/.exec(line);
    return match?.[1] === name && match[2] !== undefined ? [match[2]] : [];
  });
  return values.length === 1 ? values[0] : undefined;
}

const namedStatusLine =
  /^[\s│┌└├─●✓✗⚠]*GitHits\s+(authenticated|not authenticated|expired)\s*$/;
const namedUrlLine = /^[\s│┌└├─]*(https?:\/\/\S+)\s*$/;

/** Classify one GitHits auth row from Kilo or OpenCode's native auth list. */
export function parseNamedAuthStatus(stdout: string): HostAuthStatus {
  const lines = stripVTControlCharacters(stdout).split(/\r?\n/);
  const matchingRows = lines.flatMap((line, index) => {
    const match = namedStatusLine.exec(line);
    return match?.[1] === undefined ? [] : [{ index, status: match[1] }];
  });
  if (matchingRows.length !== 1) return "unknown";

  const row = matchingRows[0];
  if (!row) return "unknown";
  const nextNonEmptyLine = lines
    .slice(row.index + 1)
    .find((line) => line.trim().length > 0);
  const url =
    nextNonEmptyLine === undefined
      ? undefined
      : namedUrlLine.exec(nextNonEmptyLine)?.[1];
  if (url !== MCP_URL) return "unknown";

  switch (row.status) {
    case "authenticated":
      return "authenticated";
    case "not authenticated":
    case "expired":
      return "required";
    default:
      return "unknown";
  }
}
