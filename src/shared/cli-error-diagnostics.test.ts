import { describe, expect, it, spyOn } from "bun:test";
import {
  CodeNavigationTargetNotFoundError,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import {
  mapCodeNavigationErrorForCli,
  mapPackageIntelligenceErrorForCli,
  recordCliErrorClassification,
} from "./cli-error-diagnostics.js";

describe("CLI error diagnostics", () => {
  it("emits the package classification event without the error message", () => {
    const previous = process.env.GITHITS_DEBUG;
    process.env.GITHITS_DEBUG = "pkg-intel";
    const errorSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true,
    );

    try {
      const error = new PackageIntelligenceTargetNotFoundError(
        "private package caller-content",
      );
      const mapped = mapPackageIntelligenceErrorForCli(error);

      expect(mapped.code).toBe("NOT_FOUND");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const line = String(errorSpy.mock.calls[0]?.[0]);
      expect(JSON.parse(line)).toMatchObject({
        area: "pkg-intel",
        event: "error-classified",
        code: "NOT_FOUND",
        errorName: "PackageIntelligenceTargetNotFoundError",
        detailKeys: [],
      });
      expect(line).not.toContain("private package caller-content");
    } finally {
      errorSpy.mockRestore();
      if (previous === undefined) delete process.env.GITHITS_DEBUG;
      else process.env.GITHITS_DEBUG = previous;
    }
  });

  it("emits the code-navigation classification event with detail keys only", () => {
    const previous = process.env.GITHITS_DEBUG;
    process.env.GITHITS_DEBUG = "code-nav";
    const errorSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true,
    );

    try {
      const error = new CodeNavigationTargetNotFoundError(
        "caller query text",
        [],
        "https://github.com/example/repo",
        "main",
      );
      const mapped = mapCodeNavigationErrorForCli(error);

      expect(mapped.code).toBe("NOT_FOUND");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
      expect(payload).toMatchObject({
        area: "code-nav",
        event: "error-classified",
        code: "NOT_FOUND",
        errorName: "CodeNavigationTargetNotFoundError",
        detailKeys: ["repoUrl", "requestedRef"],
      });
      expect(payload).not.toHaveProperty("message");
      expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain(
        "caller query text",
      );
    } finally {
      errorSpy.mockRestore();
      if (previous === undefined) delete process.env.GITHITS_DEBUG;
      else process.env.GITHITS_DEBUG = previous;
    }
  });

  it("records the same event shape for a search payload", () => {
    const previous = process.env.GITHITS_DEBUG;
    process.env.GITHITS_DEBUG = "code-nav";
    const errorSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true,
    );

    try {
      recordCliErrorClassification("code-nav", "backend detail", {
        code: "BACKEND_ERROR",
        details: { graphqlCode: "UPSTREAM_ERROR" },
      });
      const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
      expect(payload).toMatchObject({
        area: "code-nav",
        event: "error-classified",
        code: "BACKEND_ERROR",
        errorName: "string",
        detailKeys: ["graphqlCode"],
      });
    } finally {
      errorSpy.mockRestore();
      if (previous === undefined) delete process.env.GITHITS_DEBUG;
      else process.env.GITHITS_DEBUG = previous;
    }
  });
});
