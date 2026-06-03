import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ClientUpdateRequiredError } from "../services/client-update-required-error.js";
import { AuthenticationError } from "../services/githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceBackendError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceGraphQLError,
  PackageIntelligenceNetworkError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceValidationError,
  PackageIntelligenceVersionNotFoundError,
} from "../services/package-intelligence-service.js";
import { mapPackageIntelligenceError } from "./package-intelligence-error-map.js";

describe("mapPackageIntelligenceError", () => {
  it("maps ClientUpdateRequiredError to UPDATE_REQUIRED", () => {
    const mapped = mapPackageIntelligenceError(
      new ClientUpdateRequiredError(undefined, undefined, "0.2.0"),
    );

    expect(mapped).toEqual({
      code: "UPDATE_REQUIRED",
      message: "Update required: Backend protocol changed",
      retryable: false,
      details: {
        currentVersion: "0.2.0",
        reason: "Backend protocol changed",
        updateCommand: "npm i -g githits@latest",
      },
    });
  });

  it("maps PackageIntelligenceTargetNotFoundError to NOT_FOUND", () => {
    const mapped = mapPackageIntelligenceError(
      new PackageIntelligenceTargetNotFoundError("Package not found"),
    );
    expect(mapped.code).toBe("NOT_FOUND");
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toBe("Package not found");
  });

  it("maps PackageIntelligenceVersionNotFoundError to VERSION_NOT_FOUND with structured details", () => {
    const mapped = mapPackageIntelligenceError(
      new PackageIntelligenceVersionNotFoundError(
        "Version not found",
        "npm:express",
        "99.0.0",
        ["4.18.2", "4.18.1", "4.17.4"],
      ),
    );
    expect(mapped.code).toBe("VERSION_NOT_FOUND");
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toBe("Version not found");
    expect(mapped.details?.package).toBe("npm:express");
    expect(mapped.details?.requestedVersion).toBe("99.0.0");
    expect(mapped.details?.availableVersions).toEqual([
      { version: "4.18.2", ref: "4.18.2" },
      { version: "4.18.1", ref: "4.18.1" },
      { version: "4.17.4", ref: "4.17.4" },
    ]);
  });

  it("maps PackageIntelligenceVersionNotFoundError with empty extensions (backend not wired)", () => {
    const mapped = mapPackageIntelligenceError(
      new PackageIntelligenceVersionNotFoundError(
        "Version not found",
        undefined,
        undefined,
        undefined,
      ),
    );
    expect(mapped.code).toBe("VERSION_NOT_FOUND");
    expect(mapped.details).toBeUndefined();
  });

  it("maps PackageIntelligenceValidationError to INVALID_ARGUMENT", () => {
    const mapped = mapPackageIntelligenceError(
      new PackageIntelligenceValidationError("Bad input"),
    );
    expect(mapped.code).toBe("INVALID_ARGUMENT");
    expect(mapped.retryable).toBe(false);
  });

  it("maps PackageIntelligenceAccessError and FeatureFlagRequiredError to ACCESS_DENIED", () => {
    expect(
      mapPackageIntelligenceError(new PackageIntelligenceAccessError("denied"))
        .code,
    ).toBe("ACCESS_DENIED");
    expect(
      mapPackageIntelligenceError(
        new PackageIntelligenceFeatureFlagRequiredError("flag missing"),
      ).code,
    ).toBe("ACCESS_DENIED");
  });

  it("maps AuthenticationError to AUTH_REQUIRED", () => {
    expect(
      mapPackageIntelligenceError(new AuthenticationError("login required")),
    ).toEqual({
      code: "AUTH_REQUIRED",
      message: "login required",
      retryable: false,
      details: { authSource: "local" },
    });
  });

  it("preserves server auth rejection source", () => {
    expect(
      mapPackageIntelligenceError(
        new AuthenticationError("token rejected", "server"),
      ),
    ).toEqual({
      code: "AUTH_REQUIRED",
      message: "token rejected",
      retryable: false,
      details: { authSource: "server" },
    });
  });

  it("maps PackageIntelligenceNetworkError to NETWORK (retryable)", () => {
    const mapped = mapPackageIntelligenceError(
      new PackageIntelligenceNetworkError("offline"),
    );
    expect(mapped.code).toBe("NETWORK");
    expect(mapped.retryable).toBe(true);
  });

  it("maps MalformedPackageIntelligenceResponseError to PROTOCOL_ERROR", () => {
    const mapped = mapPackageIntelligenceError(
      new MalformedPackageIntelligenceResponseError("bad shape"),
    );
    expect(mapped.code).toBe("PROTOCOL_ERROR");
    expect(mapped.retryable).toBe(false);
  });

  it("dispatches PackageIntelligenceBackendError by graphqlCode", () => {
    const timeout = mapPackageIntelligenceError(
      new PackageIntelligenceBackendError("timed out", 504, "TIMEOUT"),
    );
    expect(timeout.code).toBe("TIMEOUT");
    expect(timeout.retryable).toBe(true);

    const rateLimited = mapPackageIntelligenceError(
      new PackageIntelligenceBackendError("too many", 429, "RATE_LIMITED"),
    );
    expect(rateLimited.code).toBe("RATE_LIMITED");
    expect(rateLimited.retryable).toBe(true);

    const upstream = mapPackageIntelligenceError(
      new PackageIntelligenceBackendError("bad gateway", 502, "UPSTREAM_ERROR"),
    );
    expect(upstream.code).toBe("BACKEND_ERROR");
    expect(upstream.retryable).toBe(true);

    const internal = mapPackageIntelligenceError(
      new PackageIntelligenceBackendError("oops", 500, "INTERNAL_ERROR"),
    );
    expect(internal.code).toBe("BACKEND_ERROR");
    expect(internal.retryable).toBe(false);
  });

  it("respects backend-provided retryable override on PackageIntelligenceBackendError", () => {
    const mapped = mapPackageIntelligenceError(
      new PackageIntelligenceBackendError(
        "custom",
        500,
        "INTERNAL_ERROR",
        true,
      ),
    );
    expect(mapped.retryable).toBe(true);
  });

  it("maps legacy PackageIntelligenceGraphQLError to BACKEND_ERROR", () => {
    const mapped = mapPackageIntelligenceError(
      new PackageIntelligenceGraphQLError("legacy", "SOME_CODE"),
    );
    expect(mapped.code).toBe("BACKEND_ERROR");
    expect(mapped.details?.graphqlCode).toBe("SOME_CODE");
  });

  it("maps name-prefixed Invalid*/Unsupported* errors to INVALID_ARGUMENT", () => {
    class InvalidPackageSpecError extends Error {
      constructor() {
        super("bad spec");
        this.name = "InvalidPackageSpecError";
      }
    }
    class UnsupportedRegistryError extends Error {
      constructor() {
        super("bad registry");
        this.name = "UnsupportedRegistryError";
      }
    }
    expect(
      mapPackageIntelligenceError(new InvalidPackageSpecError()).code,
    ).toBe("INVALID_ARGUMENT");
    expect(
      mapPackageIntelligenceError(new UnsupportedRegistryError()).code,
    ).toBe("INVALID_ARGUMENT");
  });

  it("falls through to UNKNOWN only for truly unrecognised errors", () => {
    const mapped = mapPackageIntelligenceError(new Error("mystery"));
    expect(mapped.code).toBe("UNKNOWN");
  });

  it("handles non-Error thrown values", () => {
    const mapped = mapPackageIntelligenceError("raw string");
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.message).toBe("Unknown error");
  });
});

describe("mapPackageIntelligenceError — debug emissions", () => {
  let originalDebug: string | undefined;
  let stderrLines: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalDebug = process.env.GITHITS_DEBUG;
    process.env.GITHITS_DEBUG = "pkg-intel";
    stderrLines = [];
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    if (originalDebug === undefined) {
      delete process.env.GITHITS_DEBUG;
    } else {
      process.env.GITHITS_DEBUG = originalDebug;
    }
  });

  it("emits a single pkg-intel line with only PII-safe keys", () => {
    mapPackageIntelligenceError(
      new PackageIntelligenceTargetNotFoundError("Package not found"),
    );

    const combined = stderrLines.join("");
    expect(combined).toContain('"area":"pkg-intel"');
    expect(combined).toContain('"event":"error-classified"');
    expect(combined).toContain('"code":"NOT_FOUND"');
    expect(combined).toContain(
      '"errorName":"PackageIntelligenceTargetNotFoundError"',
    );
    // Must not carry message text
    expect(combined).not.toContain("Package not found");
  });
});
