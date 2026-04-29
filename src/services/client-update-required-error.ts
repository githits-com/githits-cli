import { version } from "../../package.json";

export const CLIENT_UPDATE_REQUIRED_REASON = "Backend protocol changed";

export class ClientUpdateRequiredError extends Error {
  constructor(
    message = `Update required: ${CLIENT_UPDATE_REQUIRED_REASON}`,
    public readonly reason = CLIENT_UPDATE_REQUIRED_REASON,
    public readonly currentVersion = version,
  ) {
    super(message);
    this.name = "ClientUpdateRequiredError";
  }
}

export function isClientUpdateRequiredGraphQLError(input: {
  message: string;
  code?: string;
}): boolean {
  if (input.code === "CLIENT_UPDATE_REQUIRED") {
    return true;
  }

  const message = input.message;
  if (!isGraphQLSchemaMismatchMessage(message)) {
    return false;
  }

  return (
    !input.code ||
    input.code === "GRAPHQL_VALIDATION_FAILED" ||
    input.code === "BAD_USER_INPUT"
  );
}

function isGraphQLSchemaMismatchMessage(message: string): boolean {
  return /Cannot query field|Field .* does not exist|Unknown argument|Unknown type|Unknown field/i.test(
    message,
  );
}
