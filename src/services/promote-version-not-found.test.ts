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
});
