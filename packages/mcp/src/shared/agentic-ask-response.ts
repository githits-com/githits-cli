import { MalformedAgenticAskResponseError } from "@githits/core-internal";

/** Read the sole text primitive; JSON callers bypass display extraction entirely. */
export function extractAgenticAskDisplay(response: unknown): string {
  if (
    typeof response !== "object" ||
    response === null ||
    !("display_markdown" in response) ||
    typeof response.display_markdown !== "string"
  ) {
    throw new MalformedAgenticAskResponseError();
  }
  return response.display_markdown;
}
