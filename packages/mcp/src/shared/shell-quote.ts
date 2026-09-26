export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Quote a value exactly for shells such as Bash and Zsh that support ANSI-C quoting. */
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
        escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`;
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
