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
  type MappedError,
  type McpProgressHook,
  mapAgenticAskError,
  parseRepositoryTargetSpec,
  parseUnifiedSearchTargetSpec,
  RESEARCH_VERIFIED_ANSWER_GUIDANCE,
  requireAuth,
  sanitizeTerminalText,
  shellQuoteExact,
} from "@githits/mcp/internal";
import { type Command, InvalidArgumentError, Option } from "commander";
import { createContainer } from "../container.js";
import {
  beginSpinnerProgress,
  createCommandProgress,
  openingResearchLabel,
} from "../shared/remote-progress.js";
import type { Spinner } from "../shared/spinner.js";
import { startNarrowingSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import { sanitizeTerminalMarkdown } from "../shared/terminal-markdown.js";
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
  /** Live backend progress for the interactive spinner. */
  progress?: McpProgressHook;
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
    startNarrowingSpinner(
      "target" in subject
        ? openingResearchLabel(subject.target)
        : SPINNER_MESSAGES.research[0],
      !options.json,
    );
  const progress = await beginSpinnerProgress(spinner, deps.progress);
  try {
    const requestOptions =
      deps.signal || progress
        ? {
            ...(deps.signal ? { signal: deps.signal } : {}),
            ...(progress ? { progress } : {}),
          }
        : undefined;
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
    progress?.end();
    spinner.stop();
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      process.stdout.write(formatAgenticAskHumanResponse(result));
    }
  } catch (error) {
    progress?.end();
    spinner.stop();
    if (isCallerCancellation(error, deps.signal)) throw error;
    const failure = mapAgenticAskError(error);
    const example = buildResearchDiscoveryExample(
      failure.mapped,
      "target" in subject ? subject.target : undefined,
    );
    if (options.json) {
      const payload = buildCliMappedErrorPayload(failure.mapped);
      console.error(
        JSON.stringify({
          ...payload,
          ...(example ? { details: { ...payload.details, example } } : {}),
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
      console.error(
        [
          diagnostic,
          ...(example ? [`Example: ${example}`] : []),
          ...identifiers,
        ].join("\n"),
      );
    }
    process.exit(1);
  }
}

/** Build a CLI search template; the target originates in argv and cannot contain NUL. */
export function buildResearchDiscoveryExample(
  mapped: MappedError,
  target: string | undefined,
): string | undefined {
  if (
    mapped.code !== "RATE_LIMITED" ||
    mapped.details?.rateLimitScope !== "daily" ||
    target === undefined
  ) {
    return undefined;
  }
  try {
    parseUnifiedSearchTargetSpec(target);
  } catch {
    return undefined;
  }
  return `githits search --in ${shellQuoteExact(target)} -- 'your query'`;
}

/** Print backend-owned Markdown through the terminal safety boundary. */
export function formatAgenticAskHumanResponse(response: unknown): string {
  return sanitizeTerminalMarkdown(extractAgenticAskDisplay(response));
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

const DESCRIPTION = `Answer a question about an open-source package or repository. Quote multi-word questions. ${RESEARCH_VERIFIED_ANSWER_GUIDANCE} Use direct reads/package commands when sufficient. Supply a package/repository target or omit it for identification; docs sites are unsupported.

If candidates return, retry with the matching project as target; never guess. Reuse \`--thread\` and state scope changes. Respect retry delays and daily resets. After failure, use a direct lookup for a specific gap.`;

export function registerResearchCommand(program: Command): Command {
  return program
    .command("research")
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
        "Source pointers: CLI read commands (default) or upstream URLs",
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
        const deps = await createContainer({
          openProviderRecovery:
            !options.json &&
            Boolean(process.stdin.isTTY && process.stdout.isTTY),
        });
        const progress = options.json ? undefined : createCommandProgress(deps);
        try {
          await researchAction(input.target, input.question, options, {
            agenticAskService: deps.agenticAskService,
            hasValidToken: deps.hasValidToken,
            mcpUrl: deps.mcpUrl,
            progress,
          });
        } finally {
          // An open progress socket must not keep the process alive.
          progress?.close();
        }
      },
    );
}
