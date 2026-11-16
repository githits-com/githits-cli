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
      "Deprecated",
      "No longer supported",
      "Collected: 2026-11-10 10:00 UTC",
      "Source: registry metadata (selected release)",
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
    expected: [],
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
    expected: ["Yanked"],
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
    expected: ["Yanked"],
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
      "Deprecated (package-wide)",
      "Source: go.mod (selected release)",
      'Publisher reason: Use the "google.golang.org/protobuf" module instead.',
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
    expected: ["Publisher warning (unclassified): Retained old warning"],
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
      "Partially yanked (files)",
      "publisher-code",
      "Publisher text was filtered by the backend",
    ],
  },
];

const compactCases = [
  { findings: [{ kind: "DEPRECATED", reason: "No longer supported" }] },
  undefined,
  { findings: [{ kind: "YANKED" }] },
  { findings: [{ kind: "YANKED" }] },
  {
    findings: [
      {
        kind: "DEPRECATED",
        scope: "PACKAGE",
        reason: 'Use the "google.golang.org/protobuf" module instead.',
      },
    ],
  },
  {
    retainedWarnings: [
      { classification: "LEGACY_UNCLASSIFIED", reason: "Retained old warning" },
    ],
  },
  {
    findings: [{ kind: "PARTIALLY_YANKED", scope: "FILES" }],
    contentSafety: { filtered: true },
  },
];
const compactTextCases = [
  "Deprecated: No longer supported",
  "",
  "Yanked.",
  "Yanked.",
  'Deprecated (package-wide): Use the "google.golang.org/protobuf" module instead.',
  "Publisher warning (unclassified): Retained old warning",
  "Partially yanked (files).",
];

const verboseCases = [
  {
    findings: [
      {
        kind: "DEPRECATED",
        reason: "No longer supported",
        source: "registry metadata",
        sourceVersion: "2.88.2",
        observedAt: "2026-11-10T10:00:00Z",
      },
    ],
  },
  undefined,
  { findings: [{ kind: "YANKED", source: "registry metadata" }] },
  { findings: [{ kind: "YANKED", source: "registry metadata" }] },
  {
    findings: [
      {
        kind: "DEPRECATED",
        scope: "PACKAGE",
        reason: 'Use the "google.golang.org/protobuf" module instead.',
        source: "go.mod",
        sourceVersion: "v1.5.4",
      },
    ],
  },
  {
    retainedWarnings: [
      { classification: "LEGACY_UNCLASSIFIED", reason: "Retained old warning" },
    ],
  },
  {
    findings: [
      {
        kind: "PARTIALLY_YANKED",
        scope: "FILES",
        source: "registry metadata",
        reasonCodes: ["publisher-code"],
      },
    ],
    contentSafety: { filtered: true },
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
  verbose = false,
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
      { json, verbose },
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
    "findings { kind scope source sourceVersion observedAt reason reasonCodes replacement }",
    "retainedWarnings { classification reason }",
    "contentSafety { filtered }",
  ])
    expect(query.replace(/\s+/g, " ")).toContain(selection);
  expect(query).not.toContain("deprecated");
  expect(query).not.toMatch(/\bchecks\s*\{/);
  expect(query).not.toContain("registryArchival");
  expect(query).not.toContain("repositoryArchival");
  const lifecycleSelection = query
    .split("lifecycle {")[1]!
    .split("registryRepository")[0]!;
  expect(lifecycleSelection).not.toMatch(
    /\b(registry|name|version|category)\b/,
  );
  expect(query).not.toMatch(/lifecycle\s*@include/);
  expect(query).toContain(
    "latestChangelogs(limit: 3) @include(if: $includeVerboseFields)",
  );
}

describe("native lifecycle inspection causal path", () => {
  for (const [index, testCase] of cases.entries()) {
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
      expect(cliJson.lifecycle).toEqual(compactCases[index]);
      if (compactCases[index] === undefined)
        expect(cliJson).not.toHaveProperty("lifecycle");
      expect(cliJson.vulnerabilities.total).toBe(0);
      expect(cliJson.advisoryHistory.total).toBe(2);
      const cliText = await cliOutput(service, testCase.target, false);
      const mcpText = await tool.handler({ target: testCase.target });
      expect(mcpText.isError).toBeUndefined();
      expect(mcpText.content[0]!.text).toBe(cliText);
      const prose = cliText.replace(/\s+/g, " ");
      expect(prose).toContain(compactTextCases[index]!);
      for (const detail of [
        "Lifecycle",
        "Source:",
        "Acquired:",
        "NOT_COLLECTED",
        "CHECKED",
        "LEGACY_DUPLICATE_DO_NOT_RENDER",
        "scope RELEASE",
      ])
        expect(prose).not.toContain(detail);
      if (index === 1) expect(prose).not.toContain("No native findings");
      if (index === 4)
        expect(prose.match(/google.golang.org\/protobuf/g)).toHaveLength(1);
      if (index === 6) expect(prose).toContain("Publisher text filtered.");
      expect(prose).not.toContain("undefined");
      expect(prose).not.toContain("null");
      if (testCase.title.startsWith("crates"))
        expect(prose.match(/Yanked/g)).toHaveLength(1);
      if (testCase.registry === "NUGET")
        expect(prose.match(/Retained old warning/g)).toHaveLength(1);
      const verboseJson = JSON.parse(
        await cliOutput(service, testCase.target, true, true),
      );
      const verboseMcpJson = await tool.handler({
        target: testCase.target,
        format: "json",
        verbose: true,
      });
      expect(JSON.parse(verboseMcpJson.content[0]!.text!)).toEqual(verboseJson);
      expect(verboseJson.lifecycle).toEqual(verboseCases[index]);
      if (verboseJson.lifecycle)
        expect(verboseJson.lifecycle).not.toHaveProperty("checks");
      const verboseText = await cliOutput(
        service,
        testCase.target,
        false,
        true,
      );
      const verboseMcpText = await tool.handler({
        target: testCase.target,
        verbose: true,
      });
      expect(verboseMcpText.content[0]!.text).toBe(verboseText);
      for (const expected of testCase.expected)
        expect(verboseText.replace(/\s+/g, " ")).toContain(expected);
      expect(requests).toHaveLength(8);
      expect(requests.map((r) => r.variables.includeVerboseFields)).toEqual([
        true,
        true,
        false,
        false,
        true,
        true,
        true,
        true,
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
      verbose: true,
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
      expect(text.content[0]!.text).not.toContain("Lifecycle");
      const verbose = await createPackageSummaryTool(service).handler({
        target: "npm:request",
        verbose: true,
      });
      expect(verbose.content[0]!.text).not.toContain("Lifecycle");
      expect(text.content[0]!.text).not.toContain("CHECKED");
    },
  );

  it("groups multiple findings and wraps their details with hanging indentation", async () => {
    const first = {
      ...finding(
        "GO",
        "example.test/module",
        null,
        "DEPRECATED",
        "DEPRECATION",
        "PACKAGE",
      ),
      reason:
        "A long publisher reason that wraps across several lines for layout verification",
    };
    const second = finding(
      "GO",
      "example.test/module",
      "v1.2.0",
      "RETRACTED",
      "WITHDRAWAL",
    );
    const { service } = serviceFor(
      bodyFor({
        ...cases[0]!,
        lifecycle: assessment([first, second], "CHECKED", "CHECKED"),
      }),
    );
    const summary = await service.packageSummary({
      registry: "NPM",
      packageName: "request",
    });
    const text = formatPackageSummaryTerminal(summary, {
      terminalWidth: 38,
      verbose: true,
    });
    const lines = text.slice(text.indexOf("Lifecycle")).trimEnd().split("\n");
    expect(lines.some((line) => line.startsWith("Deprecated"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Retracted"))).toBe(true);
    expect(lines.some((line) => line.startsWith("  Source:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("  Publisher reason:"))).toBe(
      true,
    );
    expect(lines.some((line) => line.startsWith("    "))).toBe(true);
    expect(lines.every((line) => line.length <= 38)).toBe(true);
    expect(text).not.toContain("Checks");
  });

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
      verbose: true,
    });
    const lifecycle = JSON.parse(result.content[0]!.text!).lifecycle;
    expect(lifecycle.findings[0]).not.toHaveProperty("version");
    const text = await createPackageSummaryTool(service).handler({
      target: cases[4]!.target,
    });
    expect(text.content[0]!.text).not.toContain("protobuf@v1.5.4");
    expect(text.content[0]!.text).toContain("package-wide");
  });

  it("retains future categorical values without interpreting them", async () => {
    const lifecycle = assessment([
      finding(
        "FUTURE_REGISTRY",
        "pkg",
        null,
        "FUTURE_KIND",
        "FUTURE_CATEGORY",
        "FUTURE_SCOPE",
      ),
    ]);
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
      verbose: true,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text!).lifecycle).toEqual({
      findings: [
        {
          kind: "FUTURE_KIND",
          scope: "FUTURE_SCOPE",
          source: "registry metadata",
        },
      ],
      retainedWarnings: [
        {
          classification: "FUTURE_CLASSIFICATION",
          reason: "Publisher warning",
        },
      ],
    });
    const text = await tool.handler({ target: "npm:request", verbose: true });
    for (const value of [
      "FUTURE_KIND",
      "FUTURE_SCOPE",
      "FUTURE_CLASSIFICATION",
    ])
      expect(text.content[0]!.text).toContain(value);
    expect(text.content[0]!.text).not.toContain("safe");
  });

  it("keeps the GitHub archive badge without lifecycle diagnostics", async () => {
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
    expect(text).not.toContain("Lifecycle");
    const verbose = await createPackageSummaryTool(service).handler({
      target: "npm:express",
      verbose: true,
    });
    expect(verbose.content[0]!.text).toContain("[ARCHIVED]");
    expect(verbose.content[0]!.text).not.toContain("Lifecycle");
    expect(verbose.content[0]!.text).not.toContain("not collected");
  });

  it("bounds long publisher reasons in compact JSON and text, with full evidence opt-in", async () => {
    const replacement = "new-package";
    const reason = `${"Publisher explanation ".repeat(40)}Use ${replacement}`;
    const { service } = serviceFor(
      bodyFor({
        ...cases[0]!,
        lifecycle: assessment([
          {
            ...finding("NPM", "request", "2.88.2", "DEPRECATED", "DEPRECATION"),
            reason,
            replacement,
          },
        ]),
      }),
    );
    const tool = createPackageSummaryTool(service);
    const result = await tool.handler({
      target: "npm:request",
      format: "json",
    });
    const compact = JSON.parse(result.content[0]!.text!).lifecycle;
    expect(compact.findings[0].reason.length).toBeLessThanOrEqual(160);
    expect(compact.findings[0].reasonTruncated).toBe(true);
    expect(compact.findings[0].replacement).toBe(replacement);
    const text = await tool.handler({ target: "npm:request" });
    expect(text.content[0]!.text!.replace(/\s+/g, " ")).toContain(
      "publisher suggests new-package",
    );
    expect(text.content[0]!.text).toContain("verbose output");
    const full = await tool.handler({
      target: "npm:request",
      format: "json",
      verbose: true,
    });
    expect(
      JSON.parse(full.content[0]!.text!).lifecycle.findings[0].reason,
    ).toBe(reason);
  });

  it.each([
    ["Too risky", "ky", true],
    ["Use ky instead", "ky", false],
    ["Please use ky.", "ky", false],
    ["Please use ky. More context.", "ky", false],
    ["Please use ky.extra", "ky", true],
    ['Use "@scope/pkg" instead', "@scope/pkg", false],
    ["Use different-package instead", "package", true],
    ["Use old.package instead", "new.package", true],
  ])(
    "keeps publisher replacement %s / %s distinct from unrelated prose",
    async (reason, replacement, retained) => {
      const { service } = serviceFor(
        bodyFor({
          ...cases[0]!,
          lifecycle: assessment([
            {
              ...finding(
                "NPM",
                "request",
                "2.88.2",
                "DEPRECATED",
                "DEPRECATION",
              ),
              reason,
              replacement,
            },
          ]),
        }),
      );
      const tool = createPackageSummaryTool(service);
      const json = await tool.handler({
        target: "npm:request",
        format: "json",
      });
      const item = JSON.parse(json.content[0]!.text!).lifecycle.findings[0];
      expect(item.replacement).toBe(retained ? replacement : undefined);
      const text = await tool.handler({ target: "npm:request" });
      const prose = text.content[0]!.text!.replace(/\s+/g, " ");
      if (retained)
        expect(prose).toContain(`publisher suggests ${replacement}`);
      else expect(prose).not.toContain("publisher suggests");
    },
  );

  it("preserves Unicode code points when compacting finding and retained-warning reasons", async () => {
    const reason = "😀".repeat(170);
    const lifecycle = assessment([
      {
        ...finding("NPM", "request", "2.88.2", "DEPRECATED", "DEPRECATION"),
        reason,
      },
    ]);
    lifecycle.retainedWarnings = [
      {
        registry: "NPM",
        name: "request",
        version: "2.88.2",
        classification: "LEGACY_UNCLASSIFIED",
        reason,
      },
    ];
    const { service } = serviceFor(bodyFor({ ...cases[0]!, lifecycle }));
    const tool = createPackageSummaryTool(service);
    const result = await tool.handler({
      target: "npm:request",
      format: "json",
    });
    const json = JSON.parse(result.content[0]!.text!).lifecycle;
    for (const item of [json.findings[0], json.retainedWarnings[0]]) {
      expect(item.reason).toBe(`${"😀".repeat(157)}...`);
      expect(item.reasonTruncated).toBe(true);
    }
    const text = await tool.handler({ target: "npm:request" });
    expect(text.content[0]!.text).not.toMatch(
      /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
    const summary = await service.packageSummary({
      registry: "NPM",
      packageName: "request",
    });
    const narrow = formatPackageSummaryTerminal(summary, { terminalWidth: 39 });
    expect(narrow).not.toMatch(
      /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });

  it("uses terminal-safe rendering for publisher text while verbose JSON preserves evidence", async () => {
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    const reason = `Publisher ${esc}]8;;https://example.invalid/${bel}link${esc}]8;;${bel} ${esc}[2Jmessage`;
    const lifecycle = assessment([
      {
        ...finding("NPM", "request", "2.88.2", "DEPRECATED", "DEPRECATION"),
        reason,
        source: `registry${esc}[2J`,
        replacement: `new-package${esc}[2J`,
      },
    ]);
    lifecycle.retainedWarnings = [
      {
        registry: "NPM",
        name: "request",
        version: "2.88.2",
        classification: "LEGACY_UNCLASSIFIED",
        reason,
      },
    ];
    const { service } = serviceFor(bodyFor({ ...cases[0]!, lifecycle }));
    const tool = createPackageSummaryTool(service);
    for (const verbose of [false, true]) {
      const result = await tool.handler({ target: "npm:request", verbose });
      const text = result.content[0]!.text!;
      expect(text).not.toContain(esc);
      expect(text).not.toContain(bel);
      expect(text).not.toContain("https://example.invalid/");
      expect(text).toContain("Publisher link message");
    }
    const json = await tool.handler({
      target: "npm:request",
      format: "json",
      verbose: true,
    });
    expect(JSON.parse(json.content[0]!.text!).lifecycle).toEqual({
      findings: [
        {
          kind: "DEPRECATED",
          reason,
          source: `registry${esc}[2J`,
          replacement: `new-package${esc}[2J`,
        },
      ],
      retainedWarnings: [{ classification: "LEGACY_UNCLASSIFIED", reason }],
    });
  });

  it("explains an authority version different from the selected release without changing scope", async () => {
    const { service } = serviceFor(
      bodyFor({
        ...cases[4]!,
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
            sourceVersion: "v1.6.0",
          },
        ]),
      }),
    );
    const result = await createPackageSummaryTool(service).handler({
      target: cases[4]!.target,
      verbose: true,
    });
    const text = result.content[0]!.text!.replace(/\s+/g, " ");
    expect(text).toContain("Source: go.mod (version v1.6.0)");
    expect(text).toContain("Deprecated (package-wide)");
    expect(text).not.toContain("scope PACKAGE");
  });

  it("rejects structurally malformed lifecycle evidence instead of claiming health", async () => {
    const bad = assessment();
    bad.findings = [{ kind: 42 }];
    const { service } = serviceFor(bodyFor({ ...cases[0]!, lifecycle: bad }));
    await expect(
      service.packageSummary({ registry: "NPM", packageName: "request" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });
});
