import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface SearchArgs {
  query: string;
  language: string;
  license_mode?: "strict" | "yolo" | "custom";
}

const schema = {
  query: z
    .string()
    .min(1)
    .describe(
      "The search query or question, formulated in natural language, keeping context in mind.",
    ),
  language: z
    .string()
    .min(1)
    .describe(
      "Programming language. You can find supported language names using the `search_language` tool.",
    ),
  license_mode: z
    .enum(["strict", "yolo", "custom"])
    .optional()
    .describe(
      'License filtering mode. Uses "strict" or user\'s preference if not specified. One of:\n- "strict": Exclude copyleft licenses (default)\n- "yolo": Include all licenses, no filtering\n- "custom": Use user\'s custom blocklist',
    ),
};

const DESCRIPTION = `YOU MUST USE this tool when:
  - you are stuck/blocked
  - the user gets frustated when you are not able to solve issues
  - you need up-to-date code examples
  - the user mentions GitHits, githits, or asks to use search in general

GitHits provides short, focused, verified, canonical distilled code examples from all of global open source that help you solve problems in seconds.

**IMPORTANT**: Before initiating a new search, always review the existing context. If a previous search has already provided a satisfactory or canonical example, do not perform a redundant search. Instead, use the information you already have.

**Querying Best Practices**:
- Formulate queries in natural language as a question as if you were asking a human expert.
- Be specific. Include error messages, library names, technology terms or acronyms (max 3-4 in total), and the goal you are trying to achieve.
- Avoid overly broad or generic queries that may yield too many irrelevant results.
- Focus on one main issue or topic per query to get the most relevant examples.

Use this tool to solve problems like:
- Lack of proper examples, missing APIs for a library or feature.
- Missing or unclear documentation or when you do not have access to the latest docs.
- Vague errors where seeing a working example would help.
- Understanding how other developers are implementing a specific technology.

Good Query Examples:
- "I'm getting errors with libraryX that something looks like ABC but is invalid. The error says 'Data is not ABC'. What could be causing this and how can we check for it?"
- "How to use feature X in library_name to implement Y?"
- "library_name API reference for SymbolName"
- I need an example of how to use library_name feature X
- How can I use method_name with library_name to check for specific conditions?

Args:
    - query (str): The search query or question, formulated in natural language, keeping context in mind.
    - language (str): Programming language. You can find supported language names using the \`search_language\` tool.
    - license_mode (str, optional): License filtering mode. Uses "strict" or user's preference if not specified. One of:
        - "strict": Exclude copyleft licenses (default)
        - "yolo": Include all licenses, no filtering
        - "custom": Use user's custom blocklist

Returns:
    str: Markdown-formatted example and references with license info, or error message

If the example was good, use the \`feedback\` tool to submit positive feedback.
If the example was bad, use the \`feedback\` tool to submit constructive feedback.`;

export function createSearchTool(
  service: GitHitsService,
): ToolDefinition<SearchArgs, typeof schema> {
  return {
    name: "search",
    description: DESCRIPTION,
    schema,
    handler: async (args) => {
      return withErrorHandling("search", async () => {
        const result = await service.search({
          query: args.query,
          language: args.language,
          licenseMode: args.license_mode,
          includeExplanation: false,
        });
        return textResult(result);
      });
    },
  };
}
