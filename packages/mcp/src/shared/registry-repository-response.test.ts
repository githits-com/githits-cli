import { describe, expect, it } from "bun:test";
import type {
  PackageVersionIdentity,
  RegistryRepository,
} from "@githits/core-internal";
import { defaultPackageSummary } from "../services/test-helpers.js";
import {
  buildPackageDependenciesSuccessPayload,
  formatPackageDependenciesTerminal,
} from "./package-dependencies-response.js";
import {
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
} from "./package-summary-response.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
} from "./package-vulnerabilities-response.js";

const repositories: Array<RegistryRepository | undefined> = [
  {
    id: "maven:google",
    name: "Google Maven",
    url: "https://dl.google.com/dl/android/maven2",
  },
  {
    id: "maven:central",
    name: "Maven Central",
    url: "https://repo1.maven.org/maven2",
  },
  {
    id: "future:regional",
    name: "Regional registry",
    url: "https://registry.example/artifacts",
  },
  undefined,
];

describe("registry repository presentation", () => {
  for (const registryRepository of repositories) {
    it(`adds only the pkg info row and JSON descriptor: ${registryRepository?.id ?? "unknown"}`, () => {
      const summary = structuredClone(defaultPackageSummary);
      summary.package.registryRepository = registryRepository;
      const json = buildPackageSummarySuccessPayload(summary);
      const original = buildPackageSummarySuccessPayload(defaultPackageSummary);
      const { registryRepository: projected, ...unchanged } = json;
      expect(projected).toEqual(registryRepository);
      expect(unchanged).toEqual(original);

      const text = formatPackageSummaryTerminal(summary, { useColors: false });
      if (registryRepository) {
        expect(text).toMatch(/^Repository[^\n]*\nPackage registry\s+/m);
        expect(text).toContain(registryRepository.name);
        expect(text).toContain(registryRepository.url);
      } else {
        expect(text).not.toContain("Package registry");
        expect("registryRepository" in json).toBe(false);
      }
      expect(text).toContain("https://github.com/expressjs/express");
      expect(text).toContain("Native history:");
      const colored = formatPackageSummaryTerminal(summary, {
        useColors: true,
      });
      if (registryRepository)
        expect(colored).toContain(`\x1b[36m${registryRepository.url}\x1b[0m`);
    });

    it(`preserves shared identities in deps/vulns JSON: ${registryRepository?.id ?? "unknown"}`, () => {
      const identity: PackageVersionIdentity = {
        name: "sample:library",
        registry: "MAVEN",
        version: "2.2",
        registryRepository,
      };
      const report = { package: identity };
      const withoutProvenance = {
        package: { ...identity, registryRepository: undefined },
      };
      for (const payload of [
        buildPackageDependenciesSuccessPayload(report),
        buildPackageVulnerabilitiesSuccessPayload(report),
      ]) {
        expect(payload.registryRepository).toEqual(registryRepository);
        if (!registryRepository)
          expect("registryRepository" in payload).toBe(false);
      }
      expect(formatPackageDependenciesTerminal(report)).toBe(
        formatPackageDependenciesTerminal(withoutProvenance),
      );
      expect(formatPackageVulnerabilitiesTerminal(report)).toBe(
        formatPackageVulnerabilitiesTerminal(withoutProvenance),
      );
    });
  }
});
