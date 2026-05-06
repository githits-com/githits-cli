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
      "The `solution_id` returned by a prior `get_example` call (shown on the trailing line of the markdown result, or under the `solution_id` key in JSON mode).",
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

const DESCRIPTION = `Submit feedback on a \`get_example\` result.

Call after \`get_example\` with the returned \`solution_id\`. \`accepted=true\` when the example solved the problem or was useful; \`accepted=false\` when it was irrelevant or wrong. Use \`feedback_text\` to add a short reason. Feeds ranking quality. Not for unified \`search\` hits — those have no \`solution_id\`.`;

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
