import { describe, expect, it } from "bun:test";
import type { PackageDocsList } from "@githits/core-internal";
import {
  buildListPackageDocsSuccessPayload,
  formatListPackageDocsTerminal,
} from "./list-package-docs-response.js";

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
    const cli = formatListPackageDocsTerminal(envelope, { useColors: false });

    expect(cli).toContain("No documentation pages yet.");
    expect(cli).toContain("preparation is still in progress");
    expect(cli).not.toContain("No documentation pages found.");
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

    const cli = formatListPackageDocsTerminal(envelope, { useColors: false });
    expect(cli.split("\n")[0]).toEndWith("| provisional");
    expect(cli).toContain("Guide");
    expect(cli).toContain("provisional");
    expect(cli).toContain("indexing is still in progress");
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

    const cli = formatListPackageDocsTerminal(envelope, { useColors: false });
    expect(cli.split("\n")[0]).toEndWith("| indexing");
    expect(cli).toContain("indexing is still in progress");
    expect(cli).toContain("later for a current snapshot");
  });

  it("does not call an empty provisional snapshot not found", () => {
    const envelope = buildEnvelope({ codeIndexState: "PROVISIONAL" });

    const cli = formatListPackageDocsTerminal(envelope, { useColors: false });
    expect(cli).toContain("No documentation pages yet.");
    expect(cli).toContain("indexing is still in progress");
    expect(cli).not.toContain("No documentation pages found.");
  });

  it("keeps completed empty output terminal", () => {
    const envelope = buildEnvelope({ codeIndexState: "CURRENT" });

    expect(
      formatListPackageDocsTerminal(envelope, { useColors: false }),
    ).toContain("No documentation pages found.");
  });

  it("renders one canonical CLI action per hosted and repo page", () => {
    const hostedTarget = "https://docs.example.test/guide";
    const repoTarget = "github:owner/repo@immutable-sha/README.md";
    const envelope = buildEnvelope({
      pages: [
        {
          id: "hosted-guide",
          docsReadTarget: hostedTarget,
          title: "Hosted guide",
          sourceKind: "CRAWLED",
          sourceUrl: "https://docs.example.test/source/guide",
        },
        {
          id: "repo-guide",
          docsReadTarget: repoTarget,
          title: "Repo guide",
          sourceKind: "REPOSITORY",
          sourceUrl: "https://github.com/owner/repo/blob/main/README.md",
          repoUrl: "https://github.com/owner/repo",
          gitRef: "immutable-sha",
          requestedRef: "main",
          filePath: "README.md",
        },
      ],
      pageInfo: { hasNextPage: false, totalCount: 2 },
    });
    const cli = formatListPackageDocsTerminal(envelope, { useColors: false });

    expect(
      cli.split("\n").filter((line) => line.startsWith("  githits read ")),
    ).toEqual([
      `  githits read '${hostedTarget}'`,
      `  githits read '${repoTarget}'`,
    ]);
    expect(envelope.pages).toEqual([
      {
        pageId: "hosted-guide",
        docsReadTarget: hostedTarget,
        title: "Hosted guide",
        sourceKind: "crawled",
        sourceUrl: "https://docs.example.test/source/guide",
      },
      {
        pageId: "repo-guide",
        docsReadTarget: repoTarget,
        title: "Repo guide",
        sourceKind: "repo",
        sourceUrl: "https://github.com/owner/repo/blob/main/README.md",
        repoUrl: "https://github.com/owner/repo",
        gitRef: "immutable-sha",
        requestedRef: "main",
        filePath: "README.md",
      },
    ]);
  });
});
