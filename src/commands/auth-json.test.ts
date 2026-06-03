import { describe, expect, it, spyOn } from "bun:test";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
import { pkgFilesAction } from "./code/files.js";
import { pkgGrepAction } from "./code/grep.js";
import { pkgReadAction } from "./code/read.js";
import { docsListAction } from "./docs/list.js";
import { docsReadAction } from "./docs/read.js";
import { exampleAction } from "./example.js";
import { feedbackAction } from "./feedback.js";
import { languagesAction } from "./languages.js";
import { pkgChangelogAction } from "./pkg/changelog.js";
import { pkgDepsAction } from "./pkg/deps.js";
import { pkgInfoAction } from "./pkg/info.js";
import { pkgUpgradeReviewAction } from "./pkg/upgrade-review.js";
import { pkgVulnsAction } from "./pkg/vulns.js";
import { searchAction, searchStatusAction } from "./search.js";

const missingAuth = {
  hasValidToken: false,
  mcpUrl: "https://mcp.githits.com",
} as const;

const gitHitsDeps = {
  ...missingAuth,
  githitsService: createMockGitHitsService(),
};

const codeDeps = {
  ...missingAuth,
  codeNavigationUrl: "https://pkgseer.dev",
  codeNavigationService: createMockCodeNavigationService(),
};

const packageDeps = {
  ...missingAuth,
  codeNavigationUrl: "https://pkgseer.dev",
  packageIntelligenceService: createMockPackageIntelligenceService(),
};

describe("authenticated command JSON auth failures", () => {
  const cases: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: "example",
      run: () => exampleAction("router", { json: true }, gitHitsDeps),
    },
    {
      name: "languages",
      run: () => languagesAction(undefined, { json: true }, gitHitsDeps),
    },
    {
      name: "feedback",
      run: () =>
        feedbackAction(undefined, { accept: true, json: true }, gitHitsDeps),
    },
    {
      name: "search",
      run: () =>
        searchAction("router", { in: ["npm:express"], json: true }, codeDeps),
    },
    {
      name: "search-status",
      run: () => searchStatusAction("search-ref", { json: true }, codeDeps),
    },
    {
      name: "code files",
      run: () =>
        pkgFilesAction("npm:express", undefined, { json: true }, codeDeps),
    },
    {
      name: "code read",
      run: () =>
        pkgReadAction("npm:express", "src/index.js", { json: true }, codeDeps),
    },
    {
      name: "code grep",
      run: () =>
        pkgGrepAction(
          "npm:express",
          "router",
          undefined,
          { json: true },
          codeDeps,
        ),
    },
    {
      name: "docs list",
      run: () => docsListAction("npm:express", { json: true }, packageDeps),
    },
    {
      name: "docs read",
      run: () => docsReadAction("page-id", { json: true }, packageDeps),
    },
    {
      name: "pkg info",
      run: () => pkgInfoAction("npm:express", { json: true }, packageDeps),
    },
    {
      name: "pkg vulns",
      run: () => pkgVulnsAction("npm:express", { json: true }, packageDeps),
    },
    {
      name: "pkg deps",
      run: () => pkgDepsAction("npm:express", { json: true }, packageDeps),
    },
    {
      name: "pkg changelog",
      run: () => pkgChangelogAction("npm:express", { json: true }, packageDeps),
    },
    {
      name: "pkg upgrade-review",
      run: () =>
        pkgUpgradeReviewAction(
          "npm:express@4.18.0",
          { to: "5.0.0", json: true },
          packageDeps,
        ),
    },
  ];

  it.each(cases)("emits AUTH_REQUIRED JSON for $name", async ({ run }) => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(run()).rejects.toThrow("process.exit");

      expect(logSpy).not.toHaveBeenCalled();
      const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
      expect(payload).toEqual({
        error: "No local GitHits authentication token found.",
        code: "AUTH_REQUIRED",
        retryable: false,
        details: { authSource: "local" },
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
