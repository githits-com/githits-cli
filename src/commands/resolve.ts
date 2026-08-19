import {
  PKGSEER_REGISTRY_LIST,
  type ResolveTargetService,
} from "@githits/core-internal";
import {
  buildResolveTargetParams,
  buildResolveTargetSuccessPayload,
  formatResolveTargetTerminal,
  InvalidPackageSpecError,
  mapPackageIntelligenceError,
  RESOLVE_TARGET_DEFAULT_LIMIT,
  RESOLVE_TARGET_MAX_LIMIT,
  requireAuth,
  sanitizeTerminalText,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import { parseIntCliOption } from "../shared/cli-options.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface ResolveCommandOptions {
  query?: string;
  registry?: string;
  preferKind?: string;
  intentHint?: string[];
  limit?: string;
  json?: boolean;
}

export interface ResolveCommandDependencies {
  resolveTargetService: ResolveTargetService;
  hasValidToken: boolean;
  mcpUrl: string;
}

export async function resolveAction(
  name: string,
  options: ResolveCommandOptions,
  deps: ResolveCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handleResolveError(error, true);
    throw error;
  }

  try {
    const params = buildCliResolveTargetParams({
      name,
      query: options.query,
      registry: options.registry,
      preferKind: options.preferKind,
      intentHints: options.intentHint,
      limit: parseIntCliOption(
        options.limit,
        "--limit",
        1,
        RESOLVE_TARGET_MAX_LIMIT,
      ),
      includeDetailedFields: options.json === true,
    });
    const result = await deps.resolveTargetService.resolveTarget(params);

    if (options.json) {
      console.log(JSON.stringify(buildResolveTargetSuccessPayload(result)));
    } else {
      process.stdout.write(
        formatResolveTargetTerminal(result, {
          name: params.name,
          query: params.query,
          useColors: shouldUseColors(),
        }),
      );
    }
    if (!result.best) process.exitCode = 1;
  } catch (error) {
    handleResolveError(error, options.json === true);
  }
}

function buildCliResolveTargetParams(
  input: Parameters<typeof buildResolveTargetParams>[0],
): ReturnType<typeof buildResolveTargetParams> {
  try {
    return buildResolveTargetParams(input);
  } catch (error) {
    if (!(error instanceof InvalidPackageSpecError)) throw error;
    const rewritten = error.message.replace(
      /^Preferred kind/,
      "`--prefer-kind`",
    );
    if (rewritten === error.message) throw error;
    throw new InvalidPackageSpecError(rewritten);
  }
}

function handleResolveError(error: unknown, json: boolean): never {
  const mapped = mapPackageIntelligenceError(error);
  // Package-intelligence mappings never set `details.hint`, and their update
  // command is local. Sanitize any new terminal-visible mapped text here too.
  console.error(
    json
      ? JSON.stringify(buildCliMappedErrorPayload(mapped))
      : formatMappedErrorForTerminal({
          ...mapped,
          message: sanitizeTerminalText(mapped.message),
        }),
  );
  process.exit(1);
}

function collectIntentHint(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const DESCRIPTION = `Resolve a human-provided name to ranked package or GitHub repository targets.

The optional --query and --intent-hint values are sent to the service as ranking
context. Do not include credentials, personal data, private code, or proprietary
content in either option.`;

export function registerResolveCommand(program: Command): Command {
  return program
    .command("resolve")
    .summary("Resolve a package or GitHub repository name")
    .description(DESCRIPTION)
    .argument("<name>", "Package or GitHub repository name")
    .option("-q, --query <text>", "Task context used as a soft ranking hint")
    .option(
      "--registry <list>",
      `Comma-separated package registries: ${PKGSEER_REGISTRY_LIST}`,
    )
    .option("--prefer-kind <kind>", "Soft preference: package or repository")
    .option(
      "--intent-hint <text>",
      "Soft intent hint (repeatable)",
      collectIntentHint,
    )
    .option(
      "-n, --limit <n>",
      `Ranked candidates (1-${RESOLVE_TARGET_MAX_LIMIT}, default ${RESOLVE_TARGET_DEFAULT_LIMIT}); protected exact matches may be additional`,
    )
    .option("--json", "Emit structured diagnostic JSON")
    .action(async (name: string, options: ResolveCommandOptions) => {
      const deps = await createContainer();
      await resolveAction(name, options, {
        resolveTargetService: deps.resolveTargetService,
        hasValidToken: deps.hasValidToken,
        mcpUrl: deps.mcpUrl,
      });
    });
}
