/**
 * Known package registries supported by code navigation targets.
 */
export const KNOWN_REGISTRIES = [
  "npm",
  "pypi",
  "hex",
  "crates",
  "nuget",
  "maven",
  "zig",
  "vcpkg",
  "packagist",
] as const;

export type KnownRegistry = (typeof KNOWN_REGISTRIES)[number];

/**
 * Parsed package specification with optional version suffix.
 */
export interface ParsedPackageSpec {
  registry: KnownRegistry;
  name: string;
  version?: string;
  registryExplicit: boolean;
}

/**
 * Raised when the caller prefixes the package spec with a string that
 * looks like a registry (contains a `:`) but is not one of
 * `KNOWN_REGISTRIES`. Without this guard the parser used to silently
 * fall back to npm, leaving the user with a confusing "package not
 * found" error on a completely different registry than they intended.
 */
export class UnsupportedRegistryError extends Error {
  constructor(public readonly attempted: string) {
    super(
      `Unsupported registry "${attempted}". Supported: ${KNOWN_REGISTRIES.join(", ")}.`,
    );
    this.name = "UnsupportedRegistryError";
  }
}

/**
 * Raised when the spec is syntactically malformed (empty name,
 * trailing `@` with no version, etc.).
 */
export class InvalidPackageSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPackageSpecError";
  }
}

/**
 * Raised by surface-level callers for any other caller-input
 * validation failure (bad option value, missing required args, etc.).
 * Name begins with `Invalid` so the shared classifier maps it to
 * `INVALID_ARGUMENT` — so CLI parser errors round-trip through the
 * same envelope as server-side invalid inputs.
 *
 * Lives in `package-spec.ts` for import locality (same module as
 * `InvalidPackageSpecError`); may move to its own file if the set
 * of invalid-argument flavours grows.
 */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgumentError";
  }
}

/**
 * Parse a user-provided package spec in the form
 * `<registry>:<name>[@<version>]`.
 *
 * Rules:
 * - The registry prefix is optional; omitting it defaults to `npm`.
 * - If a prefix is present, it must be a known registry — otherwise
 *   `UnsupportedRegistryError` is thrown. The previous behaviour of
 *   treating `foobar:baz` as an npm package literally named
 *   `foobar:baz` was a footgun.
 * - Scoped npm names (`@types/node`) are preserved unchanged; the
 *   leading `@` is not interpreted as a version delimiter.
 * - `@<version>` is optional and parsed from the last `@` in the
 *   remaining name. Trailing `@` with no version is rejected.
 */
export function parsePackageSpec(spec: string): ParsedPackageSpec {
  if (!spec || spec.trim() === "") {
    throw new InvalidPackageSpecError(
      "Package spec cannot be empty. Expected <registry>:<name>[@<version>].",
    );
  }

  let registry: KnownRegistry = "npm";
  let registryExplicit = false;
  let rest = spec;

  if (spec.includes(":")) {
    const colonIndex = spec.indexOf(":");
    const potentialRegistry = spec.slice(0, colonIndex).toLowerCase();
    if (isKnownRegistry(potentialRegistry)) {
      registry = potentialRegistry;
      registryExplicit = true;
      rest = spec.slice(colonIndex + 1);
    } else {
      throw new UnsupportedRegistryError(potentialRegistry);
    }
  }

  const atIndex = rest.lastIndexOf("@");
  if (atIndex > 0) {
    const name = rest.slice(0, atIndex);
    const version = rest.slice(atIndex + 1);
    if (version === "") {
      throw new InvalidPackageSpecError(
        `Package spec "${spec}" has a trailing "@" with no version. Omit the "@" or add a version.`,
      );
    }
    if (name === "") {
      throw new InvalidPackageSpecError(
        `Package spec "${spec}" has a version but no name.`,
      );
    }
    return { registry, registryExplicit, name, version };
  }

  if (rest === "") {
    throw new InvalidPackageSpecError(
      `Package spec "${spec}" is missing a package name after the registry prefix.`,
    );
  }

  return { registry, registryExplicit, name: rest };
}

/**
 * Narrows a string to a known registry.
 */
export function isKnownRegistry(value: string): value is KnownRegistry {
  return KNOWN_REGISTRIES.includes(value as KnownRegistry);
}
