import type { MappedError } from "@githits/mcp/internal";

const CLI_AUTH_ERROR_MESSAGE =
  "Authentication required. Run `githits login` to authenticate.";
const CLI_LOCAL_AUTH_REMEDIATION =
  "Run `githits login` to authenticate or set GITHITS_API_TOKEN.";
const CLI_SERVER_AUTH_REMEDIATION =
  "Re-authenticate with `githits login` or update GITHITS_API_TOKEN if set. If this persists, contact support@githits.com.";

interface CliErrorPayload {
  error: string;
  code: string;
  retryable?: boolean;
  details?: MappedError["details"] | Record<string, unknown>;
}

export function formatMappedErrorForTerminal(mapped: MappedError): string {
  if (mapped.code === "AUTH_REQUIRED") {
    if (
      mapped.message === "Authentication required." &&
      mapped.details?.authSource === undefined
    ) {
      return CLI_AUTH_ERROR_MESSAGE;
    }
    return `${mapped.message} ${authRemediation(mapped)}`;
  }
  if (mapped.code === "RATE_LIMITED") {
    if (mapped.retryable !== true || hasRetryGuidance(mapped.message)) {
      return mapped.message;
    }
    const retryAfterSeconds = mapped.details?.retryAfterSeconds;
    if (
      typeof retryAfterSeconds === "number" &&
      Number.isFinite(retryAfterSeconds) &&
      retryAfterSeconds > 0
    ) {
      const seconds = Math.ceil(retryAfterSeconds);
      const unit = seconds === 1 ? "second" : "seconds";
      return `${mapped.message} Try again in ${seconds} ${unit}.`;
    }
    return `${mapped.message} Try again shortly.`;
  }
  if (mapped.code === "TIMEOUT") {
    if (mapped.retryable !== true || hasRetryGuidance(mapped.message)) {
      return mapped.message;
    }
    return `${mapped.message} Try again.`;
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

function hasRetryGuidance(message: string): boolean {
  return /\b(?:retry|try again)\b/i.test(message);
}

function authRemediation(mapped: MappedError): string {
  return mapped.details?.authSource === "server"
    ? CLI_SERVER_AUTH_REMEDIATION
    : CLI_LOCAL_AUTH_REMEDIATION;
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

export function formatCliMappedError(
  mapped: MappedError,
  json: boolean,
): string {
  return json
    ? JSON.stringify(buildCliMappedErrorPayload(mapped))
    : formatMappedErrorForTerminal(mapped);
}
