import type { ListEntry, ListResult } from "@githits/core-internal";
import { dim } from "./colors.js";

export interface FormatListTextOptions {
  useColors?: boolean;
  includeHeader?: boolean;
}

/** Render one token-efficient inventory shared by CLI and MCP text surfaces. */
export function formatListText(
  result: ListResult,
  options: FormatListTextOptions = {},
): string {
  const siteReadTarget = findSharedSiteReadTarget(result);
  const paths = result.entries.map((entry) =>
    formatPath(entry, result.inventoryKind),
  );
  if (options.includeHeader === false) return paths.join("\n");
  return [
    formatHeader(result, siteReadTarget, options.useColors === true),
    ...paths,
  ].join("\n");
}

function formatHeader(
  result: ListResult,
  siteReadTarget: string | undefined,
  useColors: boolean,
): string {
  const source = result.canonicalTarget ?? result.requestedTarget;
  const escapedSource = escapeLineValue(source);
  const followUpTarget =
    result.inventoryKind === "SOURCE" ? source : siteReadTarget;
  const followUp =
    followUpTarget === undefined
      ? ""
      : ` | follow up with "read ${escapeLineValue(followUpTarget)} $path"`;
  const header = `# source ${escapedSource}${followUp}${result.hasMore ? " | more results available" : ""}`;
  return dim(header, useColors);
}

function formatPath(
  entry: ListEntry,
  inventoryKind: ListResult["inventoryKind"],
): string {
  if (inventoryKind === "SITE") {
    return formatSitePath(entry);
  }
  if (entry.kind === "PAGE" && entry.read?.target !== undefined) {
    return escapePath(entry.read.target);
  }
  const path =
    entry.kind === "DIRECTORY" && !entry.path.endsWith("/")
      ? `${entry.path}/`
      : entry.path;
  return escapePath(path);
}

function formatSitePath(entry: ListEntry): string {
  if (
    entry.kind === "PAGE" &&
    entry.read !== null &&
    entry.read !== undefined
  ) {
    if (isSiteReadAction(entry.read.target, entry.read.path)) {
      return escapePath(entry.read.path);
    }
    return escapePath(entry.read.target);
  }

  const separator = entry.path.indexOf("/");
  const relative =
    separator === -1 ? entry.path : entry.path.slice(separator + 1);
  const path =
    entry.kind === "DIRECTORY" && !relative.endsWith("/")
      ? `${relative}/`
      : relative;
  return escapePath(path.length === 0 ? "./" : path);
}

function findSharedSiteReadTarget(result: ListResult): string | undefined {
  if (result.inventoryKind !== "SITE") return undefined;

  let sharedTarget: string | undefined;
  for (const entry of result.entries) {
    if (
      entry.kind !== "PAGE" ||
      entry.read === null ||
      entry.read === undefined ||
      !isSiteReadAction(entry.read.target, entry.read.path)
    ) {
      continue;
    }
    if (sharedTarget === undefined) {
      sharedTarget = entry.read.target;
    } else if (entry.read.target !== sharedTarget) {
      return undefined;
    }
  }
  return sharedTarget;
}

function isSiteReadAction(target: string, path: string | null): path is string {
  return target.startsWith("site:") && path !== null;
}

/** Escape controls and backslashes while keeping ordinary path text literal. */
function escapePath(path: string): string {
  return escapeLineValue(path);
}

function escapeLineValue(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "\\") {
      escaped += "\\\\";
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
