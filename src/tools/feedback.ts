import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface FeedbackArgs {
  solution_id?: string;
  accepted: boolean;
  feedback_text?: string;
  tool_name?: string;
}

const schema = {
  solution_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional. Pass the `solution_id` from a prior `get_example` response (shown on the trailing line of the markdown result, or under the `solution_id` key in JSON mode) to anchor feedback to that specific result. Omit for generic feedback about any tool (code/package navigation, search, docs) or the overall experience.",
    ),
  accepted: z
    .boolean()
    .describe(
      "True for positive feedback (helpful/good), False for negative (unhelpful/bad). Always required.",
    ),
  feedback_text: z
    .string()
    .optional()
    .describe(
      'Optional context (e.g., "This solved problem X" or "code_grep regex over npm:lodash missed Foo function"). Strongly recommended when `solution_id` is omitted, since there is no specific result to anchor to.',
    ),
  tool_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional name of the GitHits tool or CLI command that produced the result being rated.",
    ),
};

const DESCRIPTION = `Use after a GitHits result was helpful, unhelpful, wrong, incomplete, slow, or confusing. Submit feedback on a tool result or the GitHits experience.

Two modes:
1. **Solution-tied** — pass the \`solution_id\` from a prior \`get_example\` response to rate that specific result.
2. **Generic** — omit \`solution_id\` to send session feedback about any tool (\`search\`, \`code_grep\`, \`code_read\`, \`code_files\`, \`docs_*\`, \`pkg_*\`) or the overall experience.

\`accepted\` is always required (true = positive, false = negative). Add \`feedback_text\` for context — strongly recommended in generic mode. Pass \`tool_name\` when rating a specific tool result. Feeds ranking and product quality.`;

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
          toolName: args.tool_name,
        });
        return textResult(result.message);
      });
    },
  };
}
