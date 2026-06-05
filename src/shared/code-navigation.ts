import type {
  FileIntent,
  SymbolCategory,
  SymbolKind,
} from "@githits/core-internal";
import {
  type PkgseerRegistryArg,
  toPkgseerRegistry,
} from "@githits/core-internal";

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
} as const satisfies Record<string, SymbolKind>;

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
} as const satisfies Record<string, FileIntent>;

export type FileIntentArg = keyof typeof fileIntentMap;

/**
 * Back-compat alias for {@link PkgseerRegistryArg}. The registry map
 * now lives in `pkgseer-registry.ts` as single source of truth; this
 * re-export keeps existing call-sites working without churn.
 */
export type CodeNavigationRegistryArg = PkgseerRegistryArg;

/**
 * Back-compat alias for {@link toPkgseerRegistry}.
 */
export function toCodeNavigationRegistry(registry: CodeNavigationRegistryArg) {
  return toPkgseerRegistry(registry);
}

export function toSymbolKind(kind: string | undefined): SymbolKind | undefined {
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

export function toFileIntent(
  intent: string | undefined,
): FileIntent | undefined {
  return intent
    ? fileIntentMap[intent as keyof typeof fileIntentMap]
    : undefined;
}

export function isKnownFileIntent(value: string): value is FileIntentArg {
  return value in fileIntentMap;
}

export function knownFileIntentList(): ReadonlyArray<FileIntentArg> {
  return Object.keys(fileIntentMap) as FileIntentArg[];
}
