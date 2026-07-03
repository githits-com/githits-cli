/**
 * Pure formatting helpers for the init setup/uninstall "what changed" output.
 *
 * Kept free of IO and `console` so it can be unit-tested directly and reused by
 * both install and uninstall rendering. The genuinely shared units are the
 * `SetupChange` data shape, the display row (`ChangeRow`), and
 * `renderChangeRows`; executors in `setup-handlers.ts` produce `SetupChange`s
 * that map onto rows at the call site.
 */

import { colorize, type colors } from "@githits/mcp/internal";
import type { FileSystemService } from "../../services/filesystem-service.js";
import type { CliCommand, SetupConfig } from "./agent-definitions.js";

/**
 * A single structured change produced by a setup operation, for display and
 * `--json` auditing. Verbs are set correctly by construction at each executor,
 * so the union never needs to represent e.g. a command that was "created".
 *
 * Lives here (not in setup-handlers) because it is a display/serialization
 * shape consumed by the formatter and the JSON payload, and keeping it here
 * keeps the module dependency direction one-way (setup-handlers → setup-format).
 */
export type SetupChange =
  | {
      kind: "config-file";
      path: string;
      change: "created" | "updated" | "unchanged";
    }
  | { kind: "command"; command: string; change: "ran" | "unchanged" }
  | {
      kind: "skill" | "managed-block";
      path: string;
      change: "created" | "updated" | "unchanged";
    };

/**
 * The uninstall counterpart of {@link SetupChange}. The verb describes the
 * action actually taken on the target: editing a shared config file to strip
 * the GitHits entry is an "updated" (the file is kept, not deleted); running a
 * removal command is "ran". Either is "unchanged" when GitHits was already
 * absent. This mirrors install, where commands are "ran" and files are
 * created/updated.
 */
export type UninstallChange =
  | { kind: "config-file"; path: string; change: "updated" | "unchanged" }
  | { kind: "command"; command: string; change: "ran" | "unchanged" }
  | {
      kind: "skill" | "managed-block";
      path: string;
      change: "removed" | "unchanged";
    };

/** A single rendered output row: glyph tone + three aligned columns. */
export interface ChangeRow {
  /** Glyph + emphasis: ok (✓), warn (⚠), error (✗). */
  tone: "ok" | "warn" | "error";
  /** Left column — usually the agent/client name. */
  label: string;
  /** Middle column — status verb (created/updated/unchanged/ran/removed/failed). */
  verb: string;
  /** Right column — collapsed config path or the command that ran. */
  detail: string;
}

/** Closed vocabulary of status verbs across install + uninstall rendering. */
export const CHANGE_VERBS = [
  "created",
  "updated",
  "unchanged",
  "ran",
  "removed",
  "failed",
] as const;

/** Width of the verb column, derived from the closed verb vocabulary. */
export const CHANGE_VERB_WIDTH = CHANGE_VERBS.reduce(
  (width, verb) => Math.max(width, verb.length),
  0,
);

const TONE_GLYPH: Record<
  ChangeRow["tone"],
  { glyph: string; color: keyof typeof colors }
> = {
  ok: { glyph: "✓", color: "green" },
  warn: { glyph: "⚠", color: "yellow" },
  error: { glyph: "✗", color: "red" },
};

export interface RenderChangeRowsOptions {
  useColors: boolean;
  /** Width of the label column, precomputed across the batch for alignment. */
  labelWidth: number;
  /** Width of the verb column, precomputed across the batch for alignment. */
  verbWidth: number;
}

/**
 * Render aligned change rows. Padding is applied to raw text before any color
 * codes are added, so ANSI escapes never corrupt column widths. The glyph is a
 * fixed single visible character regardless of color.
 *
 * Column widths are caller-supplied (see {@link changeRowColumnWidths}) because
 * rows are printed incrementally inside a per-agent loop and cannot all be
 * collected before the first line is emitted.
 */
export function renderChangeRows(
  rows: ChangeRow[],
  options: RenderChangeRowsOptions,
): string[] {
  const { useColors, labelWidth, verbWidth } = options;
  return rows.map((row) => {
    if (row.label === "" && row.verb === "") {
      const detailOffset = 10 + labelWidth + verbWidth;
      return `${" ".repeat(detailOffset)}${row.detail}`.trimEnd();
    }
    const { glyph, color } = TONE_GLYPH[row.tone];
    const coloredGlyph = colorize(glyph, color, useColors);
    const label = row.label.padEnd(labelWidth);
    const verb = colorize(row.verb.padEnd(verbWidth), "dim", useColors);
    return `    ${coloredGlyph} ${label}  ${verb}  ${row.detail}`.trimEnd();
  });
}

/** Compute aligned column widths from a batch of rows. */
export function changeRowColumnWidths(rows: ChangeRow[]): {
  labelWidth: number;
  verbWidth: number;
} {
  let labelWidth = 0;
  let verbWidth = 0;
  for (const row of rows) {
    if (row.label.length > labelWidth) labelWidth = row.label.length;
    if (row.verb.length > verbWidth) verbWidth = row.verb.length;
  }
  return { labelWidth, verbWidth };
}

/**
 * Collapse a known root prefix (home or cwd) in an absolute config path for
 * display. Picks the longest matching prefix so a repository checked out under
 * the home directory still renders as `./…` rather than `~/…`.
 *
 * Separator-agnostic (`/` or `\`) so it behaves correctly for Windows paths in
 * tests and at runtime.
 */
export function formatConfigPath(path: string, fs: FileSystemService): string {
  const candidates: Array<{ prefix: string; replacement: string }> = [
    { prefix: fs.getCwd(), replacement: "." },
    { prefix: fs.getHomeDir(), replacement: "~" },
  ];

  let best: { length: number; collapsed: string } | null = null;
  for (const { prefix, replacement } of candidates) {
    const collapsed = collapsePrefix(path, prefix, replacement);
    if (collapsed === null) continue;
    if (!best || prefix.length > best.length) {
      best = { length: prefix.length, collapsed };
    }
  }
  return best ? best.collapsed : path;
}

/** Whether a path looks like a Windows path (drive letter or backslashes). */
function isWindowsLikePath(path: string): boolean {
  return /^[a-zA-Z]:/.test(path) || path.includes("\\");
}

/**
 * Replace `prefix` with `replacement` when `path` is `prefix` itself or sits
 * directly beneath it. Returns null when `path` is not under `prefix`. The
 * boundary must be a path separator so `/home/user2` is not treated as being
 * under `/home/user`. Windows paths are matched case-insensitively (the
 * filesystem is), while preserving the original casing in the output.
 */
function collapsePrefix(
  path: string,
  prefix: string,
  replacement: string,
): string | null {
  if (!prefix || prefix.length === 0) return null;
  const caseInsensitive = isWindowsLikePath(prefix);
  const cmpPath = caseInsensitive ? path.toLowerCase() : path;
  const cmpPrefix = caseInsensitive ? prefix.toLowerCase() : prefix;
  if (cmpPath === cmpPrefix) return replacement;
  if (!cmpPath.startsWith(cmpPrefix)) return null;
  const boundary = path.charAt(prefix.length);
  if (boundary !== "/" && boundary !== "\\") return null;
  return `${replacement}${path.slice(prefix.length)}`;
}

/** Render a CLI command + args as a copy-pasteable string. */
export function formatCliCommand(cmd: CliCommand): string {
  return cmd.args.length > 0
    ? `${cmd.command} ${cmd.args.join(" ")}`
    : cmd.command;
}

/**
 * Describe a setup config as a list of `unchanged` changes, without executing
 * anything. Used to render already-configured clients (the install
 * short-circuit) and pre-skipped composite steps, so they still report their
 * path/command instead of vanishing from the output.
 */
export function describeConfigAsUnchanged(config: SetupConfig): SetupChange[] {
  switch (config.method) {
    case "config-file":
      return [
        { kind: "config-file", path: config.configPath, change: "unchanged" },
      ];
    case "cli":
      return config.commands.map((cmd) => ({
        kind: "command" as const,
        command: formatCliCommand(cmd),
        change: "unchanged" as const,
      }));
    case "skill":
      return [{ kind: "skill", path: config.targetPath, change: "unchanged" }];
    case "managed-block":
      return [
        {
          kind: "managed-block",
          path: config.targetPath,
          change: "unchanged",
        },
      ];
    case "composite":
      return config.steps.flatMap((step) => describeConfigAsUnchanged(step));
  }
}
