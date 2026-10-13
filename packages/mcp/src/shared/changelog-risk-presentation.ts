import type {
  ChangelogRiskCoverage,
  ChangelogRiskItem,
} from "@githits/core-internal";
import { sanitizeTerminalText } from "./terminal-text.js";

/** Shared statement presentation; policy and counts remain backend-owned. */
export interface ClassifiedChangelogItem
  extends Omit<ChangelogRiskItem, "tier"> {
  tier: "must_act" | "should_know" | "unclassified";
}

export function normaliseChangelogRiskItems(
  items: ChangelogRiskItem[],
): ClassifiedChangelogItem[] {
  return items.map((item) => ({
    ...item,
    tier: item.tier.toLowerCase() as ClassifiedChangelogItem["tier"],
    kind: item.kind?.toLowerCase(),
    source: item.source?.toLowerCase(),
  }));
}

export function changelogRiskSections<Item extends ClassifiedChangelogItem>(
  items: Item[],
): Array<{ label: string; items: Item[] }> {
  return [
    {
      label: "Requires action",
      items: items.filter(
        (item) => item.tier === "must_act" && !item.ambiguous,
      ),
    },
    {
      label: "Possibly requires action",
      items: items.filter((item) => item.tier === "must_act" && item.ambiguous),
    },
    {
      label: "Should know",
      items: items
        .filter((item) => item.tier === "should_know")
        .sort((a, b) => Number(a.ambiguous) - Number(b.ambiguous)),
    },
    {
      label: "Too long to classify - read it",
      items: items.filter((item) => item.tier === "unclassified"),
    },
  ];
}

export function changelogRiskSummary(c: ChangelogRiskCoverage): string {
  return `${c.itemsMustActConfident} require action${c.itemsMustActAmbiguous ? ` (+${c.itemsMustActAmbiguous} uncertain)` : ""} | ${c.itemsShouldKnowConfident} should know${c.itemsShouldKnowAmbiguous ? ` (+${c.itemsShouldKnowAmbiguous} uncertain)` : ""} | ${c.itemsUnclassified} too long to classify`;
}

export function changelogRiskCoverageText(c: ChangelogRiskCoverage): string {
  return `${c.versionsClassified} classified | ${c.versionsNotAssessed} not assessed | ${c.versionsWithoutNotes} without notes${c.versionsUnparseable ? ` | ${c.versionsUnparseable} unparseable` : ""} | ${c.unitsNoImpact} statements labeled no impact`;
}

/** Render the observed release-note Markdown as visible words and source references. */
export function releaseNoteText(
  text: string,
  reference: (url: string) => string,
): string {
  const plain = safeRiskText(
    text
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\s*(?:>\s*)+/, "")
          .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
          .replace(/\[!([A-Z]+)\]/g, "$1:"),
      )
      .join(" "),
  )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    // Note-authored numbers must not impersonate our source citations.
    .replace(/\[(S?\d+)\](?!\()/g, "($1)");
  return plain
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/g,
      (
        _match: string,
        label: string | undefined,
        linkedUrl: string | undefined,
        bareUrl: string | undefined,
      ): string => {
        if (linkedUrl) return `${label ?? ""} ${reference(linkedUrl)}`.trim();
        const rawUrl = bareUrl ?? "";
        const url = rawUrl.replace(/[.,;:!?)]*$/, "");
        return `${reference(url)}${rawUrl.slice(url.length)}`;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}

export const RISK_KIND_LABELS: Record<string, string> = {
  removes_or_renames_api: "removal",
  changes_behavior_or_default: "behavior",
  raises_runtime_or_platform_requirement: "runtime/platform",
  changes_packaging_or_module_format: "packaging/modules",
  deprecates_without_removal: "deprecation",
  security_fix: "security fix",
  notable_change: "notable change",
};

export const PENDING_CLASSIFICATION_MESSAGE =
  "Classification is still running or may have failed. Rerun in a few seconds to a minute to fill not-assessed versions from completed stored labels, without rerunning the model.";

export function safeRiskText(value: string): string {
  return sanitizeTerminalText(value.replace(/\s+/g, " ")).trim();
}
