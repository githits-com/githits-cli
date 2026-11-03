import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  type AdvisoryLookup,
  AdvisoryLookupError,
  AuthenticationError,
  TermsAcceptanceRequiredError,
} from "@githits/core-internal";
import { Command } from "commander";
import {
  createMockAdvisoryService,
  defaultAdvisoryLookup,
} from "../../packages/core-internal/src/services/advisory-test-helpers.js";
import {
  readAdvisoryReports,
  registerVulnsCommand,
  vulnsAction,
} from "./vulns.js";

function item(id = "CVE-example"): AdvisoryLookup {
  return { ...structuredClone(defaultAdvisoryLookup), requestedId: id };
}
function unknown(code: string, section = "ADVISORY") {
  return {
    section,
    code,
    message: `Neutral ${code}`,
    retryable: code === "UPSTREAM_ERROR",
    candidateIds:
      code === "AMBIGUOUS_VULNERABILITY_ID" ? ["GHSA-a", "OSV-b"] : null,
    candidateIdsTruncated: code === "AMBIGUOUS_VULNERABILITY_ID" ? true : null,
  };
}
function nextPage(
  result: AdvisoryLookup,
  cursor = "opaque-page1",
): AdvisoryLookup {
  result.affectedPackages!.pageInfo = {
    hasNextPage: true,
    endCursor: cursor,
    totalCount: 2,
  };
  return result;
}

describe("vulns command", () => {
  it("reads one ID per admitted request and preserves duplicates, whitespace and result order", async () => {
    const service = createMockAdvisoryService();
    const ids = [" a ", "b", "a", "c", "d", "e", "f"];
    const result = await readAdvisoryReports(ids, false, service);
    expect(result.map((x) => x.inputId)).toEqual(ids);
    expect(result.map((x) => x.lookup?.requestedId)).toEqual(
      ids.map((x) => x.trim()),
    );
    expect(result.every((x) => x.status === "success")).toBe(true);
    expect(service.lookup).toHaveBeenCalledTimes(ids.length);
    for (const [index, id] of ids.entries())
      expect(service.lookup).toHaveBeenNthCalledWith(
        index + 1,
        [id.trim()],
        false,
      );
  });
  it("uses one request per detailed input and validates locally without discarding good inputs", async () => {
    const service = createMockAdvisoryService();
    const result = await readAdvisoryReports(
      ["a", "bad id", "b"],
      true,
      service,
    );
    expect(result.map((x) => x.status)).toEqual([
      "success",
      "error",
      "success",
    ]);
    expect(result[1]?.error?.code).toBe("VALIDATION_ERROR");
    expect(service.lookup).toHaveBeenCalledTimes(2);
  });
  it("keeps mixed source failures and real local evidence independent", async () => {
    const found = item("good");
    const absent = item("absent");
    absent.advisory = null;
    absent.affectedPackages!.entries = [];
    absent.affectedPackages!.pageInfo.totalCount = 0;
    absent.affectedPackages!.coverage.sourceStatus = "NOT_FOUND";
    absent.unknownDetails = [unknown("NOT_FOUND")];
    const ambiguous = item("ambiguous");
    ambiguous.advisory = null;
    ambiguous.affectedPackages!.coverage.sourceStatus = "AMBIGUOUS";
    ambiguous.unknownDetails = [unknown("AMBIGUOUS_VULNERABILITY_ID")];
    const service = createMockAdvisoryService({
      lookup: mock(async (ids: string[]) => [
        { good: found, absent, ambiguous }[ids[0]!]!,
      ]),
    });
    const result = await readAdvisoryReports(
      ["good", "absent", "ambiguous"],
      false,
      service,
    );
    expect(result.map((x) => x.status)).toEqual([
      "success",
      "error",
      "partial",
    ]);
    expect(result[1]?.error?.code).toBe("NOT_FOUND");
    expect(result[2]?.error?.details).toMatchObject({
      candidateIds: ["GHSA-a", "OSV-b"],
      candidateIdsTruncated: true,
    });
    expect(result[2]?.lookup?.affectedPackages?.entries).toHaveLength(1);
  });
  it("does not misclassify source NOT_FOUND plus failed local acquisition as NOT_FOUND", async () => {
    const lookup = item();
    lookup.advisory = null;
    lookup.affectedPackages = null;
    lookup.unknownDetails = [
      unknown("NOT_FOUND"),
      unknown("UPSTREAM_ERROR", "AFFECTED_PACKAGES"),
    ];
    const result = await readAdvisoryReports(
      ["CVE-example"],
      true,
      createMockAdvisoryService({ lookup: mock(async () => [lookup]) }),
    );
    expect(result[0]).toMatchObject({
      status: "error",
      error: { code: "UPSTREAM_ERROR", retryable: true },
    });
  });
  it("a checked empty mapping succeeds; unfamiliar coverage remains explicit and partial", async () => {
    const lookup = item();
    lookup.affectedPackages!.entries = [];
    lookup.affectedPackages!.pageInfo.totalCount = 0;
    const service = createMockAdvisoryService({
      lookup: mock(async () => [lookup]),
    });
    expect(
      (await readAdvisoryReports(["CVE-example"], true, service))[0]?.status,
    ).toBe("success");
    lookup.affectedPackages!.coverage.localStatus = "FUTURE";
    expect(
      (await readAdvisoryReports(["CVE-example"], true, service))[0],
    ).toMatchObject({
      status: "partial",
      lookup: { affectedPackages: { coverage: { localStatus: "FUTURE" } } },
    });
  });
  it("drains independent cursors without merging or repeating acquisition unknowns", async () => {
    const firstA = nextPage(item("a"), "cursor-a");
    firstA.unknownDetails = [unknown("UPSTREAM_ERROR", "AFFECTED_PACKAGES")];
    firstA.affectedPackages!.coverage.localStatus = "UNAVAILABLE";
    const firstB = nextPage(item("b"), "cursor-b");
    const secondA = item("a");
    secondA.advisory = undefined;
    secondA.unknownDetails = [...firstA.unknownDetails];
    secondA.affectedPackages!.entries[0]!.package.name =
      "second-source-package";
    secondA.affectedPackages!.pageInfo.totalCount = 2;
    const secondB = item("b");
    secondB.advisory = undefined;
    secondB.affectedPackages!.pageInfo.totalCount = 2;
    const lookup = mock(
      async (ids: string[], _detailed: boolean, after?: string) =>
        after === "cursor-a"
          ? [secondA]
          : after === "cursor-b"
            ? [secondB]
            : ids[0] === "a"
              ? [firstA]
              : [firstB],
    );
    const result = await readAdvisoryReports(
      ["a", "b"],
      false,
      createMockAdvisoryService({ lookup }),
    );
    expect(lookup).toHaveBeenNthCalledWith(2, ["a"], false, "cursor-a");
    expect(lookup).toHaveBeenNthCalledWith(4, ["b"], false, "cursor-b");
    expect(result[0]?.lookup?.unknownDetails).toHaveLength(1);
    expect(
      result[0]?.lookup?.affectedPackages?.entries.map((x) => x.package.name),
    ).toEqual(["minimatch", "second-source-package"]);
    expect(result[0]?.packagePagination).toEqual({
      complete: true,
      pagesRead: 2,
    });
    expect(result[1]?.status).toBe("success");
  });
  it.each(["stale", "request"])(
    "retains earlier source/package evidence on %s continuation failure",
    async (kind) => {
      const first = nextPage(item());
      const stale = item();
      stale.advisory!.osvId = "new-revision-source";
      stale.affectedPackages = null;
      stale.unknownDetails = [unknown("VALIDATION_ERROR", "AFFECTED_PACKAGES")];
      const lookup = mock(
        async (_ids: string[], _detailed: boolean, after?: string) => {
          if (!after) return [first];
          if (kind === "request")
            throw new AdvisoryLookupError(
              "TIMEOUT",
              "Continuation timed out.",
              true,
            );
          return [stale];
        },
      );
      const result = (
        await readAdvisoryReports(
          ["CVE-example"],
          true,
          createMockAdvisoryService({ lookup }),
        )
      )[0]!;
      expect(result.status).toBe("partial");
      expect(result.lookup?.advisory?.osvId).toBe("OSV-example");
      expect(result.lookup?.affectedPackages?.entries).toHaveLength(1);
      expect(result.packagePagination).toEqual({
        complete: false,
        pagesRead: 1,
      });
      expect(result.error).toMatchObject({
        code: kind === "stale" ? "VALIDATION_ERROR" : "TIMEOUT",
        retryable: kind === "request",
      });
      expect(lookup).toHaveBeenCalledTimes(2);
    },
  );
  it("display-only errors yield partial without losing raw ranges", async () => {
    const lookup = item();
    lookup.unknownDetails = [
      {
        ...unknown("FUTURE_DISPLAY", "AFFECTED_PACKAGES"),
        path: [
          "affectedPackages",
          "entries",
          0,
          "advisories",
          0,
          "affectedVersionDisplay",
        ],
      },
    ];
    const result = (
      await readAdvisoryReports(
        ["CVE-example"],
        true,
        createMockAdvisoryService({ lookup: mock(async () => [lookup]) }),
      )
    )[0]!;
    expect(result.status).toBe("partial");
    expect(
      result.lookup?.affectedPackages?.entries[0]?.advisories[0]
        ?.affectedVersionRanges,
    ).toEqual([">=10.0.0 <10.2.1"]);
  });
  it.each([
    new AuthenticationError(),
    new TermsAcceptanceRequiredError(),
    new AdvisoryLookupError("FORBIDDEN", "Access denied."),
  ])("stops further protected requests after access failure", async (error) => {
    const lookup = mock(async () => {
      throw error;
    });
    const ids = ["a", "b", "c", "d", "e", "f", "bad id"];
    const result = await readAdvisoryReports(
      ids,
      false,
      createMockAdvisoryService({ lookup }),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result[5]?.error?.details?.notAttempted).toBe(true);
    expect(result[6]?.error?.code).toBe("VALIDATION_ERROR");
  });
  it("retains earlier input evidence and does not admit later inputs after continuation auth", async () => {
    const lookup = mock(
      async (_ids: string[], _full: boolean, after?: string) => {
        if (after) throw new AuthenticationError("Server rejected", "server");
        return [nextPage(item("a"))];
      },
    );
    const result = await readAdvisoryReports(
      ["a", "b"],
      false,
      createMockAdvisoryService({ lookup }),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result[0]?.status).toBe("partial");
    expect(result[0]?.lookup?.affectedPackages?.entries).toHaveLength(1);
    expect(result[1]?.status).toBe("error");
    expect(result[1]?.lookup).toBeUndefined();
    expect(result[1]?.error?.details?.notAttempted).toBe(true);
  });
  it("help distinguishes source evidence, coverage and installed-version assessment", () => {
    const command = registerVulnsCommand(new Command());
    expect(command.description()).toContain("githits pkg vulns");
    expect(command.description()).toContain("case-sensitive");
    expect(command.description()).toMatch(
      /including package-less Git\s+ranges/,
    );
    expect(command.options.map((x) => x.long)).toEqual(["--verbose", "--json"]);
  });
});

describe("vulns output boundary", () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode ?? 0;
  });
  it("JSON projects actionable evidence and stderr remains clean", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const stderr = spyOn(console, "error").mockImplementation(() => {});
    try {
      await vulnsAction(
        [" CVE-example "],
        { json: true },
        { advisoryService: createMockAdvisoryService() },
      );
      const payload = JSON.parse(log.mock.calls[0]![0]);
      expect(payload.results[0]).toMatchObject({
        inputId: " CVE-example ",
        status: "success",
        advisory: { id: "OSV-example" },
        packages: [
          { target: "npm:minimatch", evidence: [{ sourceIndexes: [0] }] },
        ],
        coverage: { complete: true },
      });
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      stderr.mockRestore();
    }
  });
  it("partial results exit nonzero while JSON is compact and verbose selects detail", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const lookup = item();
      lookup.unknownDetails = [unknown("UPSTREAM_ERROR")];
      const service = createMockAdvisoryService({
        lookup: mock(async () => [lookup]),
      });
      await vulnsAction(
        ["CVE-example"],
        { json: true },
        { advisoryService: service },
      );
      expect(process.exitCode).toBe(1);
      await vulnsAction(
        ["CVE-example"],
        { verbose: true },
        { advisoryService: service },
      );
      expect(service.lookup).toHaveBeenNthCalledWith(1, ["CVE-example"], false);
      expect(service.lookup).toHaveBeenNthCalledWith(2, ["CVE-example"], true);
    } finally {
      log.mockRestore();
      write.mockRestore();
    }
  });
});

describe("nullable supporting evidence", () => {
  it("null display without a GraphQL error remains a successful checked lookup", async () => {
    const lookup = item();
    lookup.affectedPackages!.entries[0]!.advisories[0]!.affectedVersionDisplay =
      null;
    const [result] = await readAdvisoryReports(
      ["CVE-example"],
      true,
      createMockAdvisoryService({ lookup: mock(async () => [lookup]) }),
    );
    expect(result?.status).toBe("success");
  });
  it("missing continuation cursor is partial rather than a reset or false completion", async () => {
    const lookup = nextPage(item());
    lookup.affectedPackages!.pageInfo.endCursor = null;
    const service = createMockAdvisoryService({
      lookup: mock(async () => [lookup]),
    });
    const [result] = await readAdvisoryReports(["CVE-example"], true, service);
    expect(result).toMatchObject({
      status: "partial",
      packagePagination: { complete: false, pagesRead: 1 },
      error: { code: "UPSTREAM_ERROR" },
    });
    expect(service.lookup).toHaveBeenCalledTimes(1);
  });
});

describe("drained diagnostic attribution", () => {
  it("offsets continuation field diagnostics into retained whole-group entries", async () => {
    const first = nextPage(item());
    const second = item();
    second.advisory = undefined;
    second.affectedPackages!.entries[0]!.package.name = "other-package";
    second.affectedPackages!.entries[0]!.advisories[0]!.affectedVersionDisplay =
      null;
    second.affectedPackages!.pageInfo.totalCount = 2;
    second.unknownDetails = [
      {
        ...unknown("DISPLAY_ERROR", "AFFECTED_PACKAGES"),
        path: [
          "affectedPackages",
          "entries",
          0,
          "advisories",
          0,
          "affectedVersionDisplay",
        ],
      },
    ];
    const service = createMockAdvisoryService({
      lookup: mock(
        async (_ids: string[], _detailed: boolean, after?: string) =>
          after ? [second] : [first],
      ),
    });
    const [result] = await readAdvisoryReports(["CVE-example"], true, service);
    expect(result?.lookup?.unknownDetails[0]?.path).toEqual([
      "affectedPackages",
      "entries",
      1,
      "advisories",
      0,
      "affectedVersionDisplay",
    ]);
    expect(result?.lookup?.affectedPackages?.entries[1]?.package.name).toBe(
      "other-package",
    );
    expect(result?.status).toBe("partial");
    expect(result?.packagePagination?.complete).toBe(true);
  });
});
