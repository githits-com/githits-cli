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
import {
  formatVulns,
  type VulnsError,
  type VulnsResult,
} from "./vulns-format.js";

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
  const batchSize = detailed ? 1 : 5;
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    if (stopped) {
      for (const input of batch)
        input.result.error = {
          ...stopped,
          details: { ...stopped.details, notAttempted: true },
        };
      continue;
    }
    let items: AdvisoryLookup[];
    try {
      items = await service.lookup(
        batch.map((input) => input.id),
        detailed,
      );
    } catch (error) {
      const mapped = mapVulnsError(error);
      for (const input of batch) input.result.error = mapped;
      if (stopsAdmission(mapped)) stopped = mapped;
      continue;
    }
    // Store every initial success before any continuation can fail or stop admission.
    const admitted = batch.map((input, i) => {
      // biome-ignore lint/style/noNonNullAssertion: the core service validates cardinality and input order.
      const lookup = structuredClone(items[i]!);
      input.result.lookup = lookup;
      input.result.packagePagination = lookup.affectedPackages
        ? {
            complete: !lookup.affectedPackages.pageInfo.hasNextPage,
            pagesRead: 1,
          }
        : undefined;
      return { ...input, lookup };
    });
    for (const input of admitted) {
      const { result, lookup } = input;
      const connection = lookup.affectedPackages;
      if (!connection || !result.packagePagination) {
        classify(result);
        continue;
      }
      while (connection.pageInfo.hasNextPage) {
        try {
          if (stopped) {
            result.error = {
              ...stopped,
              details: { ...stopped.details, notAttempted: true },
            };
            break;
          }
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
      classify(result);
    }
  }
  return results.map(classify);
}

/** JSON is the complete selected core projection; text is presentation of the same evidence. */
export async function vulnsAction(
  ids: string[],
  options: VulnsOptions,
  deps: { advisoryService: AdvisoryService },
): Promise<void> {
  const results = await readAdvisoryReports(
    ids,
    options.verbose === true || options.json === true,
    deps.advisoryService,
  );
  if (options.json) console.log(JSON.stringify({ results }));
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
    .description(`Look up one or several CVE/OSV IDs with attributed affected packages, ranges
and source-reported fixed versions. Examples:
  githits vulns CVE-2026-26996 GHSA-3ppc-4f35-3m26
  githits vulns CVE-2026-26996 --verbose

IDs are trimmed, case-preserving, at most 512 UTF-8 bytes, with no embedded
whitespace or control/format characters. Exact source IDs win; recorded aliases
may resolve to a different served ID. Source and imported local advisories stay
separate, including withdrawn records. Unknown ecosystems keep their source names.

All available package pages are read. Partial failures retain successful evidence
and exit nonzero; stale continuation never silently restarts. Coverage describes
current source/local acquisition, not worldwide completeness. Empty mappings do
not prove safety. Display truncation is explicit. Source fix strings are not
verified releases or safe upgrades. Assess an installed version with
'githits pkg vulns <registry>:<name>@<installed-version>'.

--verbose adds original source evidence (including package-less Git ranges),
prose, vectors, references, raw ranges and revision/safety details. --json emits
lossless defined core evidence with one ordered result per input and explicit
partial/error outcomes; optional release/related-advisory metadata is not acquired.`)
    .argument(
      "<ids...>",
      "CVE/OSV IDs or recorded aliases; order and duplicates are preserved",
    )
    .option(
      "-v, --verbose",
      "Show complete core source/local evidence and provenance",
    )
    .option(
      "--json",
      "Emit ordered core evidence, coverage, diagnostics and pagination state",
    )
    .action(async (ids: string[], options: VulnsOptions) => {
      const deps = await createContainer();
      await vulnsAction(ids, options, deps);
    });
}
