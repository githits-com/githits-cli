/**
 * Hand-crafted response envelope for the `package_changelog` tool.
 * Shared by CLI `--json`, CLI terminal output, and MCP `content[0].text`.
 *
 * Key design commitments:
 *
 * - **Data-first envelope.** Every top-level key is driven by what
 *   the backend returned and what the caller asked for.
 * - **Mode derived from request.** `latest`, `exact`, or `range`.
 * - **`entries.count` computed client-side** from `items.length`.
 * - **`version` kept when null**, every other per-entry nullable
 *   field stripped only when null/undefined.
 * - **`filter.*` emits only when caller explicitly supplied them.**
 * - **Body omission lever.** When requested, each entry drops its
 *   `body` field.
 * - Exact selected-release entries add `hasChangelog`. Timeline
 *   entries omit that field.
 */

import type { ChangelogReport } from "@githits/core-internal";
import { colorize, dim, highlight } from "./colors.js";
import type { ExplicitFilterField } from "./package-changelog-request.js";

export type ChangelogMode = "latest" | "exact" | "range";

export interface LeanChangelogEntry {
  /** Present with a possibly-null value — the primary index key. */
  version: string | null;
  /** Backend-normalised version for sorting. Stripped when null. */
  normalizedVersion?: string;
  /** ISO8601 date string. Stripped when null. */
  publishedAt?: string;
  /** Absolute URL to release / commit / doc page. Stripped when null. */
  htmlUrl?: string;
  /** Raw markdown. Stripped when null OR when bodies are omitted. */
  body?: string;
  /** Present only for exact selected-release results. */
  hasChangelog?: boolean;
}

export interface LeanEntriesBlock {
  /** Client-computed. Matches `items.length` by construction. */
  count: number;
  items: LeanChangelogEntry[];
}

/**
 * `filter` block — present only when the caller supplied at least
 * one explicit input. Each field inside emits only when it was
 * caller-supplied; backend defaults never round-trip as caller
 * intent.
 */
export interface LeanChangelogFilter {
  fromVersion?: string;
  toVersion?: string;
  limit?: number;
  version?: string;
}

export interface LeanChangelogEnvelope {
  /** Present for spec addressing. */
  registry?: string;
  /** Present for spec addressing. */
  name?: string;
  /**
   * Timeline source or exact `detailSource` normalised to lower snake
   * case. Absent when the backend returned no concrete source.
   */
  source?: string;
  /** Derived from request params. */
  mode: ChangelogMode;
  entries: LeanEntriesBlock;
  filter?: LeanChangelogFilter;
}

export interface BuildChangelogPayloadOptions {
  registry?: string;
  name?: string;
  mode: ChangelogMode;
  explicitFilterFields: Set<ExplicitFilterField>;
  /** When false, drop each entry's `body` field. Default: true. */
  includeBodies: boolean;
  fromVersion?: string;
  toVersion?: string;
  limit?: number;
  version?: string;
}

export function buildPackageChangelogSuccessPayload(
  report: ChangelogReport,
  options: BuildChangelogPayloadOptions,
): LeanChangelogEnvelope {
  const items = report.entries.map((entry) => {
    const lean: LeanChangelogEntry = {
      version: entry.version ?? null,
    };
    if (entry.normalizedVersion != null) {
      lean.normalizedVersion = entry.normalizedVersion;
    }
    if (entry.publishedAt != null) {
      lean.publishedAt = entry.publishedAt;
    }
    if (entry.htmlUrl != null) {
      lean.htmlUrl = entry.htmlUrl;
    }
    if (options.includeBodies && entry.body != null) {
      lean.body = entry.body;
    }
    if (options.mode === "exact" && entry.hasChangelog !== undefined) {
      lean.hasChangelog = entry.hasChangelog;
    }
    return lean;
  });

  const envelope: LeanChangelogEnvelope = {
    mode: options.mode,
    entries: {
      count: items.length,
      items,
    },
  };

  if (report.source) envelope.source = report.source;

  if (options.registry) envelope.registry = options.registry;
  if (options.name) envelope.name = options.name;

  const filter = buildFilterBlock(options);
  if (filter) envelope.filter = filter;

  return envelope;
}

function buildFilterBlock(
  options: BuildChangelogPayloadOptions,
): LeanChangelogFilter | undefined {
  const { explicitFilterFields } = options;
  if (explicitFilterFields.size === 0) return undefined;
  const filter: LeanChangelogFilter = {};
  if (explicitFilterFields.has("fromVersion") && options.fromVersion) {
    filter.fromVersion = options.fromVersion;
  }
  if (explicitFilterFields.has("toVersion") && options.toVersion) {
    filter.toVersion = options.toVersion;
  }
  if (explicitFilterFields.has("limit") && options.limit !== undefined) {
    filter.limit = options.limit;
  }
  if (explicitFilterFields.has("version") && options.version) {
    filter.version = options.version;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// --------------------------------------------------------------------
// Shared terminal/text formatter used by both CLI and MCP.
// --------------------------------------------------------------------

export interface FormatChangelogTerminalOptions {
  verbose?: boolean;
  useColors: boolean;
  fullBodyHint?: string;
  bodyPreviewLines?: number;
}

const DEFAULT_BODY_PREVIEW_LINES = 10;

/**
 * Format an envelope for terminal display. The summary header leads
 * with the addressing + count + source; each entry renders as
 * `version  date  url` plus an indented body preview.
 */
export function formatPackageChangelogTerminal(
  envelope: LeanChangelogEnvelope,
  options: FormatChangelogTerminalOptions,
): string {
  const lines: string[] = [];
  lines.push(buildSummaryLine(envelope, options));
  lines.push("");

  if (envelope.entries.items.length === 0) {
    lines.push(dim("No entries in this range.", options.useColors));
    lines.push("");
    return lines.join("\n");
  }

  const versionWidth = computeVersionColumnWidth(envelope.entries.items);
  const dateWidth = 10; // YYYY-MM-DD

  for (const entry of envelope.entries.items) {
    const version = entry.version ?? "(unversioned)";
    const date = entry.publishedAt
      ? formatDate(entry.publishedAt)
      : dim("-", options.useColors);
    const url = entry.htmlUrl
      ? dim(entry.htmlUrl, options.useColors)
      : dim("(no link)", options.useColors);
    const padded = padColumn(version, versionWidth);
    const datePadded = padColumn(date, dateWidth);
    lines.push(
      `${highlight(`${padded}  ${datePadded}`, options.useColors)}  ${url}`,
    );
    if (entry.hasChangelog === false) {
      lines.push("");
      lines.push(
        `  ${dim("Release notes are unavailable.", options.useColors)}`,
      );
    } else if (entry.body != null) {
      appendBodyLines(lines, entry.body, options);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function appendBodyLines(
  lines: string[],
  body: string,
  options: FormatChangelogTerminalOptions,
): void {
  lines.push("");
  if (body.length === 0) {
    lines.push(`  ${dim("(empty release notes)", options.useColors)}`);
    return;
  }
  const bodyLines = body.split("\n");
  const cap = options.verbose
    ? bodyLines.length
    : (options.bodyPreviewLines ?? DEFAULT_BODY_PREVIEW_LINES);
  const visible = bodyLines.slice(0, cap);
  for (const bodyLine of visible) {
    lines.push(`  ${bodyLine}`);
  }
  const hidden = bodyLines.length - visible.length;
  if (hidden > 0) {
    lines.push(
      `  ${dim(`... (+${hidden} more line${hidden === 1 ? "" : "s"} - ${options.fullBodyHint ?? "use --verbose for the full body"})`, options.useColors)}`,
    );
  }
}

function buildSummaryLine(
  envelope: LeanChangelogEnvelope,
  options: FormatChangelogTerminalOptions,
): string {
  const identity =
    envelope.registry && envelope.name
      ? `${envelope.name} | ${envelope.registry}`
      : "(unknown)";
  const sourceLabel = envelope.source
    ? humanizeSource(envelope.source)
    : "package versions";
  const modeLabel = modeSummary(envelope);
  const countLabel = `${envelope.entries.count} ${plural("entry", "entries", envelope.entries.count)}`;
  const parts = [identity, `source: ${sourceLabel}`, modeLabel, countLabel];
  return colorize(parts.join(" | "), "bold", options.useColors);
}

function modeSummary(envelope: LeanChangelogEnvelope): string {
  if (envelope.mode === "exact") {
    const version =
      envelope.filter?.version ?? envelope.entries.items[0]?.version;
    return version ? `exact ${version}` : "exact";
  }
  if (envelope.mode === "range") {
    const from = envelope.filter?.fromVersion ?? "earliest";
    const to = envelope.filter?.toVersion ?? "latest";
    return `range (${from}, ${to}]`;
  }
  if (envelope.filter?.toVersion) {
    return `latest up to ${envelope.filter.toVersion}`;
  }
  return "latest";
}

function humanizeSource(source: string): string {
  switch (source) {
    case "releases":
      return "GitHub Releases";
    case "changelog_file":
      return "CHANGELOG.md";
    case "hexdocs":
      return "HexDocs";
    case "registry_release_notes":
      return "registry release notes";
    case "registry_link":
      return "registry link";
    case "generated_github_url":
      return "generated GitHub URL";
    case "package_version":
      return "package versions";
    default:
      return source;
  }
}

function plural(singular: string, pluralForm: string, count: number): string {
  return count === 1 ? singular : pluralForm;
}

function formatDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  return iso;
}

function computeVersionColumnWidth(items: LeanChangelogEntry[]): number {
  let width = 0;
  for (const item of items) {
    const label = item.version ?? "(unversioned)";
    if (label.length > width) width = label.length;
  }
  return width;
}

function padColumn(text: string, width: number): string {
  const visible = stripAnsi(text);
  if (visible.length >= width) return text;
  return text + " ".repeat(width - visible.length);
}

const ESC = String.fromCharCode(0x1b);
const ANSI_SGR_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, "");
}
