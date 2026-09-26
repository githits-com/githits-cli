import {
  type CodeNavigationService,
  MalformedCodeNavigationResponseError,
  type ReadService,
} from "@githits/core-internal";

/** Adapt a unified reader to the existing code-read presentation seam. */
export function createReadFileServiceAdapter(
  readService: ReadService,
  target: string,
): Pick<CodeNavigationService, "readFile"> {
  return {
    readFile: async (params) => {
      // The parsed params.target drives presentation; transport keeps the compact target byte-for-byte.
      const response = await readService.read({
        target,
        path: params.filePath,
        startLine: params.startLine,
        endLine: params.endLine,
        waitTimeoutMs: params.waitTimeoutMs,
      });
      if (response.source !== "code") {
        throw new MalformedCodeNavigationResponseError(
          "Malformed response from code navigation service.",
        );
      }
      return response.result;
    },
  };
}
