/**
 * Markdown report generator. Takes the flat list of run cells from
 * `run.ts` and emits a report with:
 *
 * 1. Headline numbers — compliance % per (driver × variant).
 * 2. Compliance matrix grouped by category.
 * 3. Per-cell detail table with response excerpts for spot-checking.
 *
 * MVP shape: small + readable. Stats are simple percentages, no error
 * bars. If the signal is borderline we add multiple runs per cell in
 * a later iteration.
 */

import type { RunCell } from "./run.js";

export interface ReportMetadata {
  invocation: string;
  surface?: string;
  claudeModel?: string;
  codexModel?: string;
}

export function renderReport(
  cells: readonly RunCell[],
  meta: ReportMetadata,
): string {
  const lines: string[] = [];
  lines.push("# Prompt Injection Eval — MVP run");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Cells: ${cells.length}`);
  if (meta.surface) lines.push(`Surface: \`${meta.surface}\``);
  lines.push(`Invocation: \`${meta.invocation}\``);
  if (meta.claudeModel) lines.push(`Claude model: \`${meta.claudeModel}\``);
  if (meta.codexModel) lines.push(`Codex model: \`${meta.codexModel}\``);
  lines.push("");

  renderHeadline(lines, cells);
  renderCategoryBreakdown(lines, cells);
  renderPerCellTable(lines, cells);
  renderErrorsIfAny(lines, cells);

  return `${lines.join("\n")}\n`;
}

function renderHeadline(lines: string[], cells: readonly RunCell[]): void {
  lines.push("## Headline — compliance % by driver × variant");
  lines.push("");
  const drivers = uniqueSorted(cells.map((c) => c.driver));
  const variantIds = uniqueSorted(cells.map((c) => c.variant.id));

  lines.push(`| driver | ${variantIds.join(" | ")} |`);
  lines.push(`| --- | ${variantIds.map(() => "---").join(" | ")} |`);
  for (const driver of drivers) {
    const row: string[] = [driver];
    for (const variantId of variantIds) {
      const subset = cells.filter(
        (c) => c.driver === driver && c.variant.id === variantId,
      );
      row.push(formatComplianceCell(subset));
    }
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    "*Lower is better.* `complied / total` shown beneath each percentage.",
  );
  lines.push("");
}

function renderCategoryBreakdown(
  lines: string[],
  cells: readonly RunCell[],
): void {
  lines.push("## Breakdown by attack category");
  lines.push("");
  const categories = uniqueSorted(cells.map((c) => c.attack.category));
  const drivers = uniqueSorted(cells.map((c) => c.driver));
  const variantIds = uniqueSorted(cells.map((c) => c.variant.id));

  for (const driver of drivers) {
    lines.push(`### ${driver}`);
    lines.push("");
    lines.push(`| category | ${variantIds.join(" | ")} |`);
    lines.push(`| --- | ${variantIds.map(() => "---").join(" | ")} |`);
    for (const category of categories) {
      const row: string[] = [category];
      for (const variantId of variantIds) {
        const subset = cells.filter(
          (c) =>
            c.driver === driver &&
            c.variant.id === variantId &&
            c.attack.category === category,
        );
        row.push(formatComplianceCell(subset));
      }
      lines.push(`| ${row.join(" | ")} |`);
    }
    lines.push("");
  }
}

function renderPerCellTable(lines: string[], cells: readonly RunCell[]): void {
  lines.push("## Per-cell detail");
  lines.push("");
  lines.push("| driver | attack | category | variant | complied | excerpt |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const cell of cells) {
    const ok = cell.judgement.complied ? "🔴 yes" : "🟢 no";
    const excerpt = (cell.judgement.excerpt ?? "—")
      .replace(/\|/g, "\\|")
      .slice(0, 120);
    lines.push(
      `| ${cell.driver} | ${cell.attack.id} | ${cell.attack.category} | ${cell.variant.id} | ${ok} | ${excerpt} |`,
    );
  }
  lines.push("");
}

function renderErrorsIfAny(lines: string[], cells: readonly RunCell[]): void {
  const errored = cells.filter((c) => c.errored);
  if (errored.length === 0) return;
  lines.push("## Errored cells");
  lines.push("");
  lines.push(
    `${errored.length} cell(s) had an empty response (subprocess error or quota). These count as non-compliance in the totals.`,
  );
  lines.push("");
  lines.push("| driver | attack | variant | stderr (truncated) |");
  lines.push("| --- | --- | --- | --- |");
  for (const cell of errored) {
    const err = (cell.stderr ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\s+/g, " ")
      .slice(0, 200);
    lines.push(
      `| ${cell.driver} | ${cell.attack.id} | ${cell.variant.id} | ${err} |`,
    );
  }
  lines.push("");
}

function formatComplianceCell(subset: readonly RunCell[]): string {
  if (subset.length === 0) return "—";
  const errored = subset.filter((c) => c.errored).length;
  const successful = subset.filter((c) => !c.errored);
  if (successful.length === 0) {
    return `**err**<br/>${errored}/${subset.length} errored`;
  }
  const complied = successful.filter((c) => c.judgement.complied).length;
  const pct = ((complied / successful.length) * 100).toFixed(0);
  const errSuffix = errored > 0 ? `<br/>${errored} err` : "";
  return `**${pct}%**<br/>${complied}/${successful.length}${errSuffix}`;
}

function uniqueSorted<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)].sort();
}
