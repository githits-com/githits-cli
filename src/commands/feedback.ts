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
 */
export async function feedbackAction(
  solutionId: string,
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

const FEEDBACK_DESCRIPTION = `Submit feedback on a search result.

Rate whether a code example was helpful. Use --accept for positive
feedback or --reject for negative. Optionally add a message.

Examples:
  githits feedback abc123 --accept
  githits feedback abc123 --reject -m "Example was outdated"
  githits feedback abc123 --accept --message "Solved my problem" --json`;

/**
 * Register the feedback command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerFeedbackCommand(program: Command) {
  program
    .command("feedback")
    .summary("Submit feedback on a search result")
    .description(FEEDBACK_DESCRIPTION)
    .argument("<solution_id>", "Solution ID from search result")
    .addOption(new Option("--accept", "Mark as helpful").conflicts("reject"))
    .addOption(new Option("--reject", "Mark as unhelpful").conflicts("accept"))
    .option("-m, --message <text>", "Feedback explanation")
    .option("--json", "Output as JSON for piping")
    .action(async (solutionId: string, options: FeedbackOptions) => {
      try {
        const deps = await createContainer();
        await feedbackAction(solutionId, options, deps);
      } catch (error) {
        if (error instanceof AuthRequiredError) process.exit(1);
        throw error;
      }
    });
}
