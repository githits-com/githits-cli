import { describe, expect, it } from "bun:test";
import type { PackageDocsList } from "@githits/core-internal";
import {
  buildListPackageDocsSuccessPayload,
  formatListPackageDocsTerminal,
} from "./list-package-docs-response.js";
import { renderListPackageDocsText } from "./list-package-docs-text.js";

function buildEnvelope(
  overrides: Partial<PackageDocsList>,
): ReturnType<typeof buildListPackageDocsSuccessPayload> {
  return buildListPackageDocsSuccessPayload(
    {
      registry: "NPM",
      packageName: "express",
      version: "5.2.1",
      pages: [],
      pageInfo: { hasNextPage: false, totalCount: 0 },
      ...overrides,
    },
    { limitExplicit: false, afterExplicit: false },
  );
}

describe("package docs list lifecycle output", () => {
  it("preserves active lifecycle state without calling an empty result not found", () => {
    const envelope = buildEnvelope({ codeIndexState: "PENDING" });

    expect(envelope.codeIndexState).toBe("PENDING");
    const mcp = renderListPackageDocsText(envelope);
    const cli = formatListPackageDocsTerminal(envelope, { useColors: false });

    for (const output of [mcp, cli]) {
      expect(output).toContain("No documentation pages yet.");
      expect(output).toContain("preparation is still in progress");
      expect(output).not.toContain("No documentation pages found.");
    }
    expect(mcp).toContain(
      '`docs_list registry="npm" package_name="express" version="5.2.1"`',
    );
    expect(cli).toContain("`githits docs list 'npm:express@5.2.1'`");
  });

  it("retains pages while marking a provisional snapshot", () => {
    const envelope = buildEnvelope({
      codeIndexState: "PROVISIONAL",
      pages: [
        {
          id: "guide",
          docsReadTarget: "https://docs.example.test/guide",
          title: "Guide",
          sourceKind: "CRAWLED",
        },
      ],
      pageInfo: { hasNextPage: false, totalCount: 1 },
    });

    const mcp = renderListPackageDocsText(envelope);
    const cli = formatListPackageDocsTerminal(envelope, { useColors: false });
    expect(mcp.split("\n")[0]).toEndWith("| provisional");
    expect(cli.split("\n")[0]).toEndWith("| provisional");
    for (const output of [mcp, cli]) {
      expect(output).toContain("Guide");
      expect(output).toContain("provisional");
      expect(output).toContain("indexing is still in progress");
    }
  });

  it("marks non-empty indexing results and provides a later retry", () => {
    const envelope = buildEnvelope({
      codeIndexState: "INDEXING",
      pages: [
        {
          id: "guide",
          docsReadTarget: "https://docs.example.test/guide",
          title: "Guide",
          sourceKind: "CRAWLED",
        },
      ],
      pageInfo: { hasNextPage: false, totalCount: 1 },
    });

    for (const output of [
      renderListPackageDocsText(envelope),
      formatListPackageDocsTerminal(envelope, { useColors: false }),
    ]) {
      expect(output.split("\n")[0]).toEndWith("| indexing");
      expect(output).toContain("indexing is still in progress");
      expect(output).toContain("later for a current snapshot");
    }
  });

  it("does not call an empty provisional snapshot not found", () => {
    const envelope = buildEnvelope({ codeIndexState: "PROVISIONAL" });

    for (const output of [
      renderListPackageDocsText(envelope),
      formatListPackageDocsTerminal(envelope, { useColors: false }),
    ]) {
      expect(output).toContain("No documentation pages yet.");
      expect(output).toContain("indexing is still in progress");
      expect(output).not.toContain("No documentation pages found.");
    }
  });

  it("keeps completed empty output terminal", () => {
    const envelope = buildEnvelope({ codeIndexState: "CURRENT" });

    expect(renderListPackageDocsText(envelope)).toContain(
      "No documentation pages found.",
    );
    expect(
      formatListPackageDocsTerminal(envelope, { useColors: false }),
    ).toContain("No documentation pages found.");
  });
});
