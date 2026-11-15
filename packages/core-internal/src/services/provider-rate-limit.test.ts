import { describe, expect, it, mock } from "bun:test";
import {
  CodeDiffError,
  CodeNavigationServiceImpl,
} from "./code-navigation-service.js";
import { GrepServiceImpl } from "./grep-service.js";
import { ListServiceImpl } from "./list-service.js";
import { PackageIntelligenceServiceImpl } from "./package-intelligence-service.js";
import { ReadServiceImpl } from "./read-service.js";
import { ResolveTargetServiceImpl } from "./resolve-target-service.js";
import type { ServiceDiagnostics } from "./runtime-diagnostics.js";
import { createMockTokenProvider } from "./test-helpers.js";

// Producer contract, independent of the producer checkout or live provider quota.
const extensions = {
  code: "RATE_LIMITED",
  retryable: true,
  rate_limit_scope: "repository_provider",
  token_source: "supabase_user",
  repo_url: "https://github.com/example/repo",
  git_ref: null,
  retry_after_ms: 1501,
  retryAfter: 2,
  provider_body: "must-not-survive",
};
const facts = {
  rateLimitScope: "repository_provider",
  tokenSource: "supabase_user",
  repoUrl: "https://github.com/example/repo",
  gitRef: null,
  retryAfterMs: 1501,
  retryAfterSeconds: 1.501,
};
const target = { registry: "NPM" as const, packageName: "example" };
interface Services {
  code: CodeNavigationServiceImpl;
  pkg: PackageIntelligenceServiceImpl;
  read: ReadServiceImpl;
  grep: GrepServiceImpl;
  list: ListServiceImpl;
  resolve: ResolveTargetServiceImpl;
}
const operations: Array<{
  name: string;
  run: (services: Services) => Promise<unknown>;
}> = [
  {
    name: "cold package summary",
    run: ({ pkg }) => pkg.packageSummary(target),
  },
  {
    name: "package dependency facts",
    run: ({ pkg }) => pkg.packageDependencies(target),
  },
  {
    name: "selected release changelog",
    run: ({ pkg }) => pkg.packageChangelog({ ...target, version: "1.0.0" }),
  },
  { name: "latest changelog", run: ({ pkg }) => pkg.packageChangelog(target) },
  {
    name: "FetchCodeContext",
    run: ({ code }) => code.readFile({ target, filePath: "index.ts" }),
  },
  {
    name: "legacy GrepRepo",
    run: ({ code }) => code.grepRepo({ target, pattern: "router" }),
  },
  { name: "legacy navigation", run: ({ code }) => code.listFiles({ target }) },
  {
    name: "unified search",
    run: ({ code }) => code.search({ targets: [target], query: "router" }),
  },
  {
    name: "unified Read",
    run: ({ read }) => read.read({ target: "npm:example", path: "index.ts" }),
  },
  {
    name: "unified Grep",
    run: ({ grep }) =>
      grep.grep({
        targets: [{ target: "npm:example" }],
        pattern: "router",
        patternType: "LITERAL",
        caseSensitive: false,
        contextLinesBefore: 0,
        contextLinesAfter: 0,
        includeDetailedFields: false,
      }),
  },
  {
    name: "unified List",
    run: ({ list }) =>
      list.list({ target: "npm:example", includeDetailedFields: false }),
  },
  {
    name: "target resolution",
    run: ({ resolve }) =>
      resolve.resolveTarget({
        name: "example",
        limit: 5,
        includeDetailedFields: false,
        includeNameSimilarity: false,
      }),
  },
  {
    name: "CodeDiff",
    run: ({ code }) =>
      code.codeDiff({ target, from: "1.0.0", to: "1.0.1", mode: "inventory" }),
  },
];

for (const status of [200, 429]) {
  describe(`provider GraphQL errors over HTTP ${status}`, () => {
    it.each(operations)(
      "preserves safe facts for $name without retrying",
      async ({ run }) => {
        const fetchFn = mock(async () =>
          Response.json(
            {
              data: null,
              errors: [
                {
                  message: "No source selected",
                  extensions: { code: "NOT_FOUND" },
                },
                { message: "Provider temporarily unavailable", extensions },
              ],
            },
            { status },
          ),
        );
        const token = createMockTokenProvider();
        const events: Record<string, unknown>[] = [];
        const diagnostics: ServiceDiagnostics = {
          withOperation: async (_name, operation) => operation(),
          isEnabled: () => true,
          debug: (_area, event) => events.push(event),
        };
        const args = [
          "https://pkgseer.example",
          token,
          fetchFn as unknown as typeof fetch,
          { diagnostics },
        ] as const;
        const services: Services = {
          code: new CodeNavigationServiceImpl(...args),
          pkg: new PackageIntelligenceServiceImpl(...args),
          read: new ReadServiceImpl(...args),
          grep: new GrepServiceImpl(...args),
          list: new ListServiceImpl(...args),
          resolve: new ResolveTargetServiceImpl(...args),
        };
        const error = await run(services).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(Error);
        const typed = error as {
          graphqlCode?: string;
          code?: string;
          metadata?: unknown;
          details?: unknown;
          extensions?: Record<string, unknown>;
        };
        expect(
          typed.graphqlCode ??
            typed.code ??
            typed.extensions?.code ??
            (typed.details as { code?: string })?.code,
        ).toBe("RATE_LIMITED");
        if (typed.extensions)
          expect(typed.extensions).toMatchObject(extensions);
        else expect(typed.metadata ?? typed.details).toMatchObject(facts);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(token.forceRefresh).not.toHaveBeenCalled();
        expect(events).toContainEqual({
          event: "rate-limited",
          code: "RATE_LIMITED",
          rate_limit_scope: "repository_provider",
          token_source: "supabase_user",
        });
        expect(JSON.stringify(events)).not.toContain("must-not-survive");
      },
    );
  });
}

it("retains immutable CodeDiff resolution with a provider-throttled raw field", async () => {
  const resolution = {
    requested: "main",
    ref: "main",
    commitSha: "abc",
    refKind: "BRANCH",
  };
  const fetchFn = mock(async () =>
    Response.json({
      data: {
        codeDiff: {
          fromResolution: resolution,
          toResolution: { ...resolution, commitSha: "def" },
          raw: null,
        },
      },
      errors: [
        {
          message: "Provider temporarily unavailable",
          path: ["codeDiff", "raw"],
          extensions,
        },
      ],
    }),
  );
  const service = new CodeNavigationServiceImpl(
    "https://pkgseer.example",
    createMockTokenProvider(),
    fetchFn as unknown as typeof fetch,
  );
  const error = await service
    .codeDiff({ target, from: "main", to: "next", mode: "inventory" })
    .catch((error: unknown) => error);
  expect(error).toBeInstanceOf(CodeDiffError);
  expect((error as CodeDiffError).details).toMatchObject(facts);
  expect((error as CodeDiffError).partial?.fromResolution.commitSha).toBe(
    "abc",
  );
  expect((error as CodeDiffError).partial?.toResolution.commitSha).toBe("def");
  expect((error as CodeDiffError).partial?.raw).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain("must-not-survive");
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it("does not retry a compatibility query when a provider throttle accompanies a schema error", async () => {
  const fetchFn = mock(async () =>
    Response.json({
      errors: [
        {
          message:
            'Cannot query field "targetResolution" on type "CodeContext".',
        },
        { message: "Provider temporarily unavailable", extensions },
      ],
    }),
  );
  const service = new CodeNavigationServiceImpl(
    "https://pkgseer.example",
    createMockTokenProvider(),
    fetchFn as unknown as typeof fetch,
  );
  await expect(
    service.readFile({ target, filePath: "index.ts" }),
  ).rejects.toMatchObject({ graphqlCode: "RATE_LIMITED", metadata: facts });
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
