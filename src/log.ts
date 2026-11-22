// ---------------------------------------------------------------------------
// log.ts — WHAT we insert (the console.log text). WHERE it goes lives in
// placement/. Pure, no `vscode` import.
// ---------------------------------------------------------------------------

/**
 * Builds the log statement itself:
 *   gokhan        -> console.log("gokhan:", gokhan)
 *   obj["key"]    -> console.log("obj[\"key\"]:", obj["key"])
 * Multi-line selections are collapsed to one line so the result stays valid.
 */
export function buildLogStatement(expr: string): string {
  const oneLine = expr.trim().replace(/\s+/g, " ");
  const label = oneLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `console.log("${label}:", ${oneLine})`;
}

/**
 * Words we should never log on their own — if the cursor sits on `const`
 * we'd otherwise produce `console.log("const:", const)`, which is invalid.
 */
const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "let",
  "new", "null", "return", "super", "switch", "throw", "true",
  "try", "typeof", "var", "void", "while", "with", "yield", "async",
  "await", "interface", "type", "enum", "implements", "private",
  "protected", "public", "readonly", "static", "undefined",
]);

export function isLoggableWord(word: string): boolean {
  return word.length > 0 && !RESERVED.has(word);
}
