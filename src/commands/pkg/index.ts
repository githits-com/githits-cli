import type { Command } from "commander";
import {
  type GatedCommandGroupOptions,
  resolveGatedCommandGroupRegistrationState,
} from "../gated-command-group.js";
import { registerPkgChangelogCommand } from "./changelog.js";
import { registerPkgDepsCommand } from "./deps.js";
import { registerPkgInfoCommand } from "./info.js";
import { registerPkgVulnsCommand } from "./vulns.js";

export interface PkgCommandGroupOptions extends GatedCommandGroupOptions {}

/**
 * Registers the `pkg` command group.
 */
export async function registerPkgCommandGroup(
  program: Command,
  options: PkgCommandGroupOptions = {},
): Promise<void> {
  const registration = await resolveGatedCommandGroupRegistrationState(options);
  if (!registration.shouldRegister) {
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
