import { describe, expect, it, mock } from "bun:test";
import { PackageIntelligenceServiceImpl } from "./package-intelligence-service.js";
import {
  createMockPackageLifecycle,
  createMockTokenProvider,
} from "./test-helpers.js";

interface SelectedSecurity {
  selectedVersionAffected: boolean;
  assessmentStatus: string;
  assessmentComplete: boolean;
  assessmentReasons: string[];
  affectedVulnerabilityCount: number;
  unknownVulnerabilityCount: number;
}
interface Wire {
  data: {
    packageSummary: {
      package: {
        registry: string;
        name: string;
        version: string | null;
        license: string;
      };
      security: {
        allVulnerabilityCount: number;
        recentVulnerabilities: Array<{ osvId: string }>;
        vulnerabilityCount?: number;
        hasCurrentVulnerabilities?: boolean;
      } | null;
    };
    provenance: {
      package: { registry: string; name: string } | null;
      security: SelectedSecurity | null;
      selectedVersion: {
        resolvedVersion: string;
        lifecycle: ReturnType<typeof createMockPackageLifecycle> | null;
        registryRepository: { id: string; name: string; url: string } | null;
      } | null;
    } | null;
  };
  errors?: Array<{
    message: string;
    path: string[];
    extensions: Record<string, unknown>;
  }>;
}
function fixture(): Wire {
  return {
    data: {
      packageSummary: {
        package: {
          registry: "npm",
          name: "example",
          version: "1.0.0",
          license: "MIT",
        },
        security: { allVulnerabilityCount: 0, recentVulnerabilities: [] },
      },
      provenance: {
        package: { registry: "NPM", name: "example" },
        security: {
          selectedVersionAffected: true,
          assessmentStatus: "AFFECTED",
          assessmentComplete: false,
          assessmentReasons: ["RELATED_APPLICABILITY_UNPROVED"],
          affectedVulnerabilityCount: 1,
          unknownVulnerabilityCount: 0,
        },
        selectedVersion: {
          resolvedVersion: "1.0.0",
          lifecycle: createMockPackageLifecycle(),
          registryRepository: {
            id: "npm",
            name: "npm",
            url: "https://registry.npmjs.org",
          },
        },
      },
    },
  };
}
function setup(body: Wire) {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> =
    [];
  const fetchFn = mock(
    async (_url: unknown, init?: RequestInit): Promise<Response> => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json(body);
    },
  );
  const token = createMockTokenProvider();
  const service = new PackageIntelligenceServiceImpl(
    "https://example.test",
    token,
    fetchFn as unknown as typeof fetch,
  );
  return {
    requests,
    token,
    run: (includeVerboseFields = false) =>
      service.packageSummary({
        registry: "NPM",
        packageName: "example",
        includeVerboseFields,
      }),
  };
}
describe("overview combined selected security", () => {
  it.each([false, true])(
    "uses one full two-root query with actual registry casing (verbose=%s)",
    async (verbose) => {
      const h = setup(fixture());
      const r = await h.run(verbose);
      expect(r.security).toMatchObject({
        vulnerabilityCount: 1,
        allVulnerabilityCount: 0,
        hasCurrentVulnerabilities: true,
        assessmentStatus: "AFFECTED",
        assessmentComplete: false,
        assessmentReasons: ["RELATED_APPLICABILITY_UNPROVED"],
        unknownVulnerabilityCount: 0,
      });
      expect(h.requests).toHaveLength(1);
      expect(h.requests[0]!.variables).toEqual({
        registry: "NPM",
        name: "example",
        includeVerboseFields: verbose,
      });
      const query = h.requests[0]!.query;
      expect(query).toContain("package { registry name }");
      for (const field of [
        "selectedVersionAffected",
        "assessmentStatus",
        "assessmentComplete",
        "assessmentReasons",
        "affectedVulnerabilityCount",
        "unknownVulnerabilityCount",
      ])
        expect(query).toContain(field);
      expect(query).not.toMatch(
        /\bvulnerabilityCount\b|hasCurrentVulnerabilities|\bevidence\s*\(|contentDigest|sourceDetails|packageVulnerabilityCount/,
      );
      expect(query).toContain(
        "recentVulnerabilities @include(if: $includeVerboseFields)",
      );
      expect(query).toContain(
        "latestChangelogs(limit: 3) @include(if: $includeVerboseFields)",
      );
      expect(r.package.registryRepository?.id).toBe("npm");
    },
  );
  it.each([
    "registry",
    "name",
    "version",
    "parent",
    "security",
    "identity",
    "selected",
    "no-version",
  ])(
    "does not substitute legacy native current values for %s mismatch or absence",
    async (mode) => {
      const b = fixture();
      b.data.packageSummary.security!.vulnerabilityCount = 99;
      b.data.packageSummary.security!.hasCurrentVulnerabilities = true;
      b.data.packageSummary.security!.allVulnerabilityCount = 2;
      b.data.packageSummary.security!.recentVulnerabilities = [
        { osvId: "historical" },
      ];
      if (mode === "registry") b.data.provenance!.package!.registry = "PYPI";
      if (mode === "name") b.data.provenance!.package!.name = "other";
      if (mode === "version")
        b.data.provenance!.selectedVersion!.resolvedVersion = "2";
      if (mode === "parent") b.data.provenance = null;
      if (mode === "security") b.data.provenance!.security = null;
      if (mode === "identity") b.data.provenance!.package = null;
      if (mode === "selected") b.data.provenance!.selectedVersion = null;
      if (mode === "no-version") b.data.packageSummary.package.version = null;
      const h = setup(b);
      const r = await h.run();
      expect(r.security?.vulnerabilityCount).toBeUndefined();
      expect(r.security?.hasCurrentVulnerabilities).toBeUndefined();
      expect(r.security?.allVulnerabilityCount).toBe(2);
      expect(r.security?.recentVulnerabilities).toEqual([
        { osvId: "historical" },
      ]);
      expect(h.requests).toHaveLength(1);
    },
  );
  it("keeps selected findings independently of absent native history", async () => {
    const b = fixture();
    b.data.packageSummary.security = null;
    const r = await setup(b).run();
    expect(r.security?.vulnerabilityCount).toBe(1);
    expect(r.security?.allVulnerabilityCount).toBeUndefined();
  });
  it("preserves Related-only incompleteness without promoting its positive", async () => {
    const b = fixture();
    Object.assign(b.data.provenance!.security!, {
      selectedVersionAffected: false,
      affectedVulnerabilityCount: 0,
      assessmentStatus: "NON_AFFECTING",
    });
    const r = await setup(b).run();
    expect(r.security).toMatchObject({
      vulnerabilityCount: 0,
      hasCurrentVulnerabilities: false,
      unknownVulnerabilityCount: 0,
      assessmentComplete: false,
      assessmentReasons: ["RELATED_APPLICABILITY_UNPROVED"],
    });
  });
  it.each(["security", "lifecycle", "repository", "parent"])(
    "isolates %s optional errors",
    async (facet) => {
      const b = fixture();
      const path =
        facet === "parent"
          ? ["provenance"]
          : facet === "security"
            ? ["provenance", "security"]
            : [
                "provenance",
                "selectedVersion",
                facet === "lifecycle" ? "lifecycle" : "registryRepository",
              ];
      b.errors = [
        {
          message: "private provider response",
          path,
          extensions: {
            code: "RATE_LIMITED",
            retryable: true,
            retry_after_ms: 1501,
          },
        },
      ];
      if (facet === "security") b.data.provenance!.security = null;
      if (facet === "lifecycle")
        b.data.provenance!.selectedVersion!.lifecycle = null;
      if (facet === "repository")
        b.data.provenance!.selectedVersion!.registryRepository = null;
      if (facet === "parent") b.data.provenance = null;
      const r = await setup(b).run();
      expect(r.package.license).toBe("MIT");
      expect(r.security?.allVulnerabilityCount).toBe(0);
      expect(r.security?.vulnerabilityCount).toBe(
        facet === "security" || facet === "parent" ? undefined : 1,
      );
      if (facet === "security") {
        expect(r.lifecycle).toBeDefined();
        expect(r.package.registryRepository?.id).toBe("npm");
        expect(r.package.registryRepositoryError).toBeUndefined();
      } else {
        expect(r.lifecycle === undefined).toBe(facet !== "repository");
        expect(r.package.registryRepository === undefined).toBe(
          facet !== "lifecycle",
        );
        expect(r.package.registryRepositoryError).toBeDefined();
      }
      expect(r.securityError === undefined).toBe(
        facet !== "security" && facet !== "parent",
      );
      expect(JSON.stringify(r)).not.toContain("private provider response");
    },
  );
  it.each(["selectedVersion", "resolvedVersion"])(
    "invalidates dependent facets when %s fails",
    async (facet) => {
      const b = fixture();
      b.errors = [
        {
          message: "unavailable",
          path:
            facet === "selectedVersion"
              ? ["provenance", "selectedVersion"]
              : ["provenance", "selectedVersion", "resolvedVersion"],
          extensions: { code: "RATE_LIMITED" },
        },
      ];
      const r = await setup(b).run();
      expect(r.security?.vulnerabilityCount).toBeUndefined();
      expect(r.security?.allVulnerabilityCount).toBe(0);
      expect(r.lifecycle).toBeUndefined();
      expect(r.package.registryRepository).toBeUndefined();
      expect(r.package.registryRepositoryError?.message).toBe(
        "Registry provenance and lifecycle warnings temporarily unavailable (RATE_LIMITED).",
      );
    },
  );
  it.each(["UNAUTHORIZED", "FORBIDDEN", "CLIENT_UPDATE_REQUIRED"])(
    "keeps %s fatal on optional facets",
    async (code) => {
      const b = fixture();
      b.errors = [
        {
          message: "blocked",
          path: ["provenance", "security"],
          extensions: { code },
        },
      ];
      const h = setup(b);
      await expect(h.run()).rejects.toThrow();
    },
  );
});
