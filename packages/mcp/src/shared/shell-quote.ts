export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Quote values for shells with ANSI-C quoting; callers must handle NUL separately. */
export function shellQuoteExact(value: string): string {
  if (hasShellControl(value)) {
    let escaped = "";
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (character === "\\") {
        escaped += "\\\\";
      } else if (character === "'") {
        escaped += "\\'";
      } else if (
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      ) {
        const bytes = codePoint <= 0x7f ? [codePoint] : [0xc2, codePoint];
        escaped += bytes
          .map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`)
          .join("");
      } else {
        escaped += character;
      }
    }
    return `$'${escaped}'`;
  }
  return shellQuote(value);
}

function hasShellControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}
