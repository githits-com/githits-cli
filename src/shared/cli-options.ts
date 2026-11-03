import { InvalidPackageSpecError } from "@githits/mcp/internal";

/**
 * Validate the complete CLI integer string before parsing so partial values
 * such as `10abc` are rejected.
 */
export function parseIntCliOption(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new InvalidPackageSpecError(
      `${name} expects an integer between ${min} and ${max}. Got '${raw}'.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < min || parsed > max) {
    throw new InvalidPackageSpecError(
      `${name} expects an integer between ${min} and ${max}. Got '${raw}'.`,
    );
  }
  return parsed;
}
