import { describe, expect, it } from "bun:test";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "./package-intelligence-service.js";
import { promoteGenericVersionNotFound } from "./promote-version-not-found.js";

const params = {
  registry: "NPM" as const,
  packageName: "lodash",
  version: "99.99.99",
};

describe("promoteGenericVersionNotFound", () => {
  it("promotes a generic backend error with matching message when graphqlCode is absent and version is set", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    const promoted = promoteGenericVersionNotFound(generic, params);
    expect(promoted).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
    const typed = promoted as PackageIntelligenceVersionNotFoundError;
    expect(typed.packageName).toBe("npm:lodash");
    expect(typed.requestedVersion).toBe("99.99.99");
    expect(typed.availableVersions).toBeUndefined();
    expect(typed.message).toBe("No matching version found");
  });

  it("does not promote when graphqlCode is present (backend sent real signal)", () => {
    const internal = new PackageIntelligenceBackendError(
      "no matching version table while the cluster was recovering",
      undefined,
      "INTERNAL_ERROR",
    );
    expect(promoteGenericVersionNotFound(internal, params)).toBe(internal);
  });

  it("does not promote when caller asked for latest (no version in params)", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    expect(
      promoteGenericVersionNotFound(generic, { ...params, version: undefined }),
    ).toBe(generic);
  });

  it("does not promote when message does not match the /no matching version/i pattern", () => {
    const generic = new PackageIntelligenceBackendError(
      "Backend is briefly offline",
    );
    expect(promoteGenericVersionNotFound(generic, params)).toBe(generic);
  });

  it("does not promote a non-BackendError", () => {
    const notFound = new PackageIntelligenceTargetNotFoundError(
      "package not found",
    );
    expect(promoteGenericVersionNotFound(notFound, params)).toBe(notFound);
  });

  it("lowercases the registry prefix when qualifying details.package", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    const promoted = promoteGenericVersionNotFound(generic, {
      registry: "CRATES",
      packageName: "serde",
      version: "0.99.0",
    }) as PackageIntelligenceVersionNotFoundError;
    expect(promoted.packageName).toBe("crates:serde");
  });

  it("matches the phrase case-insensitively", () => {
    const generic = new PackageIntelligenceBackendError(
      "no matching VERSION found",
    );
    expect(promoteGenericVersionNotFound(generic, params)).toBeInstanceOf(
      PackageIntelligenceVersionNotFoundError,
    );
  });

  it("promotes when fromVersion is set (range-mode callers)", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    const promoted = promoteGenericVersionNotFound(generic, {
      registry: "NPM",
      packageName: "lodash",
      fromVersion: "4.0.0",
    }) as PackageIntelligenceVersionNotFoundError;
    expect(promoted).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
    expect(promoted.packageName).toBe("npm:lodash");
    expect(promoted.requestedVersion).toBe("4.0.0");
  });

  it("prefers fromVersion over toVersion when both are set", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    const promoted = promoteGenericVersionNotFound(generic, {
      registry: "NPM",
      packageName: "lodash",
      fromVersion: "3.0.0",
      toVersion: "4.0.0",
    }) as PackageIntelligenceVersionNotFoundError;
    expect(promoted.requestedVersion).toBe("3.0.0");
  });

  it("promotes when only toVersion is set (latest-mode cap)", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    const promoted = promoteGenericVersionNotFound(generic, {
      registry: "NPM",
      packageName: "lodash",
      toVersion: "99.0.0",
    }) as PackageIntelligenceVersionNotFoundError;
    expect(promoted.requestedVersion).toBe("99.0.0");
  });

  it("does not promote when no version field is set (unconstrained request)", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    expect(
      promoteGenericVersionNotFound(generic, {
        registry: "NPM",
        packageName: "lodash",
      }),
    ).toBe(generic);
  });

  it("omits details.package in repo-URL mode (no registry / packageName)", () => {
    const generic = new PackageIntelligenceBackendError(
      "No matching version found",
    );
    const promoted = promoteGenericVersionNotFound(generic, {
      fromVersion: "1.0.0",
    }) as PackageIntelligenceVersionNotFoundError;
    expect(promoted).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
    expect(promoted.packageName).toBeUndefined();
    expect(promoted.requestedVersion).toBe("1.0.0");
  });
});
