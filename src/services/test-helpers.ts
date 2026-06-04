import { mock } from "bun:test";
import type {
  ChangelogReport,
  CodeNavigationService,
  DependencyReport,
  GitHitsService,
  GrepRepoResult,
  PackageDocResult,
  PackageDocsList,
  PackageIntelligenceService,
  PackageSummary,
  TokenProvider,
  UnifiedSearchOutcome,
  VulnerabilityReport,
} from "@githits/core-internal";
import type {
  AuthService,
  CallbackResult,
  OAuthMetadata,
  PkceParams,
  TokenResponse,
} from "./auth-service.js";
import type { ClientRegistration, TokenData } from "./auth-storage.js";
import type { BrowserService } from "./browser-service.js";
import type { ExecResult, ExecService } from "./exec-service.js";
import type { FileSystemService } from "./filesystem-service.js";
import type { KeyringService } from "./keyring-service.js";
import type { LockingAuthStorage } from "./locked-auth-storage.js";
import type { ConfirmChoice, PromptService } from "./prompt-service.js";
import type { UpdateCheckService } from "./update-check-service.js";

/**
 * Default OAuth metadata for testing.
 */
export const defaultOAuthMetadata: OAuthMetadata = {
  authorizationEndpoint: "https://auth.example.com/oauth/authorize",
  tokenEndpoint: "https://auth.example.com/oauth/token",
  registrationEndpoint: "https://auth.example.com/oauth/register",
};

/**
 * Default PKCE params for testing.
 */
export const defaultPkceParams: PkceParams = {
  verifier: "test-verifier",
  challenge: "test-challenge",
  state: "test-state",
};

/**
 * Default callback result for testing.
 */
export const defaultCallbackResult: CallbackResult = {
  type: "success",
  code: "test-code",
  state: defaultPkceParams.state,
};

/**
 * Default token response for testing.
 */
export const defaultTokenResponse: TokenResponse = {
  accessToken: "eyJ-test-access-token",
  refreshToken: "test-refresh-token",
  expiresIn: 3600,
};

/**
 * Default client registration for testing.
 */
export const defaultClientRegistration: ClientRegistration = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://127.0.0.1:8080/callback",
  registeredAt: "2025-01-15T10:30:00Z",
};

/**
 * Creates a mock AuthService with default implementations.
 */
export function createMockAuthService(
  impl: Partial<AuthService> = {},
): AuthService {
  return {
    discoverEndpoints: mock(() => Promise.resolve(defaultOAuthMetadata)),
    registerClient: mock(() =>
      Promise.resolve({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      }),
    ),
    generatePkceParams: mock(() => defaultPkceParams),
    buildAuthUrl: mock(() => "http://example.com/auth"),
    startCallbackServer: mock(() =>
      Promise.resolve({
        result: Promise.resolve(defaultCallbackResult),
        close: mock(() => Promise.resolve()),
      }),
    ),
    exchangeCodeForTokens: mock(() => Promise.resolve(defaultTokenResponse)),
    refreshAccessToken: mock(() => Promise.resolve(defaultTokenResponse)),
    ...impl,
  };
}

export const defaultUnifiedSearchOutcome: UnifiedSearchOutcome = {
  state: "completed",
  completed: true,
  searchRef: "search-ref-123",
  result: {
    query: "router middleware",
    queryWarnings: [],
    sources: ["CODE"],
    results: [
      {
        id: "hit-1",
        resultType: "REPOSITORY_CODE",
        targetLabel: "npm:express@4.18.2",
        title: "router middleware",
        summary: "function router(req, res, next) { ... }",
        score: 0.92,
        highlights: {
          title: [[7, 17]],
          summary: [[9, 15]],
        },
        locator: {
          registry: "npm",
          packageName: "express",
          version: "4.18.2",
          filePath: "lib/router/index.js",
          startLine: 42,
          endLine: 57,
          language: "javascript",
          symbolRef: "npm:express:4.18.2:a123",
          qualifiedPath: "router",
          kind: "function",
          category: "callable",
        },
      },
    ],
    page: {
      offset: 0,
      limit: 10,
      returned: 1,
      hasMore: false,
    },
    partialResults: false,
    sourceStatus: [
      {
        source: "CODE",
        targetLabel: "npm:express@4.18.2",
        indexingStatus: "INDEXED",
        codeIndexState: "CURRENT",
        resultCount: 1,
        appliedFilters: [],
        ignoredFilters: [],
        incompatibleFilters: [],
        appliedQueryFeatures: [],
        ignoredQueryFeatures: [],
        incompatibleQueryFeatures: [],
      },
    ],
  },
  progress: {
    searchRef: "search-ref-123",
    status: "COMPLETED",
    targetsTotal: 1,
    targetsReady: 1,
    elapsedMs: 120,
    query: "router middleware",
    queryWarnings: [],
    sources: ["CODE"],
  },
};

/**
 * Creates a mock AuthStorage with default implementations.
 */
export function createMockAuthStorage(
  impl: Partial<LockingAuthStorage> = {},
): LockingAuthStorage {
  return {
    loadTokens: mock(() => Promise.resolve(null)),
    saveTokens: mock(() => Promise.resolve()),
    saveTokensIfUnchanged: mock(() => Promise.resolve(true)),
    clearTokens: mock(() => Promise.resolve()),
    clearTokensIfUnchanged: mock(() => Promise.resolve(true)),
    loadClient: mock(() => Promise.resolve(null)),
    saveClient: mock(() => Promise.resolve()),
    clearClient: mock(() => Promise.resolve()),
    saveAuthSession: mock(() => Promise.resolve()),
    clearAuthSession: mock(() => Promise.resolve()),
    getStorageLocation: mock(() => "/mock/.githits"),
    withAuthStorageLock: <T>(fn: () => Promise<T>) => fn(),
    ...impl,
  };
}

/**
 * Creates a mock BrowserService with default implementations.
 */
export function createMockBrowserService(
  impl: Partial<BrowserService> = {},
): BrowserService {
  return {
    open: mock(() => Promise.resolve()),
    ...impl,
  };
}

/**
 * Creates a mock FileSystemService with default implementations.
 */
export function createMockFileSystemService(
  impl: Partial<FileSystemService> = {},
): FileSystemService {
  return {
    readFile: mock(() => Promise.reject(new Error("File not found"))),
    writeFile: mock(() => Promise.resolve()),
    deleteFile: mock(() => Promise.resolve()),
    exists: mock(() => Promise.resolve(false)),
    ensureDir: mock(() => Promise.resolve()),
    getHomeDir: mock(() => "/home/test"),
    joinPath: mock((...segments: string[]) => segments.join("/")),
    getCwd: mock(() => "/current/dir"),
    getDirname: mock(
      (path: string) => path.split("/").slice(0, -1).join("/") || "/",
    ),
    readdir: mock(() => Promise.resolve([])),
    isDirectory: mock(() => Promise.resolve(false)),
    atomicWriteFile: mock(() => Promise.resolve()),
    ...impl,
  };
}

/**
 * Creates a mock UpdateCheckService with default implementations.
 */
export function createMockUpdateCheckService(
  impl: Partial<UpdateCheckService> = {},
): UpdateCheckService {
  return {
    checkForUpdate: mock(() => Promise.resolve(undefined)),
    refreshRequiredUpdateStatus: mock(() => Promise.resolve()),
    getRequiredUpdateNotice: mock(() => Promise.resolve(undefined)),
    ...impl,
  };
}

/**
 * Creates a mock GitHitsService with default implementations.
 */
export function createMockGitHitsService(
  impl: Partial<GitHitsService> = {},
): GitHitsService {
  return {
    search: mock(() =>
      Promise.resolve("# Example\n```js\nconsole.log('hi')\n```"),
    ),
    getLanguages: mock(() =>
      Promise.resolve([
        {
          id: "1",
          name: "javascript",
          display_name: "JavaScript",
          aliases: ["js"],
        },
        {
          id: "2",
          name: "typescript",
          display_name: "TypeScript",
          aliases: ["ts"],
        },
        {
          id: "3",
          name: "python",
          display_name: "Python",
          aliases: ["py"],
        },
      ]),
    ),
    submitFeedback: mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    ),
    ...impl,
  };
}

export const defaultListFilesResult = {
  files: [
    // Backend returns `fileType` uppercase (observed: CONFIG, SOURCE,
    // TEST, DOC). Keep fixtures aligned so formatter tests lock in
    // the real contract.
    {
      path: "src/index.js",
      name: "index.js",
      language: "javascript",
      fileType: "SOURCE",
      byteSize: 1234,
    },
    {
      path: "src/lib/app.js",
      name: "app.js",
      language: "javascript",
      fileType: "SOURCE",
      byteSize: 8500,
    },
  ],
  total: 2,
  hasMore: false,
  indexedVersion: "v5.2.1",
  resolution: {
    requestedVersion: undefined,
    requestedRef: undefined,
    resolvedRef: "v5.2.1",
    commitSha: "abc123",
  },
  hint: undefined,
};

export const defaultReadFileResult = {
  filePath: "src/index.js",
  language: "javascript",
  totalLines: 5,
  startLine: 1,
  endLine: 5,
  content:
    "// Express entry point\n'use strict';\n\nmodule.exports = require('./lib/express');\n",
  isBinary: false,
};

export const defaultGrepRepoResult: GrepRepoResult = {
  matches: [
    {
      filePath: "src/index.js",
      line: 4,
      matchStartByte: 17,
      matchEndByte: 24,
      lineContent: "module.exports = require('./lib/express');",
      contextBefore: ["// Express entry point", "'use strict';", ""],
      contextAfter: [""],
      fileContentHash: "abc123",
      fileIntent: "production",
    },
  ],
  nextCursor: undefined,
  hasMore: false,
  truncatedReason: "NONE",
  routeTaken: "CONTENT_INDEX",
  filesScanned: 1,
  filesInScope: 1,
  binaryFilesSkipped: 0,
  filesTooLargeSkipped: 0,
  totalMatches: 1,
  uniqueFilesMatched: 1,
  indexedVersion: "v5.2.1",
  resolution: {
    requestedVersion: undefined,
    requestedRef: undefined,
    resolvedRef: "v5.2.1",
    commitSha: "abc123",
  },
};

/**
 * Creates a mock CodeNavigationService with default implementations.
 */
export function createMockCodeNavigationService(
  impl: Partial<CodeNavigationService> = {},
): CodeNavigationService {
  return {
    search: mock(() => Promise.resolve(defaultUnifiedSearchOutcome)),
    searchStatus: mock(() => Promise.resolve(defaultUnifiedSearchOutcome)),
    listFiles: mock(() => Promise.resolve(defaultListFilesResult)),
    readFile: mock(() => Promise.resolve(defaultReadFileResult)),
    grepRepo: mock(() => Promise.resolve(defaultGrepRepoResult)),
    ...impl,
  };
}

/**
 * Fully-populated `PackageSummary` fixture. Every optional field is
 * present so omission-rule tests can subtract from a realistic shape.
 */
export const defaultPackageSummary: PackageSummary = {
  package: {
    name: "express",
    registry: "NPM",
    description: "Fast, unopinionated, minimalist web framework for Node.js",
    latestVersion: "4.18.2",
    latestVersionPublishedAt: "2023-05-28T00:00:00Z",
    homepage: "https://expressjs.com",
    repositoryUrl: "https://github.com/expressjs/express",
    license: "MIT",
    downloadsLastMonth: 86_000_000,
    downloadsTotal: 1_200_000_000,
    githubRepository: {
      stargazersCount: 63_400,
      forksCount: 14_300,
      openIssuesCount: 123,
      archived: false,
      language: "JavaScript",
      topics: ["framework", "http", "middleware", "nodejs", "web"],
      pushedAt: "2024-05-10T00:00:00Z",
    },
  },
  security: {
    vulnerabilityCount: 5,
    hasCurrentVulnerabilities: true,
    recentVulnerabilities: [
      {
        osvId: "GHSA-xxxx-xxxx-xxxx",
        summary: "Open redirect vulnerability in default error handler",
        severityScore: 7.5,
        publishedAt: "2024-06-01T00:00:00Z",
      },
      {
        osvId: "GHSA-yyyy-yyyy-yyyy",
        summary: "Prototype pollution via query parser",
        severityScore: 5.3,
        publishedAt: "2024-03-12T00:00:00Z",
      },
    ],
  },
  latestChangelogs: [
    {
      version: "4.18.2",
      publishedAt: "2023-05-28T00:00:00Z",
      body: "Security fix for CVE-xxxx\n\nFull changelog body...",
    },
    {
      version: "4.18.1",
      publishedAt: "2023-05-10T00:00:00Z",
      body: "Bug fixes\n\nAnother body...",
    },
    {
      version: "4.18.0",
      publishedAt: "2023-04-01T00:00:00Z",
      body: "New router API\n\nYet another body...",
    },
  ],
};

/**
 * Fully-populated `VulnerabilityReport` fixture. Mixes one malicious
 * advisory, one critical, one high, one medium with aliases, one low
 * with a `modifiedAt` that differs from `publishedAt`, and one
 * null-severity advisory so omission tests have live material to
 * subtract from.
 */
export const defaultVulnerabilityReport: VulnerabilityReport = {
  package: {
    name: "express",
    registry: "NPM",
    version: "4.18.0",
  },
  security: {
    affectedVulnerabilityCount: 6,
    nonAffectingVulnerabilityCount: 0,
    allVulnerabilityCount: 6,
    currentVersionAffected: true,
    upgradePaths: ["4.18.2"],
    vulnerabilities: [
      {
        osvId: "GHSA-mmmm-mmmm-mmmm",
        summary: "Malicious package impersonating express helper",
        severityScore: 9.8,
        severityType: "CVSS_V3",
        affectedVersionRanges: [">= 4.17.0, < 4.18.1"],
        affectedVersionRangesCount: 1,
        affectedVersionRangesTruncated: false,
        fixedInVersions: [],
        publishedAt: "2024-07-10T00:00:00Z",
        aliases: [],
        isMalicious: true,
        affectsInspectedVersion: true,
        matchedAffectedVersionRanges: [">= 4.17.0, < 4.18.1"],
        duplicateIds: [],
      },
      {
        osvId: "GHSA-cccc-cccc-cccc",
        summary: "RCE via crafted JSON body",
        severityScore: 9.2,
        severityType: "CVSS_V3",
        affectedVersionRanges: [">= 4.0.0, < 4.18.2"],
        affectedVersionRangesCount: 1,
        affectedVersionRangesTruncated: false,
        fixedInVersions: ["4.18.2"],
        publishedAt: "2024-06-15T00:00:00Z",
        aliases: ["CVE-2024-4242"],
        affectsInspectedVersion: true,
        matchedAffectedVersionRanges: [">= 4.0.0, < 4.18.2"],
        duplicateIds: [],
      },
      {
        osvId: "GHSA-xxxx-xxxx-xxxx",
        summary: "Open redirect in default error handler",
        severityScore: 7.5,
        severityType: "CVSS_V3",
        affectedVersionRanges: [">= 4.0.0, < 4.18.2"],
        affectedVersionRangesCount: 1,
        affectedVersionRangesTruncated: false,
        fixedInVersions: ["4.18.2"],
        publishedAt: "2024-06-01T00:00:00Z",
        aliases: ["CVE-2024-1234"],
        affectsInspectedVersion: true,
        matchedAffectedVersionRanges: [">= 4.0.0, < 4.18.2"],
        duplicateIds: [],
      },
      {
        osvId: "GHSA-yyyy-yyyy-yyyy",
        summary: "Prototype pollution via query parser",
        severityScore: 5.3,
        severityType: "CVSS_V3",
        affectedVersionRanges: [">= 4.0.0, < 4.17.4"],
        affectedVersionRangesCount: 1,
        affectedVersionRangesTruncated: false,
        fixedInVersions: ["4.17.4"],
        publishedAt: "2024-03-12T00:00:00Z",
        modifiedAt: "2024-04-02T00:00:00Z",
        aliases: ["CVE-2024-5678", "CVE-2024-5679"],
        affectsInspectedVersion: true,
        matchedAffectedVersionRanges: [">= 4.0.0, < 4.17.4"],
        duplicateIds: [],
      },
      {
        osvId: "GHSA-zzzz-zzzz-zzzz",
        summary: "Header injection in res.send",
        severityScore: 3.2,
        severityType: "CVSS_V3",
        affectedVersionRanges: [">= 4.0.0, < 4.17.3"],
        affectedVersionRangesCount: 1,
        affectedVersionRangesTruncated: false,
        fixedInVersions: ["4.17.3"],
        publishedAt: "2024-02-01T00:00:00Z",
        affectsInspectedVersion: true,
        matchedAffectedVersionRanges: [">= 4.0.0, < 4.17.3"],
        duplicateIds: [],
      },
      {
        osvId: "GHSA-nnnn-nnnn-nnnn",
        summary: "Advisory without a CVSS score",
        affectedVersionRangesCount: 0,
        affectedVersionRangesTruncated: false,
        publishedAt: "2023-11-20T00:00:00Z",
        affectsInspectedVersion: true,
        matchedAffectedVersionRanges: [],
        duplicateIds: [],
      },
    ],
  },
};

/**
 * Fully-populated `DependencyReport` fixture — npm:express shape with
 * a runtime group + a development group. No transitive, no conflicts,
 * no circular deps.
 */
export const defaultDependencyReport: DependencyReport = {
  package: {
    name: "express",
    registry: "NPM",
    version: "5.2.1",
  },
  dependencies: {
    direct: [
      { name: "accepts", versionConstraint: "^2.0.0", type: "runtime" },
      { name: "body-parser", versionConstraint: "^2.2.1", type: "runtime" },
      { name: "cookie", versionConstraint: "^0.7.1", type: "runtime" },
    ],
  },
  dependencyGroups: {
    primaryGroup: undefined,
    groups: [
      {
        name: "runtime",
        lifecycle: "runtime",
        conditionType: "always",
        selectionMode: "required",
        dependencies: [
          { name: "accepts", constraint: "^2.0.0" },
          { name: "body-parser", constraint: "^2.2.1" },
          { name: "cookie", constraint: "^0.7.1" },
        ],
      },
      {
        name: "development",
        lifecycle: "development",
        conditionType: "always",
        selectionMode: "required",
        dependencies: [
          { name: "mocha", constraint: "^10.7.3" },
          { name: "supertest", constraint: "^6.3.0" },
        ],
      },
    ],
  },
};

/**
 * Zero-dep fixture — left-pad shape. Backend returns
 * `dependencyGroups: null` for packages without group metadata, which
 * is the shape the envelope's omission rules key off of.
 */
export const zeroDepDependencyReport: DependencyReport = {
  package: {
    name: "left-pad",
    registry: "NPM",
    version: "1.3.0",
  },
  dependencies: { direct: [] },
};

/**
 * Crates-shape fixture — tokio with runtime + development + optional
 * feature groups, exercising conditionType=feature and conditionValue.
 * Includes a synthetic duplicate so terminal-only dedup can be asserted.
 */
export const cratesFeatureDependencyReport: DependencyReport = {
  package: {
    name: "tokio",
    registry: "CRATES",
    version: "1.52.1",
  },
  dependencies: {
    direct: [
      {
        name: "pin-project-lite",
        versionConstraint: "^0.2.11",
        type: "runtime",
      },
    ],
  },
  dependencyGroups: {
    primaryGroup: undefined,
    groups: [
      {
        name: "runtime",
        lifecycle: "runtime",
        conditionType: "always",
        selectionMode: "required",
        dependencies: [{ name: "pin-project-lite", constraint: "^0.2.11" }],
      },
      {
        name: "full",
        lifecycle: "optional",
        conditionType: "feature",
        conditionValue: "full",
        selectionMode: "additive",
        defaultEnabled: false,
        dependencies: [{ name: "parking_lot", constraint: "^0.12.0" }],
      },
      {
        name: "net",
        lifecycle: "optional",
        conditionType: "feature",
        conditionValue: "net",
        selectionMode: "additive",
        defaultEnabled: false,
        dependencies: [
          { name: "libc", constraint: "^0.2.168" },
          { name: "libc", constraint: "^0.2.168" },
          { name: "mio", constraint: "^1.2.0" },
        ],
      },
    ],
  },
};

/**
 * Default changelog fixture — express with two GitHub Releases entries.
 * Covers the common shape: resolved `releases` source, populated body
 * markdown, ISO date, and a normalisedVersion that equals the raw.
 */
export const defaultChangelogReport: ChangelogReport = {
  package: {
    name: "express",
    registry: "npm",
    repoUrl: undefined,
    fromVersion: undefined,
    toVersion: undefined,
    limit: 10,
  },
  source: "releases",
  entries: [
    {
      version: "5.2.1",
      normalizedVersion: "5.2.1",
      publishedAt: "2026-01-15T12:00:00Z",
      htmlUrl: "https://github.com/expressjs/express/releases/tag/5.2.1",
      body: "## Patch\n- fixed a thing",
    },
    {
      version: "5.2.0",
      normalizedVersion: "5.2.0",
      publishedAt: "2025-12-10T09:00:00Z",
      htmlUrl: "https://github.com/expressjs/express/releases/tag/5.2.0",
      body: "## Minor\n- added WebSocket support",
    },
  ],
};

export const defaultPackageDocsList: PackageDocsList = {
  registry: "npm",
  packageName: "express",
  version: "5.2.1",
  stale: false,
  pages: [
    {
      id: "123-getting-started",
      title: "Getting Started",
      slug: "getting-started",
      order: 0,
      linkName: "getting-started",
      lastUpdatedAt: "2026-02-01T12:00:00Z",
      sourceKind: "CRAWLED",
      sourceUrl: "https://hexdocs.pm/express/getting-started.html",
    },
    {
      id: "github:expressjs/express@abc123/README.md",
      title: "README.md",
      slug: "github:expressjs/express@abc123/README.md",
      order: 1,
      sourceKind: "REPOSITORY",
      sourceUrl: "https://github.com/expressjs/express/blob/abc123/README.md",
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "abc123",
      requestedRef: "v5.2.1",
      filePath: "README.md",
    },
  ],
  pageInfo: {
    hasNextPage: false,
    totalCount: 2,
  },
};

export const defaultPackageDocResult: PackageDocResult = {
  registry: "npm",
  packageName: "express",
  version: "5.2.1",
  sourceKind: "REPOSITORY",
  page: {
    id: "github:expressjs/express@abc123/README.md",
    title: "README.md",
    content: "# Express\n\nFast, unopinionated web framework.",
    contentFormat: "markdown",
    breadcrumbs: ["README"],
    lastUpdatedAt: "2026-02-01T12:00:00Z",
    sourceKind: "REPOSITORY",
    source: {
      url: "https://github.com/expressjs/express/blob/abc123/README.md",
      label: "README.md",
    },
    repoUrl: "https://github.com/expressjs/express",
    gitRef: "abc123",
    requestedRef: "v5.2.1",
    filePath: "README.md",
    baseUrl: "https://github.com/expressjs/express/blob/abc123/README.md",
  },
};

/**
 * Creates a mock PackageIntelligenceService. Defaults resolve to the
 * fully-populated fixtures; override per-test as needed.
 */
export function createMockPackageIntelligenceService(
  impl: Partial<PackageIntelligenceService> = {},
): PackageIntelligenceService {
  return {
    packageSummary: mock(() => Promise.resolve(defaultPackageSummary)),
    packageVulnerabilities: mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    ),
    packageDependencies: mock(() => Promise.resolve(defaultDependencyReport)),
    packageUpgradeDependencyProbe: mock(() =>
      Promise.resolve(defaultDependencyReport),
    ),
    packageChangelog: mock(() => Promise.resolve(defaultChangelogReport)),
    listPackageDocs: mock(() => Promise.resolve(defaultPackageDocsList)),
    readPackageDoc: mock(() => Promise.resolve(defaultPackageDocResult)),
    ...impl,
  };
}

/**
 * Creates a mock KeyringService with default implementations.
 */
export function createMockKeyringService(
  impl: Partial<KeyringService> = {},
): KeyringService {
  return {
    getPassword: mock(() => null),
    setPassword: mock(() => {}),
    deletePassword: mock(() => false),
    ...impl,
  };
}

/**
 * Creates a mock TokenProvider with default implementations.
 */
export function createMockTokenProvider(
  impl: Partial<TokenProvider> = {},
): TokenProvider {
  return {
    getToken: mock(() => Promise.resolve("mock-access-token")),
    forceRefresh: mock(() => Promise.resolve("mock-refreshed-token")),
    ...impl,
  };
}

/**
 * Creates valid TokenData for testing.
 */
export function createValidTokenData(
  overrides: Partial<TokenData> = {},
): TokenData {
  return {
    accessToken: "eyJ-test-access-token",
    refreshToken: "test-refresh-token",
    createdAt: "2025-01-15T10:30:00Z",
    expiresAt: null,
    ...overrides,
  };
}

/**
 * Creates an unsigned JWT-like token string for payload decoding tests.
 */
export function createJwtToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8")
      .toString("base64url")
      .replace(/=/g, "");

  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

/**
 * Creates a mock PromptService with default implementations.
 */
export function createMockPromptService(
  impl: Partial<PromptService> = {},
): PromptService {
  return {
    select: mock(
      <T>(_message: string, choices: { value: T }[], defaultValue?: T) =>
        Promise.resolve((defaultValue ?? choices[0]?.value) as T),
    ) as PromptService["select"],
    checkbox: mock(
      <T>(
        _message: string,
        choices: {
          value: T;
          checked?: boolean;
          disabled?: boolean | string;
        }[],
      ) =>
        Promise.resolve(
          choices
            .filter((choice) => choice.checked && !choice.disabled)
            .map((choice) => choice.value),
        ),
    ) as PromptService["checkbox"],
    confirm: mock(() =>
      Promise.reject(new Error("confirm called without explicit override")),
    ),
    confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    ...impl,
  };
}

/**
 * Creates a mock ExecService with default implementations.
 */
export function createMockExecService(
  impl: Partial<ExecService> = {},
): ExecService {
  return {
    exec: mock((_command: string, _args: string[], _options?: unknown) =>
      Promise.resolve({ exitCode: 1, stdout: "", stderr: "" } as ExecResult),
    ),
    ...impl,
  };
}
