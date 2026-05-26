import { InvalidPackageSpecError } from "./package-spec.js";

/**
 * Parse an optional CLI integer string exactly. `parseInt` is deliberately
 * avoided because it silently accepts partial values such as `10abc`.
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
      `${name} expects an integer between ${min} and ${max}. Got ${parsed}.`,
    );
  }
  return parsed;
}
