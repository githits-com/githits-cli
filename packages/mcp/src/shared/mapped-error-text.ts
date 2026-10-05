import { MAX_DISCOVERY_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import {
  formatIndexingDuration,
  renderPreparationEstimates,
} from "./indexing-estimates-text.js";
import { indexingWaitMs } from "./indexing-wait.js";
import type { MappedError } from "./mapped-error.js";
import { sanitizeTerminalText } from "./terminal-text.js";
import { terminalWidth } from "./terminal-width.js";

export interface MappedErrorTextOptions {
  width?: number;
  indexingTarget?: string;
  indexingOutcome?: string;
}

/** Tool boundaries supply native retry syntax; classification retains backend facts. */
export function withIndexingRetryAction(
  mapped: MappedError,
  operation: string,
  syntax: "cli" | "mcp",
  maxWaitMs: number = MAX_DISCOVERY_WAIT_TIMEOUT_MS,
  hasAfter = false,
  cliUnit: "milliseconds" | "seconds" = "milliseconds",
): MappedError {
  if (mapped.code !== "INDEXING") return mapped;
  const details = mapped.details ?? {};
  const wait = indexingWaitMs(
    details.indexingEstimates,
    maxWaitMs,
    details.indexingEstimate,
  );
  const argument =
    syntax === "mcp"
      ? `wait_timeout_ms=${wait}`
      : `--wait ${cliUnit === "seconds" ? wait / 1000 : wait}`;
  const cursor = hasAfter
    ? ` Leave out ${syntax === "mcp" ? "after" : "--after"}.`
    : "";
  return {
    ...mapped,
    details: {
      ...details,
      action:
        details.action ?? `Retry this ${operation} with ${argument}.${cursor}`,
    },
  };
}

/** Human error content shared by CLI and MCP; JSON remains the complete evidence surface. */
export function formatMappedErrorText(
  mapped: MappedError,
  options: MappedErrorTextOptions = {},
): string {
  const details = mapped.details ?? {};
  const target = options.indexingTarget ?? details.package ?? details.repoUrl;
  const preparingDocumentation = target?.startsWith("site:") === true;
  const lines: string[] = [
    mapped.code === "INDEXING"
      ? (options.indexingOutcome ??
        (preparingDocumentation
          ? "Documentation is being prepared."
          : "Source is being indexed."))
      : mapped.message,
  ];
  if (mapped.code === "INDEXING") {
    const rows = renderPreparationEstimates(details.indexingEstimates);
    lines.push("", "Preparing:");
    if (rows.length) lines.push(...rows);
    else {
      const timing =
        formatIndexingDuration(details.indexingEstimate, "compact") ??
        "no estimate available";
      lines.push(
        target
          ? `  - ${JSON.stringify(target).slice(1, -1)} (${preparingDocumentation ? "preparing documentation" : "indexing"}, ${timing})`
          : `Indexing (${timing}).`,
      );
    }
  }
  const versions = details.availableVersions?.map((entry) =>
    mapped.code === "INDEXING"
      ? (entry.version ?? entry.ref)
      : entry.version
        ? `${entry.version} (ref: ${entry.ref})`
        : entry.ref,
  );
  const refs = details.availableRefs?.map((entry) => entry.ref);
  if (versions?.length)
    lines.push(
      `${mapped.code === "INDEXING" ? "Indexed" : "Available"} versions/refs: ${versions.slice(0, 5).join(", ")}${versions.length > 5 ? ` (+${versions.length - 5} more)` : ""}`,
    );
  if (refs?.length)
    lines.push(
      `${mapped.code === "INDEXING" ? "Indexed" : "Available"} refs: ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ` (+${refs.length - 5} more)` : ""}`,
    );
  if (details.latestIndexed)
    lines.push(`Latest indexed version: ${details.latestIndexed}`);
  if (details.publishedVersions?.length)
    lines.push(`Published versions: ${details.publishedVersions.join(", ")}`);
  if (details.refKinds?.length)
    lines.push(`Matching ref types: ${details.refKinds.join(", ")}`);
  if (details.side) lines.push(`Comparison side: ${details.side}`);
  if (details.codeDiffResolution)
    lines.push(
      `Compared commits: ${details.codeDiffResolution.from.commitSha} -> ${details.codeDiffResolution.to.commitSha}`,
    );
  if (details.updateCommand)
    lines.push("", `Update with: ${details.updateCommand}`);
  const retryAfterSeconds =
    details.retryAfterSeconds ??
    (details.retryAfterMs === undefined
      ? undefined
      : details.retryAfterMs / 1000);
  if (
    !details.action &&
    mapped.retryable &&
    mapped.code === "RATE_LIMITED" &&
    retryAfterSeconds !== undefined
  )
    lines.push("", `Try again in ${Math.ceil(retryAfterSeconds)} seconds.`);
  if (
    details.hint &&
    !lines.join("\n").includes(details.hint) &&
    details.hint !== details.action
  )
    lines.push("", details.hint);
  const width = options.width ?? 80;
  const output = lines.flatMap((line) => wrapProse(line, width));
  // Keep callable/copyable action operands intact, and avoid repeating host remediation.
  if (details.action && !lines.join("\n").includes(details.action))
    output.push("", ...details.action.split("\n").map(sanitizeTerminalText));
  return output.join("\n");
}

function wrapProse(text: string, width: number): string[] {
  return text.split("\n").flatMap((line) => {
    const safe = sanitizeTerminalText(line);
    if (!safe) return [""];
    const indent = safe.startsWith("  - ") ? "    " : "";
    const words = safe.trim().split(/\s+/);
    let current = safe.startsWith("  - ") ? "  -" : "";
    if (current) words.shift();
    const lines: string[] = [];
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && terminalWidth(next) > width) {
        lines.push(current);
        current = `${indent}${word}`;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines;
  });
}
