import { describe, expect, it } from "bun:test";
import type { Dependencies } from "../container.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockCodeNavigationService,
  createMockFileSystemService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
import { getMcpToolDefinitions } from "./mcp.js";
import {
  buildMcpInstructions,
  isPackageToolsCapabilityOpen,
} from "./mcp-instructions.js";

function createTestDeps(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    authStorage: createMockAuthStorage(),
    authService: createMockAuthService(),
    browserService: createMockBrowserService(),
    fileSystemService: createMockFileSystemService(),
    mcpUrl: "https://mcp.githits.com",
    apiUrl: "https://api.githits.com",
    apiToken: "test-token",
    hasValidToken: true,
    envApiToken: undefined,
    codeNavigationCapability: "disabled",
    codeNavigationCliOverrideEnabled: false,
    codeNavigationUrl: undefined,
    codeNavigationService: undefined,
    packageIntelligenceService: undefined,
    githitsService: createMockGitHitsService(),
    ...overrides,
  };
}

/**
 * Tool names this CLI knows how to register. Each is separately
 * probed by the mention↔registration invariant so the composer
 * cannot advertise a tool that `getMcpToolDefinitions` omits for
 * the same deps.
 */
const KNOWN_TOOLS = [
  "search",
  "get_example",
  "search_language",
  "feedback",
  "search_status",
  "list_files",
  "read_file",
  "grep_repo",
  "package_summary",
  "package_vulnerabilities",
  "package_dependencies",
  "package_changelog",
] as const;

function mentionedTools(instructions: string): Set<string> {
  const mentioned = new Set<string>();
  for (const name of KNOWN_TOOLS) {
    if (instructions.includes(`\`${name}\``)) {
      mentioned.add(name);
    }
  }
  return mentioned;
}

function registeredTools(deps: Dependencies): Set<string> {
  return new Set(getMcpToolDefinitions(deps).map((tool) => tool.name));
}

describe("isPackageToolsCapabilityOpen", () => {
  it("is true when capability is enabled", () => {
    const deps = createTestDeps({ codeNavigationCapability: "enabled" });
    expect(isPackageToolsCapabilityOpen(deps)).toBe(true);
  });

  it("is false when capability is disabled", () => {
    const deps = createTestDeps({ codeNavigationCapability: "disabled" });
    expect(isPackageToolsCapabilityOpen(deps)).toBe(false);
  });

  it("is false when capability unknown even if an env token is present", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "unknown",
      envApiToken: "ghi-opaque-token",
    });
    expect(isPackageToolsCapabilityOpen(deps)).toBe(false);
  });

  it("is false when capability unknown and no env token", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "unknown",
      envApiToken: undefined,
    });
    expect(isPackageToolsCapabilityOpen(deps)).toBe(false);
  });
});

describe("buildMcpInstructions", () => {
  it("returns only the core block when gate is closed", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);

    expect(instructions).toContain("GitHits surfaces verified");
    expect(instructions).toContain("search_language");
    expect(instructions).toContain("feedback");
    expect(instructions).toContain("get_example");
    expect(instructions).not.toContain("Package tools");
    expect(instructions).not.toContain("package_summary");
    expect(instructions).not.toContain("package_vulnerabilities");
    expect(instructions).not.toContain("package_dependencies");
    expect(instructions).not.toContain("package_changelog");
    expect(instructions).not.toContain("search_status");
  });

  it("returns core + package-tools section when capability enabled and both services wired", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://nav.example.com",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });
    const instructions = buildMcpInstructions(deps);

    expect(instructions).toContain("GitHits surfaces verified");
    expect(instructions).toContain("Package tools");
    expect(instructions).toContain("`package_summary`");
    expect(instructions).toContain("`package_vulnerabilities`");
    expect(instructions).toContain("`package_dependencies`");
    expect(instructions).toContain("`package_changelog`");
    expect(instructions).toContain("`search`");
    expect(instructions).toContain("`search_status`");
    expect(instructions).toContain("allow_partial_results");
    expect(instructions).toContain("partial hits");
  });

  it("keeps the core block first when both sections are present", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });
    const instructions = buildMcpInstructions(deps);

    const coreIdx = instructions.indexOf("GitHits surfaces verified");
    const gatedIdx = instructions.indexOf("Package tools");
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(gatedIdx).toBeGreaterThan(coreIdx);
  });

  it("omits the package-tools section when capability enabled but no services wired", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationService: undefined,
      packageIntelligenceService: undefined,
    });
    const instructions = buildMcpInstructions(deps);

    expect(instructions).not.toContain("Package tools");
  });

  it("half-open: only code navigation service wired → mentions search/search_status but not package_summary", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: undefined,
    });
    const instructions = buildMcpInstructions(deps);

    expect(instructions).toContain("Package tools");
    expect(instructions).toContain("`search`");
    expect(instructions).toContain("`search_status`");
    expect(instructions).not.toContain("`package_summary`");
    expect(instructions).toContain("canonical example retrieval");
  });

  it("half-open: only package intelligence service wired → mentions every package tool but not unified search", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationService: undefined,
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });
    const instructions = buildMcpInstructions(deps);

    expect(instructions).toContain("Package tools");
    expect(instructions).toContain("`package_summary`");
    expect(instructions).toContain("`package_vulnerabilities`");
    expect(instructions).toContain("`package_dependencies`");
    expect(instructions).toContain("`package_changelog`");
    expect(instructions).not.toContain("`search_status`");
    // The decision tip references unified search, so it must not
    // appear when unified search isn't registered.
    expect(instructions).not.toContain("canonical example retrieval");
  });

  describe("mention↔registration invariant", () => {
    const scenarios: { label: string; overrides: Partial<Dependencies> }[] = [
      { label: "gate closed", overrides: {} },
      {
        label: "gate open, no services wired",
        overrides: { codeNavigationCapability: "enabled" },
      },
      {
        label: "gate open, only code navigation service",
        overrides: {
          codeNavigationCapability: "enabled",
          codeNavigationService: createMockCodeNavigationService(),
        },
      },
      {
        label: "gate open, only package intelligence service",
        overrides: {
          codeNavigationCapability: "enabled",
          packageIntelligenceService: createMockPackageIntelligenceService(),
        },
      },
      {
        label: "gate open, both services",
        overrides: {
          codeNavigationCapability: "enabled",
          codeNavigationService: createMockCodeNavigationService(),
          packageIntelligenceService: createMockPackageIntelligenceService(),
        },
      },
      {
        label: "opaque env token, both services",
        overrides: {
          codeNavigationCapability: "unknown",
          envApiToken: "ghi-opaque-token",
          codeNavigationService: createMockCodeNavigationService(),
          packageIntelligenceService: createMockPackageIntelligenceService(),
        },
      },
    ];

    for (const { label, overrides } of scenarios) {
      it(`${label}: every mentioned tool is registered, and every package tool registered is mentioned`, () => {
        const deps = createTestDeps(overrides);
        const mentioned = mentionedTools(buildMcpInstructions(deps));
        const registered = registeredTools(deps);

        // Forward: no ghost mentions.
        for (const name of mentioned) {
          expect(registered.has(name)).toBe(true);
        }
        // Reverse: every package tool that is registered must also
        // be mentioned in the composed instructions. Core tools
        // (search/search_language/feedback) are exempt — the core
        // block narrates the workflow rather than bulleting them
        // individually, so `search_language` and `feedback` won't
        // appear in backtick form.
        const packageTools = [
          "search",
          "search_status",
          "list_files",
          "read_file",
          "grep_repo",
          "package_summary",
          "package_vulnerabilities",
          "package_dependencies",
          "package_changelog",
        ];
        for (const name of packageTools) {
          if (registered.has(name)) {
            expect(mentioned.has(name)).toBe(true);
          }
        }
      });
    }
  });
});
