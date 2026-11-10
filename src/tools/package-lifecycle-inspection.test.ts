import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceServiceImpl,
} from "@githits/core-internal";
import { formatPackageSummaryTerminal } from "../../packages/mcp/src/shared/package-summary-response.js";
import { createPackageSummaryTool } from "../../packages/mcp/src/tools/package-summary.js";
import { pkgInfoAction } from "../commands/pkg/info.js";
import { createMockTokenProvider } from "../services/test-helpers.js";

// Minimal authored wire evidence, not a captured registry inventory. Every case
// exercises HTTP decoding plus the real CLI/MCP output path without paid calls.
function assessment(
  findings: Array<Record<string, unknown>> = [],
  deprecation = "CHECKED",
  withdrawal = "NOT_COLLECTED",
): Record<string, unknown> {
  const check = (status: string): Record<string, unknown> => ({
    status,
    reason: status === "UNKNOWN" ? "NATIVE_EVIDENCE_UNAVAILABLE" : null,
  });
  return {
    findings,
    checks: {
      deprecation: check(deprecation),
      withdrawal: check(withdrawal),
      registryArchival: check("NOT_COLLECTED"),
      repositoryArchival: check("NOT_COLLECTED"),
    },
    retainedWarnings: [],
    contentSafety: { filtered: false },
  };
}

function finding(
  registry: string,
  name: string,
  version: string | null,
  kind: string,
  category: string,
  scope = "RELEASE",
): Record<string, unknown> {
  return {
    registry,
    name,
    version,
    kind,
    category,
    scope,
    source: "registry metadata",
    reasonCodes: [],
  };
}

const nuget = assessment([], "UNKNOWN", "UNKNOWN");
nuget.retainedWarnings = [
  {
    registry: "NUGET",
    name: "Legacy.Package",
    version: "1.0.0",
    classification: "LEGACY_UNCLASSIFIED",
    reason: "Retained old warning",
  },
];

const cases = [
  {
    title: "npm native deprecation",
    target: "npm:request",
    registry: "NPM",
    name: "request",
    version: "2.88.2",
    legacy: true,
    lifecycle: assessment([
      {
        ...finding("NPM", "request", "2.88.2", "DEPRECATED", "DEPRECATION"),
        reason: "No longer supported",
        observedAt: "2026-11-10T10:00:00Z",
        sourceVersion: "2.88.2",
      },
    ]),
    expected: [
      "DEPRECATED",
      "DEPRECATION",
      "scope RELEASE",
      "No longer supported",
      "2026-11-10T10:00:00Z",
    ],
  },
  {
    title: "npm checked negative",
    target: "npm:express",
    registry: "NPM",
    name: "express",
    version: "4.21.2",
    legacy: false,
    lifecycle: assessment(),
    expected: ["No native findings reported", "CHECKED: deprecation"],
  },
  {
    title: "PyPI yank and inapplicable deprecation",
    target: "pypi:urllib3",
    registry: "PYPI",
    name: "urllib3",
    version: "2.0.0",
    legacy: false,
    lifecycle: assessment(
      [finding("PYPI", "urllib3", "2.0.0", "YANKED", "WITHDRAWAL")],
      "NOT_APPLICABLE",
      "CHECKED",
    ),
    expected: [
      "YANKED",
      "WITHDRAWAL",
      "scope RELEASE",
      "NOT_APPLICABLE: deprecation",
      "CHECKED: withdrawal",
    ],
  },
  {
    title: "crates yank without coarse duplicate",
    target: "crates:crossbeam-channel",
    registry: "CRATES",
    name: "crossbeam-channel",
    version: "0.5.12",
    legacy: true,
    lifecycle: assessment(
      [
        finding(
          "CRATES",
          "crossbeam-channel",
          "0.5.12",
          "YANKED",
          "WITHDRAWAL",
        ),
      ],
      "NOT_COLLECTED",
      "CHECKED",
    ),
    expected: ["YANKED", "NOT_COLLECTED: deprecation"],
  },
  {
    title: "Go package scope despite legacy false",
    target: "go:github.com/golang/protobuf",
    registry: "GO",
    name: "github.com/golang/protobuf",
    version: "v1.5.4",
    legacy: false,
    lifecycle: assessment([
      {
        ...finding(
          "GO",
          "github.com/golang/protobuf",
          null,
          "DEPRECATED",
          "DEPRECATION",
          "PACKAGE",
        ),
        source: "go.mod",
        sourceVersion: "v1.5.4",
        reason: 'Use the "google.golang.org/protobuf" module instead.',
        replacement: "google.golang.org/protobuf",
      },
    ]),
    expected: [
      "DEPRECATED",
      "scope PACKAGE",
      "go.mod",
      "source version v1.5.4",
      "Publisher replacement advice",
      "not an upgrade recommendation",
    ],
  },
  {
    title: "NuGet retained warning and unknown checks",
    target: "nuget:Legacy.Package",
    registry: "NUGET",
    name: "Legacy.Package",
    version: "1.0.0",
    legacy: true,
    lifecycle: nuget,
    expected: [
      "LEGACY_UNCLASSIFIED",
      "Retained old warning",
      "UNKNOWN (NATIVE_EVIDENCE_UNAVAILABLE)",
    ],
  },
  {
    title: "file withdrawal, missing optional details and filtered content",
    target: "pypi:partial",
    registry: "PYPI",
    name: "partial",
    version: "1.0",
    legacy: false,
    lifecycle: {
      ...assessment(
        [
          {
            ...finding(
              "PYPI",
              "partial",
              "1.0",
              "PARTIALLY_YANKED",
              "WITHDRAWAL",
              "FILES",
            ),
            sourceVersion: null,
            observedAt: null,
            reason: null,
            replacement: null,
            reasonCodes: ["publisher-code"],
          },
        ],
        "NOT_APPLICABLE",
        "UNKNOWN",
      ),
      contentSafety: { filtered: true },
    },
    expected: [
      "PARTIALLY_YANKED",
      "scope FILES",
      "publisher-code",
      "Content safety: filtered",
    ],
  },
];

function bodyFor(testCase: (typeof cases)[number]): Record<string, unknown> {
  return {
    data: {
      packageSummary: {
        package: {
          name: testCase.name,
          registry: testCase.registry,
          version: testCase.version,
          deprecated: testCase.legacy,
          deprecationReason: "LEGACY_DUPLICATE_DO_NOT_RENDER",
        },
        security: {
          vulnerabilityCount: 0,
          allVulnerabilityCount: 2,
          hasCurrentVulnerabilities: false,
        },
      },
      provenance: {
        selectedVersion: {
          resolvedVersion: testCase.version,
          registryRepository: {
            id: "public",
            name: "Public registry",
            url: "https://registry.example",
          },
          lifecycle: testCase.lifecycle,
        },
      },
    },
  };
}

function serviceFor(body: unknown): {
  service: PackageIntelligenceServiceImpl;
  requests: Array<{ query: string; variables: Record<string, unknown> }>;
} {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> =
    [];
  const fetchFn = mock(
    async (_url: unknown, init?: RequestInit): Promise<Response> => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json(body);
    },
  );
  return {
    service: new PackageIntelligenceServiceImpl(
      "https://pkgseer.test",
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    ),
    requests,
  };
}

async function cliOutput(
  service: PackageIntelligenceServiceImpl,
  target: string,
  json: boolean,
): Promise<string> {
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((value: string) => {
    output.push(value);
  });
  const write = spyOn(process.stdout, "write").mockImplementation(((
    value: string | Uint8Array,
  ) => {
    output.push(String(value));
    return true;
  }) as typeof process.stdout.write);
  try {
    await pkgInfoAction(
      target,
      { json },
      {
        packageIntelligenceService: service,
        hasValidToken: true,
        codeNavigationUrl: "https://pkgseer.test",
        mcpUrl: "https://mcp.test",
      },
    );
    return output.join("").trimEnd();
  } finally {
    log.mockRestore();
    write.mockRestore();
  }
}

function assertSelection(query: string): void {
  expect(query).toContain(
    "provenance: packageInfo(registry: $registry, name: $name)",
  );
  expect(query).toMatch(/selectedVersion\s*\{[\s\S]*lifecycle\s*\{/);
  for (const selection of [
    "findings { registry name version category kind scope source sourceVersion observedAt reason reasonCodes replacement }",
    "deprecation { status reason }",
    "withdrawal { status reason }",
    "registryArchival { status reason }",
    "repositoryArchival { status reason }",
    "retainedWarnings { registry name version classification reason }",
    "contentSafety { filtered }",
  ])
    expect(query.replace(/\s+/g, " ")).toContain(selection);
  expect(query).not.toContain("deprecated");
  expect(query).not.toMatch(/lifecycle\s*@include/);
  expect(query).toContain(
    "latestChangelogs(limit: 3) @include(if: $includeVerboseFields)",
  );
}

describe("native lifecycle inspection causal path", () => {
  for (const testCase of cases) {
    it(`${testCase.title} survives GraphQL to CLI and MCP text/JSON`, async () => {
      const { service, requests } = serviceFor(bodyFor(testCase));
      const tool = createPackageSummaryTool(service);
      const cliJson = JSON.parse(
        await cliOutput(service, testCase.target, true),
      );
      const mcpJson = await tool.handler({
        target: testCase.target,
        format: "json",
      });
      expect(mcpJson.isError).toBeUndefined();
      expect(JSON.parse(mcpJson.content[0]!.text!)).toEqual(cliJson);
      expect(cliJson.lifecycle).toEqual(testCase.lifecycle);
      expect(cliJson.vulnerabilities.total).toBe(0);
      expect(cliJson.advisoryHistory.total).toBe(2);
      const cliText = await cliOutput(service, testCase.target, false);
      const mcpText = await tool.handler({ target: testCase.target });
      expect(mcpText.isError).toBeUndefined();
      expect(mcpText.content[0]!.text).toBe(cliText);
      const prose = cliText.replace(/\s+/g, " ");
      for (const expected of testCase.expected)
        expect(prose).toContain(expected);
      expect(prose).toContain("Lifecycle checks:");
      expect(prose).toContain("registry archival, repository archival");
      expect(prose).toContain("NOT_COLLECTED:");
      expect(prose).not.toContain("LEGACY_DUPLICATE_DO_NOT_RENDER");
      expect(prose).not.toContain("undefined");
      expect(prose).not.toContain("null");
      if (testCase.title.startsWith("crates"))
        expect(prose.match(/YANKED/g)).toHaveLength(1);
      if (testCase.registry === "NUGET")
        expect(prose.match(/Retained old warning/g)).toHaveLength(1);
      expect(requests).toHaveLength(4);
      expect(requests.map((r) => r.variables.includeVerboseFields)).toEqual([
        true,
        true,
        false,
        false,
      ]);
      for (const request of requests) assertSelection(request.query);
    });
  }

  it("verbose text still selects lifecycle and preserves optional authority data", async () => {
    const { service, requests } = serviceFor(bodyFor(cases[0]!));
    await createPackageSummaryTool(service).handler({
      target: "npm:request",
      verbose: true,
    });
    expect(requests[0]!.variables.includeVerboseFields).toBe(true);
    assertSelection(requests[0]!.query);
  });

  it("wraps lifecycle prose and retains backend Unicode", async () => {
    const testCase = cases[0]!;
    const body = bodyFor({
      ...testCase,
      lifecycle: assessment([
        {
          ...finding("NPM", "request", "2.88.2", "DEPRECATED", "DEPRECATION"),
          reason: "Publisher says: Übermäßig lange Begründung ".repeat(5),
        },
      ]),
    });
    const { service } = serviceFor(body);
    const summary = await service.packageSummary({
      registry: "NPM",
      packageName: "request",
    });
    const output = formatPackageSummaryTerminal(summary, {
      terminalWidth: 38,
      useColors: false,
    });
    const lifecycle = output.slice(output.indexOf("Lifecycle"));
    expect(lifecycle).toContain("Übermäßig");
    expect(lifecycle.split("\n").every((line) => line.length <= 38)).toBe(true);
  });

  it.each(["missing", "mismatch", "resolver error", "no selection"])(
    "%s evidence never becomes a checked negative",
    async (mode) => {
      const body = bodyFor(cases[0]!) as {
        data: {
          provenance?: unknown;
          packageSummary: { package: { version?: string } };
        };
        errors?: unknown[];
      };
      if (mode === "missing") delete body.data.provenance;
      if (mode === "mismatch")
        body.data.provenance = {
          selectedVersion: {
            resolvedVersion: "other",
            lifecycle: cases[0]!.lifecycle,
          },
        };
      if (mode === "resolver error") {
        body.data.provenance = null;
        body.errors = [
          {
            message: "Lifecycle unavailable",
            path: ["provenance", "selectedVersion", "lifecycle"],
            extensions: { code: "UPSTREAM_ERROR" },
          },
        ];
      }
      if (mode === "no selection")
        delete body.data.packageSummary.package.version;
      const { service } = serviceFor(body);
      const result = await createPackageSummaryTool(service).handler({
        target: "npm:request",
        format: "json",
      });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]!.text!)).not.toHaveProperty(
        "lifecycle",
      );
      expect(JSON.parse(result.content[0]!.text!)).not.toHaveProperty(
        "registryRepository",
      );
      const text = await createPackageSummaryTool(service).handler({
        target: "npm:request",
      });
      expect(text.content[0]!.text).toContain("Lifecycle unavailable");
      expect(text.content[0]!.text).not.toContain("CHECKED");
    },
  );

  it("preserves access failure from the optional lifecycle root", async () => {
    const body = bodyFor(cases[0]!);
    (body.data as Record<string, unknown>).provenance = null;
    body.errors = [
      {
        message: "Forbidden",
        path: ["provenance", "selectedVersion", "lifecycle"],
        extensions: { code: "FORBIDDEN" },
      },
    ];
    const { service } = serviceFor(body);
    const result = await createPackageSummaryTool(service).handler({
      target: "npm:request",
      format: "json",
    });
    expect(result.isError).toBe(true);
  });

  it("preserves an omitted affected version without inventing the selected version", async () => {
    const item = finding(
      "GO",
      "github.com/golang/protobuf",
      null,
      "DEPRECATED",
      "DEPRECATION",
      "PACKAGE",
    );
    delete item.version;
    const { service } = serviceFor(
      bodyFor({ ...cases[4]!, lifecycle: assessment([item]) }),
    );
    const result = await createPackageSummaryTool(service).handler({
      target: cases[4]!.target,
      format: "json",
    });
    const lifecycle = JSON.parse(result.content[0]!.text!).lifecycle;
    expect(lifecycle.findings[0]).not.toHaveProperty("version");
    const text = await createPackageSummaryTool(service).handler({
      target: cases[4]!.target,
    });
    expect(text.content[0]!.text).not.toContain("protobuf@v1.5.4");
    expect(text.content[0]!.text).toContain("scope PACKAGE");
  });

  it("retains future categorical values without interpreting them", async () => {
    const lifecycle = assessment(
      [
        finding(
          "FUTURE_REGISTRY",
          "pkg",
          null,
          "FUTURE_KIND",
          "FUTURE_CATEGORY",
          "FUTURE_SCOPE",
        ),
      ],
      "FUTURE_STATUS",
    );
    (lifecycle.checks as Record<string, unknown>).withdrawal = {
      status: "UNKNOWN",
      reason: "FUTURE_REASON",
    };
    lifecycle.retainedWarnings = [
      {
        registry: "FUTURE_REGISTRY",
        name: "pkg",
        version: "1",
        classification: "FUTURE_CLASSIFICATION",
        reason: "Publisher warning",
      },
    ];
    const { service } = serviceFor(bodyFor({ ...cases[0]!, lifecycle }));
    const tool = createPackageSummaryTool(service);
    const result = await tool.handler({
      target: "npm:request",
      format: "json",
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text!).lifecycle).toEqual(lifecycle);
    const text = await tool.handler({ target: "npm:request" });
    for (const value of [
      "FUTURE_REGISTRY",
      "FUTURE_KIND",
      "FUTURE_SCOPE",
      "FUTURE_STATUS",
      "FUTURE_REASON",
      "FUTURE_CLASSIFICATION",
    ])
      expect(text.content[0]!.text).toContain(value);
    expect(text.content[0]!.text).not.toContain("safe");
  });

  it("keeps GitHub archival separate from lifecycle collection", async () => {
    const body = bodyFor(cases[1]!);
    const data = body.data as {
      packageSummary: { package: Record<string, unknown> };
    };
    data.packageSummary.package.githubRepository = { archived: true };
    const { service } = serviceFor(body);
    const result = await createPackageSummaryTool(service).handler({
      target: "npm:express",
    });
    const text = result.content[0]!.text!.replace(/\s+/g, " ");
    expect(text).toContain("[ARCHIVED]");
    expect(text).toContain("Lifecycle checks:");
    expect(text).toContain(
      "NOT_COLLECTED: withdrawal, registry archival, repository archival",
    );
  });

  it("rejects structurally malformed lifecycle evidence instead of claiming health", async () => {
    const bad = assessment();
    (bad.checks as Record<string, unknown>).withdrawal = { status: 42 };
    const { service } = serviceFor(bodyFor({ ...cases[0]!, lifecycle: bad }));
    await expect(
      service.packageSummary({ registry: "NPM", packageName: "request" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });
});
