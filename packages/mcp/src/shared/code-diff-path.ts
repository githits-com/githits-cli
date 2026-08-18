/** Quote a UTF-8 path using Git's reversible double-quoted path syntax. */
export function quoteGitPath(path: string): string {
  let quoted = false;
  let output = "";

  for (const character of path) {
    const codePoint = character.codePointAt(0);
    if (character === '"' || character === "\\") {
      quoted = true;
      output += `\\${character}`;
      continue;
    }
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      quoted = true;
      for (const byte of new TextEncoder().encode(character)) {
        output += `\\${byte.toString(8).padStart(3, "0")}`;
      }
      continue;
    }
    output += character;
  }

  return quoted ? `"${output}"` : output;
}
