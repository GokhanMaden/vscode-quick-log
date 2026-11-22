// ---------------------------------------------------------------------------
// extension.ts
//
// Entry point VS Code loads. Its only job is to translate between the editor
// (selections, document, edits) and the pure logic in logic.ts.
// ---------------------------------------------------------------------------
import * as vscode from "vscode";
import { buildLogStatement, findInsertionPoint, isLoggableWord } from "./logic";

// What counts as a "word" when nothing is selected. VS Code's default word
// pattern doesn't include `$`, which is valid in JS identifiers ($state, $el).
const IDENTIFIER = /[A-Za-z_$][\w$]*/;

/**
 * Called once, the first time our command is used.
 * (Since VS Code 1.74, commands listed under `contributes.commands`
 * activate the extension automatically — no `activationEvents` needed.)
 */
export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand("quickLog.insertLog", insertLog);

  // Everything pushed to `subscriptions` is disposed when the extension
  // is deactivated, so we don't leak the command registration.
  context.subscriptions.push(command);
}

export function deactivate(): void {
  // Nothing to clean up — subscriptions handle it.
}

async function insertLog(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;

  // Snapshot of all lines as plain strings — that's all logic.ts needs.
  const lines: string[] = [];
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text);

  // Respect the file's own indentation settings (2 spaces / 4 spaces / tabs).
  const indentUnit = editor.options.insertSpaces
    ? " ".repeat(Number(editor.options.tabSize) || 2)
    : "\t";

  // Use the file's line ending so we don't mix \n and \r\n.
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  // One target per cursor — multi-cursor works for free this way.
  const targets = editor.selections.map((selection) => {
    const expr = getExpression(doc, selection);
    return expr ? { expr, line: selection.start.line } : null;
  });

  // No selection and the cursor isn't on a word (e.g. an empty line):
  // insert an empty `console.log()` and put the cursor between the parens.
  // `$0` in a snippet marks where the cursor ends up.
  if (targets.every((t) => t === null)) {
    await editor.insertSnippet(new vscode.SnippetString("console.log($0)"));
    return;
  }

  // Group logs by the line they go after. Two cursors in the same statement
  // would otherwise create two inserts at the exact same position, which
  // VS Code's edit builder may reject as overlapping.
  const byLine = new Map<number, string[]>();
  for (const target of targets) {
    if (!target) continue;
    const point = findInsertionPoint(lines, target.line, target.expr, indentUnit);
    const text = point.indent + buildLogStatement(target.expr);
    byLine.set(point.afterLine, [...(byLine.get(point.afterLine) ?? []), text]);
  }

  // A single `edit` call = a single undo step. Cmd+Z removes all logs at once.
  await editor.edit((builder) => {
    for (const [afterLine, texts] of byLine) {
      const endOfLine = doc.lineAt(afterLine).range.end;
      // Insert at the END of the line, starting with a newline,
      // so the new log sits on its own line right below.
      builder.insert(endOfLine, texts.map((t) => eol + t).join(""));
    }
  });
}

/**
 * Figures out WHAT to log for one cursor/selection:
 *  - text is selected  -> the selected text (`gokhan`, `user.name`, ...)
 *  - nothing selected  -> the identifier under the cursor, if any
 *  - otherwise         -> null (nothing to log for this cursor)
 */
function getExpression(doc: vscode.TextDocument, selection: vscode.Selection): string | null {
  if (!selection.isEmpty) {
    const text = doc.getText(selection).trim();
    return text.length > 0 ? text : null;
  }

  const range = doc.getWordRangeAtPosition(selection.active, IDENTIFIER);
  if (!range) return null;

  const word = doc.getText(range);
  return isLoggableWord(word) ? word : null;
}
