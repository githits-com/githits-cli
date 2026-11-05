import {
  type AdvisoryLookup,
  AdvisoryLookupError,
  type AdvisoryService,
  normalizeAdvisoryId,
} from "@githits/core-internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import { mapPackageIntelligenceErrorForCli } from "../shared/cli-error-diagnostics.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";
import { formatVulns } from "./vulns-format.js";
import {
  buildVulnsResponse,
  type VulnsError,
  type VulnsResult,
} from "./vulns-response.js";

export interface VulnsOptions {
  json?: boolean;
  verbose?: boolean;
}

/** Existing CLI auth/terms remediation, with advisory-specific codes kept intact. */
export function mapVulnsError(error: unknown): VulnsError {
  if (error instanceof AdvisoryLookupError)
    return {
      error: error.message,
      code: error.code,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    };
  const mapped = mapPackageIntelligenceErrorForCli(error);
  const payload = buildCliMappedErrorPayload(mapped);
  return {
    ...payload,
    details: payload.details ? { ...payload.details } : undefined,
    error: formatMappedErrorForTerminal(mapped),
    retryable: mapped.retryable ?? false,
  };
}
function typedError(
  detail: AdvisoryLookup["unknownDetails"][number],
): VulnsError {
  return {
    code: detail.code,
    error: detail.message,
    retryable: detail.retryable,
    details: {
      section: detail.section,
      ...(detail.candidateIds !== null
        ? {
            candidateIds: detail.candidateIds,
            candidateIdsTruncated: detail.candidateIdsTruncated,
          }
        : {}),
    },
  };
}
function stopsAdmission(error: VulnsError): boolean {
  return [
    "AUTH_REQUIRED",
    "FORBIDDEN",
    "TERMS_ACCEPTANCE_REQUIRED",
    "ACCESS_DENIED",
    "UPDATE_REQUIRED",
  ].includes(error.code);
}
function classify(result: VulnsResult): VulnsResult {
  const lookup = result.lookup;
  if (!lookup) {
    result.status = "error";
    return result;
  }
  const connection = lookup.affectedPackages;
  if (!result.error) {
    const problem =
      lookup.unknownDetails.find((detail) => detail.code !== "NOT_FOUND") ??
      lookup.unknownDetails[0];
    if (problem) result.error = typedError(problem);
  }
  const failed =
    result.error ||
    lookup.unknownDetails.length ||
    !result.packagePagination?.complete ||
    !connection ||
    connection.coverage.sourceStatus !== "AVAILABLE" ||
    connection.coverage.localStatus !== "AVAILABLE";
  if (failed && !result.error)
    result.error = {
      code: "INCOMPLETE_EVIDENCE",
      error:
        "Advisory evidence is incomplete; inspect coverage and package pagination.",
      retryable: false,
    };
  result.status = failed
    ? lookup.advisory || connection?.entries.length
      ? "partial"
      : "error"
    : "success";
  return result;
}

/** Preserve each input's result while independently draining backend-owned whole groups. */
export async function readAdvisoryReports(
  inputs: string[],
  detailed: boolean,
  service: AdvisoryService,
): Promise<VulnsResult[]> {
  const results: VulnsResult[] = [];
  const pending: Array<{ result: VulnsResult; id: string }> = [];
  for (const inputId of inputs) {
    const result: VulnsResult = { inputId, status: "error" };
    results.push(result);
    try {
      pending.push({ result, id: normalizeAdvisoryId(inputId) });
    } catch (error) {
      result.error = mapVulnsError(error);
    }
  }
  let stopped: VulnsError | undefined;
  for (const input of pending) {
    const { result } = input;
    if (stopped) {
      result.error = {
        ...stopped,
        details: { ...stopped.details, notAttempted: true },
      };
      continue;
    }
    let lookup: AdvisoryLookup;
    try {
      lookup = structuredClone(
        // biome-ignore lint/style/noNonNullAssertion: service validates cardinality and input order.
        (await service.lookup([input.id], detailed))[0]!,
      );
    } catch (error) {
      result.error = mapVulnsError(error);
      if (stopsAdmission(result.error)) stopped = result.error;
      continue;
    }
    result.lookup = lookup;
    result.packagePagination = lookup.affectedPackages
      ? {
          complete: !lookup.affectedPackages.pageInfo.hasNextPage,
          pagesRead: 1,
        }
      : undefined;
    const connection = lookup.affectedPackages;
    if (!connection || !result.packagePagination) {
      continue;
    }
    while (connection.pageInfo.hasNextPage) {
      try {
        const cursor = connection.pageInfo.endCursor;
        if (!cursor)
          throw new AdvisoryLookupError(
            "UPSTREAM_ERROR",
            "Package continuation has no cursor.",
          );
        // biome-ignore lint/style/noNonNullAssertion: service validates one result for this one input.
        const next = (await service.lookup([input.id], detailed, cursor))[0]!;
        // A stale/null page can include a newer source observation. Keep the original
        // report intact and retain only diagnostics from that failed continuation.
        const page = next.affectedPackages;
        lookup.unknownDetails.push(
          ...next.unknownDetails
            .filter((detail) => !page || detail.path)
            .map((detail) =>
              detail.path
                ? {
                    ...detail,
                    path: [
                      ...detail.path.slice(0, 2),
                      (detail.path[2] as number) + connection.entries.length,
                      ...detail.path.slice(3),
                    ],
                  }
                : detail,
            ),
        );
        if (!page) {
          const problem =
            next.unknownDetails.find(
              (detail) => detail.section === "AFFECTED_PACKAGES",
            ) ?? next.unknownDetails[0];
          result.error = problem
            ? typedError(problem)
            : {
                code: "INCOMPLETE_PACKAGES",
                error:
                  "Package continuation failed; earlier evidence is retained.",
                retryable: false,
              };
          break;
        }
        connection.entries.push(...page.entries);
        connection.pageInfo = page.pageInfo;
        result.packagePagination.pagesRead += 1;
        result.packagePagination.complete = !page.pageInfo.hasNextPage;
      } catch (error) {
        result.error = mapVulnsError(error);
        if (stopsAdmission(result.error)) stopped = result.error;
        break;
      }
    }
  }
  return results.map(classify);
}

/** Text and curated JSON share source attribution and explicit coverage/diagnostics. */
export async function vulnsAction(
  ids: string[],
  options: VulnsOptions,
  deps: { advisoryService: AdvisoryService },
): Promise<void> {
  const results = await readAdvisoryReports(
    ids,
    options.verbose === true,
    deps.advisoryService,
  );
  if (options.json)
    console.log(JSON.stringify(buildVulnsResponse(results, options)));
  else
    process.stdout.write(
      formatVulns(results, {
        verbose: options.verbose,
        width: process.stdout.columns,
      }),
    );
  if (results.some((result) => result.status !== "success"))
    process.exitCode = 1;
}

export function registerVulnsCommand(program: Command): Command {
  return program
    .command("vulns")
    .summary("Look up CVE/OSV IDs and their known affected packages")
    .description(`Find packages linked to one or several CVE/OSV advisory IDs.
Shows package links, affected ranges, source-reported fixes and attributed
sources. Reads every available package page; partial results retain evidence
and exit nonzero. Coverage is acquisition evidence, not a safety verdict.

Examples:
  githits vulns CVE-2026-26996 GHSA-3ppc-4f35-3m26
  githits vulns CVE-2026-26996 --json
  githits vulns CVE-2026-26996 --verbose

--json includes every package, source reference, coverage and recovery field,
with up to ten normalized affected spans. affectedRanges and sourceFixVersions
are independent lists, not index-aligned; a range boundary is not necessarily a fix.
Use --verbose for full untruncated source Markdown, schema version, related/upstream
IDs, credits and original source detail, including package-less Git
ranges, vectors, aliases, dates and references. Verbose JSON uses zero-based
advisoryAffectedIndexes into advisory.originalAffected for exact same-record
copies. Source fixes are unverified;
assess an installed version with githits pkg vulns <registry>:<name>@<version>.
IDs are case-sensitive; input order and duplicates are preserved.`)
    .argument(
      "<ids...>",
      "CVE/OSV IDs or recorded aliases; order and duplicates are preserved",
    )
    .option(
      "-v, --verbose",
      "Add the full advisory report: source text, source metadata, original evidence, vectors, dates and references",
    )
    .option(
      "--json",
      "Emit compact package evidence, sources, coverage and recovery actions",
    )
    .action(async (ids: string[], options: VulnsOptions) => {
      const deps = await createContainer();
      await vulnsAction(ids, options, deps);
    });
}
