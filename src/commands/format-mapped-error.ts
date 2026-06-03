import type { MappedError } from "../shared/code-navigation-error-map.js";

const CLI_AUTH_ERROR_MESSAGE =
  "Authentication required. Run `githits login` to authenticate.";

interface CliErrorPayload {
  error: string;
  code: string;
  retryable?: boolean;
  details?: MappedError["details"] | Record<string, unknown>;
}

export function formatMappedErrorForTerminal(mapped: MappedError): string {
  if (mapped.code === "AUTH_REQUIRED") {
    return CLI_AUTH_ERROR_MESSAGE;
  }
  if (mapped.code !== "UPDATE_REQUIRED") {
    return mapped.message;
  }
  const detail = mapped.details ?? {};
  const updateCommand =
    typeof detail.updateCommand === "string"
      ? detail.updateCommand
      : "npm i -g githits@latest";
  return [mapped.message, "", "Update with:", `  ${updateCommand}`].join("\n");
}

export function buildCliMappedErrorPayload(
  mapped: MappedError,
): CliErrorPayload {
  return {
    error: mapped.message,
    code: mapped.code,
    retryable: mapped.retryable ?? false,
    ...(mapped.details ? { details: mapped.details } : {}),
  };
}
