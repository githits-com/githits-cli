import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { withErrorHandling } from "./shared.js";
import { textResult, type ToolDefinition } from "./types.js";

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

const DESCRIPTION = `Submit feedback on a GitHits search result.

Use this tool after receiving a search result to indicate whether the example was helpful.
This feedback helps improve GitHits' search quality.

**When to use**:
- After using the search tool, provide feedback on whether the result was useful
- Use \`accepted=true\` if the example solved your problem or was helpful, and you used it
- Use \`accepted=false\` if the example was not relevant or unhelpful, and you did not use it
- Optionally provide textual feedback explaining why

Args:
    solution_id: The solution ID from a previous search result (shown in the result)
    accepted: True if the example was helpful/good, False if unhelpful/bad
    feedback_text: Optional text explaining why (e.g., "This solved problem X" or "Example was outdated")

Returns:
    Confirmation message or error`;

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
