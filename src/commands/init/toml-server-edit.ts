import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "smol-toml";

interface Token {
  start: number;
  end: number;
  text: string;
  kind: "string" | "comment" | "newline" | "other";
}
interface Patch {
  start: number;
  end: number;
  text: string;
}
interface Entry {
  start: number;
  end: number;
  path: string[];
  comma?: Token;
}

/** Locate source spans only; smol-toml remains the semantic syntax validator. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < source.length; ) {
    const start = i;
    const char = source[i]!;
    if (char === " " || char === "\t" || char === "\r" || char === "\uFEFF") {
      i++;
      continue;
    }
    let kind: Token["kind"] = "other";
    if (char === "\n") {
      kind = "newline";
      i++;
    } else if (char === "#") {
      kind = "comment";
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
    } else if (char === '"' || char === "'") {
      kind = "string";
      const triple = source.slice(i, i + 3) === char.repeat(3);
      i += triple ? 3 : 1;
      while (i < source.length) {
        if (char === '"' && source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === char) {
          if (!triple) {
            i++;
            break;
          }
          let end = i;
          while (source[end] === char) end++;
          if (end - i >= 3) {
            i = end;
            break;
          }
          i = end;
        } else i++;
      }
    } else if ("[]=.,{}".includes(char)) i++;
    else {
      while (i < source.length && !/[\s#"'[\]=.,{}]/.test(source[i]!)) i++;
    }
    tokens.push({ start, end: i, text: source.slice(start, i), kind });
  }
  return tokens;
}

function keyPath(text: string): string[] {
  let value: unknown = parse(`${text} = 0`);
  const path: string[] = [];
  while (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    if (keys.length !== 1) throw new Error("Invalid TOML key path");
    const key = keys[0]!;
    path.push(key);
    value = (value as Record<string, unknown>)[key];
  }
  return path;
}

/** End of an assignment value, including nested containers and multiline strings. */
function valueEnd(tokens: Token[], start: number, inline = false): number {
  let depth = 0;
  let index = start;
  for (; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === "string" || (token.kind === "comment" && depth > 0))
      continue;
    if (
      depth === 0 &&
      ((!inline && (token.kind === "newline" || token.kind === "comment")) ||
        (inline && (token.text === "," || token.text === "}")))
    )
      break;
    if (token.text === "[" || token.text === "{") depth++;
    else if (token.text === "]" || token.text === "}") depth--;
  }
  return index;
}

function inlineValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineValue).join(", ")}]`;
  if (value && typeof value === "object")
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)} = ${inlineValue(item)}`)
      .join(", ")} }`;
  return stringify({ value })
    .trim()
    .replace(/^value\s*=\s*/, "");
}

function patchInlineServers(
  source: string,
  tokens: Token[],
  open: number,
  name: string,
  replacement: Record<string, unknown> | undefined,
): Patch[] {
  const entries: Entry[] = [];
  let index = open + 1;
  while (index < tokens.length && tokens[index]!.text !== "}") {
    if (
      tokens[index]!.kind === "newline" ||
      tokens[index]!.kind === "comment"
    ) {
      index++;
      continue;
    }
    const first = index;
    while (tokens[index]?.text !== "=") index++;
    const equals = index++;
    const end = valueEnd(tokens, index, true);
    const comma = tokens[end]?.text === "," ? tokens[end] : undefined;
    let last = end - 1;
    while (tokens[last]?.kind === "newline" || tokens[last]?.kind === "comment")
      last--;
    entries.push({
      start: tokens[first]!.start,
      end: tokens[last]!.end,
      path: keyPath(source.slice(tokens[first]!.start, tokens[equals]!.start)),
      comma,
    });
    index = end + (comma ? 1 : 0);
  }
  const selected = entries.map(
    (entry) => entry.path[0]?.toLowerCase() === name.toLowerCase(),
  );
  const first = selected.indexOf(true);
  const patches: Patch[] = [];
  if (replacement && first >= 0) {
    const entry = entries[first]!;
    patches.push({
      start: entry.start,
      end: entry.end,
      text: `${JSON.stringify(name)} = ${inlineValue(replacement)}`,
    });
    selected[first] = false;
  }
  for (let i = 0; i < entries.length; i++) {
    if (!selected[i]) continue;
    const start = i;
    while (selected[i + 1]) i++;
    const next = entries[i + 1];
    patches.push({
      start:
        !next && start > 0
          ? entries[start - 1]!.comma!.start
          : entries[start]!.start,
      end: entries[i]!.comma?.end ?? entries[i]!.end,
      text: "",
    });
  }
  if (replacement && first < 0)
    patches.push({
      start: tokens[index]!.start,
      end: tokens[index]!.start,
      text: `${entries.length && !entries.at(-1)!.comma ? ", " : ""}${JSON.stringify(name)} = ${inlineValue(replacement)}`,
    });
  return patches;
}

/** Edit all case-variant server entries without reserializing the surrounding TOML. */
export function editTomlServer(
  source: string,
  serversKey: string,
  serverName: string,
  replacement: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
): string {
  try {
    const normalized = source.replace(/^\uFEFF/, "");
    parse(normalized); // Reject malformed input before computing edits.
    const tokens = tokenize(source);
    const patches: Patch[] = [];
    let table: string[] = [];
    let inlineParent = false;
    const owns = (path: string[]): boolean =>
      path[0] === serversKey &&
      path[1]?.toLowerCase() === serverName.toLowerCase();
    for (let index = 0; index < tokens.length; ) {
      const token = tokens[index]!;
      if (token.kind === "newline" || token.kind === "comment") {
        index++;
        continue;
      }
      if (token.text === "[") {
        const array = tokens[index + 1]?.text === "[";
        const first = index + (array ? 2 : 1);
        let close = first;
        while (tokens[close]?.text !== "]") close++;
        table = keyPath(
          source.slice(tokens[first]!.start, tokens[close]!.start),
        );
        const end = close + (array ? 1 : 0);
        if (owns(table))
          patches.push({ start: token.start, end: tokens[end]!.end, text: "" });
        index = end + 1;
        continue;
      }
      const first = index;
      while (tokens[index]?.text !== "=") index++;
      const equals = index++;
      const path = [
        ...table,
        ...keyPath(source.slice(token.start, tokens[equals]!.start)),
      ];
      const end = valueEnd(tokens, index);
      if (owns(path))
        patches.push({
          start: tokens[first]!.start,
          end: tokens[end - 1]!.end,
          text: "",
        });
      else if (
        path.length === 1 &&
        path[0] === serversKey &&
        tokens[index]?.text === "{"
      ) {
        inlineParent = true;
        patches.push(
          ...patchInlineServers(source, tokens, index, serverName, replacement),
        );
      }
      index = end;
    }
    let content = source;
    for (const patch of patches.sort((a, b) => b.start - a.start))
      content =
        content.slice(0, patch.start) + patch.text + content.slice(patch.end);
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const append = (text: string): void => {
      content += `${content.length && !content.endsWith("\n") ? newline : ""}${text.replaceAll("\n", newline)}`;
    };
    if (replacement && !inlineParent)
      append(stringify({ [serversKey]: { [serverName]: replacement } }));
    if (!replacement && !(serversKey in parse(content.replace(/^\uFEFF/, ""))))
      append(`[${JSON.stringify(serversKey)}]\n`);
    // A span bug must fail before the atomic write; never fall back to whole-file serialization.
    if (!isDeepStrictEqual(parse(content.replace(/^\uFEFF/, "")), expected))
      throw new Error(
        "TOML server edit did not preserve configuration settings",
      );
    return content;
  } catch {
    throw new Error(
      "Cannot edit the GitHits TOML entry while preserving other settings. File left unchanged.",
    );
  }
}
