import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  InvalidPackageSpecError,
  PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES,
} from "@githits/mcp/internal";
import { Command } from "commander";
import { createMockPackageIntelligenceService } from "../../services/test-helpers.js";
import {
  parseUpgradeReviewPackageOption,
  pkgUpgradeReviewAction,
  registerPkgUpgradeReviewCommand,
} from "./upgrade-review.js";

const originalStdoutWrite = process.stdout.write;
const originalStdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
  process.stdout,
  "columns",
);

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  restoreProperty(process.stdout, "columns", originalStdoutColumnsDescriptor);
});

function restoreProperty(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

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
});

describe("pkg upgrade-review help", () => {
  it("advertises the maximum batch size", () => {
    const command = registerPkgUpgradeReviewCommand(
      new Command().command("pkg"),
    );
    const help = command.helpInformation().replace(/\s+/g, " ");

    expect(help).toContain("at most 30 upgrades");
    expect(help).toContain("maximum 30");
  });
});

describe("pkgUpgradeReviewAction", () => {
  it("rejects over-cap batches before calling the service", async () => {
    const packageUpgradeReview = mock(() =>
      Promise.reject(new Error("service must not be called")),
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(
        pkgUpgradeReviewAction(
          undefined,
          {
            package: Array.from(
              { length: PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES + 1 },
              (_, index) => `npm:package-${index}@1.0.0..1.0.1`,
            ),
          },
          {
            packageIntelligenceService: createMockPackageIntelligenceService({
              packageUpgradeReview: packageUpgradeReview as never,
            }),
            codeNavigationUrl: "https://pkgseer.dev",
            hasValidToken: true,
            mcpUrl: "https://mcp.githits.com",
          },
        ),
      ).rejects.toThrow("process.exit");

      expect(packageUpgradeReview).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("packages[] must contain at most 30 upgrades."),
      );
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
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

  it("passes the terminal width to the shared human-readable formatter", async () => {
    let output = "";
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      writable: true,
      value: 30,
    });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    await pkgUpgradeReviewAction(
      "npm:express@5.0.0",
      { to: "5.2.1", transitiveSecurity: false },
      {
        packageIntelligenceService: createMockPackageIntelligenceService(),
        codeNavigationUrl: "https://pkgseer.dev",
        hasValidToken: true,
        mcpUrl: "https://mcp.githits.com",
      },
    );

    expect(output).toStartWith("Upgrade review - 1 package");
    expect(output).toContain("\n          affected | 0 fixed |");
    expect(output).not.toContain("pkg_upgrade_review");
  });
});
