import type { Command } from "commander";
import { registerPkgChangelogCommand } from "./changelog.js";
import { registerPkgDepsCommand } from "./deps.js";
import { registerPkgInfoCommand } from "./info.js";
import { registerPkgUpgradeReviewCommand } from "./upgrade-review.js";
import { registerPkgVulnsCommand } from "./vulns.js";

/**
 * Registers the `pkg` command group.
 */
export async function registerPkgCommandGroup(program: Command): Promise<void> {
  const pkgCommand = program
    .command("pkg")
    .summary("Package metadata, dependencies, vulnerabilities and changelogs")
    .description(
      "Inspect package metadata from npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, Swift, vcpkg, and Zig: overviews, advisories, dependency graphs, and changelogs. Advisory data is unavailable for vcpkg and Zig. For source-level operations inside a dependency, use `githits code`.",
    );

  registerPkgInfoCommand(pkgCommand);
  registerPkgVulnsCommand(pkgCommand);
  registerPkgDepsCommand(pkgCommand);
  registerPkgChangelogCommand(pkgCommand);
  registerPkgUpgradeReviewCommand(pkgCommand);
}
