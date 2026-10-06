import { expect, it, mock } from "bun:test";
import { AuthenticationError } from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { createPackageChangelogTool } from "./package-changelog.js";
import { createPackageDependenciesTool } from "./package-dependencies.js";
import { createPackageSummaryTool } from "./package-summary.js";
import { createPackageUpgradeReviewTool } from "./package-upgrade-review.js";
import { createPackageVulnerabilitiesTool } from "./package-vulnerabilities.js";

type ErrorFormat = "text" | "json" | undefined;

interface ErrorFormatMode {
  label: string;
  format: ErrorFormat;
}

const errorFormatModes: ErrorFormatMode[] = [
  { label: "format omitted", format: undefined },
  { label: "format=text", format: "text" },
  { label: "format=json", format: "json" },
];

const authError = new AuthenticationError(
  "GitHits could not accept the authentication token.",
  "server",
);
const serverAuthAction =
  "Re-authenticate with `githits login` or update GITHITS_API_TOKEN if set. If this persists, contact support@githits.com.";

const errorFormatTools = [
  {
    name: "pkg_info",
    invoke: async (format: ErrorFormat) => {
      const packageSummary = mock(() => Promise.reject(authError));
      const tool = createPackageSummaryTool(
        createMockPackageIntelligenceService({ packageSummary }),
      );
      const args = {
        target: "npm:express",
        ...(format === undefined ? {} : { format }),
      };
      return {
        result: await tool.handler(args, {}),
        serviceCalls: packageSummary.mock.calls.length,
      };
    },
  },
  {
    name: "pkg_deps",
    invoke: async (format: ErrorFormat) => {
      const packageDependencies = mock(() => Promise.reject(authError));
      const tool = createPackageDependenciesTool(
        createMockPackageIntelligenceService({ packageDependencies }),
      );
      const args = {
        target: "npm:express",
        ...(format === undefined ? {} : { format }),
      };
      return {
        result: await tool.handler(args, {}),
        serviceCalls: packageDependencies.mock.calls.length,
      };
    },
  },
  {
    name: "pkg_upgrade_review",
    invoke: async (format: ErrorFormat) => {
      const packageUpgradeReview = mock(() => Promise.reject(authError));
      const tool = createPackageUpgradeReviewTool(
        createMockPackageIntelligenceService({
          packageUpgradeReview: packageUpgradeReview as never,
        }),
      );
      const args = {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
        ...(format === undefined ? {} : { format }),
      };
      return {
        result: await tool.handler(args, {}),
        serviceCalls: packageUpgradeReview.mock.calls.length,
      };
    },
  },
  {
    name: "pkg_changelog",
    invoke: async (format: ErrorFormat) => {
      const packageChangelog = mock(() => Promise.reject(authError));
      const tool = createPackageChangelogTool(
        createMockPackageIntelligenceService({ packageChangelog }),
      );
      const args = {
        target: "npm:express",
        ...(format === undefined ? {} : { format }),
      };
      return {
        result: await tool.handler(args, {}),
        serviceCalls: packageChangelog.mock.calls.length,
      };
    },
  },
  {
    name: "pkg_vulns",
    invoke: async (format: ErrorFormat) => {
      const packageVulnerabilities = mock(() => Promise.reject(authError));
      const tool = createPackageVulnerabilitiesTool(
        createMockPackageIntelligenceService({ packageVulnerabilities }),
      );
      const args = {
        target: "npm:express",
        ...(format === undefined ? {} : { format }),
      };
      return {
        result: await tool.handler(args, {}),
        serviceCalls: packageVulnerabilities.mock.calls.length,
      };
    },
  },
];

const namedErrorFormatCases = errorFormatTools.flatMap((tool) =>
  errorFormatModes.map(
    (mode) => [`${tool.name} ${mode.label}`, tool, mode] as const,
  ),
);

it.each(namedErrorFormatCases)(
  "%s returns readable text or the JSON error envelope",
  async (_name, tool, mode) => {
    const { result, serviceCalls } = await tool.invoke(mode.format);
    const text = result.content[0]?.text ?? "";

    expect(serviceCalls).toBe(1);
    expect(result.isError).toBe(true);

    if (mode.format === "json") {
      expect(JSON.parse(text)).toEqual({
        error: authError.message,
        code: "AUTH_REQUIRED",
        retryable: false,
        details: {
          authSource: "server",
          action: serverAuthAction,
        },
      });
      return;
    }

    expect(text).toContain(authError.message);
    expect(text).toContain(serverAuthAction);
    expect(() => JSON.parse(text)).toThrow();
  },
);
