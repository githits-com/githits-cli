import type { ListEntry, ListResult } from "@githits/core-internal";

const SEP = " | ";

/** Render one token-efficient inventory shared by CLI and MCP text surfaces. */
export function formatListText(result: ListResult): string {
  return [formatHeader(result), ...result.entries.map(formatPath)].join("\n");
}

function formatHeader(result: ListResult): string {
  const target = `requested=${stringValue(result.requestedTarget)} canonical=${stringValue(result.canonicalTarget)}`;
  const count = `${result.entries.length}${result.hasMore ? "+" : ""} ${result.entries.length === 1 && !result.hasMore ? "entry" : "entries"}`;
  return [result.inventoryKind, target, count].join(SEP);
}

function formatPath(entry: ListEntry): string {
  const path =
    entry.kind === "DIRECTORY" && !entry.path.endsWith("/")
      ? `${entry.path}/`
      : entry.path;
  return escapePath(path);
}

/** Escape controls and backslashes while keeping ordinary path text literal. */
function escapePath(path: string): string {
  return escapeLineValue(path, false);
}

function stringValue(value: string | null): string {
  return value === null ? "null" : `"${escapeLineValue(value, true)}"`;
}

function escapeLineValue(value: string, escapeQuote: boolean): string {
  let escaped = "";
  for (const character of value) {
    if (character === "\\") {
      escaped += "\\\\";
      continue;
    }
    if (character === '"' && escapeQuote) {
      escaped += '\\"';
      continue;
    }
    const shortEscape = SHORT_ESCAPES.get(character);
    if (shortEscape !== undefined) {
      escaped += shortEscape;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`;
      continue;
    }
    escaped += character;
  }
  return escaped;
}

const SHORT_ESCAPES = new Map<string, string>([
  ["\b", "\\b"],
  ["\t", "\\t"],
  ["\n", "\\n"],
  ["\f", "\\f"],
  ["\r", "\\r"],
]);
