import { describe, expect, it, mock } from "bun:test";
import type { ResolveTargetService } from "@githits/core-internal";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
import { buildMcpInstructions } from "./instructions.js";
import {
  createLocalMcpServer,
  type LocalExperimentalMcpPolicy,
  type LocalMcpToolServices,
} from "./local-server.js";

const EXPECTED_STABLE_NAMES = [
  "get_example",
  "search_language",
  "feedback",
  "search",
  "search_status",
  "code_files",
  "code_read",
  "code_grep",
  "docs_list",
  "docs_read",
  "pkg_info",
  "pkg_vulns",
  "pkg_deps",
  "pkg_changelog",
  "pkg_upgrade_review",
] as const;

function createServices(): LocalMcpToolServices {
  const resolveTargetService: ResolveTargetService = {
    resolveTarget: mock(() => Promise.reject(new Error("unused"))),
  };
  return {
    githitsService: createMockGitHitsService(),
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    resolveTargetService,
  };
}

function registeredToolNames(server: ReturnType<typeof createLocalMcpServer>) {
  return Object.keys(
    (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools,
  );
}

function serverInstructions(
  server: ReturnType<typeof createLocalMcpServer>,
): string | undefined {
  return (
    server.server as unknown as {
      _instructions?: string;
    }
  )._instructions;
}

describe("createLocalMcpServer", () => {
  const policies: LocalExperimentalMcpPolicy[] = [
    { tools: false, reportToolIssues: undefined },
    { tools: false, reportToolIssues: "experimental" },
    { tools: false, reportToolIssues: "all" },
    { tools: true, reportToolIssues: undefined },
  ];

  it("keeps every local pre-adapter policy on the stable tool and instruction inventories", () => {
    for (const policy of policies) {
      const server = createLocalMcpServer({
        metadata: { name: "local-githits", version: "0.0.0" },
        services: createServices(),
        policy,
      });

      expect(registeredToolNames(server)).toEqual([...EXPECTED_STABLE_NAMES]);
      expect(serverInstructions(server)).toBe(buildMcpInstructions());
    }
  });
});
