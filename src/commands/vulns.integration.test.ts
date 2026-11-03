import { describe, expect, it } from "bun:test";
import { defaultAdvisoryLookup } from "../../packages/core-internal/src/services/advisory-test-helpers.js";
import { createIsolatedSmokeEnvironment } from "../../scripts/smoke-environment.js";

/** Exercise the published CLI path against a local contract fixture, never a live credential. */
describe("vulns CLI contract smoke", () => {
  it("wires container, detailed query, continuation, JSON and partial exit end to end", async () => {
    const requests: Array<{
      query: string;
      variables: { ids: string[]; first: number; after: string | null };
    }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const body = (await request.json()) as (typeof requests)[number];
        requests.push(body);
        const lookup = structuredClone(defaultAdvisoryLookup);
        if (body.variables.after === null)
          lookup.affectedPackages!.pageInfo = {
            totalCount: 2,
            hasNextPage: true,
            endCursor: "opaque-local-fixture",
          };
        else {
          lookup.advisory = undefined;
          lookup.affectedPackages = null;
          lookup.unknownDetails = [
            {
              section: "AFFECTED_PACKAGES",
              code: "VALIDATION_ERROR",
              message: "Fixture evidence changed; restart lookup.",
              retryable: false,
              candidateIds: null,
              candidateIdsTruncated: null,
            },
          ];
        }
        return Response.json({ data: { vulnerabilityLookup: [lookup] } });
      },
    });
    const isolated = createIsolatedSmokeEnvironment(
      "githits-advisory-contract-",
    );
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          "run",
          "src/cli.ts",
          "vulns",
          "CVE-example",
          "--json",
        ],
        {
          env: {
            ...isolated.env,
            GITHITS_CODE_NAV_URL: server.url.toString(),
            GITHITS_API_TOKEN: "ghi-local-test-fixture",
            NO_COLOR: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(status).toBe(1);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout).results[0];
      expect(result).toMatchObject({
        inputId: "CVE-example",
        status: "partial",
        packagePagination: { complete: false, pagesRead: 1 },
      });
      expect(result.lookup.advisory.osvId).toBe("OSV-example");
      expect(
        result.lookup.affectedPackages.entries[0].advisories[0].osvId,
      ).toBe("GHSA-example");
      expect(result.lookup.unknownDetails[0].code).toBe("VALIDATION_ERROR");
      expect(requests.map((x) => x.variables)).toEqual([
        { ids: ["CVE-example"], first: 5, after: null },
        { ids: ["CVE-example"], first: 5, after: "opaque-local-fixture" },
      ]);
      expect(requests[0]?.query).toContain("references { type url }");
      expect(requests[1]?.query).not.toContain("advisory {");
    } finally {
      server.stop(true);
      isolated.cleanup();
    }
  });
});
