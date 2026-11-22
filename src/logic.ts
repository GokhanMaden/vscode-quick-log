// ---------------------------------------------------------------------------
// logic.ts
//
// Pure functions only — this file never imports `vscode`.
// That's deliberate: it lets us unit-test the "where should the log go?"
// logic with plain Node (`npm test`) without launching VS Code at all.
// extension.ts is just a thin adapter that feeds editor data into these.
// ---------------------------------------------------------------------------

/** Where the new console.log line should be inserted. */
export interface InsertionPoint {
  /** 0-based line index. The log goes on a NEW line right AFTER this one. */
  afterLine: number;
  /** Leading whitespace for the new line, so it matches the surrounding code. */
  indent: string;
}

/**
 * State that survives from one line to the next while scanning.
 * Block comments and template literals can span multiple lines, so a
 * line-by-line scanner must remember whether it's still "inside" one.
 */
interface ScanState {
  inBlockComment: boolean;
  inTemplate: boolean;
}

/** Result of scanning one line. */
interface ScannedLine {
  /**
   * The line with comments removed and every string replaced by `""`.
   * We only use this to look at the *shape* of the code (last char, etc.),
   * so the string contents don't matter — but a `(` inside a string must
   * not count as a real bracket. That's why we blank them out.
   */
  code: string;
  /** Net bracket change on this line: +1 per ( [ {, -1 per ) ] }. */
  delta: number;
}

/**
 * Scans a single line, tracking strings/comments so brackets inside them
 * are ignored.
 *
 * Known limitations (fine for a v1, mention them in the README):
 *  - Regex literals like /[(]/ are not detected, so their brackets count.
 *  - `${...}` inside template literals is skipped as plain text.
 *  - JSX text with an apostrophe (<p>Don't</p>) looks like an open string.
 */
function scanLine(line: string, state: ScanState): ScannedLine {
  let code = "";
  let delta = 0;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    // Inside /* ... */ — skip until we see the closing */
    if (state.inBlockComment) {
      if (ch === "*" && next === "/") {
        state.inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // Inside `...` — skip until the closing backtick (\` is an escape)
    if (state.inTemplate) {
      if (ch === "\\") {
        i += 2;
      } else if (ch === "`") {
        state.inTemplate = false;
        code += '""'; // placeholder so the "shape" still shows a value here
        i++;
      } else {
        i++;
      }
      continue;
    }

    // `//` comment — the rest of the line is irrelevant
    if (ch === "/" && next === "/") break;

    // Start of a block comment
    if (ch === "/" && next === "*") {
      state.inBlockComment = true;
      i += 2;
      continue;
    }

    // Single-line strings: "..." or '...'
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === "\\") j++; // skip the escaped character
        j++;
      }
      code += '""';
      i = j + 1;
      continue;
    }

    // Start of a template literal (may continue on the next lines)
    if (ch === "`") {
      state.inTemplate = true;
      i++;
      continue;
    }

    // Real code: count brackets
    if (ch === "(" || ch === "[" || ch === "{") delta++;
    else if (ch === ")" || ch === "]" || ch === "}") delta--;

    code += ch;
    i++;
  }

  return { code, delta };
}

/**
 * Does this line END in a way that means "the statement continues below"?
 *   const total = a +      <- yes, ends with an operator
 *   const fn = () =>       <- yes, arrow with body on next line
 *   count++                <- no! ++ / -- complete the expression
 */
function endsWithContinuation(code: string): boolean {
  const trimmed = code.trimEnd();
  if (trimmed === "") return false;
  if (/(\+\+|--)$/.test(trimmed)) return false;
  return /(=>|&&|\|\||\?\?|[+\-*/%=&|^?:,.])$/.test(trimmed);
}

/**
 * Does the NEXT line START in a way that continues the current statement?
 *   const user = getUser()
 *     .then(...)           <- yes, method chain
 *     ?.name               <- yes, optional chain
 *   ...spread              <- no, that's a spread, not a chain
 */
function startsWithContinuation(nextLine: string): boolean {
  const t = nextLine.trimStart();
  return /^(\?\.|\?\?|\.(?!\.\.)|\?|:|&&|\|\||[+*%]|\/(?![/*]))/.test(t);
}

/** Leading whitespace of a line. */
function getIndent(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? "";
}

/**
 * The "root" identifier of an expression: `user.profile.name` -> `user`,
 * `items[0]` -> `items`. Used to check whether the selection is the
 * variable being declared on this line.
 */
function rootIdentifier(expr: string): string {
  return /^[A-Za-z_$][\w$]*/.exec(expr.trim())?.[0] ?? "";
}

/**
 * Is `expr` the thing being DECLARED on this line?
 *   const gokhan = a + b;          (gokhan)  -> true
 *   const { name, age } = user;    (name)    -> true
 *   const total = gokhan + 1;      (gokhan)  -> false (it's on the right side)
 */
function isDeclaredOnLine(code: string, expr: string): boolean {
  const match = /^\s*(?:export\s+)?(?:const|let|var)\s+([^=]*)=/.exec(code);
  if (!match) return false;
  const root = rootIdentifier(expr);
  if (!root) return false;
  // \b doesn't treat $ as a word char, so build the boundary by hand
  const escaped = root.replace(/\$/g, "\\$");
  return new RegExp(`(^|[^\\w$])${escaped}($|[^\\w$])`).test(match[1]);
}

/**
 * Does this line open a block whose body we can log INTO?
 *   function save(user) {        -> yes
 *   items.map((item) => {        -> yes
 *   if (user) {   } else {       -> yes
 *   const config = {             -> no, that's an object literal
 *   switch (x) {                 -> no, only `case` may appear there
 *   class Foo {                  -> no, statements aren't allowed in a class body
 */
function opensFunctionOrBlock(code: string): boolean {
  const trimmed = code.trimEnd();
  if (!trimmed.endsWith("{")) return false;
  if (/^\s*(switch|class)\b/.test(trimmed)) return false;
  const beforeBrace = trimmed.slice(0, -1).trimEnd();
  return (
    beforeBrace.endsWith(")") ||
    beforeBrace.endsWith("=>") ||
    /\b(else|try|finally|do)$/.test(beforeBrace)
  );
}

/**
 * The core of the extension: given the file's lines and the line where the
 * selection is, decide where the console.log should go.
 *
 * Two cases:
 *  1. The selection is a parameter of a function/block that opens on this
 *     line (e.g. `item` in `items.map((item) => {`). Logging AFTER the whole
 *     block would be wrong — `item` doesn't exist there. So we log as the
 *     first line INSIDE the block, one indent level deeper.
 *  2. Everything else: walk down until the statement ends (brackets closed,
 *     no dangling operator, no `.chain` on the next line), then log after it
 *     with the same indent as the starting line.
 */
export function findInsertionPoint(
  lines: string[],
  startLine: number,
  expr: string,
  indentUnit: string
): InsertionPoint {
  const state: ScanState = { inBlockComment: false, inTemplate: false };
  const startIndent = getIndent(lines[startLine]);

  const first = scanLine(lines[startLine], state);
  let code = first.code;
  let depth = first.delta;

  // Case 1: log inside the block (but NOT for `const x = useMemo(() => {` —
  // there `x` is the declared variable and only exists after the statement).
  if (opensFunctionOrBlock(code) && !isDeclaredOnLine(code, expr)) {
    return { afterLine: startLine, indent: startIndent + indentUnit };
  }

  // Case 2: find the end of the statement.
  let line = startLine;
  while (line < lines.length - 1) {
    const stillOpen =
      depth > 0 || state.inTemplate || state.inBlockComment;
    const continues =
      endsWithContinuation(code) || startsWithContinuation(lines[line + 1]);

    if (!stillOpen && !continues) break;

    line++;
    const scanned = scanLine(lines[line], state);
    code = scanned.code;
    depth += scanned.delta;
  }

  return { afterLine: line, indent: startIndent };
}

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
