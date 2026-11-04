import { defaultAdvisoryLookup } from "../packages/core-internal/src/services/advisory-test-helpers.js";
import { formatVulns, type VulnsResult } from "../src/commands/vulns-format.js";
import { buildVulnsResponse } from "../src/commands/vulns-response.js";

/** Response-size cases, not runtime benchmarks; generated rows share one small fixture. */
for (const count of [1, 13]) {
  const lookup = structuredClone(defaultAdvisoryLookup);
  const connection = lookup.affectedPackages;
  const template = connection?.entries[0];
  if (!connection || !template)
    throw new Error("Output-size fixture requires a package");
  connection.entries = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    package: {
      ...template.package,
      name: count === 1 ? "minimatch" : `package-${index + 1}`,
    },
  }));
  connection.pageInfo.totalCount = count;
  const results: VulnsResult[] = [
    {
      inputId: lookup.requestedId,
      status: "success",
      lookup,
      packagePagination: { complete: true, pagesRead: 1 },
    },
  ];
  for (const verbose of [false, true]) {
    const text = formatVulns(results, { width: 80, verbose });
    const json = JSON.stringify(buildVulnsResponse(results, { verbose }));
    console.log(
      JSON.stringify({
        packages: count,
        verbose,
        textBytes: Buffer.byteLength(text),
        textLines: text.trimEnd().split("\n").length,
        jsonBytes: Buffer.byteLength(json),
      }),
    );
  }
}
