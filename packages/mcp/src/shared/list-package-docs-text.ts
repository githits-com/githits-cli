import {
  buildCodeReadCommand,
  buildDocsReadCommand,
} from "./follow-up-command-text.js";
import type { LeanPackageDocsEnvelope } from "./list-package-docs-response.js";

const SEP = " | ";

export function renderListPackageDocsText(
  envelope: LeanPackageDocsEnvelope,
): string {
  const lines: string[] = [];
  lines.push(buildHeader(envelope));
  lines.push("");

  if (envelope.pages.length === 0) {
    lines.push("No documentation pages found.");
    return lines.join("\n");
  }

  for (const page of envelope.pages) {
    lines.push(
      [
        page.pageId,
        page.title ?? "",
        page.sourceKind ?? "",
        page.sourceUrl ?? "",
      ].join(SEP),
    );
    lines.push(`  ${buildDocsReadCommand(page.pageId)}`);
    if (page.sourceKind === "repo" && page.repoUrl && page.filePath) {
      lines.push(
        `  ${buildCodeReadCommand({
          repoUrl: page.repoUrl,
          gitRef: page.gitRef,
          filePath: page.filePath,
          startLine: 1,
          endLine: 150,
        })}`,
      );
    }
  }

  if (envelope.nextCursor) {
    lines.push("");
    lines.push(`More docs available. Pass after=${envelope.nextCursor}.`);
  }
  if (envelope.stale) {
    lines.push("");
    lines.push("Documentation may be stale.");
  }
  return lines.join("\n");
}

function buildHeader(envelope: LeanPackageDocsEnvelope): string {
  const target =
    envelope.registry && envelope.name
      ? `${envelope.registry}:${envelope.name}${envelope.version ? `@${envelope.version}` : ""}`
      : "package docs";
  const suffix = envelope.total !== undefined ? `/${envelope.total}` : "";
  return `docs_list${SEP}${target}${SEP}${envelope.pages.length}${suffix} page${envelope.pages.length === 1 ? "" : "s"}`;
}
