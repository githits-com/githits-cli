import {
  type AgenticAskService,
  normalizeAgenticAskThreadId,
} from "@githits/core-internal";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  extractAgenticAskDisplay,
  isRepositoryTargetSpec,
  LegacyRepositoryRefError,
  mapAgenticAskError,
  parseRepositoryTargetSpec,
  requireAuth,
  sanitizeTerminalText,
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
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      process.stdout.write(formatAgenticAskHumanResponse(result));
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
        details: {
          ...failure.mapped.details,
          ...(failure.mapped.details?.hint
            ? { hint: sanitizeTerminalText(failure.mapped.details.hint) }
            : {}),
        },
      });
      const identifiers = [
        ...(failure.toolCallId
          ? [`Research run ID: ${sanitizeTerminalText(failure.toolCallId)}`]
          : []),
        ...(failure.threadId
          ? [`Thread ID: ${sanitizeTerminalText(failure.threadId)}`]
          : []),
      ];
      console.error([diagnostic, ...identifiers].join("\n"));
    }
    process.exit(1);
  }
}

/** Print backend-owned Markdown through the terminal safety boundary. */
export function formatAgenticAskHumanResponse(response: unknown): string {
  return sanitizeTerminalMarkdown(extractAgenticAskDisplay(response));
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
