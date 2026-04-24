import type { Command } from "commander";
import { resolveStartupCodeNavigationRegistrationState } from "../../container.js";
import {
  type CodeNavigationCapability,
  getCodeNavigationUrl,
  isCodeNavigationCliOverrideEnabled,
} from "../../services/index.js";
import { registerPkgChangelogCommand } from "./changelog.js";
import { registerPkgDepsCommand } from "./deps.js";
import { registerPkgInfoCommand } from "./info.js";
import { registerPkgVulnsCommand } from "./vulns.js";

export interface PkgCommandGroupOptions {
  codeNavigationUrl?: string;
  overrideEnabled?: boolean;
  capability?: CodeNavigationCapability;
  expiredStoredAuth?: boolean;
}

/**
 * Registers the capability-gated `pkg` command group. Structurally
 * mirrors `registerCodeCommandGroup`:
 *
 * 1. URL early-exit — if the pkgseer endpoint isn't configured (no
 *    `GITHITS_CODE_NAV_URL`, no sensible default), skip registration
 *    entirely.
 * 2. Capability gate — register only when the token advertises
 *    `code_navigation`, or when `GITHITS_CODE_NAVIGATION=1` is set
 *    for local development. Direct command invocation also keeps the
 *    expired-stored-auth fallback so a refreshable session can reach
 *    the token refresh path before capability is re-evaluated.
 *
 * The capability check is intentionally duplicated with
 * `registerCodeCommandGroup` rather than factored out — two tiny
 * sites today, extract only once a third group arrives.
 */
export async function registerPkgCommandGroup(
  program: Command,
  options: PkgCommandGroupOptions = {},
): Promise<void> {
  const codeNavigationUrl = options.codeNavigationUrl ?? getCodeNavigationUrl();
  if (!codeNavigationUrl) {
    return;
  }

  const overrideEnabled =
    options.overrideEnabled ?? isCodeNavigationCliOverrideEnabled();
  const registrationState =
    options.capability !== undefined || options.expiredStoredAuth !== undefined
      ? {
          capability: options.capability ?? "unknown",
          expiredStoredAuth: options.expiredStoredAuth ?? false,
        }
      : await resolveStartupCodeNavigationRegistrationState();

  if (
    !overrideEnabled &&
    registrationState.capability !== "enabled" &&
    !registrationState.expiredStoredAuth
  ) {
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
