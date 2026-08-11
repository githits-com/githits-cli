export const TERMS_ACCEPTANCE_REQUIRED_CODE = "TERMS_ACCEPTANCE_REQUIRED";
export const TERMS_URL = "https://githits.com/legal/terms-of-service/";
export const TERMS_ACCEPTANCE_URL = "https://app.githits.com/settings/privacy";

export interface TermsAcceptanceRemediation {
  termsUrl?: string;
  acceptanceUrl?: string;
}

/** Stable cross-transport signal that the current terms must be accepted. */
export class TermsAcceptanceRequiredError extends Error {
  readonly code: typeof TERMS_ACCEPTANCE_REQUIRED_CODE =
    TERMS_ACCEPTANCE_REQUIRED_CODE;
  readonly termsUrl: string;
  readonly acceptanceUrl: string;

  constructor(remediation: TermsAcceptanceRemediation = {}) {
    super(
      "Terms acceptance required. Run `githits settings terms accept`, then retry.",
    );
    this.name = "TermsAcceptanceRequiredError";
    this.termsUrl = remediation.termsUrl ?? TERMS_URL;
    this.acceptanceUrl = remediation.acceptanceUrl ?? TERMS_ACCEPTANCE_URL;
  }
}

/** Parse the canonical REST or GraphQL terms gate without trusting its message. */
export function createTermsAcceptanceError(
  payload: unknown,
): TermsAcceptanceRequiredError | undefined {
  const record = parseErrorRecord(payload);
  if (!record) return undefined;
  const contract =
    record.code === TERMS_ACCEPTANCE_REQUIRED_CODE
      ? record
      : firstGraphQLErrorExtensions(record);
  if (contract?.code !== TERMS_ACCEPTANCE_REQUIRED_CODE) return undefined;

  return new TermsAcceptanceRequiredError({
    termsUrl: stringField(contract, "terms_url"),
    acceptanceUrl: stringField(contract, "acceptance_url"),
  });
}

/** Apply the shared terms gate once before transport-specific error mapping. */
export function throwIfTermsAcceptanceRequired(payload: unknown): void {
  const error = createTermsAcceptanceError(payload);
  if (error) throw error;
}

function parseErrorRecord(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (typeof payload === "string") {
    try {
      return parseErrorRecord(JSON.parse(payload));
    } catch {
      return undefined;
    }
  }
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : undefined;
}

function firstGraphQLErrorExtensions(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const firstError = Array.isArray(record.errors)
    ? record.errors[0]
    : undefined;
  if (!firstError || typeof firstError !== "object") return undefined;
  const extensions = (firstError as Record<string, unknown>).extensions;
  return extensions && typeof extensions === "object"
    ? (extensions as Record<string, unknown>)
    : undefined;
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  return typeof record[field] === "string"
    ? (record[field] as string)
    : undefined;
}
