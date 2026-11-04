import { describe, expect, it } from "bun:test";
import { ClientUpdateRequiredError } from "./client-update-required-error.js";
import { AuthenticationError } from "./githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceBackendError,
  PackageIntelligenceServiceImpl,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "./package-intelligence-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const GOOGLE = {
  id: "maven:google",
  name: "Google Maven",
  url: "https://dl.google.com/dl/android/maven2",
};
const CENTRAL = {
  id: "maven:central",
  name: "Maven Central",
  url: "https://repo1.maven.org/maven2",
};
const PARAMS = {
  registry: "MAVEN" as const,
  packageName: "com.android.installreferrer:installreferrer",
};

interface WireRequest {
  query: string;
  variables: Record<string, unknown>;
}

interface OverviewWireBody {
  data: { packageSummary: unknown; provenance: unknown };
}

function serviceFor(
  body: unknown,
  requests: WireRequest[] = [],
): PackageIntelligenceServiceImpl {
  const fetchFn = async (
    _url: unknown,
    init?: RequestInit,
  ): Promise<Response> => {
    requests.push(JSON.parse(String(init?.body)) as WireRequest);
    return Response.json(body);
  };
  return new PackageIntelligenceServiceImpl(
    "https://example.invalid",
    createMockTokenProvider(),
    fetchFn as unknown as typeof fetch,
  );
}

function overviewBody(
  repository: unknown = GOOGLE,
  version = "2.2",
): OverviewWireBody {
  return {
    data: {
      packageSummary: {
        package: {
          name: PARAMS.packageName,
          registry: PARAMS.registry,
          version: "2.2",
          latestVersion: "2.2",
          license: "MIT",
        },
        security: {
          vulnerabilityCount: 0,
          allVulnerabilityCount: 3,
          hasCurrentVulnerabilities: false,
        },
        latestChangelogs: [{ version: "2.2", body: "Existing notes" }],
      },
      provenance: {
        selectedVersion: {
          resolvedVersion: version,
          registryRepository: repository,
        },
      },
    },
  };
}

describe("registry repository provenance", () => {
  it.each([GOOGLE, CENTRAL, null])(
    "preserves the descriptor or unknown evidence: %p",
    async (repository) => {
      for (const includeVerboseFields of [false, true]) {
        const requests: WireRequest[] = [];
        const result = await serviceFor(
          overviewBody(repository),
          requests,
        ).packageSummary({ ...PARAMS, includeVerboseFields });
        expect(result.package.registryRepository).toEqual(
          repository ?? undefined,
        );
        expect(result.package.latestVersion).toBe("2.2");
        expect(result.package.license).toBe("MIT");
        expect(result.security?.allVulnerabilityCount).toBe(3);
        expect(result.latestChangelogs?.[0]?.body).toBe("Existing notes");
        expect(requests).toHaveLength(1);
        expect(requests[0]?.variables).toEqual({
          registry: PARAMS.registry,
          name: PARAMS.packageName,
          includeVerboseFields,
        });
        const query = requests[0]?.query ?? "";
        expect(query).toContain(
          "packageSummary(registry: $registry, name: $name)",
        );
        const selection = query.split("provenance: packageInfo")[1] ?? "";
        expect(selection).toContain("resolvedVersion");
        expect(selection).toMatch(
          /registryRepository\s*\{\s*id\s+name\s+url\s*\}/,
        );
        expect(selection).not.toMatch(
          /security|githubRepository|changelog|license/,
        );
        expect(query).toContain(
          "recentVulnerabilities @include(if: $includeVerboseFields)",
        );
        expect(query).toContain(
          "latestChangelogs(limit: 3) @include(if: $includeVerboseFields)",
        );
        expect(query).not.toContain("quickstart");
      }
    },
  );

  it("does not attach another release's provenance", async () => {
    const result = await serviceFor(overviewBody(GOOGLE, "2.3")).packageSummary(
      PARAMS,
    );
    expect(result.package.latestVersion).toBe("2.2");
    expect(result.package.registryRepository).toBeUndefined();
  });

  it("omits provenance when the optional root has no data", async () => {
    const body = overviewBody();
    const result = await serviceFor({
      data: { ...body.data, provenance: null },
    }).packageSummary(PARAMS);
    expect(result.package.registryRepository).toBeUndefined();
  });

  it("rejects an incomplete descriptor rather than inventing its fields", async () => {
    await expect(
      serviceFor(
        overviewBody({ id: "maven:google", url: GOOGLE.url }),
      ).packageSummary(PARAMS),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it.each([["provenance"], ["provenance", "selectedVersion"]])(
    "keeps a usable overview when selected-version lookup fails at %p",
    async (...path) => {
      const body = overviewBody();
      const result = await serviceFor({
        data: { ...body.data, provenance: null },
        errors: [
          {
            message: "Selected release unavailable",
            extensions: { code: "VERSION_NOT_FOUND" },
            path,
          },
        ],
      }).packageSummary(PARAMS);
      expect(result.package.latestVersion).toBe("2.2");
      expect(result.package.registryRepository).toBeUndefined();
      expect(result.latestChangelogs?.[0]?.body).toBe("Existing notes");
    },
  );

  it("maps only original overview errors when both roots fail", async () => {
    await expect(
      serviceFor({
        data: { packageSummary: null, provenance: null },
        errors: [
          {
            message: "Extra provenance failure",
            extensions: { code: "VERSION_NOT_FOUND" },
            path: ["provenance"],
          },
          {
            message: "Original overview failure",
            extensions: { code: "PACKAGE_NOT_FOUND" },
            path: ["packageSummary"],
          },
        ],
      }).packageSummary(PARAMS),
    ).rejects.toThrow(/^Original overview failure$/);
    await expect(
      serviceFor({
        errors: [
          {
            message: "Extra provenance failure",
            extensions: { code: "VERSION_NOT_FOUND" },
            path: ["provenance"],
          },
          {
            message: "Original overview failure",
            extensions: { code: "PACKAGE_NOT_FOUND" },
            path: ["packageSummary"],
          },
        ],
      }).packageSummary(PARAMS),
    ).rejects.toBeInstanceOf(PackageIntelligenceTargetNotFoundError);
  });

  it("preserves a provenance error when no overview exists", async () => {
    await expect(
      serviceFor({
        data: { packageSummary: null, provenance: null },
        errors: [
          {
            message: "Selected release unavailable",
            extensions: { code: "VERSION_NOT_FOUND" },
            path: ["provenance"],
          },
        ],
      }).packageSummary(PARAMS),
    ).rejects.toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
  });

  it.each([
    ["UNAUTHORIZED", AuthenticationError],
    ["FORBIDDEN", PackageIntelligenceAccessError],
    ["CLIENT_UPDATE_REQUIRED", ClientUpdateRequiredError],
  ] as const)(
    "does not suppress %s on the provenance root",
    async (code, errorClass) => {
      await expect(
        serviceFor({
          ...overviewBody(),
          errors: [
            {
              message: "Access or client failure",
              extensions: { code },
              path: ["provenance"],
            },
          ],
        }).packageSummary(PARAMS),
      ).rejects.toBeInstanceOf(errorClass);
    },
  );

  it("preserves pathless errors", async () => {
    await expect(
      serviceFor({
        ...overviewBody(),
        errors: [
          { message: "Request failed", extensions: { code: "UPSTREAM_ERROR" } },
        ],
      }).packageSummary(PARAMS),
    ).rejects.toBeInstanceOf(PackageIntelligenceBackendError);
  });

  for (const method of [
    "packageVulnerabilities",
    "packageDependencies",
    "packageUpgradeDependencyProbe",
  ] as const) {
    it.each([GOOGLE, CENTRAL, null])(
      `${method} selects and retains shared identity provenance: %p`,
      async (repository) => {
        const requests: WireRequest[] = [];
        const root =
          method === "packageVulnerabilities" ? method : "packageDependencies";
        const result = await serviceFor(
          {
            data: {
              [root]: {
                package: {
                  name: PARAMS.packageName,
                  registry: PARAMS.registry,
                  version: "2.2",
                  registryRepository: repository,
                },
              },
            },
          },
          requests,
        )[method]({ ...PARAMS, version: "2.2" });
        expect(result.package.registryRepository).toEqual(
          repository ?? undefined,
        );
        expect(requests[0]?.query).toMatch(
          /registryRepository\s*\{\s*id\s+name\s+url\s*\}/,
        );
        expect(requests[0]?.variables.version).toBe("2.2");
      },
    );
  }
});
