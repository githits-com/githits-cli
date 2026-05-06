import { type Command, Option } from "commander";
import { createContainer } from "../container.js";
import type { GitHitsService } from "../services/githits-service.js";
import { AuthRequiredError, requireAuth } from "../shared/require-auth.js";

export interface FeedbackOptions {
  accept?: boolean;
  reject?: boolean;
  message?: string;
  json?: boolean;
}

export interface FeedbackDependencies {
  githitsService: GitHitsService;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core feedback logic, separated for testability.
 *
 * `solutionId` is optional: when present, feedback is anchored to a
 * specific `get_example` result; when omitted, the feedback is
 * generic (covers code/package navigation, search, docs, or the
 * overall experience).
 */
export async function feedbackAction(
  solutionId: string | undefined,
  options: FeedbackOptions,
  deps: FeedbackDependencies,
): Promise<void> {
  requireAuth(deps);

  if (!options.accept && !options.reject) {
    console.error("Error: Specify either --accept or --reject.");
    process.exit(1);
  }

  const accepted = !!options.accept;

  try {
    const result = await deps.githitsService.submitFeedback({
      solutionId,
      accepted,
      feedbackText: options.message,
    });

    if (options.json) {
      console.log(
        JSON.stringify({ success: result.success, message: result.message }),
      );
    } else {
      console.log(result.message);
    }
  } catch (error) {
    console.error(
      `Failed to submit feedback: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}

const FEEDBACK_DESCRIPTION = `Submit feedback on a tool result or the GitHits experience.

Two modes:
  - Solution-tied: pass the [solution_id] from a prior 'githits example'
    result (shown at the bottom of the markdown / under 'solution_id'
    in --json) to anchor feedback to that specific result.
  - Generic: omit [solution_id] to send feedback about any command
    (search, pkg, docs, code) or the overall experience. A --message
    is strongly recommended here.

Use --accept for positive feedback or --reject for negative.

Examples:
  githits feedback abc123 --accept
  githits feedback abc123 --reject -m "Example was outdated"
  githits feedback --accept -m "code_grep regex is fast on npm:lodash"
  githits feedback --reject -m "search missing kotlin support"`;

/**
 * Register the feedback command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerFeedbackCommand(program: Command) {
  program
    .command("feedback")
    .summary("Submit feedback on a tool result or the GitHits experience")
    .description(FEEDBACK_DESCRIPTION)
    .argument(
      "[solution_id]",
      "Solution ID from a prior 'githits example' result (omit for generic feedback)",
    )
    .addOption(new Option("--accept", "Mark as helpful").conflicts("reject"))
    .addOption(new Option("--reject", "Mark as unhelpful").conflicts("accept"))
    .option("-m, --message <text>", "Feedback explanation")
    .option("--json", "Output as JSON for piping")
    .action(
      async (solutionId: string | undefined, options: FeedbackOptions) => {
        try {
          const deps = await createContainer();
          await feedbackAction(solutionId, options, deps);
        } catch (error) {
          if (error instanceof AuthRequiredError) process.exit(1);
          throw error;
        }
      },
    );
}
