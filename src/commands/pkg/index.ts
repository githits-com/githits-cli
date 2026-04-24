import type { Command } from "commander";
import {
  type CodeNavigationCapability,
  getCodeNavigationUrl,
} from "../../services/index.js";
import { isCodeNavigationCliSurfaceOpen } from "../../shared/code-navigation-cli-surface.js";
import { registerPkgChangelogCommand } from "./changelog.js";
import { registerPkgDepsCommand } from "./deps.js";
import { registerPkgInfoCommand } from "./info.js";
import { registerPkgVulnsCommand } from "./vulns.js";

export interface PkgCommandGroupOptions {
  codeNavigationUrl?: string;
  overrideEnabled?: boolean;
  capability?: CodeNavigationCapability;
}

/**
 * Registers the `pkg` command group only when the package/source endpoint
 * is configured and the capability gate is open for the CLI surface.
 */
export async function registerPkgCommandGroup(
  program: Command,
  options: PkgCommandGroupOptions = {},
): Promise<void> {
  const codeNavigationUrl = options.codeNavigationUrl ?? getCodeNavigationUrl();
  if (!codeNavigationUrl) {
    return;
  }

  if (!isCodeNavigationCliSurfaceOpen(options)) {
    return;
  }

  const pkgCommand = program
    .command("pkg")
    .summary("Package metadata: info, vulnerabilities, dependencies, changelog")
    .description(
      "Inspect package metadata from npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, vcpkg, and Zig: overviews, advisories, dependency graphs, and changelogs. For source-level operations inside a dependency, use `githits code`.",
    );

  registerPkgInfoCommand(pkgCommand);
  registerPkgVulnsCommand(pkgCommand);
  registerPkgDepsCommand(pkgCommand);
  registerPkgChangelogCommand(pkgCommand);
}
