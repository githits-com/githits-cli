import { describe, expect, it } from "bun:test";
import { PackageIntelligenceServiceImpl } from "./package-intelligence-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

describe("package summary release selection", () => {
  it.each([
    ["NPM", "path-is-absolute", "1.0.1", "2.0.0", "DEPRECATED"],
    ["NUGET", "preview", null, "1.27.0-preview.1", "PRERELEASE_EXCLUDED"],
    [
      "NUGET",
      "preview",
      "1.27.0-preview.1",
      "1.27.0-preview.1",
      "PRERELEASE_EXCLUDED",
    ],
    ["PYPI", "example", "1.9.3", "2.0.0", "YANKED"],
    ["NPM", "ordinary", "1.0.0", "1.0.0", null],
    ["NPM", "no-pointer", "1.0.0", null, null],
  ] as const)(
    "preserves %s:%s selection %s independently of pointer %s",
    async (registry, name, version, latestVersion, reason) => {
      for (const includeVerboseFields of [false, true]) {
        const requests: Array<{
          query: string;
          variables: Record<string, unknown>;
        }> = [];
        const difference =
          reason && latestVersion ? { version: latestVersion, reason } : null;
        const fetchFn: typeof fetch = (async (
          _url: unknown,
          init?: RequestInit,
        ): Promise<Response> => {
          requests.push(JSON.parse(String(init?.body)));
          return Response.json({
            data: {
              packageSummary: {
                package: {
                  name,
                  registry,
                  version,
                  ...(includeVerboseFields ? { latestVersion } : {}),
                  publishedAt: version ? "2024-01-02T00:00:00Z" : null,
                  ...(includeVerboseFields
                    ? { latestVersionPublishedAt: "2025-03-04T00:00:00Z" }
                    : {}),
                  registryLatestDifference: difference,
                },
              },
              provenance: {
                selectedVersion: {
                  resolvedVersion: version ?? "other",
                  registryRepository: {
                    id: "registry",
                    name: "Registry",
                    url: "https://example.test",
                  },
                },
              },
            },
          });
        }) as typeof fetch;
        const summary = await new PackageIntelligenceServiceImpl(
          "https://example.test",
          createMockTokenProvider(),
          fetchFn,
        ).packageSummary({ registry, packageName: name, includeVerboseFields });
        expect(summary.package.version).toBe(version ?? undefined);
        expect(summary.package.latestVersion).toBe(
          includeVerboseFields ? (latestVersion ?? undefined) : undefined,
        );
        expect(summary.package.publishedAt).toBe(
          version ? "2024-01-02T00:00:00Z" : undefined,
        );
        expect(summary.package.registryLatestDifference).toEqual(
          difference ?? undefined,
        );
        expect(summary.package.registryRepository?.id).toBe(
          version ? "registry" : undefined,
        );
        expect(requests).toHaveLength(1);
        const request = requests[0]!;
        expect(request.variables).toEqual({
          registry,
          name,
          includeVerboseFields,
        });
        const identity =
          request.query.split("package {")[1]?.split("githubRepository")[0] ??
          "";
        expect(identity).toMatch(
          /\bversion\s+publishedAt\s+registryLatestDifference\s*\{\s*version\s+reason\s*\}/,
        );
        expect(identity).toContain(
          "latestVersion @include(if: $includeVerboseFields)",
        );
        expect(identity).toContain(
          "latestVersionPublishedAt @include(if: $includeVerboseFields)",
        );
        expect(request.query).toContain(
          "latestChangelogs(limit: 3) @include(if: $includeVerboseFields)",
        );
        expect(request.query).not.toContain("quickstart");
      }
    },
  );
});
