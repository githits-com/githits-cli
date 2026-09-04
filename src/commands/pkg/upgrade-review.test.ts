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

  it("rejects legacy arrow package ranges with replacement guidance", () => {
    expect(() =>
      parseUpgradeReviewPackageOption("npm:@scope/pkg@1.2.3->1.3.0"),
    ).toThrow("The '->' delimiter is not supported");
    expect(() =>
      parseUpgradeReviewPackageOption("npm:@scope/pkg@1.2.3->1.3.0"),
    ).toThrow("<registry>:<name>@<current>..<target>");
  });

  it("preserves delimiter-like package names in batch ranges", () => {
    expect(
      parseUpgradeReviewPackageOption("npm:@scope/pkg..legacy@1.2.3..1.3.0"),
    ).toEqual({
      registry: "npm",
      packageName: "@scope/pkg..legacy",
      currentVersion: "1.2.3",
      targetVersion: "1.3.0",
    });
  });

  it("rejects adjacent dots in a batch range suffix", () => {
    expect(() =>
      parseUpgradeReviewPackageOption("npm:foo@1.0.0...2.0.0"),
    ).toThrow(InvalidPackageSpecError);
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

  it("advertises positional single-package ranges", () => {
    const command = registerPkgUpgradeReviewCommand(
      new Command().command("pkg"),
    );
    const help = command.helpInformation().replace(/\s+/g, " ");

    expect(help).toContain("githits pkg upgrade-review npm:zod@4.3.6..4.4.3");
    expect(help).toContain(
      "githits pkg upgrade-review npm:zod@4.3.6 --to 4.4.3",
    );
    expect(help).toContain("Single package range:");
    expect(help).toContain("Single package with separate target:");
    expect(help).toContain(
      "use a .. range for an inline target or --to for a separate target",
    );
    expect(help).toContain(
      "--package npm:zod@4.3.6..4.4.3 --package npm:lint-staged@16.2.7..16.4.0",
    );
    expect(help).not.toContain("->");
  });
});

describe("pkgUpgradeReviewAction", () => {
  it("accepts a scoped positional double-dot range", async () => {
    const service = createMockPackageIntelligenceService();
    process.stdout.write = (() => true) as typeof process.stdout.write;

    await pkgUpgradeReviewAction(
      "npm:@scope/pkg@1.2.3..1.3.0",
      { json: true },
      {
        packageIntelligenceService: service,
        codeNavigationUrl: "https://pkgseer.dev",
        hasValidToken: true,
        mcpUrl: "https://mcp.githits.com",
      },
    );

    expect(service.packageUpgradeReview).toHaveBeenCalledWith(
      expect.objectContaining({
        packages: [
          {
            registry: "NPM",
            name: "@scope/pkg",
            currentVersion: "1.2.3",
            targetVersion: "1.3.0",
          },
        ],
      }),
    );
  });

  it("rejects a legacy positional arrow range with replacement guidance", async () => {
    const service = createMockPackageIntelligenceService();
    const output = await expectActionError(
      "npm:@scope/pkg@1.2.3->1.3.0",
      { json: true },
      service,
    );

    expect(service.packageUpgradeReview).not.toHaveBeenCalled();
    expect(output).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(output.error).toContain("The '->' delimiter is not supported");
    expect(output.error).toContain("<registry>:<name>@<current>..<target>");
  });

  it("preserves delimiter-like package names with --to", async () => {
    const service = createMockPackageIntelligenceService();
    process.stdout.write = (() => true) as typeof process.stdout.write;

    await pkgUpgradeReviewAction(
      "npm:@scope/pkg..legacy@1.2.3",
      { to: "1.3.0", json: true },
      {
        packageIntelligenceService: service,
        codeNavigationUrl: "https://pkgseer.dev",
        hasValidToken: true,
        mcpUrl: "https://mcp.githits.com",
      },
    );

    expect(service.packageUpgradeReview).toHaveBeenCalledWith(
      expect.objectContaining({
        packages: [
          {
            registry: "NPM",
            name: "@scope/pkg..legacy",
            currentVersion: "1.2.3",
            targetVersion: "1.3.0",
          },
        ],
      }),
    );
  });

  it("rejects a positional range combined with --to", async () => {
    const service = createMockPackageIntelligenceService();
    const output = await expectActionError(
      "npm:@scope/pkg@1.2.3..1.3.0",
      { to: "1.4.0", json: true },
      service,
    );

    expect(service.packageUpgradeReview).not.toHaveBeenCalled();
    expect(output).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(output.error).toContain("already contains the target version");
    expect(output.error).toContain("npm:@scope/pkg@1.2.3..1.3.0' without --to");
    expect(output.error).toContain("'npm:@scope/pkg@1.2.3' --to '1.3.0'");
  });

  it("rejects malformed positional range intent", async () => {
    const cases = [
      "npm:@scope/pkg@1.2.3..",
      "npm:foo@1.0.0...2.0.0",
      "npm:@scope/pkg@1.2.3..1.3.0..1.4.0",
      "npm:@scope/pkg@..1.3.0",
    ];

    for (const spec of cases) {
      const service = createMockPackageIntelligenceService();
      const output = await expectActionError(spec, { json: true }, service);

      expect(service.packageUpgradeReview).not.toHaveBeenCalled();
      expect(output).toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(output.error).toContain("Expected <registry>:<name>@<current>");
      expect(output.error).not.toContain("--package");
      expect(output.error).not.toContain('trailing "@"');
    }
  });

  it("rejects positional input combined with --package", async () => {
    const service = createMockPackageIntelligenceService();
    const output = await expectActionError(
      "npm:@scope/pkg@1.2.3..1.3.0",
      {
        package: ["npm:other@2.0.0..2.1.0"],
        json: true,
      },
      service,
    );

    expect(service.packageUpgradeReview).not.toHaveBeenCalled();
    expect(output).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(output.error).toContain("positional <spec>@<current> --to <target>");
    expect(output.error).toContain("positional <spec>@<current>..<target>");
    expect(output.error).toContain("repeatable --package entries");
    expect(output.error).toContain("Choose one form.");
  });

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

async function expectActionError(
  spec: string,
  options: Parameters<typeof pkgUpgradeReviewAction>[1],
  service: ReturnType<typeof createMockPackageIntelligenceService>,
): Promise<{ error: string; code: string }> {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });

  try {
    await expect(
      pkgUpgradeReviewAction(spec, options, {
        packageIntelligenceService: service,
        codeNavigationUrl: "https://pkgseer.dev",
        hasValidToken: true,
        mcpUrl: "https://mcp.githits.com",
      }),
    ).rejects.toThrow("process.exit");
    const payload = errorSpy.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    return JSON.parse(payload as string) as { error: string; code: string };
  } finally {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }
}
