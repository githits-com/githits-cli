import { sanitizeTerminalText } from "@githits/mcp/internal";

/** Remove terminal controls while retaining Markdown line breaks and indentation. */
export function sanitizeTerminalMarkdown(value: string): string {
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
