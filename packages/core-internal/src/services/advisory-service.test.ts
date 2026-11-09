import { describe, expect, it, mock } from "bun:test";
import {
  AdvisoryLookupError,
  AdvisoryServiceImpl,
  normalizeAdvisoryId,
} from "./advisory-service.js";
import { defaultAdvisoryLookup } from "./advisory-test-helpers.js";
import {
  AuthenticationError,
  TermsAcceptanceRequiredError,
} from "./githits-service.js";
import { createMockTokenProvider } from "./test-helpers.js";
import {
  createStaticTokenProvider,
  type TokenProvider,
} from "./token-provider.js";

function success(ids = ["CVE-example"]) {
  return {
    body: {
      data: {
        vulnerabilityLookup: ids.map((requestedId) => ({
          ...structuredClone(defaultAdvisoryLookup),
          requestedId,
        })),
      },
    },
  };
}
function failure(code: string) {
  return {
    body: {
      data: null,
      errors: [
        {
          message: "not for public display",
          extensions: { code, retryable: false },
        },
      ],
    },
  };
}
function setup(
  responses: Array<{ body?: unknown; status?: number; error?: Error }> = [
    success(),
  ],
  token: string | TokenProvider = "test-jwt",
) {
  const requests: Array<{
    query: string;
    variables: Record<string, unknown>;
    headers?: RequestInit["headers"];
  }> = [];
  const fetchFn = mock(async (_input: unknown, init?: RequestInit) => {
    requests.push({
      ...JSON.parse(String(init?.body)),
      headers: init?.headers,
    });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    if (next.error) throw next.error;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  });
  const provider = createMockTokenProvider(
    typeof token === "string"
      ? {
          getToken: mock(async () => token || undefined),
          forceRefresh: mock(async () => "test-refreshed-jwt"),
        }
      : token,
  );
  const debug = mock(() => {});
  const service = new AdvisoryServiceImpl(
    "https://example.com",
    provider,
    fetchFn as unknown as typeof fetch,
    {
      clientHeaders: () => ({ "X-Client-Test": "present" }),
      userAgent: "test-cli",
      diagnostics: {
        withOperation: async <T>(
          _name: string,
          fn: () => Promise<T>,
        ): Promise<T> => fn(),
        isEnabled: () => true,
        debug,
      },
    },
  );
  return { service, provider, requests, fetchFn, debug };
}
describe("advisory identifier grammar", () => {
  it("trims Unicode whitespace while preserving case and punctuation", () => {
    expect(normalizeAdvisoryId(" \tCase:ID/奇-1\n")).toBe("Case:ID/奇-1");
    expect(normalizeAdvisoryId("é".repeat(256))).toHaveLength(256);
  });
  it.each([
    "",
    " \t",
    "bad id",
    "bad\nID",
    "bad\u0085ID",
    "bad\u200bID",
    "\ufeffID",
    "ID\u0000",
    "a".repeat(513),
    "é".repeat(257),
    "bad\ud800",
  ])("rejects invalid IDs before credentials or IO", async (id) => {
    const { service, provider, fetchFn } = setup();
    await expect(service.lookup([id], false)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      retryable: false,
    });
    expect(provider.getToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("cohesive advisory lookup", () => {
  it.each([
    [false, undefined, 5, 10],
    [false, "opaque-next", 5, 10],
    [true, undefined, 5, 10],
    [true, "opaque-next", 5, 10],
  ] as const)(
    "uses admitted field selections and page bounds",
    async (detailed, after, first, max) => {
      const { service, requests } = setup();
      const result = await service.lookup([" CVE-example "], detailed, after);
      const expected = structuredClone(defaultAdvisoryLookup);
      if (after !== undefined) delete expected.advisory;
      expect(result).toEqual([expected]);
      expect(requests[0]?.variables).toEqual({
        ids: ["CVE-example"],
        first,
        after: after ?? null,
      });
      const query = requests[0]!.query;
      if (after === undefined) expect(query).toContain("osvId aliases");
      expect(query.match(/\baliases\b/g)).toHaveLength(
        after === undefined ? 2 : 1,
      );
      if (after !== undefined) expect(query).not.toContain("advisory {");
      expect(
        query.match(
          new RegExp(`affectedVersionDisplay\\(maxRanges: ${max}\\)`, "g"),
        ),
      ).toHaveLength(2);
      expect(query).not.toMatch(
        /fixedVersionDetails|relatedAdvisories|vulnerabilities\(/,
      );
      expect(requests[0]?.headers).toMatchObject({
        "X-Client-Test": "present",
        "User-Agent": "test-cli",
      });
      if (detailed) {
        if (after === undefined)
          expect(query).toContain(
            "osvId aliases summary details sourceUrl publishedAt modifiedAt withdrawnAt",
          );
        expect(query).toContain("contentSafety { filtered modifications }");
        expect(query).toContain("introduced fixed lastAffected limit");
        expect(query).toContain(
          "publishedAt modifiedAt withdrawnAt aliases isMalicious",
        );
      } else {
        expect(query).toContain(
          "withdrawnAt isMalicious affectedVersionRanges",
        );
        expect(query).not.toMatch(/\bmodifiedAt\b/);
        expect(query).not.toMatch(
          /\bdetails\b|\breferences\b|\bpurl\b|\bcontentSafety\b/,
        );
      }
    },
  );
  it.each([
    [[], false, undefined],
    [["a", "b"], true, undefined],
    [["a", "b"], false, undefined],
    [["a", "b"], false, "cursor"],
    [Array(6).fill("a"), false, undefined],
  ] as const)(
    "rejects inadmissible batches before auth",
    async (ids, detailed, after) => {
      const { service, provider } = setup();
      await expect(
        service.lookup([...ids], detailed, after),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(provider.getToken).not.toHaveBeenCalled();
    },
  );
  it("keeps typed partial evidence and unfamiliar producer strings losslessly", async () => {
    const response = success();
    const item = response.body.data.vulnerabilityLookup[0]!;
    item.affectedPackages!.entries[0]!.package = {
      name: "Future.Name",
      ecosystem: "Future:OS",
      registry: null,
    };
    item.unknownDetails = [
      {
        section: "FUTURE_SECTION",
        code: "FUTURE_CODE",
        message: "Neutral source diagnostic",
        retryable: false,
        candidateIds: ["source-a"],
        candidateIdsTruncated: true,
      },
    ];
    item.affectedPackages!.coverage.localStatus = "FUTURE_STATUS";
    const { service } = setup([response]);
    expect(await service.lookup(["CVE-example"], true)).toEqual([item]);
  });
  it.each([
    "AUTHENTICATION_REQUIRED",
    "UNAUTHORIZED",
    "TERMS_ACCEPTANCE_REQUIRED",
  ])("refreshes once for %s", async (code) => {
    const { service, provider, requests } = setup([failure(code), success()]);
    expect(await service.lookup(["CVE-example"], true)).toEqual([
      defaultAdvisoryLookup,
    ]);
    expect(provider.forceRefresh).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
  });
  it("retains terms and local/server auth after refresh and does not retry static tokens", async () => {
    const terms = setup([
      failure("TERMS_ACCEPTANCE_REQUIRED"),
      failure("TERMS_ACCEPTANCE_REQUIRED"),
    ]);
    await expect(terms.service.lookup(["x"], false)).rejects.toBeInstanceOf(
      TermsAcceptanceRequiredError,
    );
    expect(terms.provider.forceRefresh).toHaveBeenCalledTimes(1);
    const local = setup([], "");
    await expect(local.service.lookup(["x"], false)).rejects.toMatchObject({
      source: "local",
    });
    const server = setup([{ status: 401 }, { status: 401 }]);
    await expect(server.service.lookup(["x"], false)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    const opaque = setup(
      [failure("AUTHENTICATION_REQUIRED")],
      createStaticTokenProvider("ghi-test-fixture"),
    );
    await expect(opaque.service.lookup(["x"], false)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(opaque.requests).toHaveLength(1);
  });
  it.each([403, 429, 500, 400])(
    "classifies HTTP failures without raw bodies",
    async (status) => {
      const { service } = setup([
        { status, body: { message: "not for display" } },
      ]);
      await expect(service.lookup(["x"], false)).rejects.toMatchObject({
        code:
          status === 403
            ? "FORBIDDEN"
            : status === 429
              ? "RATE_LIMITED"
              : "UPSTREAM_ERROR",
        retryable: status === 429 || status === 500,
      });
    },
  );
  it.each([
    {},
    { data: null },
    { data: { vulnerabilityLookup: [] } },
    success(["wrong-id"]).body,
  ])("rejects malformed/empty/mismatched results", async (body) => {
    const { service } = setup([{ body }]);
    await expect(service.lookup(["CVE-example"], false)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      retryable: false,
    });
  });
  it("requires detailed fields while accepting their omission in compact mode", async () => {
    const response = success();
    delete response.body.data.vulnerabilityLookup[0]!.advisory!.details;
    const { service } = setup([response, response]);
    await service.lookup(["CVE-example"], false);
    await expect(service.lookup(["CVE-example"], true)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });
  it.each([
    new Error("network fixture"),
    new DOMException("timeout fixture", "TimeoutError"),
  ])("classifies transport failures", async (error) => {
    const { service } = setup([{ error }]);
    await expect(service.lookup(["x"], false)).rejects.toBeInstanceOf(
      AdvisoryLookupError,
    );
  });
  it("honors cancellation before requesting or refreshing", async () => {
    const { service, provider } = setup();
    await expect(
      service.lookup(["x"], false, undefined, {
        signal: AbortSignal.abort(new Error("cancel fixture")),
      }),
    ).rejects.toThrow("cancel fixture");
    expect(provider.getToken).not.toHaveBeenCalled();
  });
});

describe("operation-local partial envelope", () => {
  const localPath = [
    "vulnerabilityLookup",
    0,
    "affectedPackages",
    "entries",
    0,
    "advisories",
    0,
    "affectedVersionDisplay",
  ];
  function partial(path: Array<string | number>, nullDisplay = true) {
    const body = success().body;
    if (nullDisplay)
      body.data.vulnerabilityLookup[0]!.affectedPackages!.entries[0]!
        .advisories[0]!.affectedVersionDisplay = null;
    return {
      body: {
        ...body,
        errors: [
          {
            message: "raw upstream exception must not leak",
            path,
            extensions: { code: "FUTURE_DISPLAY_ERROR", retryable: true },
          },
        ],
      },
    };
  }
  it("retains valid data and sanitized diagnostics for a nullable local display failure", async () => {
    const { service, debug } = setup([partial(localPath)]);
    const [item] = await service.lookup(["CVE-example"], true);
    expect(item?.advisory).toEqual(defaultAdvisoryLookup.advisory);
    expect(item?.unknownDetails[0]).toMatchObject({
      section: "AFFECTED_PACKAGES",
      code: "FUTURE_DISPLAY_ERROR",
      retryable: true,
      path: localPath.slice(2),
    });
    expect(JSON.stringify(item)).not.toContain("raw upstream exception");
    expect(debug).toHaveBeenCalled();
  });
  it("retains source display failure without fabricating a local advisory", async () => {
    const response = partial([
      "vulnerabilityLookup",
      0,
      "affectedPackages",
      "entries",
      0,
      "sourceEvidence",
      "affectedVersionDisplay",
    ]);
    const group =
      response.body.data.vulnerabilityLookup[0]!.affectedPackages!.entries[0]!;
    group.sourceEvidence = {
      osvId: "OSV-example",
      sourceUrl: "https://osv.dev/vulnerability/OSV-example",
      modifiedAt: "2026-11-03T00:00:00.123456789Z",
      withdrawnAt: null,
      affected: [],
      contentSafety: { filtered: false, modifications: [] },
      affectedVersionRanges: null,
      fixedInVersions: [],
      affectedVersionDisplay: null,
    };
    const { service } = setup([response]);
    expect(
      (await service.lookup(["CVE-example"], true))[0]?.unknownDetails,
    ).toHaveLength(1);
  });
  it.each([
    ["vulnerabilityLookup", 0, "advisory"],
    [...localPath, "ranges"],
    [
      "vulnerabilityLookup",
      0,
      "affectedPackages",
      "entries",
      0,
      "advisories",
      9,
      "affectedVersionDisplay",
    ],
    [
      "vulnerabilityLookup",
      0,
      "affectedPackages",
      "entries",
      0,
      "advisories",
      0,
      "fixedVersionDetails",
    ],
    [
      "vulnerabilityLookup",
      "0",
      "affectedPackages",
      "entries",
      0,
      "sourceEvidence",
      "affectedVersionDisplay",
    ],
    ["unrelatedRoot"],
  ])("rejects unexpected or invalid error paths", async (...path) => {
    const { service } = setup([partial(path as Array<string | number>)]);
    await expect(service.lookup(["CVE-example"], false)).rejects.toMatchObject({
      code: "FUTURE_DISPLAY_ERROR",
    });
  });
  it("rejects a claimed display error without a null display", async () => {
    const { service } = setup([partial(localPath, false)]);
    await expect(service.lookup(["CVE-example"], false)).rejects.toBeInstanceOf(
      AdvisoryLookupError,
    );
  });
  it("keeps auth fatal even at a supporting path", async () => {
    const response = partial(localPath);
    response.body.errors[0]!.extensions.code = "AUTHENTICATION_REQUIRED";
    const { service, requests } = setup(
      [response],
      createStaticTokenProvider("ghi-test-fixture"),
    );
    await expect(service.lookup(["CVE-example"], false)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(requests).toHaveLength(1);
  });
});

describe("request failure provenance", () => {
  it.each(["RATE_LIMITED", "TIMEOUT", "VALIDATION_ERROR", "FUTURE_CODE"])(
    "retains %s root code/retryability without leaking producer messages",
    async (code) => {
      const response = failure(code);
      response.body.errors[0]!.extensions.retryable = true;
      const { service } = setup([response]);
      await expect(service.lookup(["x"], false)).rejects.toMatchObject({
        code,
        retryable: true,
        message: "Advisory lookup request failed.",
      });
    },
  );
});

describe("selected compact wire shape", () => {
  it("accepts missing source revision only in compact mode and preserves malicious markers", async () => {
    const fixture = structuredClone(defaultAdvisoryLookup);
    fixture.affectedPackages!.entries[0]!.sourceEvidence = {
      osvId: "OSV-example",
      sourceUrl: "https://osv.dev/vulnerability/OSV-example",
      withdrawnAt: null,
      affectedVersionRanges: ["<2"],
      fixedInVersions: ["2"],
      affectedVersionDisplay: null,
      affected: [],
      contentSafety: { filtered: false, modifications: [] },
    };
    fixture.affectedPackages!.entries[0]!.advisories[0]!.isMalicious = true;
    const { service } = setup([
      { body: { data: { vulnerabilityLookup: [fixture] } } },
      { body: { data: { vulnerabilityLookup: [fixture] } } },
    ]);
    expect(
      (await service.lookup(["CVE-example"], false))[0]!.affectedPackages!
        .entries[0]!.advisories[0]!.isMalicious,
    ).toBe(true);
    await expect(service.lookup(["CVE-example"], true)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("accepts exactly selected compact fields without requiring detailed evidence", async () => {
    const fixture = structuredClone(defaultAdvisoryLookup);
    const advisory = fixture.advisory!;
    fixture.advisory = {
      osvId: advisory.osvId,
      aliases: advisory.aliases,
      summary: advisory.summary,
      sourceUrl: advisory.sourceUrl,
      withdrawnAt: advisory.withdrawnAt,
    };
    for (const group of fixture.affectedPackages!.entries) {
      for (const local of group.advisories) {
        delete local.registry;
        delete local.packageName;
        delete local.publishedAt;
        delete local.modifiedAt;
        delete local.contentSafety;
      }
    }
    const { service } = setup([
      { body: { data: { vulnerabilityLookup: [fixture] } } },
    ]);
    expect(await service.lookup(["CVE-example"], false)).toEqual([fixture]);
  });
});

describe("display diagnostic attribution", () => {
  it("makes a compact display diagnostic relative to its result", async () => {
    const response = success(["b"]);
    response.body.data.vulnerabilityLookup[0]!.affectedPackages!.entries[0]!
      .advisories[0]!.affectedVersionDisplay = null;
    const path = [
      "vulnerabilityLookup",
      0,
      "affectedPackages",
      "entries",
      0,
      "advisories",
      0,
      "affectedVersionDisplay",
    ];
    const { service } = setup([
      {
        body: {
          ...response.body,
          errors: [
            {
              message: "private producer diagnostic",
              path,
              extensions: { code: "DISPLAY_ERROR", retryable: true },
            },
          ],
        },
      },
    ]);
    const [second] = await service.lookup(["b"], false);
    expect(second?.unknownDetails[0]?.path).toEqual([
      "affectedPackages",
      "entries",
      0,
      "advisories",
      0,
      "affectedVersionDisplay",
    ]);
  });
});

it("selects and requires typed OSV metadata only on the initial detailed advisory", async () => {
  for (const detailed of [false, true])
    for (const after of [undefined, "next"]) {
      const { service, requests } = setup();
      await service.lookup(["CVE-example"], detailed, after);
      const query = requests[0]!.query;
      expect(query.includes("schemaVersion")).toBe(
        detailed && after === undefined,
      );
      expect(query.includes("credits { name contact type }")).toBe(
        detailed && after === undefined,
      );
    }
  for (const missing of [
    "schemaVersion",
    "relatedIds",
    "upstreamIds",
    "credits",
  ]) {
    const response = success();
    delete (
      response.body.data.vulnerabilityLookup[0]!.advisory as unknown as Record<
        string,
        unknown
      >
    )[missing];
    const { service } = setup([response]);
    await expect(service.lookup(["CVE-example"], true)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  }
});
