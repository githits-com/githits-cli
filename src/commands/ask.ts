import type {
  AgenticAskCliResponse,
  AgenticAskService,
  AgenticAskUrlResponse,
} from "@githits/core-internal";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  mapAgenticAskError,
  requireAuth,
  sanitizeTerminalText,
  shellQuote,
} from "@githits/mcp/internal";
import { type Command, Option } from "commander";
import { createContainer } from "../container.js";
import type { Spinner } from "../shared/spinner.js";
import { startSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface AskCommandOptions {
  json?: boolean;
  sourceFormat?: "cli" | "url";
}

export interface AskCommandDependencies {
  agenticAskService: AgenticAskService;
  hasValidToken: boolean;
  mcpUrl: string;
  signal?: AbortSignal;
  createSpinner?: () => Spinner;
}

export async function askAction(
  target: string,
  question: string,
  options: AskCommandOptions,
  deps: AskCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json && error instanceof AuthRequiredError) {
      console.error(JSON.stringify(buildAuthRequiredErrorPayload(error)));
      process.exit(1);
    }
    throw error;
  }

  const spinner =
    deps.createSpinner?.() ?? startSpinner(SPINNER_MESSAGES.ask, !options.json);
  try {
    const requestOptions = deps.signal ? { signal: deps.signal } : undefined;
    const result =
      options.sourceFormat === "url"
        ? await deps.agenticAskService.ask(
            { target, question, sourceFormat: "url" },
            requestOptions,
          )
        : await deps.agenticAskService.ask(
            { target, question },
            requestOptions,
          );
    spinner.stop();
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      process.stdout.write(formatAgenticAskHumanResponse(result));
    }
  } catch (error) {
    spinner.stop();
    if (isCallerCancellation(error, deps.signal)) throw error;
    const failure = mapAgenticAskErrorForCli(error);
    if (options.json) {
      console.error(
        JSON.stringify({
          ...buildCliMappedErrorPayload(failure.mapped),
          ...(failure.toolCallId ? { tool_call_id: failure.toolCallId } : {}),
        }),
      );
    } else {
      const diagnostic = formatMappedErrorForTerminal({
        ...failure.mapped,
        message: sanitizeTerminalText(failure.mapped.message),
      });
      console.error(
        failure.toolCallId
          ? `${diagnostic}\nAsk run ID: ${failure.toolCallId}`
          : diagnostic,
      );
    }
    process.exit(1);
  }
}

/** Render validated Ask markdown, selected source pointers, and replay ID. */
export function formatAgenticAskHumanResponse(
  response: AgenticAskCliResponse | AgenticAskUrlResponse,
): string {
  const sections = [sanitizeTerminalMarkdown(response.answer_markdown).trim()];
  if (response.sources.length > 0) {
    const sourceLines =
      response.source_format === "url"
        ? response.sources.map(
            (source, index) =>
              `  ${index + 1}. ${sanitizeTerminalText(source.url)}`,
          )
        : response.sources.map(
            (source, index) =>
              `  ${index + 1}. ${formatAgenticAskSourceCommand(source)}`,
          );
    sections.push(["Sources:", ...sourceLines].join("\n"));
  }
  sections.push(`Ask run ID: ${response.tool_call_id}`);
  return `${sections.join("\n\n")}\n`;
}

/** Format backend-provided argv without evaluating or locally translating it. */
export function formatAgenticAskSourceCommand(
  source: AgenticAskCliResponse["sources"][number],
): string {
  return [source.command, ...source.arguments]
    .map((argument) => quoteShellArgument(sanitizeTerminalText(argument)))
    .join(" ");
}

export function mapAgenticAskErrorForCli(error: unknown) {
  return mapAgenticAskError(error);
}

function sanitizeTerminalMarkdown(value: string): string {
  return value
    .split(/\r\n|\n|\r/)
    .map((line) =>
      line
        .split("\t")
        .map((segment) => sanitizeTerminalText(segment))
        .join("\t"),
    )
    .join("\n");
}

function quoteShellArgument(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : shellQuote(value);
}

function isCallerCancellation(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return Boolean(
    signal?.aborted &&
      (error === signal.reason ||
        (error instanceof Error && error.name === "AbortError")),
  );
}

const DESCRIPTION = `Ask a grounded question about one open-source package or repository.

The backend controls the prompt, model, budgets, and validation policy. The
response includes replayable source pointers and an Ask run ID for later review.`;

export function registerAskCommand(program: Command): Command {
  return program
    .command("ask")
    .summary("Ask a grounded question about one open-source target")
    .description(DESCRIPTION)
    .argument("<target>", "Canonical package or GitHub repository target")
    .argument("<question>", "Question to answer from indexed public sources")
    .addOption(
      new Option(
        "--source-format <format>",
        "Source pointers: native CLI commands (default) or upstream URLs",
      ).choices(["cli", "url"]),
    )
    .option("--json", "Output the validated backend response as JSON")
    .action(
      async (target: string, question: string, options: AskCommandOptions) => {
        const deps = await createContainer();
        await askAction(target, question, options, {
          agenticAskService: deps.agenticAskService,
          hasValidToken: deps.hasValidToken,
          mcpUrl: deps.mcpUrl,
        });
      },
    );
}
