/**
 * Hand-crafted response envelope for the `package_changelog` tool.
 * Shared by CLI `--json` output and MCP `content[0].text`. Terminal
 * formatter is CLI-only but reads from the same envelope shape so
 * the two surfaces cannot drift.
 *
 * Key design commitments:
 *
 * - **Data-first envelope.** Every top-level key is driven by what
 *   the backend returned and what the caller asked for, not by
 *   additional caller flags. `entries` is `{count, items}` whenever
 *   the backend returned entries. Package version responses may have
 *   entries with no concrete changelog source; only no-source +
 *   no-entry responses are promoted to `NOT_FOUND`.
 * - **Mode derived from request.** `mode: "range"` iff `fromVersion`
 *   was non-null after normalisation; `"latest"` otherwise. Lowercase
 *   strings matching the backend's doc-comment convention.
 * - **`entries.count` computed client-side** from `items.length`. No
 *   backend-count field is selected on the wire, so the invariant
 *   `entries.count === entries.items.length` always holds.
 * - **`version` kept when null**, every other per-entry nullable
 *   field stripped *only when null/undefined*. Present-but-empty
 *   values (empty-string `body`, empty `htmlUrl`) are preserved so
 *   agents can distinguish "backend returned no content" from
 *   "backend didn't return this field". Rationale: `version` is the
 *   primary key agents index entries by, so keeping the slot
 *   present (even with `null`) makes it safe to write
 *   `entries.items.map(e => e.version)` without guarding. Other
 *   fields are metadata; their absence is signal, but empty values
 *   are their own signal.
 * - **`filter.*` emits only when caller explicitly supplied them.**
 *   Backend defaults (latest = 10, to = latest version) don't echo.
 *   The request builder produces an `explicitFilterFields` set that
 *   the envelope consults here.
 * - **`include_bodies` lever.** When false, each entry drops its
 *   `body` field. Other fields (`version`, `normalizedVersion`,
 *   `publishedAt`, `htmlUrl`) remain so the tool still produces the
 *   version / date / URL timeline.
 * - **`metadata` dropped from envelope.** Source-specific opaque
 *   JSON; live-smoke observations will inform a typed passthrough
 *   later. TODO(backend) marker in the service types.
 */

import type { ChangelogReport } from "../services/index.js";
import { colorize, dim } from "./colors.js";
import type { ExplicitFilterField } from "./package-changelog-request.js";

/** Two backend-documented modes, kept lowercase. */
export type ChangelogMode = "latest" | "range";

export interface LeanChangelogEntry {
  /** Present with a possibly-null value — the primary index key. */
  version: string | null;
  /** Backend-normalised version for sorting. Stripped when null. */
  normalizedVersion?: string;
  /** ISO8601 date string. Stripped when null. */
  publishedAt?: string;
  /** Absolute URL to release / commit / doc page. Stripped when null. */
  htmlUrl?: string;
  /** Raw markdown. Stripped when null OR when include_bodies=false. */
  body?: string;
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
  gitRef?: string;
}

export interface LeanChangelogEnvelope {
  /** Present for spec addressing. */
  registry?: string;
  /** Present for spec addressing. */
  name?: string;
  /** Present for repo-URL addressing. */
  repoUrl?: string;
  /** `"releases"` | `"changelog_file"` | `"hexdocs"` when resolved. Absent for package versions with no changelog entry. */
  source?: string;
  /** Derived from request params. */
  mode: ChangelogMode;
  entries: LeanEntriesBlock;
  filter?: LeanChangelogFilter;
}

export interface BuildChangelogPayloadOptions {
  /** Caller's addressing echo; one of the two is present. */
  registry?: string;
  name?: string;
  repoUrl?: string;
  /** Mode the caller requested. Built from `params.fromVersion`. */
  mode: ChangelogMode;
  explicitFilterFields: Set<ExplicitFilterField>;
  /** When false, drop each entry's `body` field. Default: true. */
  includeBodies: boolean;
  /** Caller's raw inputs, echoed under `filter.*` when explicit. */
  fromVersion?: string;
  toVersion?: string;
  limit?: number;
  gitRef?: string;
}

export function buildPackageChangelogSuccessPayload(
  report: ChangelogReport,
  options: BuildChangelogPayloadOptions,
): LeanChangelogEnvelope {
  const items = report.entries.map((entry) => {
    const lean: LeanChangelogEntry = {
      version: entry.version ?? null,
    };
    // Non-null-strip policy: present-but-null/undefined fields are
    // stripped; present-but-empty values (empty-string body, empty
    // URL) are preserved so agents can distinguish "backend returned
    // no content" from "backend didn't return this field". The only
    // mutation is `include_bodies: false`, which explicitly drops
    // `body` regardless of its value.
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
  if (options.repoUrl) envelope.repoUrl = options.repoUrl;

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
  if (explicitFilterFields.has("gitRef") && options.gitRef) {
    filter.gitRef = options.gitRef;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// --------------------------------------------------------------------
// Terminal formatter (CLI-only).
// --------------------------------------------------------------------

export interface FormatChangelogTerminalOptions {
  verbose?: boolean;
  useColors: boolean;
  fullBodyHint?: string;
}

/**
 * Default line cap applied to the body preview when `--verbose` is
 * not set. Release notes run long (100+ lines on typescript /
 * kubernetes); an unbounded default would dominate the terminal
 * scrollback. A 10-line cap shows the first one or two sections
 * plus any preamble, which is usually enough to answer "what
 * shipped". `--verbose` lifts the cap; `--no-body` (which flows
 * through the envelope builder as `body: undefined`) skips this
 * branch entirely.
 */
const DEFAULT_BODY_PREVIEW_LINES = 10;

/**
 * Format an envelope for terminal display. The summary header leads
 * with the addressing + count + source; each entry renders as
 * `version  date  url` plus an indented body preview. The preview
 * is capped at {@link DEFAULT_BODY_PREVIEW_LINES} lines by default,
 * expanded fully under `--verbose`, and skipped entirely when the
 * caller passed `--no-body` (bodies are absent from the envelope
 * on that path).
 *
 * Edge cases:
 * - Empty entries: summary header + "No entries in this range.".
 * - Missing `publishedAt`: `—` in the date column.
 * - Missing `version`: `(unversioned)`; backend newest-first order
 *   preserved (we don't re-sort).
 * - Empty-string body: rendered with a neutral `(empty release
 *   notes)` sentinel so agents can tell it apart from
 *   `--no-body` / bodies-absent.
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
      : dim("—", options.useColors);
    const url = entry.htmlUrl
      ? dim(entry.htmlUrl, options.useColors)
      : dim("(no link)", options.useColors);
    const padded = padColumn(version, versionWidth);
    const datePadded = padColumn(date, dateWidth);
    lines.push(
      `${colorize(padded, "bold", options.useColors)}  ${datePadded}  ${url}`,
    );
    if (entry.body != null) {
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
  const cap = options.verbose ? bodyLines.length : DEFAULT_BODY_PREVIEW_LINES;
  const visible = bodyLines.slice(0, cap);
  for (const bodyLine of visible) {
    lines.push(`  ${dim(bodyLine, options.useColors)}`);
  }
  const hidden = bodyLines.length - visible.length;
  if (hidden > 0) {
    lines.push(
      `  ${dim(`… (+${hidden} more line${hidden === 1 ? "" : "s"} — ${options.fullBodyHint ?? "use --verbose for the full body"})`, options.useColors)}`,
    );
  }
}

function buildSummaryLine(
  envelope: LeanChangelogEnvelope,
  options: FormatChangelogTerminalOptions,
): string {
  const identity =
    envelope.registry && envelope.name
      ? `${envelope.name} · ${envelope.registry}`
      : (envelope.repoUrl ?? "(unknown)");
  const sourceLabel = envelope.source
    ? humanizeSource(envelope.source)
    : "package versions";
  const modeLabel =
    envelope.mode === "range" ? rangeLabel(envelope) : latestLabel(envelope);
  const countLabel = `${envelope.entries.count} ${plural("entry", "entries", envelope.entries.count)}`;
  const parts = [identity, `source: ${sourceLabel}`, modeLabel, countLabel];
  return colorize(parts.join(" · "), "bold", options.useColors);
}

function rangeLabel(envelope: LeanChangelogEnvelope): string {
  const from = envelope.filter?.fromVersion ?? "earliest";
  const to = envelope.filter?.toVersion ?? "latest";
  return `range ${from} → ${to}`;
}

function latestLabel(envelope: LeanChangelogEnvelope): string {
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
    default:
      return source;
  }
}

function plural(singular: string, pluralForm: string, count: number): string {
  return count === 1 ? singular : pluralForm;
}

function formatDate(iso: string): string {
  // Slice YYYY-MM-DD without turning this into a full Date parsing
  // problem. Backend returns ISO8601; anything shorter stays verbatim.
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
  // Minimal ANSI CSI stripper — the terminal formatter only uses
  // SGR sequences produced by `colorize` / `dim`.
  return text.replace(ANSI_SGR_PATTERN, "");
}
