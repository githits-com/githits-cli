import { expect, it, mock } from "bun:test";
import {
  CodeNavigationServiceImpl,
  createStaticTokenProvider,
  GrepServiceImpl,
  ListServiceImpl,
  PackageIntelligenceServiceImpl,
} from "@githits/core-internal";
import {
  type MappedError,
  mapCodeNavigationError,
  mapGrepError,
  mapListError,
  mapPackageIntelligenceError,
} from "@githits/mcp/internal";
import { mcpMappedErrorResult } from "../../packages/mcp/src/tools/shared.js";
import { formatMappedErrorForTerminal } from "../commands/format-mapped-error.js";

const endpoint = "https://pkgseer.example";
const target = { registry: "NPM" as const, packageName: "example" };
const providerMessage =
  "Repository provider rate limit exceeded; retry after the limit resets.";
const extensions = {
  code: "RATE_LIMITED",
  retryable: true,
  rate_limit_scope: "repository_provider",
  token_source: "app",
  retry_after_ms: 1501,
};
const bodies = [
  {
    name: "GraphQL envelope with competing siblings",
    body: {
      errors: [
        { message: "Missing source", extensions: { code: "NOT_FOUND" } },
        { message: providerMessage, extensions },
        { message: "Unrelated timeout", extensions: { code: "TIMEOUT" } },
      ],
    },
  },
  {
    name: "direct API detail",
    body: { detail: providerMessage, ...extensions },
  },
  {
    name: "direct API error with nested extensions",
    body: { error: providerMessage, extensions },
  },
];
const operations: Array<{
  name: string;
  run: (fetchFn: typeof fetch) => Promise<unknown>;
  map: (error: unknown) => MappedError;
}> = [
  {
    name: "code navigation",
    run: (fetchFn) =>
      new CodeNavigationServiceImpl(
        endpoint,
        createStaticTokenProvider("mock-access-token"),
        fetchFn,
      ).readFile({ target, filePath: "index.ts" }),
    map: mapCodeNavigationError,
  },
  {
    name: "package facts",
    run: (fetchFn) =>
      new PackageIntelligenceServiceImpl(
        endpoint,
        createStaticTokenProvider("mock-access-token"),
        fetchFn,
      ).packageDependencies(target),
    map: mapPackageIntelligenceError,
  },
  {
    name: "unified grep",
    run: (fetchFn) =>
      new GrepServiceImpl(
        endpoint,
        createStaticTokenProvider("mock-access-token"),
        fetchFn,
      ).grep({
        targets: [{ target: "npm:example" }],
        pattern: "router",
        patternType: "LITERAL",
        caseSensitive: false,
        contextLinesBefore: 0,
        contextLinesAfter: 0,
        includeDetailedFields: false,
      }),
    map: mapGrepError,
  },
  {
    name: "unified list",
    run: (fetchFn) =>
      new ListServiceImpl(
        endpoint,
        createStaticTokenProvider("mock-access-token"),
        fetchFn,
      ).list({ target: "npm:example", includeDetailedFields: false }),
    map: mapListError,
  },
];
for (const { name, body } of bodies) {
  it.each(operations)(
    `retains selected provider attribution in CLI/MCP HTTP429 $name from ${name}`,
    async ({ run, map }) => {
      const fetchFn = mock(async () => Response.json(body, { status: 429 }));
      const error = await run(fetchFn as unknown as typeof fetch).catch(
        (error: unknown) => error,
      );
      const mapped = map(error);
      expect(mapped).toMatchObject({
        code: "RATE_LIMITED",
        retryable: true,
        message: providerMessage,
        details: {
          status: 429,
          rateLimitScope: "repository_provider",
          tokenSource: "app",
          retryAfterMs: 1501,
        },
      });
      const mcp = mcpMappedErrorResult(mapped, undefined, "text");
      expect(mcp.isError).toBe(true);
      expect(mcp.content[0]!.text).toBe(
        "Repository provider rate limit exceeded. Try again in 2 seconds.",
      );
      expect(formatMappedErrorForTerminal(mapped)).toBe(mcp.content[0]!.text);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );
}
