import type { ListEntry, ListResult } from "@githits/core-internal";
import { dim } from "./colors.js";

export interface FormatListTextOptions {
  useColors?: boolean;
}

/** Render one token-efficient inventory shared by CLI and MCP text surfaces. */
export function formatListText(
  result: ListResult,
  options: FormatListTextOptions = {},
): string {
  const siteOrigin = findSharedSiteReadOrigin(result);
  return [
    formatHeader(result, siteOrigin, options.useColors === true),
    ...result.entries.map((entry) => formatPath(entry, siteOrigin)),
  ].join("\n");
}

function formatHeader(
  result: ListResult,
  siteOrigin: string | undefined,
  useColors: boolean,
): string {
  const source = result.canonicalTarget ?? result.requestedTarget;
  const escapedSource = escapeLineValue(source);
  const hasExactUrlRow =
    siteOrigin !== undefined &&
    result.entries.some(
      (entry) =>
        entry.kind === "PAGE" &&
        entry.read?.target !== undefined &&
        relativeReadTarget(entry.read.target, siteOrigin) === "",
    );
  const followUp =
    siteOrigin !== undefined
      ? ` | follow up with "read ${escapeLineValue(siteOrigin)}$path"${hasExactUrlRow ? " (URLs as-is)" : ""}`
      : result.inventoryKind === "SOURCE"
        ? ` | follow up with "read ${escapedSource} $path"`
        : "";
  const header = `# source ${escapedSource}${followUp}${result.hasMore ? " | more" : ""}`;
  return dim(header, useColors);
}

function formatPath(entry: ListEntry, siteOrigin: string | undefined): string {
  if (siteOrigin !== undefined) {
    return formatSitePath(entry, siteOrigin);
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

function formatSitePath(entry: ListEntry, origin: string): string {
  if (entry.kind === "PAGE" && entry.read?.target !== undefined) {
    const relative = relativeReadTarget(entry.read.target, origin);
    return escapePath(
      relative === undefined || relative.length === 0
        ? entry.read.target
        : relative,
    );
  }

  const host = new URL(origin).host;
  const hostPrefix = `${host}/`;
  const relative = entry.path.startsWith(hostPrefix)
    ? entry.path.slice(hostPrefix.length)
    : entry.path;
  const path =
    entry.kind === "DIRECTORY" && !relative.endsWith("/")
      ? `${relative}/`
      : relative;
  return escapePath(path.length === 0 ? "./" : path);
}

function findSharedSiteReadOrigin(result: ListResult): string | undefined {
  if (result.inventoryKind !== "SITE") return undefined;
  const pages = result.entries.filter((entry) => entry.kind === "PAGE");
  if (pages.length === 0) return undefined;

  let sharedOrigin: string | undefined;
  for (const page of pages) {
    const target = page.read?.target;
    if (target === undefined) return undefined;
    const origin = readTargetOrigin(target);
    if (origin === undefined) return undefined;
    if (sharedOrigin === undefined) {
      sharedOrigin = origin;
    } else if (origin !== sharedOrigin) {
      return undefined;
    }
    if (relativeReadTarget(target, origin) === undefined) return undefined;
  }
  return sharedOrigin;
}

function readTargetOrigin(target: string): string | undefined {
  const match = /^(https?:\/\/[^/?#]+)/iu.exec(target);
  if (match?.[1] === undefined) return undefined;
  try {
    const url = new URL(target);
    if (url.username.length > 0 || url.password.length > 0) return undefined;
  } catch {
    return undefined;
  }
  return match[1];
}

function relativeReadTarget(
  target: string,
  origin: string,
): string | undefined {
  if (target === origin) return "";
  if (!target.startsWith(origin)) return undefined;
  const relative = target.slice(origin.length);
  return relative.startsWith("/") ? relative : undefined;
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
