import type {
  CodeNavigationRegistry,
  SearchSymbolsFileIntent,
  SearchSymbolsKind,
  SearchSymbolsMatchMode,
  SymbolCategory,
} from "../services/index.js";

const registryMap = {
  npm: "NPM",
  pypi: "PYPI",
  hex: "HEX",
  crates: "CRATES",
  nuget: "NUGET",
  maven: "MAVEN",
  zig: "ZIG",
  vcpkg: "VCPKG",
  packagist: "PACKAGIST",
} as const satisfies Record<string, CodeNavigationRegistry>;

/**
 * Lowercase user-facing kind values → the backend's uppercase
 * symbol-kind enum. Callers should prefer the broader
 * `symbolCategoryMap`; this enumeration exists for the "I know
 * the precise construct" use case.
 */
const symbolKindMap = {
  function: "FUNCTION",
  method: "METHOD",
  constructor: "CONSTRUCTOR",
  getter: "GETTER",
  setter: "SETTER",
  operator: "OPERATOR",
  class: "CLASS",
  interface: "INTERFACE",
  trait: "TRAIT",
  struct: "STRUCT",
  enum: "ENUM",
  record: "RECORD",
  protocol: "PROTOCOL",
  extension: "EXTENSION",
  delegate: "DELEGATE",
  mixin: "MIXIN",
  actor: "ACTOR",
  annotation: "ANNOTATION",
  type: "TYPE",
  module: "MODULE",
  namespace: "NAMESPACE",
  package: "PACKAGE",
  object: "OBJECT",
  field: "FIELD",
  property: "PROPERTY",
  event: "EVENT",
  constant: "CONSTANT",
  doc_section: "DOC_SECTION",
} as const satisfies Record<string, SearchSymbolsKind>;

/**
 * Lowercase user-facing category values → the backend's uppercase
 * category enum. Preferred over enumerating individual kinds.
 */
const symbolCategoryMap = {
  callable: "CALLABLE",
  type: "TYPE",
  module: "MODULE",
  data: "DATA",
  documentation: "DOCUMENTATION",
} as const satisfies Record<string, SymbolCategory>;

const fileIntentMap = {
  production: "PRODUCTION",
  test: "TEST",
  benchmark: "BENCHMARK",
  example: "EXAMPLE",
  generated: "GENERATED",
  fixture: "FIXTURE",
  build: "BUILD",
  vendor: "VENDOR",
} as const satisfies Record<string, SearchSymbolsFileIntent>;

const matchModeMap = {
  or: "OR",
  and: "AND",
} as const satisfies Record<string, SearchSymbolsMatchMode>;

export type CodeNavigationRegistryArg = keyof typeof registryMap;

export function toCodeNavigationRegistry(
  registry: CodeNavigationRegistryArg,
): CodeNavigationRegistry {
  return registryMap[registry];
}

export function toSearchSymbolsMatchMode(
  mode: string | undefined,
): SearchSymbolsMatchMode | undefined {
  return mode ? matchModeMap[mode as keyof typeof matchModeMap] : undefined;
}

export function toSearchSymbolsKind(
  kind: string | undefined,
): SearchSymbolsKind | undefined {
  return kind ? symbolKindMap[kind as keyof typeof symbolKindMap] : undefined;
}

export type SymbolCategoryArg = keyof typeof symbolCategoryMap;

export function toSymbolCategory(
  category: string | undefined,
): SymbolCategory | undefined {
  return category
    ? symbolCategoryMap[category as keyof typeof symbolCategoryMap]
    : undefined;
}

export function isKnownSymbolKind(value: string): value is SymbolCategoryArg {
  return value in symbolKindMap;
}

export function knownSymbolKindList(): ReadonlyArray<string> {
  return Object.keys(symbolKindMap);
}

export function knownSymbolCategoryList(): ReadonlyArray<string> {
  return Object.keys(symbolCategoryMap);
}

export function toSearchSymbolsFileIntent(
  intent: string | undefined,
): SearchSymbolsFileIntent | undefined {
  return intent
    ? fileIntentMap[intent as keyof typeof fileIntentMap]
    : undefined;
}
