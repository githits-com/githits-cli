import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  buildCodeDiffMcpParams,
  buildCodeDiffParams,
} from "../../packages/mcp/src/shared/code-diff-request.js";
import { buildSearchHitFollowUpCommand } from "../../packages/mcp/src/shared/follow-up-command-text.js";
import { buildResolveTargetParams } from "../../packages/mcp/src/shared/resolve-target-request.js";
import { parseUnifiedSearchTargetSpec } from "../../packages/mcp/src/shared/unified-search-target.js";
import { resolveCodeTarget } from "../../packages/mcp/src/tools/code-navigation-shared.js";
import { resolveCliCodeNavTarget } from "../commands/code/code-nav-cli-helpers.js";
import { searchAction } from "../commands/search.js";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
  defaultListFilesResult,
  defaultReadFileResult,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

const targets = [
  ["github:owner/repo", "https://github.com/owner/repo"],
  ["codeberg:zigil/decimal", "https://codeberg.org/zigil/decimal"],
  [
    "gitlab:group/subgroup/project",
    "https://gitlab.com/group/subgroup/project",
  ],
] as const;

describe("provider target consumer parity", () => {
  for (const [compact, repoUrl] of targets) {
    it(`${compact} shares CLI/MCP target identity and preserves refs`, () => {
      const spec = `${compact}@release/v1@stable`;
      const expected = { repoUrl, gitRef: "release/v1@stable" };
      expect(resolveCliCodeNavTarget(spec, {})).toEqual(expected);
      expect(resolveCodeTarget(spec)).toEqual(expected);
      expect(parseUnifiedSearchTargetSpec(spec)).toEqual(expected);
      expect(() =>
        buildResolveTargetParams({ name: spec, includeDetailedFields: false }),
      ).toThrow("does not need resolution");
    });

    it(`${compact} keeps CodeDiff endpoints separate from provider identity`, () => {
      const cli = buildCodeDiffParams({
        target: compact,
        range: "release/v1@stable..release/v2@stable",
        view: "name-status",
      });
      const mcp = buildCodeDiffMcpParams({
        target: compact,
        from: "release/v1@stable",
        to: "release/v2@stable",
        view: "name-status",
      });
      expect(cli.params).toEqual(mcp.params);
      expect(cli.params.target).toEqual({ repoUrl });
      expect(cli.params.from).toBe("release/v1@stable");
      expect(cli.params.to).toBe("release/v2@stable");
    });

    it(`${compact} reaches all navigation tool services with canonical URL/ref only`, async () => {
      const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
      const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
      const readFile = mock(() => Promise.resolve(defaultReadFileResult));
      const deps = {
        codeNavigationService: createMockCodeNavigationService({
          listFiles,
          grepRepo,
          readFile,
        }),
      };
      for (const [name, args] of [
        ["code_files", {}],
        ["code_grep", { pattern: "export" }],
        ["code_read", { path: "src/index.ts" }],
      ] as const) {
        const result = await createParityMcpTool(name, deps).handler(
          { target: `${compact}#release/v1@stable`, ...args },
          {},
        );
        expect(result.isError).toBeUndefined();
      }
      for (const fn of [listFiles, grepRepo, readFile]) {
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining({
            target: { repoUrl, gitRef: "release/v1@stable" },
          }),
        );
      }
    });

    it(`${compact} keeps search CLI/MCP params and output aligned`, async () => {
      const search = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
      const deps = {
        codeNavigationService: createMockCodeNavigationService({ search }),
        codeNavigationUrl: "https://pkgseer.dev",
        hasValidToken: true,
        mcpUrl: "https://mcp.githits.com",
      };
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await searchAction(
          "decimal",
          { in: [`${compact}#exact@commit`], source: "code", json: true },
          deps,
        );
        const result = await createParityMcpTool("search", deps).handler(
          {
            target: `${compact}#exact@commit`,
            query: "decimal",
            source: "code",
            format: "json",
          },
          {},
        );
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.content[0]!.text!)).toEqual(
          JSON.parse(String(log.mock.calls[0]![0])),
        );
        expect(search.mock.calls[0]).toEqual(search.mock.calls[1]);
        expect(search).toHaveBeenCalledWith(
          expect.objectContaining({
            targets: [{ repoUrl, gitRef: "exact@commit" }],
          }),
          expect.any(Object),
        );
      } finally {
        log.mockRestore();
      }
    });

    it(`${compact} follow-ups retain provider and exact commit`, () => {
      const hit = {
        type: "repository_code",
        target: compact,
        locator: {
          repoUrl,
          gitRef: "main",
          commitSha: "0123456789abcdef",
          filePath: "src/file.ts",
          repositoryFilePath: "src/file.ts",
          startLine: 2,
          endLine: 5,
        },
      };
      expect(buildSearchHitFollowUpCommand(hit)).toContain(
        `${compact}#0123456789abcdef`,
      );
      const cli = buildSearchHitFollowUpCommand(hit, "cli");
      expect(cli).toContain(repoUrl);
      expect(cli).toContain("0123456789abcdef");
      expect(cli).not.toContain("--git-ref main");
    });
  }

  it.each([
    ["zig:gh/owner/repo", "ZIG", "gh/owner/repo"],
    ["zig:cb/zigil/decimal", "ZIG", "cb/zigil/decimal"],
    ["swift:github.com/owner/repo", "SWIFT", "github.com/owner/repo"],
    ["swift:gitlab.com/group/project", "SWIFT", "gitlab.com/group/project"],
  ] as const)(
    "preserves registry-native package grammar %s",
    (spec, registry, packageName) => {
      expect(resolveCliCodeNavTarget(spec!, {})).toEqual({
        registry,
        packageName,
        version: undefined,
      });
      expect(resolveCodeTarget(spec!)).toEqual(
        resolveCliCodeNavTarget(spec!, {}),
      );
    },
  );
});
