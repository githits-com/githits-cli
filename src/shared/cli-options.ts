import { InvalidPackageSpecError } from "@githits/mcp/internal";
import { InvalidArgumentError } from "commander";

const MIN_PORT = 1;
const MAX_PORT = 65535;

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

/** Parse a callback-server port without accepting partial numeric strings. */
export function parsePortCliOption(raw: string): number {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new InvalidArgumentError(
      `Port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
    );
  }

  const port = Number(normalized);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new InvalidArgumentError(
      `Port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
    );
  }
  return port;
}
