import { afterEach, describe, expect, it, mock } from "bun:test";
import { InvalidPackageSpecError } from "@githits/mcp/internal";
import { createMockPackageIntelligenceService } from "../../services/test-helpers.js";
import {
  parseUpgradeReviewPackageOption,
  pkgUpgradeReviewAction,
} from "./upgrade-review.js";

const originalStdoutWrite = process.stdout.write;

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
});

describe("parseUpgradeReviewPackageOption", () => {
  it("accepts shell-safe double-dot package ranges", () => {
    expect(parseUpgradeReviewPackageOption("npm:zod@4.3.6..4.4.3")).toEqual({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
  });

  it("keeps quoted arrow package ranges compatible", () => {
    expect(
      parseUpgradeReviewPackageOption("npm:@scope/pkg@1.2.3->1.3.0"),
    ).toEqual({
      registry: "npm",
      packageName: "@scope/pkg",
      currentVersion: "1.2.3",
      targetVersion: "1.3.0",
    });
  });

  it("explains likely shell redirection for truncated arrow ranges", () => {
    expect(() => parseUpgradeReviewPackageOption("npm:zod@4.3.6-")).toThrow(
      InvalidPackageSpecError,
    );
    expect(() => parseUpgradeReviewPackageOption("npm:zod@4.3.6-")).toThrow(
      "The shell likely treated '>' as output redirection",
    );
  });

  it("writes JSON through stdout.write instead of console.log", async () => {
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    const consoleLog = mock(() => undefined);
    const originalConsoleLog = console.log;
    console.log = consoleLog as typeof console.log;
    try {
      await pkgUpgradeReviewAction(
        "npm:express@5.0.0",
        { to: "5.2.1", json: true, transitiveSecurity: false },
        {
          packageIntelligenceService: createMockPackageIntelligenceService(),
          codeNavigationUrl: "https://pkgseer.dev",
          hasValidToken: true,
          mcpUrl: "https://mcp.githits.com",
        },
      );
    } finally {
      console.log = originalConsoleLog;
    }

    expect(consoleLog).not.toHaveBeenCalled();
    expect(JSON.parse(output).summary.total).toBe(1);
    expect(output.endsWith("\n")).toBe(true);
  });
});
