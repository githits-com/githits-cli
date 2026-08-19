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
    for (const phrase of [
      "Experimental",
      "local-only",
      "not a production-ready",
      "known gaps",
      "empty results may miss real targets",
      "verify the identity",
      "fuzzy",
      "ambiguous",
      "misspelled",
      "human-friendly",
      "registry:name",
      "github:owner/repo",
      "credentials",
      "personal data",
      "private code",
      "proprietary content",
      "text-v1",
      "json",
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
  });

  it("keeps ambiguous and empty resolution successful without guessing", async () => {
    const ambiguous = result({
      best: undefined,
      candidates: [
        {
          kind: "PACKAGE",
          canonicalKey: "npm:express",
          confidence: "HIGH",
          docsAvailable: false,
          codeAvailable: false,
        },
        {
          kind: "REPOSITORY",
          canonicalKey: "github:expressjs/express",
          confidence: "HIGH",
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
      error: "Preferred kind expects package or repository. Got 'workspace'.",
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
