import { mock } from "bun:test";
import type {
  ChangelogReport,
  CodeDiffResult,
  CodeNavigationService,
  DependencyReport,
  GitHitsService,
  GrepRepoResult,
  PackageDocResult,
  PackageDocsList,
  PackageIntelligenceService,
  PackageSummary,
  PackageUpgradeReviewResponse,
  UnifiedSearchOutcome,
  VulnerabilityReport,
} from "@githits/core-internal";

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
        suggestedSiteTargets: [],
        suggestedSiteTargetsTruncated: false,
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
    searchLanguages: mock((query: string, limit: number = 5) => {
      const lowerQuery = query.toLowerCase();
      return Promise.resolve(
        [
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
        ]
          .filter(
            (language) =>
              language.name.toLowerCase().includes(lowerQuery) ||
              language.display_name.toLowerCase().includes(lowerQuery) ||
              language.aliases.some((alias) =>
                alias.toLowerCase().includes(lowerQuery),
              ),
          )
          .slice(0, limit),
      );
    }),
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

export const defaultCodeDiffResult: CodeDiffResult = {
  package: {
    registry: "NPM",
    name: "express",
    repoUrl: "https://github.com/expressjs/express",
  },
  fromResolution: {
    requested: "4.18.1",
    resolvedVersion: "4.18.1",
    ref: "v4.18.1",
    commitSha: "from-sha",
    refKind: "TAG",
    versionSource: "REGISTRY",
  },
  toResolution: {
    requested: "4.18.2",
    resolvedVersion: "4.18.2",
    ref: "v4.18.2",
    commitSha: "to-sha",
    refKind: "TAG",
    versionSource: "REGISTRY",
  },
  raw: {
    summary: {
      filesChanged: 1,
      added: 0,
      deleted: 0,
      modified: 1,
      modeChanged: 0,
      typeChanged: 0,
      inventoryComplete: true,
      unprojectableFiles: 0,
    },
    scope: {
      status: "PACKAGE",
      fromSubpath: "",
      toSubpath: "",
    },
    contentCoverage: "COMPLETE",
    files: [
      {
        path: "lib/express.js",
        pathEncoding: "UTF8",
        status: "MODIFIED",
        modeChanged: false,
        typeChanged: false,
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
        contentStatus: "PATCH",
        contentSafety: { filtered: false, modifications: [] },
      },
    ],
    hasMoreFiles: false,
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
    codeDiff: mock(() => Promise.resolve(defaultCodeDiffResult)),
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

export const defaultPackageUpgradeReviewResponse: PackageUpgradeReviewResponse =
  {
    summary: {
      total: 1,
      withUnknowns: 0,
      withAddedAdvisories: 0,
      withBreakingSignals: 0,
      withDirectDependencyChanges: 0,
      withTransitiveVulnerabilityAdditions: 0,
    },
    reviews: [
      {
        registry: "NPM",
        name: "express",
        currentVersion: "4.18.0",
        targetVersion: "5.0.0",
        latestVersion: "5.0.0",
        versionDelta: "MAJOR",
        security: {
          current: {
            version: "4.18.0",
            affectedCount: 0,
            nonAffectingCount: 0,
            allCount: 0,
            advisories: [],
          },
          target: {
            version: "5.0.0",
            affectedCount: 0,
            nonAffectingCount: 0,
            allCount: 0,
            advisories: [],
          },
          added: [],
          removed: [],
          notAddressed: [],
          fixed: [],
          introduced: [],
          unchanged: [],
        },
        changelog: {
          source: "RELEASES",
          entries: [
            {
              version: "5.0.0",
              bodyPreview: "Major release notes.",
              headline: "Major release notes.",
              signals: [],
            },
          ],
          sampledEntries: [],
          keywordEntries: [],
          totalKeywordEntries: 0,
          totalEntries: 1,
          totalEntriesWithBodies: 1,
          truncated: false,
          hasReleaseNoteBodies: true,
          breakingSignals: [],
          migrationSignals: [],
        },
        compatibility: { peerDependencyChanges: [], notes: [] },
        dependencyChanges: {
          direct: { added: [], removed: [], changed: [] },
          transitive: { added: [], removed: [], changed: [] },
        },
        unknowns: [],
      },
    ],
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
    packageUpgradeReview: mock(() =>
      Promise.resolve(defaultPackageUpgradeReviewResponse),
    ),
    packageChangelog: mock(() => Promise.resolve(defaultChangelogReport)),
    listPackageDocs: mock(() => Promise.resolve(defaultPackageDocsList)),
    readPackageDoc: mock(() => Promise.resolve(defaultPackageDocResult)),
    ...impl,
  };
}
