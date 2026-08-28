import { describe, expect, it, mock } from "bun:test";
import type {
  ResolveTargetCandidate,
  ResolveTargetResult,
  ResolveTargetService,
} from "@githits/core-internal";
import {
  AuthenticationError,
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceNetworkError,
} from "@githits/core-internal";
import { z } from "zod";
import { buildResolveTargetSuccessPayload } from "../shared/resolve-target-response.js";
import {
  createResolveTargetTool,
  DESCRIPTION,
  formatResolveTargetMcpText,
  type ResolveTargetMcpArgs,
} from "./resolve-target.js";

function invoke(
  tool: ReturnType<typeof createResolveTargetTool>,
  args: ResolveTargetMcpArgs,
) {
  return tool.handler(args, undefined);
}

function parseResult(result: Awaited<ReturnType<typeof invoke>>): {
  code?: string;
  error?: string;
  retryable?: boolean;
} {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

function result(
  overrides: Partial<ResolveTargetResult> = {},
): ResolveTargetResult {
  const best = {
    kind: "PACKAGE",
    canonicalKey: "npm:express",
    confidence: "EXACT",
  };
  return {
    best,
    protectedMatches: [best],
    candidates: [
      {
        ...best,
        displayName: "express",
        description: "Fast web framework",
        registry: "NPM",
        stars: 66_000,
        downloadsLastMonth: 89_000_000,
        latestVersionMaliciousStatus: "CLEAR",
        docsAvailable: true,
        codeAvailable: true,
      },
    ],
    ambiguous: false,
    ambiguousReason: "NOT_AMBIGUOUS",
    ...overrides,
  };
}

function createService(
  resolveTarget: ResolveTargetService["resolveTarget"] = mock(() =>
    Promise.resolve(result()),
  ),
): ResolveTargetService {
  return { resolveTarget };
}

describe("resolve_target MCP adapter", () => {
  it("describes the schema and agent-facing usage boundary", () => {
    const tool = createResolveTargetTool(createService());
    const schema = z.toJSONSchema(z.object(tool.schema));

    expect(tool.name).toBe("resolve_target");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
    expect(DESCRIPTION.slice(0, 80)).toBe(
      "Resolve package, repository, or documentation-site names into canonical targets.",
    );
    expect(Object.keys(tool.schema)).toEqual([
      "name",
      "query",
      "registries",
      "preferred_kind",
      "intent_hints",
      "limit",
      "format",
    ]);
    expect(schema.properties?.format).toMatchObject({
      default: "text-v1",
      enum: ["text-v1", "text", "json"],
    });
    expect(schema.properties?.query).toMatchObject({
      description: expect.stringContaining(
        "rank retrieved candidates and does not expand candidate retrieval",
      ),
    });
    expect(schema.properties?.registries).toMatchObject({
      description: expect.stringContaining(
        "constrains package candidates only",
      ),
    });
    expect(schema.properties?.intent_hints).toMatchObject({
      description: expect.stringContaining(
        "rank retrieved candidates and do not expand candidate retrieval",
      ),
    });
    for (const phrase of [
      "Experimental",
      "fuzzy",
      "ambiguous",
      "misspelled",
      "human-friendly",
      "registry:name",
      "github:owner/repo",
      "site:<host[/path]>",
      "standalone documentation-site",
      'source: "docs"',
      "pageId",
      "docs_read",
      "credentials",
      "personal data",
      "private code",
      "proprietary content",
      "text-v1",
      "json",
      "EXACT",
      "HIGH",
      "MEDIUM",
      "LOW",
      "missing statuses",
      "CLEAR is not a vulnerability-free claim",
      "explicit choice",
    ]) {
      expect(DESCRIPTION).toContain(phrase);
    }
  });

  it("uses compact service fields and renders a canonical MCP follow-up", async () => {
    const resolveTarget = mock(() => Promise.resolve(result()));
    const tool = createResolveTargetTool({ resolveTarget });

    const response = await invoke(tool, {
      name: " express ",
      query: "web framework",
      registries: [],
      preferred_kind: "",
      intent_hints: [" server", "server", " "],
      format: "text-v1",
    });

    expect(resolveTarget).toHaveBeenCalledWith({
      name: "express",
      query: "web framework",
      limit: 8,
      intentHints: ["server"],
      includeDetailedFields: false,
    });
    const text = response.content[0]?.text ?? "";
    expect(text).toContain("Best match: npm:express [exact; package]");
    expect(text).toContain("protected exact-name match");
    expect(text).toContain("66k");
    expect(text).toContain("89M");
    expect(text).toContain("Fast web framework");
    expect(text).not.toContain("Warning:");
    expect(text).not.toContain("malicious");
    expect(text).toContain(
      'Next: pass the canonical target "npm:express" to the next MCP tool.',
    );
    expect(text).not.toContain("githits ");

    await invoke(tool, { name: "express", format: "text" });
    expect(resolveTarget).toHaveBeenLastCalledWith({
      name: "express",
      limit: 8,
      includeDetailedFields: false,
    });
  });

  it("emits direct canonical next actions only for EXACT and HIGH results", () => {
    for (const confidence of ["EXACT", "HIGH"] as const) {
      const best = {
        kind: "PACKAGE",
        canonicalKey: "npm:express",
        confidence,
      };
      const bestCandidate = {
        ...best,
        latestVersionMaliciousStatus: "CLEAR",
        docsAvailable: false,
        codeAvailable: false,
      };
      const text = formatResolveTargetMcpText(
        result({ best, candidates: [bestCandidate], protectedMatches: [] }),
        { name: "express" },
      );

      expect(text).toContain(
        `Best match: npm:express [${confidence.toLowerCase()}; package].`,
      );
      expect(text).toContain(
        'Next: pass the canonical target "npm:express" to the next MCP tool.',
      );
      expect(text).not.toContain("Unconfirmed ranked candidates:");
      expect(text).not.toContain("Warning:");
      expect(text).not.toContain("malicious");
    }
  });

  it("routes an actionable site through docs search and docs_read", () => {
    const site = {
      kind: "SITE" as const,
      canonicalKey: "site:expressjs.com",
      confidence: "EXACT" as const,
      latestVersionMaliciousStatus: "NOT_APPLICABLE" as const,
      docsAvailable: true,
      codeAvailable: false,
    };
    const text = formatResolveTargetMcpText(
      result({ best: site, candidates: [site], protectedMatches: [] }),
      { name: "Express docs" },
    );

    expect(text).toContain(
      'Next: call search with target "site:expressjs.com" and source "docs", then call docs_read for relevant results.',
    );
    expect(text).not.toContain("pass the canonical target");
  });

  it("fails closed for affected, unknown, and future malicious statuses", () => {
    const expectedEvidence = new Map([
      [
        "AFFECTED",
        "Malicious content affects the latest version. Do not use the latest version. Verify another version against the linked evidence.",
      ],
      [
        "UNKNOWN",
        "Malicious-content status is uncertain. Verify the advisory details before using this version.",
      ],
      [
        "REVIEW_REQUIRED",
        "Unrecognized malicious-content status: REVIEW_REQUIRED. Do not use this target.",
      ],
    ]);

    for (const [latestVersionMaliciousStatus, evidence] of expectedEvidence) {
      const best = {
        kind: "PACKAGE",
        canonicalKey: "npm:express",
        confidence: "EXACT",
      };
      const text = formatResolveTargetMcpText(
        result({
          best,
          candidates: [
            {
              ...best,
              latestVersionMaliciousStatus,
              docsAvailable: false,
              codeAvailable: false,
            },
          ],
          protectedMatches: [],
        }),
        { name: "express" },
      );

      expect(text).toContain(evidence);
      expect(text).toContain("Warning:");
      expect(text).toContain("Candidates:\n  1. npm:express");
      expect(text).not.toContain("Next:");
      expect(text).not.toContain("pass the canonical target");
      expect(text).not.toContain("next MCP tool");
    }
  });

  it("renders malicious advisory links and unknown reasons without a handoff", () => {
    const best = {
      kind: "PACKAGE",
      canonicalKey: "npm:lookalike",
      confidence: "EXACT",
    };
    const text = formatResolveTargetMcpText(
      result({
        best,
        candidates: [
          {
            ...best,
            latestVersionMaliciousStatus: "UNKNOWN",
            latestVersionMaliciousEvidence: {
              advisories: [
                {
                  osvId: "MAL-2026-1234",
                  classificationReasons: ["MISSING_DISPLAYED_VERSION"],
                },
              ],
              totalCount: 1,
              truncated: false,
            },
            docsAvailable: false,
            codeAvailable: false,
          },
        ],
        protectedMatches: [],
      }),
      { name: "lookalike" },
    );

    expect(text).toContain(
      "Warning: Malicious-content status is uncertain — MAL-2026-1234 (latest version missing): https://osv.dev/vulnerability/MAL-2026-1234. Verify the advisory details before using this version.",
    );
    expect(text).not.toContain("Next:");
    expect(text).not.toContain("next MCP tool");
  });

  it("restricts MEDIUM and LOW continuation when reference evidence is unavailable", () => {
    for (const confidence of ["MEDIUM", "LOW"] as const) {
      const best = {
        kind: "PACKAGE",
        canonicalKey: "npm:express",
        confidence,
      };
      const text = formatResolveTargetMcpText(
        result({
          best,
          candidates: [
            {
              ...best,
              latestVersionMaliciousStatus: "CLEAR",
              docsAvailable: false,
              codeAvailable: false,
            },
            {
              kind: "REPOSITORY",
              canonicalKey: "github:expressjs/express",
              confidence,
              latestVersionMaliciousStatus: "NOT_APPLICABLE",
              docsAvailable: false,
              codeAvailable: false,
            },
          ],
          protectedMatches: [
            {
              kind: "PACKAGE",
              canonicalKey: "jsr:@express/core",
              confidence: "EXACT",
            },
          ],
        }),
        { name: "express" },
      );

      expect(text).toContain(
        `Unconfirmed ranked candidates: the best result is ${confidence.toLowerCase()} confidence.\n  1. npm:express`,
      );
      expect(text).toContain(
        "jsr:@express/core [exact; package] · protected exact-name match",
      );
      expect(text).not.toContain("\nCandidates:\n");
      expect(text).toContain(
        "Warning: Some candidates are not actionable. Narrow the result before continuing.",
      );
      expect(text.match(/Warning:/g)).toHaveLength(1);
      expect(text).not.toContain("Next:");
      expect(text).not.toContain(
        'pass the canonical target "npm:express" to the next MCP tool',
      );
      expect(text).not.toContain("next MCP tool");
    }
  });

  it("requires narrowing or an explicit choice for actionable MEDIUM and LOW candidates", () => {
    for (const confidence of ["MEDIUM", "LOW"] as const) {
      const best = {
        kind: "PACKAGE",
        canonicalKey: "npm:express",
        confidence,
      };
      const text = formatResolveTargetMcpText(
        result({
          best,
          candidates: [
            {
              ...best,
              latestVersionMaliciousStatus: "CLEAR",
              docsAvailable: false,
              codeAvailable: false,
            },
          ],
          protectedMatches: [],
        }),
        { name: "express" },
      );

      expect(text).toContain(
        `Unconfirmed ranked candidates: the best result is ${confidence.toLowerCase()} confidence.`,
      );
      expect(text).toContain("Next: narrow the name or filters");
      expect(text).toContain("explicitly choose a candidate");
      expect(text).toContain("do not pass the best result automatically");
    }
  });

  it("requests detailed fields only for JSON and reuses the stable payload", async () => {
    const service: ResolveTargetService = {
      resolveTarget: mock(() => Promise.resolve(result())),
    };
    const tool = createResolveTargetTool(service);

    const response = await invoke(tool, { name: "express", format: "json" });

    expect(service.resolveTarget).toHaveBeenCalledWith({
      name: "express",
      limit: 8,
      includeDetailedFields: true,
    });
    expect(response.content[0]?.text).toBe(
      JSON.stringify(buildResolveTargetSuccessPayload(result())),
    );
    expect(JSON.parse(response.content[0]?.text ?? "{}")).toMatchObject({
      candidates: [
        {
          target: "npm:express",
          latestVersionMaliciousStatus: "clear",
        },
      ],
    });
  });

  it("preserves ambiguous resolution guidance without guessing", () => {
    const ambiguous = result({
      best: undefined,
      candidates: [
        {
          kind: "PACKAGE",
          canonicalKey: "npm:express",
          confidence: "HIGH",
          latestVersionMaliciousStatus: "CLEAR",
          docsAvailable: false,
          codeAvailable: false,
        },
        {
          kind: "REPOSITORY",
          canonicalKey: "github:expressjs/express",
          confidence: "HIGH",
          latestVersionMaliciousStatus: "NOT_APPLICABLE",
          docsAvailable: false,
          codeAvailable: false,
        },
      ],
      protectedMatches: [],
      ambiguous: true,
      ambiguousReason: "CLOSE_CANDIDATES",
    });
    const ambiguousText = formatResolveTargetMcpText(ambiguous, {
      name: "express",
    });
    expect(ambiguousText).toContain("Ambiguous:");
    expect(ambiguousText).toContain("choose the canonical target");
    expect(ambiguousText).not.toContain("Best match:");
    expect(ambiguousText).not.toContain("candidate 1");
  });

  it("preserves ambiguous guidance when the best result has LOW confidence", () => {
    const best = {
      kind: "PACKAGE",
      canonicalKey: "npm:express",
      confidence: "LOW",
    };
    const text = formatResolveTargetMcpText(
      result({
        best,
        candidates: [],
        protectedMatches: [],
        ambiguous: true,
        ambiguousReason: "LOW_CONFIDENCE",
      }),
      { name: "express" },
    );

    expect(text).toContain(
      "Ambiguous: low confidence; multiple candidates remain.",
    );
    expect(text).toContain("Candidates:\n  1. npm:express [low; package]");
    expect(text).toContain(
      "Warning: Some candidates are not actionable. Narrow the result before continuing.",
    );
    expect(text.match(/Warning:/g)).toHaveLength(1);
    expect(text).not.toContain("Next:");
    expect(text).not.toContain("Unconfirmed ranked candidates:");
    expect(text).not.toContain(
      'pass the canonical target "npm:express" to the next MCP tool',
    );
  });

  it("corrects spelling or filters for empty resolution without adding ranking context", async () => {
    const tool = createResolveTargetTool(
      createService(() =>
        Promise.resolve(
          result({
            best: undefined,
            candidates: [],
            protectedMatches: [],
          }),
        ),
      ),
    );
    const response = await invoke(tool, { name: "missing" });
    expect(response.isError).toBeUndefined();
    expect(response.content[0]?.text).toContain("No targets found");
    expect(response.content[0]?.text).toContain(
      "Check the spelling or adjust registry filters",
    );
    expect(response.content[0]?.text).toContain(
      "query, preferred kind, and intent hints only rank existing candidates",
    );
    expect(response.content[0]?.text).not.toContain("include more context");
    expect(response.content[0]?.text).toContain("no target was invented");
  });

  it("maps builder and service failures to structured MCP errors", async () => {
    const service = createService(() =>
      Promise.reject(new Error("auth failed")),
    );
    const tool = createResolveTargetTool(service);

    const invalid = await invoke(tool, { name: " ", format: "text" });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]?.text).toContain('"code":"INVALID_ARGUMENT"');

    const serviceError = await invoke(tool, {
      name: "express",
      format: "text",
    });
    expect(serviceError.isError).toBe(true);
    expect(serviceError.content[0]?.text).toContain('"code":"UNKNOWN"');

    for (const [error, code] of [
      [new AuthenticationError("login required"), "AUTH_REQUIRED"],
      [
        new PackageIntelligenceFeatureFlagRequiredError("feature required"),
        "ACCESS_DENIED",
      ],
      [new PackageIntelligenceNetworkError("offline"), "NETWORK"],
      [
        new MalformedPackageIntelligenceResponseError("bad response"),
        "PROTOCOL_ERROR",
      ],
    ] as const) {
      const mappedTool = createResolveTargetTool(
        createService(() => Promise.reject(error)),
      );
      const mapped = await invoke(mappedTool, { name: "express" });
      expect(mapped.isError).toBe(true);
      expect(parseResult(mapped).code).toBe(code);
    }
  });

  it("keeps invalid MCP values in the structured argument envelope", async () => {
    const tool = createResolveTargetTool(createService());
    for (const args of [
      { name: "express", registries: ["cargo"] },
      { name: "express", preferred_kind: "workspace" },
      { name: "express", limit: 1.5 },
      { name: "express", limit: 21 },
    ]) {
      const response = await invoke(tool, args);
      expect(response.isError).toBe(true);
      expect(parseResult(response).code).toBe("INVALID_ARGUMENT");
    }

    const preferredKind = await invoke(tool, {
      name: "express",
      preferred_kind: "workspace",
    });
    expect(parseResult(preferredKind)).toEqual({
      code: "INVALID_ARGUMENT",
      error:
        "Preferred kind expects package, repository, or site. Got 'workspace'.",
      retryable: false,
    });
  });

  it("reports omitted candidates and protected matches in bounded text", () => {
    const candidates: ResolveTargetCandidate[] = Array.from(
      { length: 30 },
      (_, index) => ({
        kind: "PACKAGE",
        canonicalKey: `npm:library-${index}`,
        confidence: "HIGH",
        latestVersionMaliciousStatus: "CLEAR",
        docsAvailable: false,
        codeAvailable: false,
      }),
    );
    const text = formatResolveTargetMcpText(
      result({
        best: candidates[0],
        candidates,
        protectedMatches: candidates,
      }),
      { name: "library" },
    );

    expect(text).toContain(
      "... 6 additional candidate entries omitted, including 6 protected exact-name matches.",
    );
    expect(text).toContain(
      "Use format=json for the complete structured candidate and protected-match lists.",
    );
    expect(text).toContain("npm:library-23");
    expect(text).not.toContain("npm:library-24");
  });

  it("sanitizes backend strings and bounds descriptions", () => {
    const hostile: ResolveTargetResult = result({
      best: {
        kind: "PACKAGE",
        canonicalKey: "npm:x\u001b[31m",
        confidence: "EXACT",
      },
      protectedMatches: [],
      candidates: [
        {
          kind: "PACKAGE",
          canonicalKey: "npm:x\u001b[31m",
          confidence: "EXACT",
          latestVersionMaliciousStatus: "CLEAR",
          description: `first\n${"x".repeat(300)}\u0007`,
          docsAvailable: true,
          codeAvailable: false,
        },
      ],
    });
    const text = formatResolveTargetMcpText(hostile, { name: "x" });
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
    expect(text).toContain("npm:x [exact; package]");
    expect(text).toContain("firstx");
    expect(text.length).toBeLessThan(700);
  });
});
