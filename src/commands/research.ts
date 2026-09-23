import {
  type AgenticAskCliResponse,
  type AgenticAskNeedsTargetResponse,
  type AgenticAskService,
  type AgenticAskUrlResponse,
  normalizeAgenticAskThreadId,
} from "@githits/core-internal";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  formatAgenticAskClarification,
  formatRepositoryTargetLabel,
  isRepositoryTargetSpec,
  LegacyRepositoryRefError,
  mapAgenticAskError,
  parseRepositoryTargetSpec,
  requireAuth,
  sanitizeTerminalText,
  shellQuote,
} from "@githits/mcp/internal";
import { type Command, InvalidArgumentError, Option } from "commander";
import { createContainer } from "../container.js";
import type { Spinner } from "../shared/spinner.js";
import { startSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface ResearchCommandOptions {
  thread?: string;
  json?: boolean;
  sourceFormat?: "cli" | "url";
}

export interface ResearchCommandDependencies {
  agenticAskService: AgenticAskService;
  hasValidToken: boolean;
  mcpUrl: string;
  signal?: AbortSignal;
  createSpinner?: () => Spinner;
}

// Positions are fixed by core-internal's cliSourceArgumentsSchema code tuple.
const CLI_CODE_SOURCE_KIND_INDEX = 1;
const CLI_CODE_SOURCE_TARGET_INDEX = 6;

export async function researchAction(
  target: string | undefined,
  question: string,
  options: ResearchCommandOptions,
  deps: ResearchCommandDependencies,
): Promise<void> {
  const subject = resolveResearchSubject(target, options.thread);
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
    deps.createSpinner?.() ??
    startSpinner(SPINNER_MESSAGES.research, !options.json);
  try {
    const requestOptions = deps.signal ? { signal: deps.signal } : undefined;
    const result =
      options.sourceFormat === "url"
        ? await deps.agenticAskService.ask(
            { ...subject, question, sourceFormat: "url" },
            requestOptions,
          )
        : await deps.agenticAskService.ask(
            { ...subject, question },
            requestOptions,
          );
    spinner.stop();
    const projected = projectAgenticAskCliSources(result);
    if (options.json) {
      console.log(JSON.stringify(projected));
    } else {
      process.stdout.write(formatAgenticAskHumanResponse(projected));
    }
  } catch (error) {
    spinner.stop();
    if (isCallerCancellation(error, deps.signal)) throw error;
    const failure = mapAgenticAskError(error);
    if (options.json) {
      console.error(
        JSON.stringify({
          ...buildCliMappedErrorPayload(failure.mapped),
          ...(failure.toolCallId ? { tool_call_id: failure.toolCallId } : {}),
          ...(failure.threadId ? { thread_id: failure.threadId } : {}),
        }),
      );
    } else {
      const diagnostic = formatMappedErrorForTerminal({
        ...failure.mapped,
        message: sanitizeTerminalText(failure.mapped.message),
      });
      const identifiers = [
        ...(failure.toolCallId
          ? [`Research run ID: ${failure.toolCallId}`]
          : []),
        ...(failure.threadId ? [`Thread ID: ${failure.threadId}`] : []),
      ];
      console.error([diagnostic, ...identifiers].join("\n"));
    }
    process.exit(1);
  }
}

/** Render the research answer, selected source pointers, and identifiers. */
export function formatAgenticAskHumanResponse(
  response:
    | AgenticAskCliResponse
    | AgenticAskUrlResponse
    | AgenticAskNeedsTargetResponse,
): string {
  if ("outcome" in response) {
    return formatAgenticAskClarification(response);
  }
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
  sections.push(
    `Research run ID: ${response.tool_call_id}\nThread ID: ${response.thread_id}\nUse this thread ID for follow-ups; name a new project or version in the question to change scope.`,
  );
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

/** Canonicalize typed code source targets while preserving docs and URL locators. */
export function projectAgenticAskCliSources(
  response:
    | AgenticAskCliResponse
    | AgenticAskUrlResponse
    | AgenticAskNeedsTargetResponse,
):
  | AgenticAskCliResponse
  | AgenticAskUrlResponse
  | AgenticAskNeedsTargetResponse {
  if ("outcome" in response || response.source_format === "url")
    return response;
  return {
    ...response,
    sources: response.sources.map((source) => {
      if (source.arguments[CLI_CODE_SOURCE_KIND_INDEX] === "code") {
        const args = [...source.arguments] as typeof source.arguments;
        args[CLI_CODE_SOURCE_TARGET_INDEX] =
          formatRepositoryTargetLabel(args[CLI_CODE_SOURCE_TARGET_INDEX]) ??
          args[CLI_CODE_SOURCE_TARGET_INDEX];
        return { ...source, arguments: args };
      }
      return source;
    }),
  };
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

function resolveResearchSubject(
  target: string | undefined,
  thread: string | undefined,
): { target?: string; threadId?: never } | { threadId: string } {
  if (target !== undefined && thread !== undefined) {
    throw new InvalidArgumentError(
      "Do not provide a target together with --thread.",
    );
  }
  if (target !== undefined) {
    if (isRepositoryTargetSpec(target)) {
      try {
        parseRepositoryTargetSpec(target);
      } catch (error) {
        if (error instanceof LegacyRepositoryRefError) {
          throw new InvalidArgumentError(error.message);
        }
      }
    }
    return { target };
  }
  if (thread === undefined) return {};

  const threadId = normalizeAgenticAskThreadId(thread);
  if (!threadId) {
    throw new InvalidArgumentError("--thread must be one valid thread UUID.");
  }
  return { threadId };
}

/** One positional is the question; two preserve the explicit-target form. */
export function resolveResearchCommandPositionals(
  targetOrQuestion: string | undefined,
  question: string | undefined,
  thread: string | undefined,
): { target: string | undefined; question: string } {
  const effectiveQuestion = question ?? targetOrQuestion;
  if (
    effectiveQuestion !== undefined &&
    effectiveQuestion.trim().length === 0
  ) {
    throw new InvalidArgumentError("Provide a non-empty question.");
  }

  if (thread !== undefined) {
    if (question !== undefined) {
      throw new InvalidArgumentError(
        "Do not provide a target together with --thread.",
      );
    }
    if (targetOrQuestion === undefined) {
      throw new InvalidArgumentError(
        "Provide a question to continue the thread.",
      );
    }
    return { target: undefined, question: targetOrQuestion };
  }

  if (targetOrQuestion === undefined) {
    throw new InvalidArgumentError(
      "Provide a question, optionally preceded by a target.",
    );
  }
  if (question === undefined) {
    return { target: undefined, question: targetOrQuestion };
  }
  return { target: targetOrQuestion, question };
}

/** Reject invalid research shapes before the root pre-action can start auto-login. */
export function validateResearchCommandBeforeAction(command: Command): void {
  if (command.name() !== "research") return;

  const [targetOrQuestion, question] = command.processedArgs as [
    string | undefined,
    string | undefined,
  ];
  const options = command.opts<ResearchCommandOptions>();
  const input = resolveResearchCommandPositionals(
    targetOrQuestion,
    question,
    options.thread,
  );
  resolveResearchSubject(input.target, options.thread);
}

const DESCRIPTION = `Research a public repository or package to answer a question with cited sources.

Omit the target to let GitHits infer one public repository or package from your
question. Quote multi-word questions. An explicit target keeps the search scoped.

Use a returned thread ID with --thread for follow-ups. Name a new project,
version, or topic in the question to change scope.`;

export function registerResearchCommand(program: Command): Command {
  return program
    .command("research")
    .alias("ask")
    .summary("Research a public repository or package to answer a question")
    .description(DESCRIPTION)
    .usage(
      "[options] [target] <question>\n       githits research --thread <UUID> <question>",
    )
    .argument(
      "[target-or-question]",
      "Question, or target when followed by a question",
    )
    .argument("[question]", "Question to answer from indexed public sources")
    .option(
      "--thread <UUID>",
      "Continue an existing research thread when a follow-up is needed",
    )
    .addOption(
      new Option(
        "--source-format <format>",
        "Source pointers: native CLI commands (default) or upstream URLs",
      ).choices(["cli", "url"]),
    )
    .option("--json", "Output the response as JSON")
    .action(
      async (
        targetOrQuestion: string | undefined,
        question: string | undefined,
        options: ResearchCommandOptions,
      ) => {
        const input = resolveResearchCommandPositionals(
          targetOrQuestion,
          question,
          options.thread,
        );
        const deps = await createContainer();
        await researchAction(input.target, input.question, options, {
          agenticAskService: deps.agenticAskService,
          hasValidToken: deps.hasValidToken,
          mcpUrl: deps.mcpUrl,
        });
      },
    );
}
