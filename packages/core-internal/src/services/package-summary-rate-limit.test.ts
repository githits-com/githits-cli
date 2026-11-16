import { expect, it, mock } from "bun:test";
import { AuthenticationError } from "./githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceServiceImpl,
} from "./package-intelligence-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const target = { registry: "NPM" as const, packageName: "example" };
const githubPath = ["packageSummary", "package", "githubRepository"];
const provenancePath = ["provenance", "selectedVersion"];
const repository = {
  id: "npm:public",
  name: "npm",
  url: "https://registry.npmjs.org",
};
const github = { stargazersCount: 123 };
const lifecycle = {
  findings: [],
  retainedWarnings: [],
  contentSafety: { filtered: false },
};
function providerError(
  path: readonly string[],
  tokenSource = "app",
  ms = 1501,
) {
  return {
    message: "Private provider response must not survive",
    path,
    extensions: {
      code: "RATE_LIMITED",
      retryable: true,
      rate_limit_scope: "repository_provider",
      token_source: tokenSource,
      repo_url: "https://github.com/example/repo",
      git_ref: null,
      retry_after_ms: ms,
      retryAfter: Math.ceil(ms / 1000),
      provider_body: "must-not-survive",
    },
  };
}
function body(githubThrottled: boolean, provenanceThrottled: boolean) {
  return {
    data: {
      packageSummary: {
        package: {
          name: "example",
          version: "1.0.0",
          license: "MIT",
          downloadsLastMonth: 1000,
          githubRepository: githubThrottled ? null : github,
        },
        security: {
          allVulnerabilityCount: 3,
          vulnerabilityCount: 1,
          hasCurrentVulnerabilities: true,
        },
        latestChangelogs: [
          { version: "1.0.0", body: "Healthy existing notes" },
        ],
      },
      provenance: provenanceThrottled
        ? null
        : {
            selectedVersion: {
              resolvedVersion: "1.0.0",
              registryRepository: repository,
              lifecycle,
            },
          },
    },
    errors: [
      ...(githubThrottled ? [providerError(githubPath)] : []),
      ...(provenanceThrottled
        ? [providerError(provenancePath, "user", 2201)]
        : []),
    ],
  };
}
function setup(payload: unknown) {
  const fetchFn = mock(async () => Response.json(payload));
  const token = createMockTokenProvider();
  return {
    fetchFn,
    token,
    service: new PackageIntelligenceServiceImpl(
      "https://pkgseer.example",
      token,
      fetchFn as unknown as typeof fetch,
    ),
  };
}

it.each([
  {
    name: "GitHub metadata",
    githubThrottled: true,
    provenanceThrottled: false,
  },
  {
    name: "registry provenance",
    githubThrottled: false,
    provenanceThrottled: true,
  },
  {
    name: "both metadata sources",
    githubThrottled: true,
    provenanceThrottled: true,
  },
])(
  "keeps readable summary and explicit $name throttling after one fetch",
  async ({ githubThrottled, provenanceThrottled }) => {
    const { service, fetchFn, token } = setup(
      body(githubThrottled, provenanceThrottled),
    );
    const result = await service.packageSummary(target);
    expect(result.package).toMatchObject({
      name: "example",
      version: "1.0.0",
      license: "MIT",
      downloadsLastMonth: 1000,
    });
    expect(result.security?.allVulnerabilityCount).toBe(3);
    expect(result.latestChangelogs?.[0]?.body).toBe("Healthy existing notes");
    if (githubThrottled) {
      expect(result.package.githubRepository).toBeUndefined();
      expect(result.package.githubRepositoryError).toEqual({
        code: "RATE_LIMITED",
        message: "GitHub metadata temporarily unavailable (RATE_LIMITED).",
        retryable: true,
        rateLimitScope: "repository_provider",
        tokenSource: "app",
        repoUrl: "https://github.com/example/repo",
        gitRef: null,
        retryAfterMs: 1501,
        retryAfterSeconds: 1.501,
      });
    } else {
      expect(result.package.githubRepository).toMatchObject(github);
      expect(result.package.githubRepositoryError).toBeUndefined();
    }
    if (provenanceThrottled) {
      expect(result.package.registryRepository).toBeUndefined();
      expect(result.lifecycle).toBeUndefined();
      expect(result.package.registryRepositoryError).toMatchObject({
        code: "RATE_LIMITED",
        retryable: true,
        rateLimitScope: "repository_provider",
        tokenSource: "user",
        retryAfterMs: 2201,
        retryAfterSeconds: 2.201,
      });
    } else {
      expect(result.package.registryRepository).toEqual(repository);
      expect(result.lifecycle).toEqual(lifecycle);
      expect(result.package.registryRepositoryError).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toMatch(
      /Private provider|must-not-survive/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(token.forceRefresh).not.toHaveBeenCalled();
  },
);

it.each([
  {
    name: "global throttle",
    sibling: {
      message: "Global admission unavailable",
      extensions: { code: "RATE_LIMITED", retryable: true },
    },
  },
  {
    name: "latestChangelogs throttle",
    sibling: providerError(["packageSummary", "latestChangelogs"]),
  },
  {
    name: "missing-source sibling",
    sibling: {
      message: "Source unavailable",
      extensions: { code: "NOT_FOUND" },
      path: ["packageSummary", "package"],
    },
  },
])("keeps $name as a classified whole-tool failure", async ({ sibling }) => {
  const payload = body(true, true);
  const { service, fetchFn } = setup({
    ...payload,
    errors: [...payload.errors, sibling],
  });
  await expect(service.packageSummary(target)).rejects.toMatchObject({
    graphqlCode: "RATE_LIMITED",
    retryable: true,
  });
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it("retains provenance authentication failure alongside nullable metadata throttling", async () => {
  const payload = body(true, false);
  const { service, fetchFn, token } = setup({
    ...payload,
    errors: [
      ...payload.errors,
      {
        message: "Authentication required",
        path: ["provenance"],
        extensions: { code: "UNAUTHORIZED" },
      },
    ],
  });
  await expect(service.packageSummary(target)).rejects.toBeInstanceOf(
    AuthenticationError,
  );
  // Authentication keeps its existing single refresh attempt; this is not a
  // rate-limit retry or a change to token policy.
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(token.forceRefresh).toHaveBeenCalledTimes(1);
});

it.each([
  {
    name: "missing base name",
    update: (payload: ReturnType<typeof body>) => {
      payload.data.packageSummary.package.name = "";
    },
  },
  {
    name: "malformed Github data",
    update: (payload: ReturnType<typeof body>) => {
      Object.assign(payload.data.packageSummary.package, {
        githubRepository: { stargazersCount: "wrong-type" },
      });
    },
  },
])("rejects $name instead of returning partial success", async ({ update }) => {
  const payload = body(true, true);
  update(payload);
  const { service, fetchFn } = setup(payload);
  await expect(service.packageSummary(target)).rejects.toBeInstanceOf(
    MalformedPackageIntelligenceResponseError,
  );
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it.each([
  { name: "nonnull metadata", path: githubPath, metadataNull: false },
  {
    name: "wrong leaf path",
    path: [...githubPath, "stars"],
    metadataNull: true,
  },
])(
  "does not invent partial handling for $name",
  async ({ path, metadataNull }) => {
    const payload = body(metadataNull, false);
    const { service, fetchFn } = setup({
      ...payload,
      errors: [providerError(path)],
    });
    await expect(service.packageSummary(target)).rejects.toMatchObject({
      graphqlCode: "RATE_LIMITED",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  },
);
