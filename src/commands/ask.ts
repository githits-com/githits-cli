import {
  type AgenticAskCliResponse,
  AgenticAskConnectionError,
  AgenticAskHttpError,
  AgenticAskRequestTimeoutError,
  AgenticAskResponseTooLargeError,
  type AgenticAskService,
  AuthenticationError,
  MalformedAgenticAskResponseError,
} from "@githits/core-internal";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  type MappedError,
  mapTermsAcceptanceError,
  requireAuth,
  sanitizeTerminalText,
  shellQuote,
} from "@githits/mcp/internal";
import type { Command } from "commander";
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
}

export interface AskCommandDependencies {
  agenticAskService: AgenticAskService;
  hasValidToken: boolean;
  mcpUrl: string;
  signal?: AbortSignal;
  createSpinner?: () => Spinner;
}

interface AskCliError {
  mapped: MappedError;
  toolCallId?: string;
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
    const result = await deps.agenticAskService.ask(
      { target, question },
      deps.signal ? { signal: deps.signal } : undefined,
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

/** Render validated Ask markdown and directly executable source commands. */
export function formatAgenticAskHumanResponse(
  response: AgenticAskCliResponse,
): string {
  const sections = [sanitizeTerminalMarkdown(response.answer_markdown).trim()];
  if (response.sources.length > 0) {
    sections.push(
      [
        "Sources:",
        ...response.sources.map(
          (source, index) =>
            `  ${index + 1}. ${formatAgenticAskSourceCommand(source)}`,
        ),
      ].join("\n"),
    );
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

export function mapAgenticAskErrorForCli(error: unknown): AskCliError {
  const termsError = mapTermsAcceptanceError(error);
  if (termsError) return { mapped: termsError };

  if (error instanceof AgenticAskHttpError) {
    const details = {
      status: error.status,
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      ...(error.code === "AUTH_REQUIRED"
        ? { authSource: "server" as const }
        : {}),
    };
    return {
      mapped: {
        code: mapHttpErrorCode(error),
        message: error.message,
        retryable: error.retryable,
        details,
      },
      toolCallId: error.toolCallId,
    };
  }
  if (error instanceof AuthenticationError) {
    return {
      mapped: {
        code: "AUTH_REQUIRED",
        message: error.message,
        retryable: false,
        details: { authSource: error.source },
      },
    };
  }
  if (error instanceof AgenticAskRequestTimeoutError) {
    return {
      mapped: {
        code: "TIMEOUT",
        message: error.message,
        retryable: true,
        details: { timeoutMs: error.timeoutMs },
      },
    };
  }
  if (error instanceof AgenticAskConnectionError) {
    return {
      mapped: { code: "NETWORK", message: error.message, retryable: true },
    };
  }
  if (
    error instanceof MalformedAgenticAskResponseError ||
    error instanceof AgenticAskResponseTooLargeError
  ) {
    return {
      mapped: {
        code: "PROTOCOL_ERROR",
        message: error.message,
        retryable: false,
      },
    };
  }
  return {
    mapped: {
      code: "UNKNOWN",
      message: "Agentic Ask failed unexpectedly.",
      retryable: false,
    },
  };
}

function mapHttpErrorCode(error: AgenticAskHttpError): MappedError["code"] {
  switch (error.code) {
    case "INVALID_TARGET":
    case "INVALID_REQUEST":
      return "INVALID_ARGUMENT";
    case "AUTH_REQUIRED":
      return "AUTH_REQUIRED";
    case "ACCESS_DENIED":
      return "ACCESS_DENIED";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "EXECUTION_FAILED":
    case "SERVICE_UNAVAILABLE":
    case "HTTP_ERROR":
      return "BACKEND_ERROR";
  }
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
response includes replayable source commands and an Ask run ID for later review.`;

export function registerAskCommand(program: Command): Command {
  return program
    .command("ask")
    .summary("Ask a grounded question about one open-source target")
    .description(DESCRIPTION)
    .argument("<target>", "Canonical package or GitHub repository target")
    .argument("<question>", "Question to answer from indexed public sources")
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
