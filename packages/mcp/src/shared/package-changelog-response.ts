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
 * - Original bodies appear only in the explicit original-note view.
 * - Complete statements preserve missing classifications as null.
 * - Exact selected-release entries add `hasChangelog`. Timeline
 *   entries omit that field.
 */

import type {
  ChangelogReport,
  ChangelogStatement,
  ChangelogStatements,
  PackageChangelogView,
} from "@githits/core-internal";
import { RISK_KIND_LABELS } from "./changelog-risk-presentation.js";
import { colorize, dim, highlight } from "./colors.js";
import type {
  ChangelogChangesView,
  ExplicitFilterField,
} from "./package-changelog-request.js";
import { sanitizeTerminalText, wrapTerminalProse } from "./terminal-text.js";

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
  changes?: ChangelogChangesView;
  fromVersion?: string;
  toVersion?: string;
  limit?: number;
  version?: string;
}

export interface LeanChangelogEnvelope {
  statements?: LeanChangelogStatements;
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
  changes?: ChangelogChangesView;
  registry?: string;
  name?: string;
  mode: ChangelogMode;
  explicitFilterFields: Set<ExplicitFilterField>;
  view: PackageChangelogView;
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
    if (options.view === "verbatim" && entry.body != null) {
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

  if (options.view === "statements" && report.statements) {
    envelope.statements = normaliseChangelogStatements(report.statements);
  }
  if (report.source) envelope.source = report.source;

  if (options.registry) envelope.registry = options.registry;
  if (options.name) envelope.name = options.name;

  const filter = buildFilterBlock(options);
  if (filter) envelope.filter = filter;

  return envelope;
}

/** Shared lossless statement envelope; the hosts only normalize enum spelling. */
export function normaliseChangelogStatements(
  statements: ChangelogStatements,
): LeanChangelogStatements {
  return {
    ...statements,
    count: statements.items.length,
    items: statements.items.map((item) => ({
      ...item,
      ...(item.source ? { source: item.source.toLowerCase() } : {}),
      classification:
        item.classification === null
          ? null
          : {
              ...item.classification,
              tier: item.classification.tier.toLowerCase(),
              ...(item.classification.kind
                ? { kind: item.classification.kind.toLowerCase() }
                : {}),
            },
    })),
    coverage: statements.coverage.map((c) => ({
      ...c,
      status: c.status.toLowerCase(),
    })),
  };
}

function buildFilterBlock(
  options: BuildChangelogPayloadOptions,
): LeanChangelogFilter | undefined {
  const { explicitFilterFields } = options;
  if (explicitFilterFields.size === 0) return undefined;
  const filter: LeanChangelogFilter = {};
  if (options.explicitFilterFields.has("changes") && options.changes)
    filter.changes = options.changes;
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

/** Structured JSON retains evidence; only enum spelling is normalised. */
export interface LeanChangelogStatement
  extends Omit<ChangelogStatement, "classification"> {
  classification:
    | (Omit<
        NonNullable<ChangelogStatement["classification"]>,
        "tier" | "kind"
      > & { tier: string; kind?: string })
    | null;
}
export interface LeanChangelogStatements
  extends Omit<ChangelogStatements, "items" | "coverage"> {
  count: number;
  items: LeanChangelogStatement[];
  coverage: (Omit<ChangelogStatements["coverage"][number], "status"> & {
    status: string;
  })[];
}

export interface FormatChangelogTerminalOptions {
  useColors: boolean;
  fullBodyHint?: string;
  fullStatementHint?: string;
  bodyPreviewLines?: number;
  terminalWidth?: number;
}

/** One source-ordered evidence view shared by CLI and MCP. */
export function formatPackageChangelogTerminal(
  envelope: LeanChangelogEnvelope,
  options: FormatChangelogTerminalOptions,
): string {
  const width = Number.isFinite(options.terminalWidth)
    ? Math.max(20, Math.floor(options.terminalWidth as number))
    : 80;
  const lines: string[] = [];
  const prose = (text: string, indent = ""): void => {
    lines.push(...wrapTerminalProse(`${indent}${text}`, width, indent));
  };
  const identity =
    envelope.registry && envelope.name
      ? `${envelope.registry}:${envelope.name}`
      : "(unknown package)";
  lines.push(
    ...wrapTerminalProse(
      sanitizeTerminalText(
        `${identity} | ${modeSummary(envelope)} | ${envelope.entries.count} release${envelope.entries.count === 1 ? "" : "s"}`,
      ),
      width,
    ).map((line) => colorize(line, "bold", options.useColors)),
  );
  const statements = envelope.statements;
  if (statements) {
    lines.push(
      "",
      highlight("Changes (classified by agent)", options.useColors),
    );
    const c = statements.coverage;
    prose(
      `${statements.count} ${envelope.filter?.changes && envelope.filter.changes !== "all" ? "matching " : ""}statements of ${statements.totalCount} parsed | versions: ${c.filter((v) => v.status === "classified").length} classified | ${c.filter((v) => v.status === "not_assessed").length} not assessed | ${c.filter((v) => v.status === "without_notes").length} without notes | ${c.filter((v) => v.status === "unparseable").length} without parsed statements`,
      "  ",
    );
    if (
      statements.items.some(
        (item) =>
          item.classification?.tier === "must_act" ||
          item.classification?.tier === "should_know" ||
          item.classification?.tier === "no_impact",
      )
    )
      prose(
        "! requires action | kind tags: should know | plain: no impact identified",
        "  ",
      );
    const pending = c.reduce((sum, v) => sum + v.statementsNotAssessed, 0);
    const oversize = c.reduce((sum, v) => sum + v.statementsUnclassified, 0);
    if (envelope.filter?.changes && envelope.filter.changes !== "all")
      prose(
        `Filter excludes ${pending} not-assessed and ${oversize} too-long-to-classify statements.`,
        "  ",
      );
    if (pending)
      prose(
        "Classification is still in progress or failed. Rerun in a few seconds to a minute to fill stored answers.",
        "  ",
      );
    if (
      c.some((v) => v.status === "without_notes" || v.status === "unparseable")
    )
      prose("Missing or unparseable notes are not evidence of no risk.", "  ");
  }
  if (!envelope.entries.items.length)
    lines.push("", "No releases in this selection.");
  for (const entry of envelope.entries.items) {
    lines.push("");
    lines.push(
      ...wrapTerminalProse(
        sanitizeTerminalText(
          `${entry.version ?? "(unversioned)"}${entry.publishedAt ? ` (${formatDate(entry.publishedAt)})` : ""}`,
        ),
        width,
      ).map((line) => highlight(line, options.useColors)),
    );
    if (!statements) {
      if (entry.htmlUrl) prose(sanitizeTerminalText(entry.htmlUrl), "  ");
      if (entry.body !== undefined)
        renderOriginalNotes(lines, entry.body, options);
      else if (entry.hasChangelog === false)
        lines.push("  No release notes available.");
      continue;
    }
    const items = statements.items.filter(
      (item) => item.version === entry.version,
    );
    if (!items.length) {
      if (entry.htmlUrl) prose(sanitizeTerminalText(entry.htmlUrl), "  ");
      const coverage = statements.coverage.find(
        (v) => v.version === entry.version,
      );
      prose(
        coverage?.status === "without_notes"
          ? "No release notes available."
          : coverage?.status === "unparseable"
            ? "Notes contain no parsed statements."
            : "No statements match this filter.",
        "  ",
      );
      continue;
    }
    lines.push(...formatChangelogVersionStatements(items, options));
  }
  return `${lines.join("\n")}\n`;
}

/** Source ordering and trusted tags belong to the shared statement presentation. */
export function formatChangelogVersionStatements(
  items: LeanChangelogStatement[],
  options: FormatChangelogTerminalOptions & { compactNonAction?: boolean },
): string[] {
  const lines: string[] = [];
  const width = Math.max(20, options.terminalWidth ?? 80);
  const prose = (text: string, indent = ""): void => {
    lines.push(...wrapTerminalProse(`${indent}${text}`, width, indent));
  };
  let sourceIndex: number | undefined;
  let heading: string | undefined;
  for (const item of items) {
    if (sourceIndex !== item.sourceIndex) {
      sourceIndex = item.sourceIndex;
      heading = undefined;
      const source = noteSourceLabel(item.source);
      prose(
        `${source}${item.url ? `: ${sanitizeTerminalText(item.url)}` : " (source URL unavailable)"}`,
        "  ",
      );
    }
    if (item.heading !== heading) {
      heading = item.heading;
      if (heading) prose(sanitizeTerminalText(heading), "    ");
    }
    if (item.context) {
      if (item.context.heading && item.context.heading !== heading)
        prose(
          `Context for next statement - ${sanitizeTerminalText(item.context.heading)}`,
          "    ",
        );
      else prose("Context for next statement", "    ");
      renderStatementText(lines, item.context.text, "      ", width);
      if (item.context.textTruncated)
        prose(
          `Context truncated; ${options.fullStatementHint ?? "use --json for full text"}.`,
          "      ",
        );
    }
    const classification = item.classification;
    const tier = classification?.tier;
    const kind = classification?.kind
      ? RISK_KIND_LABELS[classification.kind as keyof typeof RISK_KIND_LABELS]
      : undefined;
    const annotation =
      tier === "no_impact"
        ? undefined
        : tier === "unclassified"
          ? "[too long to classify - read it]"
          : !classification
            ? "[not assessed]"
            : kind
              ? `[${tier === "must_act" ? "!" : ""}${kind}]`
              : tier === "must_act"
                ? "[!]"
                : "[should know]";
    const start = lines.length;
    renderStatementText(
      lines,
      options.compactNonAction &&
        tier !== "must_act" &&
        Array.from(item.text).length > 240
        ? `${Array.from(item.text).slice(0, 240).join("")}...`
        : item.text,
      `    * ${annotation ? `${annotation} ` : ""}${classification?.ambiguous ? "(uncertain) " : ""}`,
      width,
    );
    // Style only the trusted prefix after sanitation and wrapping. Missing
    // kinds retain explicit tier meaning; plain bullets cannot style a quote.
    if (annotation && lines[start]?.startsWith(`    * ${annotation}`)) {
      const styled =
        classification?.ambiguous || !classification
          ? dim(annotation, options.useColors)
          : colorize(
              annotation,
              tier === "must_act"
                ? "red"
                : tier === "should_know"
                  ? "yellow"
                  : "cyan",
              options.useColors,
            );
      lines[start] =
        `    * ${styled}${lines[start].slice(6 + annotation.length)}`;
    }
    if (classification?.ambiguous && lines[start])
      lines[start] = lines[start].replace(
        "(uncertain)",
        dim("(uncertain)", options.useColors),
      );
    if (
      options.compactNonAction &&
      tier !== "must_act" &&
      Array.from(item.text).length > 240
    )
      prose("Excerpt; use verbose for the full bounded quote.", "      ");
    if (item.textTruncated)
      prose(
        `Statement truncated; ${options.fullStatementHint ?? "use --json for full text"}.`,
        "      ",
      );
  }
  return lines;
}

/** Preserve nested lines and code, wrap prose without flattening the unit. */
function renderStatementText(
  lines: string[],
  text: string,
  prefix: string,
  width: number,
): void {
  const raw = text.split("\n");
  const first = sanitizeTerminalText((raw[0] ?? "").replace(/\t/g, "    "));
  const contentIndent = first.match(/^ *(?:[-*+]|\d+[.)]) +/)?.[0].length ?? 0;
  let fenced = false;
  raw.forEach((line, index) => {
    const safe = sanitizeTerminalText(line.replace(/\t/g, "    "));
    const content =
      index === 0 ? safe.replace(/^\s*(?:[-*+] |\d+[.)] )/, "") : safe;
    if (!content.trim()) {
      lines.push("");
      return;
    }
    const leading = safe.match(/^ */)?.[0] ?? "";
    const indent = index === 0 ? prefix : `      ${leading}`;
    const value = index === 0 ? content : content.trimStart();
    const isFence = value.startsWith("```") || value.startsWith("~~~");
    const nestedBullet = /^(?:[-*+]|\d+[.)]) +/.test(value.trimStart());
    const indentedCode = leading.length >= contentIndent + 4 && !nestedBullet;
    if (fenced || isFence || indentedCode) lines.push(`${indent}${value}`);
    else
      lines.push(
        ...wrapTerminalProse(
          `${indent}${value}`,
          width,
          index === 0 ? "      " : `${indent}${nestedBullet ? "  " : ""}`,
        ),
      );
    if (isFence) fenced = !fenced;
  });
}

function renderOriginalNotes(
  lines: string[],
  body: string,
  options: FormatChangelogTerminalOptions,
): void {
  if (!body.trim()) {
    lines.push("  (empty release notes)");
    return;
  }
  const bodyLines = body.split("\n");
  const cap = options.bodyPreviewLines ?? bodyLines.length;
  for (const line of bodyLines.slice(0, cap))
    lines.push(`  ${sanitizeTerminalText(line.replace(/\t/g, "    "))}`);
  if (bodyLines.length > cap)
    lines.push(
      `  ... (+${bodyLines.length - cap} more lines - ${options.fullBodyHint ?? "use --verbatim for full original notes"})`,
    );
}

function modeSummary(envelope: LeanChangelogEnvelope): string {
  if (envelope.mode === "exact")
    return `exact ${envelope.entries.items[0]?.version ?? envelope.filter?.version ?? ""}`.trim();
  if (envelope.mode === "range")
    return `range (${envelope.filter?.fromVersion ?? "earliest"}, ${envelope.filter?.toVersion ?? "latest"}] (start excluded; end included)`;
  return envelope.filter?.toVersion
    ? `latest up to ${envelope.filter.toVersion}`
    : "latest";
}
function formatDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
}
function noteSourceLabel(source?: string): string {
  if (source === "releases") return "Release notes";
  if (source === "changelog_file") return "Changelog";
  if (source === "hexdocs") return "HexDocs";
  if (source === "registry_release_notes") return "Registry notes";
  return source ? sanitizeTerminalText(source) : "Notes";
}
