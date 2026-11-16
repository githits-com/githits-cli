import { expect, it, mock } from "bun:test";
import {
  CodeDiffError,
  CodeNavigationBackendError,
  GrepGraphQLError,
  ListGraphQLError,
  PackageIntelligenceBackendError,
} from "@githits/core-internal";
import {
  createMockCodeNavigationService,
  createMockPackageIntelligenceService,
  createMockReadService,
} from "../services/test-helpers.js";
import { createCodeDiffTool } from "./code-diff.js";
import { createGrepTool } from "./grep.js";
import { createListTool } from "./list.js";
import { createPackageChangelogTool } from "./package-changelog.js";
import { createPackageDependenciesTool } from "./package-dependencies.js";
import { createPackageSummaryTool } from "./package-summary.js";
import { createReadTool } from "./read.js";
import { createResolveTargetTool } from "./resolve-target.js";
import { createSearchTool } from "./search.js";

const facts = {
  rateLimitScope: "repository_provider" as const,
  tokenSource: "app" as const,
  repoUrl: "https://github.com/example/repo",
  gitRef: null,
  retryAfterMs: 1501,
  retryAfterSeconds: 1.501,
};
const message =
  "Repository provider rate limit exceeded; retry after the limit resets.";
const navError = new CodeNavigationBackendError(
  message,
  undefined,
  "RATE_LIMITED",
  true,
  facts,
);
const packageError = new PackageIntelligenceBackendError(
  message,
  undefined,
  "RATE_LIMITED",
  true,
  undefined,
  facts,
);
const diffError = new CodeDiffError(message, {
  code: "RATE_LIMITED",
  retryable: true,
  ...facts,
});
const listError = new ListGraphQLError(
  message,
  "RATE_LIMITED",
  true,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  facts,
);
const grepError = new GrepGraphQLError(message, {
  code: "RATE_LIMITED",
  retryable: true,
  rate_limit_scope: "repository_provider",
  token_source: "app",
  repo_url: facts.repoUrl,
  git_ref: null,
  retry_after_ms: 1501,
  retryAfter: 2,
  provider_body: "must-not-survive",
});
type Format = "text" | "json";
const surfaces = [
  {
    name: "package summary",
    invoke: (format: Format) => {
      const packageSummary = mock(async (): Promise<never> => {
        throw packageError;
      });
      const tool = createPackageSummaryTool(
        createMockPackageIntelligenceService({ packageSummary }),
      );
      return {
        call: () => tool.handler({ target: "npm:example", format }, {}),
        operation: packageSummary,
      };
    },
  },
  {
    name: "read",
    invoke: (format: Format) => {
      const read = mock(async (): Promise<never> => {
        throw navError;
      });
      const tool = createReadTool({
        readService: createMockReadService({ read }),
      });
      return {
        call: () =>
          tool.handler({ target: "npm:example", path: "index.ts", format }),
        operation: read,
      };
    },
  },
  {
    name: "search",
    invoke: (format: Format) => {
      const search = mock(async (): Promise<never> => {
        throw navError;
      });
      const tool = createSearchTool(
        createMockCodeNavigationService({ search }),
      );
      return {
        call: () =>
          tool.handler({ target: "npm:example", query: "router", format }, {}),
        operation: search,
      };
    },
  },
  {
    name: "grep",
    invoke: (format: Format) => {
      const grep = mock(async (): Promise<never> => {
        throw grepError;
      });
      const tool = createGrepTool({ grep });
      return {
        call: () =>
          tool.handler({
            targets: [{ target: "npm:example" }],
            pattern: "router",
            format,
          }),
        operation: grep,
      };
    },
  },
  {
    name: "list",
    invoke: (format: Format) => {
      const list = mock(async (): Promise<never> => {
        throw listError;
      });
      const tool = createListTool({ list });
      return {
        call: () => tool.handler({ target: "npm:example", format }),
        operation: list,
      };
    },
  },
  {
    name: "package dependencies",
    invoke: (format: Format) => {
      const packageDependencies = mock(async (): Promise<never> => {
        throw packageError;
      });
      const tool = createPackageDependenciesTool(
        createMockPackageIntelligenceService({ packageDependencies }),
      );
      return {
        call: () => tool.handler({ target: "npm:example", format }, {}),
        operation: packageDependencies,
      };
    },
  },
  {
    name: "changelog",
    invoke: (format: Format) => {
      const packageChangelog = mock(async (): Promise<never> => {
        throw packageError;
      });
      const tool = createPackageChangelogTool(
        createMockPackageIntelligenceService({ packageChangelog }),
      );
      return {
        call: () => tool.handler({ target: "npm:example", format }, {}),
        operation: packageChangelog,
      };
    },
  },
  {
    name: "target resolution",
    invoke: (format: Format) => {
      const resolveTarget = mock(async (): Promise<never> => {
        throw packageError;
      });
      const tool = createResolveTargetTool({ resolveTarget });
      return {
        call: () => tool.handler({ name: "example", format }),
        operation: resolveTarget,
      };
    },
  },
  {
    name: "CodeDiff",
    invoke: (format: Format) => {
      const codeDiff = mock(async (): Promise<never> => {
        throw diffError;
      });
      const tool = createCodeDiffTool(
        createMockCodeNavigationService({ codeDiff }),
      );
      return {
        call: () =>
          tool.handler(
            { target: "npm:example", from: "1.0.0", to: "1.0.1", format },
            undefined,
          ),
        operation: codeDiff,
      };
    },
  },
];
for (const format of ["text", "json"] as const) {
  it.each(surfaces)(
    `retains provider throttle in ${format} $name MCP errors`,
    async ({ invoke }) => {
      const { call, operation } = invoke(format);
      const result = await call();
      expect(result.isError).toBe(true);
      expect(operation).toHaveBeenCalledTimes(1);
      const text = result.content[0]!.text;
      if (format === "json") {
        expect(JSON.parse(text)).toMatchObject({
          code: "RATE_LIMITED",
          retryable: true,
          details: facts,
        });
      } else {
        expect(text).toBe(
          "Repository provider rate limit exceeded. Try again in 2 seconds.",
        );
        expect(text).toContain("Try again in 2 seconds.");
      }
      expect(text).not.toContain("must-not-survive");
    },
  );
}
