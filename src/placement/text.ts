// ---------------------------------------------------------------------------
// placement/text.ts — tiny helpers for working with offsets in a string.
// ---------------------------------------------------------------------------

/** Offset of the first character of the line that contains `offset`. */
export function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

/**
 * Offset of the end of the line that contains `offset` — i.e. where the
 * line break starts (handles both \n and \r\n), or the end of the file.
 */
export function lineEnd(source: string, offset: number): number {
  const nl = source.indexOf("\n", offset);
  if (nl === -1) return source.length;
  return source[nl - 1] === "\r" ? nl - 1 : nl;
}

/** Leading whitespace of the line that contains `offset`. */
export function indentAt(source: string, offset: number): string {
  const start = lineStart(source, offset);
  return /^[ \t]*/.exec(source.slice(start))?.[0] ?? "";
}

/** Is everything between the start of the line and `offset` whitespace? */
export function startsLine(source: string, offset: number): boolean {
  return source.slice(lineStart(source, offset), offset).trim() === "";
}

/**
 * The code after `offset` up to the end of its line, without a trailing
 * `// comment`. Used to check e.g. whether `{` is followed by more code.
 * (Only strips `//` — good enough for "is there code after the brace?".)
 */
export function restOfLineCode(source: string, offset: number): string {
  const rest = source.slice(offset, lineEnd(source, offset));
  const comment = rest.indexOf("//");
  return (comment === -1 ? rest : rest.slice(0, comment)).trim();
}
