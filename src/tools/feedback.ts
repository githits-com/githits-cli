import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface FeedbackArgs {
  solution_id: string;
  accepted: boolean;
  feedback_text?: string;
}

const schema = {
  solution_id: z
    .string()
    .min(1)
    .describe(
      "The solution ID from a previous search result (shown in the result)",
    ),
  accepted: z
    .boolean()
    .describe("True if the example was helpful/good, False if unhelpful/bad"),
  feedback_text: z
    .string()
    .optional()
    .describe(
      'Optional text explaining why (e.g., "This solved problem X" or "Example was outdated")',
    ),
};

const DESCRIPTION = `Submit feedback on a GitHits example result.

Call after \`get_example\` to record whether the returned example was used. \`accepted=true\` when it solved the problem or was useful; \`accepted=false\` when it was irrelevant or wrong. Use \`feedback_text\` to add a short reason. Feeds back into ranking quality.`;

export function createFeedbackTool(
  service: GitHitsService,
): ToolDefinition<FeedbackArgs, typeof schema> {
  return {
    name: "feedback",
    description: DESCRIPTION,
    schema,
    handler: async (args) => {
      return withErrorHandling("submit feedback", async () => {
        const result = await service.submitFeedback({
          solutionId: args.solution_id,
          accepted: args.accepted,
          feedbackText: args.feedback_text,
        });
        return textResult(result.message);
      });
    },
  };
}
