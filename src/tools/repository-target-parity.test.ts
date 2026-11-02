import { describe, expect, it, mock, spyOn } from "bun:test";
import type { ReadResult } from "@githits/core-internal";
import {
  buildCodeDiffMcpParams,
  buildCodeDiffParams,
} from "../../packages/mcp/src/shared/code-diff-request.js";
import { buildSearchHitFollowUpCommand } from "../../packages/mcp/src/shared/follow-up-command-text.js";
import { buildResolveTargetParams } from "../../packages/mcp/src/shared/resolve-target-request.js";
import { parseUnifiedSearchTargetSpec } from "../../packages/mcp/src/shared/unified-search-target.js";
import { resolveCodeTarget } from "../../packages/mcp/src/tools/code-navigation-shared.js";
import { resolveCliCodeNavTarget } from "../commands/code/code-nav-cli-helpers.js";
import { grepAction } from "../commands/grep.js";
import { listAction } from "../commands/list.js";
import { readAction } from "../commands/read.js";
import { searchAction } from "../commands/search.js";
import {
  createMockCodeNavigationService,
  createMockGrepService,
  createMockListService,
  createMockReadService,
  defaultGrepResult,
  defaultListResult,
  defaultReadFileResult,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

const targets = [
  ["https://go.googlesource.com/time", "https://go.googlesource.com/time"],
  ["https://go.googlesource.com/sync.git/", "https://go.googlesource.com/sync"],
  ["github:owner/repo", "https://github.com/owner/repo"],
  ["codeberg:zigil/decimal", "https://codeberg.org/zigil/decimal"],
  [
    "gitlab:group/subgroup/project",
    "https://gitlab.com/group/subgroup/project",
  ],
  ["launchpad:~Owner/+git/Repo", "https://git.launchpad.net/~Owner/+git/Repo"],
  [
    "lp:~Owner/Project/+git/Repo",
    "https://git.launchpad.net/~Owner/Project/+git/Repo",
  ],
  [
    "LP:~Owner/Distro/+source/Source/+git/Repo",
    "https://git.launchpad.net/~Owner/Distro/+source/Source/+git/Repo",
  ],
  ["lP:~Owner/+git/Repo%402", "https://git.launchpad.net/~Owner/+git/Repo@2"],
  ["lp:Project", "https://git.launchpad.net/Project"],
  [
    "LP:Distro/+source/Source",
    "https://git.launchpad.net/Distro/+source/Source",
  ],
  [
    "https://code.launchpad.net/~Owner/Project",
    "https://git.launchpad.net/~Owner/Project",
  ],
  [
    "https://git.launchpad.net/~Owner/Distro/+source/Source",
    "https://git.launchpad.net/~Owner/Distro/+source/Source",
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
      const resolve = (): unknown =>
        buildResolveTargetParams({ name: spec, includeDetailedFields: false });
      if (
        [
          "lp:Project",
          "LP:Distro/+source/Source",
          "https://code.launchpad.net/~Owner/Project",
          "https://git.launchpad.net/~Owner/Distro/+source/Source",
        ].includes(compact)
      ) {
        expect(resolve()).toMatchObject({ name: spec });
      } else {
        expect(resolve).toThrow("does not need resolution");
      }
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

    it(`${compact} routes grep and read through their target boundaries`, async () => {
      const grep = mock(() => Promise.resolve(defaultGrepResult));
      const read = mock(
        (): Promise<ReadResult> =>
          Promise.resolve({ source: "code", result: defaultReadFileResult }),
      );
      const deps = {
        grepService: createMockGrepService({ grep }),
        readService: createMockReadService({ read }),
      };

      const grepResult = await createParityMcpTool("grep", deps).handler(
        {
          targets: [{ target: `${compact}@release/v1@stable` }],
          pattern: "export",
        },
        {},
      );
      const readResult = await createParityMcpTool("read", deps).handler(
        {
          target: `${compact}@release/v1@stable`,
          path: "src/index.ts",
          start_line: 10,
          end_line: 500,
          wait_timeout_ms: 45_000,
          format: "json",
        },
        {},
      );

      expect(grepResult.isError).toBeUndefined();
      expect(readResult.isError).toBeUndefined();
      expect(grep).toHaveBeenCalledTimes(1);
      expect(grep).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: [
            {
              target: `${compact}@release/v1@stable`,
              corpus: "ALL",
              allowUnscoped: true,
            },
          ],
        }),
      );
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith({
        target: `${compact}@release/v1@stable`,
        path: "src/index.ts",
        startLine: 10,
        endLine: 309,
        waitTimeoutMs: 45_000,
      });
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
          { in: [`${compact}@exact@commit`], source: "code", json: true },
          deps,
        );
        const result = await createParityMcpTool("search", deps).handler(
          {
            target: `${compact}@exact@commit`,
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
        const calls = search.mock.calls as unknown as Array<Array<unknown>>;
        expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
        expect(calls[0]?.[0]).toEqual(
          expect.objectContaining({
            targets: [{ repoUrl, gitRef: "exact@commit" }],
          }),
        );
      } finally {
        log.mockRestore();
      }
    });

    it(`${compact} keeps unified CLI/MCP list, grep and read target bytes`, async () => {
      const target = `${compact}@release/v1@stable`;
      const list = mock(() => Promise.resolve(defaultListResult));
      const grep = mock(() => Promise.resolve(defaultGrepResult));
      const read = mock(
        (): Promise<ReadResult> =>
          Promise.resolve({ source: "code", result: defaultReadFileResult }),
      );
      const deps = {
        listService: createMockListService({ list }),
        grepService: createMockGrepService({ grep }),
        readService: createMockReadService({ read }),
        codeNavigationService: createMockCodeNavigationService(),
        codeNavigationUrl: "https://example.test",
        hasValidToken: true,
        mcpUrl: "https://mcp.githits.com",
      };
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await listAction(target, ["src/"], { json: true }, deps);
        const result = await createParityMcpTool("list", deps).handler(
          { target, paths: ["src/"], format: "json" },
          {},
        );
        expect(result.isError).toBeUndefined();
        await grepAction("import", [target], { json: true }, deps);
        await readAction(target, "src/index.ts", { json: true }, deps);
        expect(list).toHaveBeenCalledTimes(2);
        for (const call of list.mock.calls as unknown as Array<
          Array<{ target: string }>
        >)
          expect(call[0]?.target).toBe(target);
        expect(grep).toHaveBeenCalledWith(
          expect.objectContaining({
            targets: [expect.objectContaining({ target })],
          }),
        );
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({ target, path: "src/index.ts" }),
        );
      } finally {
        log.mockRestore();
      }
    });

    it(`${compact} follow-ups retain provider and exact commit`, () => {
      const hit = {
        type: "repository_code",
        target: compact,
        readTarget: {
          target: `${compact}@0123456789abcdef`,
          path: "src/file.ts",
          startLine: 2,
          endLine: 5,
        },
        locator: {
          repoUrl,
          gitRef: "main",
          commitSha: "fedcba9876543210",
          filePath: "src/file.ts",
          repositoryFilePath: "src/file.ts",
          startLine: 2,
          endLine: 5,
        },
      };
      const mcp = buildSearchHitFollowUpCommand(hit);
      expect(mcp).toContain(`${compact}@0123456789abcdef`);
      expect(mcp).not.toContain("fedcba9876543210");
      const cli = buildSearchHitFollowUpCommand(hit, "cli");
      expect(cli).toContain(`${compact}@0123456789abcdef`);
      expect(cli).toContain("0123456789abcdef");
      expect(cli).not.toContain("fedcba9876543210");
      expect(cli).not.toContain("--git-ref main");
    });
  }

  it.each([
    "https://git.launchpad.net/~Owner/+git/Repo",
    "https://code.launchpad.net/~Owner/Project/+git/Repo",
    "git://git.launchpad.net/~Owner/Distro/+source/Source/+git/Repo",
  ])("admits Discovery and diff URL %s as canonical HTTPS", (target) => {
    const expected = target
      .replace("code.launchpad.net", "git.launchpad.net")
      .replace(/^git:/, "https:");
    expect(parseUnifiedSearchTargetSpec(`${target}@feature/a@b`)).toEqual({
      repoUrl: expected,
      gitRef: "feature/a@b",
    });
    expect(
      buildCodeDiffParams({ repoUrl: target, range: "old..new" }).params.target,
    ).toEqual({ repoUrl: expected });
  });

  it.each([
    "launchpad:~Owner/+git/Repo%402@0123456789abcdef0123456789abcdef01234567/docs/Guide.md",
    "LP:~Owner/Project/+git/Repo@release%2FKeepCase/docs/Guide.md#Heading",
    "lP:~Owner/Distro/+source/Source/+git/Repo@main#Symbol",
    "https://go.googlesource.com/time@fb013b3d/rate/rate.go",
    "https://go.googlesource.com/sync@04914c20#golang.org/x/sync/errgroup.Group",
  ])(
    "replays repository page IDs and semantic fragments unchanged: %s",
    async (target) => {
      const read = mock(
        (): Promise<ReadResult> =>
          Promise.resolve({ source: "code", result: defaultReadFileResult }),
      );
      const deps = {
        readService: createMockReadService({ read }),
        codeNavigationService: createMockCodeNavigationService(),
        codeNavigationUrl: "https://example.test",
        hasValidToken: true,
        mcpUrl: "https://mcp.githits.com",
      };
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await readAction(target, undefined, { json: true }, deps);
        const result = await createParityMcpTool("read", deps).handler(
          { target, format: "json" },
          {},
        );
        expect(result.isError).toBeUndefined();
        expect(read).toHaveBeenCalledTimes(2);
        expect(read).toHaveBeenNthCalledWith(1, {
          target,
          waitTimeoutMs: 30_000,
        });
        expect(read).toHaveBeenNthCalledWith(2, {
          target,
          waitTimeoutMs: 30_000,
        });
      } finally {
        log.mockRestore();
      }
    },
  );

  it.each([
    ["zig:gh/owner/repo", "ZIG", "gh/owner/repo"],
    ["zig:cb/zigil/decimal", "ZIG", "cb/zigil/decimal"],
    ["swift:github.com/owner/repo", "SWIFT", "github.com/owner/repo"],
    ["swift:gitlab.com/group/project", "SWIFT", "gitlab.com/group/project"],
    ["swift:gitlab.com/corekit/corekit", "SWIFT", "gitlab.com/corekit/corekit"],
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
