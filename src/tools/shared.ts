import { errorResult, type ToolResult } from "./types.js";

/**
 * Wraps a tool handler with standard error handling.
 */
export async function withErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T | ToolResult> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to ${operation}: ${message}`);
  }
}
