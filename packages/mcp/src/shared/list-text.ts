import type { ListEntry, ListResult } from "@githits/core-internal";
import { dim } from "./colors.js";
import {
  formatPreparationRetry,
  renderPreparationSection,
} from "./indexing-estimates-text.js";
import { indexingWaitMs } from "./indexing-wait.js";
import { shellQuoteExact } from "./shell-quote.js";
import {
  renderResolutionDetails,
  renderSourceSection,
  resolutionSourceFacts,
} from "./source-provenance-text.js";
import { wrapTerminalProse } from "./terminal-text.js";

export interface FormatListTextOptions {
  useColors?: boolean;
  includeHeader?: boolean;
  syntax?: "cli" | "mcp";
  hasAfter?: boolean;
  width?: number;
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
  const pending = Boolean(
    result.indexingEstimates?.length || result.codeIndexState === "INDEXING",
  );
  const isSource = result.inventoryKind === "SOURCE";
  const resolution = result.targetResolution;
  const sourceBase = result.canonicalTarget ?? result.requestedTarget;
  const sourceRows = isSource ? resolutionSourceFacts(resolution) : [];
  if (
    isSource &&
    !sourceRows.length &&
    ((!resolution && (!pending || paths.length > 0)) ||
      resolution?.freshness === "current")
  ) {
    sourceRows.push({ target: sourceBase });
  }
  const lines = isSource
    ? [
        ...(paths.length
          ? []
          : [pending ? "No files available yet." : "No files."]),
        ...renderSourceSection(sourceRows, { width: options.width }),
        `Read files: ${formatSourceReadAction(sourceBase, options.syntax)}`,
        ...paths,
      ]
    : [
        ...(paths.length
          ? []
          : [pending ? "No pages available yet." : "No pages."]),
        ...(paths.length || !pending
          ? renderSourceSection(
              [
                {
                  target: siteReadTarget ?? result.requestedTarget,
                  qualifiers: ["hosted documentation"],
                },
              ],
              { width: options.width },
            )
          : []),
        ...(siteReadTarget
          ? [formatSiteReadGuidance(siteReadTarget, options.syntax)]
          : []),
        ...paths,
      ];
  if (pending) {
    lines.push(
      ...(result.indexingEstimates?.length
        ? renderPreparationSection(
            result.indexingEstimates,
            isSource
              ? {
                  resolutions: resolution ? [resolution] : [],
                  width: options.width,
                }
              : { width: options.width },
          )
        : [
            "",
            "Preparing:",
            ...wrapTerminalProse(
              `  - ${escapeLineValue(result.requestedTarget)} (indexing, no estimate available)`,
              options.width,
            ),
          ]),
    );
  }
  if (isSource) {
    const details = renderResolutionDetails(
      resolution,
      result.indexingEstimates,
      { width: options.width },
    );
    if (details.length) lines.push("", ...details);
  }
  if (result.nextCursor) {
    const continuation = [
      result.indexingEstimates?.length
        ? "More results available now: repeat this list, adding:"
        : "More results: repeat this list, adding:",
      options.syntax === "mcp"
        ? `  after=${JSON.stringify(result.nextCursor)}`
        : `  --after ${shellQuoteExact(result.nextCursor)}`,
    ];
    lines.push(
      "",
      ...continuation.map((line) => dim(line, options.useColors === true)),
    );
  }
  if (pending) {
    lines.push(
      "",
      formatPreparationRetry({
        operation: "list",
        syntax: options.syntax ?? "cli",
        waitMs: indexingWaitMs(result.indexingEstimates),
        hasAfter: options.hasAfter,
      }),
    );
  }
  return lines.join("\n");
}

function formatSourceReadAction(
  target: string,
  syntax: FormatListTextOptions["syntax"],
): string {
  return syntax === "mcp"
    ? `read target=${JSON.stringify(target)} path=$path`
    : `read -- ${shellQuoteExact(target)} $path`;
}

function formatSiteReadGuidance(
  target: string,
  syntax: FormatListTextOptions["syntax"],
): string {
  return syntax === "mcp"
    ? `Read pages: read target=${JSON.stringify(target)} path=$path`
    : `Read pages: read -- ${shellQuoteExact(target)} $path`;
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

  const path =
    entry.kind === "DIRECTORY" && !entry.path.endsWith("/")
      ? `${entry.path}/`
      : entry.path;
  return escapePath(path);
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
