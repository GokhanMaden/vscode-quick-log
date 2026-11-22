// ---------------------------------------------------------------------------
// extension.ts
//
// Entry point VS Code loads. Its only job is to translate between the editor
// (selections, document, edits) and the pure placement logic in placement/.
// ---------------------------------------------------------------------------
import * as vscode from "vscode";
import { isLoggableWord } from "./log";
import { endOf, planLog, startOf, UNSUPPORTED, type EditPlan } from "./placement";

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
  const source = doc.getText();

  // Respect the file's own indentation settings (2 spaces / 4 spaces / tabs).
  const indentUnit = editor.options.insertSpaces ? " ".repeat(Number(editor.options.tabSize) || 2) : "\t";

  // Use the file's line ending so we don't mix \n and \r\n.
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  // One target per cursor — multi-cursor works for free this way.
  const targets = editor.selections.map((selection) => getTarget(doc, selection));

  // No selection and the cursor isn't on a word (e.g. an empty line):
  // insert an empty `console.log()` and put the cursor between the parens.
  // `$0` in a snippet marks where the cursor ends up.
  if (targets.every((t) => t === null)) {
    await editor.insertSnippet(new vscode.SnippetString("console.log($0)"));
    return;
  }

  const plans: EditPlan[] = [];
  let unsupported = 0;
  for (const target of targets) {
    if (!target) continue;
    const result = planLog({ source, languageId: doc.languageId, indentUnit, eol, ...target });
    if (result === UNSUPPORTED) unsupported++;
    else plans.push(result);
  }

  if (plans.length === 0) {
    if (unsupported > 0) {
      vscode.window.showInformationMessage("Quick Log: can't add a log here (type or class body).");
    }
    return;
  }

  // A single `edit` call = a single undo step. Cmd+Z removes all logs at once.
  await editor.edit((builder) => {
    for (const plan of mergePlans(plans)) {
      if (plan.kind === "insert") {
        builder.insert(doc.positionAt(plan.offset), plan.text);
      } else {
        builder.replace(new vscode.Range(doc.positionAt(plan.start), doc.positionAt(plan.end)), plan.text);
      }
    }
  });
}

/**
 * VS Code rejects overlapping edits in one `edit()` call. With multiple
 * cursors two plans can collide, so:
 *  - inserts at the same offset are merged into one insert (texts joined),
 *  - any plan that overlaps an earlier kept one is dropped
 *    (e.g. two cursors that both want to convert the same arrow body).
 */
function mergePlans(plans: EditPlan[]): EditPlan[] {
  const sorted = [...plans].sort((a, b) => startOf(a) - startOf(b));
  const kept: EditPlan[] = [];

  for (const plan of sorted) {
    const last = kept[kept.length - 1];
    if (last?.kind === "insert" && plan.kind === "insert" && last.offset === plan.offset) {
      kept[kept.length - 1] = { ...last, text: last.text + plan.text };
      continue;
    }
    if (last && startOf(plan) < endOf(last)) continue; // overlaps → skip
    kept.push(plan);
  }
  return kept;
}

/**
 * Figures out WHAT to log for one cursor/selection, as offsets:
 *  - text is selected  -> the selected text, trimmed (`gokhan`, `user.name`)
 *  - nothing selected  -> the identifier under the cursor, if any
 *  - otherwise         -> null (nothing to log for this cursor)
 */
function getTarget(
  doc: vscode.TextDocument,
  selection: vscode.Selection
): { expr: string; selStart: number; selEnd: number } | null {
  if (!selection.isEmpty) {
    const raw = doc.getText(selection);
    const expr = raw.trim();
    if (!expr) return null;
    // Shift the start past any leading whitespace that `trim()` removed.
    const selStart = doc.offsetAt(selection.start) + (raw.length - raw.trimStart().length);
    return { expr, selStart, selEnd: selStart + expr.length };
  }

  const range = doc.getWordRangeAtPosition(selection.active, IDENTIFIER);
  if (!range) return null;

  const word = doc.getText(range);
  if (!isLoggableWord(word)) return null;
  return { expr: word, selStart: doc.offsetAt(range.start), selEnd: doc.offsetAt(range.end) };
}
