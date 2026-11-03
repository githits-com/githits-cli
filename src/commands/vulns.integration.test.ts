import { describe, expect, it } from "bun:test";
import { defaultAdvisoryLookup } from "../../packages/core-internal/src/services/advisory-test-helpers.js";
import { createIsolatedSmokeEnvironment } from "../../scripts/smoke-environment.js";

/** Exercise the published CLI path against a local contract fixture, never a live credential. */
describe("vulns CLI contract smoke", () => {
  it.each([false, true])(
    "wires compact/verbose JSON, continuation and partial exit end to end (verbose=%s)",
    async (verbose) => {
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
            ...(verbose ? ["--verbose"] : []),
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
          coverage: { returned: 1, total: 2, complete: false },
        });
        expect(result.advisory.id).toBe("OSV-example");
        expect(result.sources[0].id).toBe("GHSA-example");
        expect(result.diagnostics[0].code).toBe("VALIDATION_ERROR");
        expect(requests.map((x) => x.variables)).toEqual([
          { ids: ["CVE-example"], first: 5, after: null },
          {
            ids: ["CVE-example"],
            first: 5,
            after: "opaque-local-fixture",
          },
        ]);
        if (verbose)
          expect(requests[0]?.query).toContain("references { type url }");
        else
          expect(requests[0]?.query).not.toContain("references { type url }");
        expect(stdout).not.toContain("endCursor");
        expect(result.packages[0].url).toBe(
          "https://www.npmjs.com/package/minimatch",
        );
        expect(Boolean(result.advisory.explanation)).toBe(verbose);
        expect(requests[1]?.query).not.toContain("advisory {");
      } finally {
        server.stop(true);
        isolated.cleanup();
      }
    },
  );
});
