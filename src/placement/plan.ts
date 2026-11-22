// ---------------------------------------------------------------------------
// placement/plan.ts — the contract between "decide" and "apply".
//
// Placement code (ast.ts, scanner.ts) never touches the editor. It returns an
// EditPlan made of plain string OFFSETS. extension.ts turns offsets into
// VS Code positions (document.positionAt) and applies them. Keeping it this
// way means every placement rule can be tested with plain strings.
// ---------------------------------------------------------------------------

export type EditPlan =
  /** Insert `text` at `offset` (usually a new line with the log). */
  | { kind: "insert"; offset: number; text: string }
  /** Replace source[start, end) with `text` (arrow body → block conversion, etc.). */
  | { kind: "replace"; start: number; end: number; text: string };

/** Everything placement needs to know — no VS Code types in here. */
export interface PlanInput {
  /** Full file content. */
  source: string;
  /** VS Code language id: javascript | javascriptreact | typescript | typescriptreact */
  languageId: string;
  /** Selection (already trimmed) as offsets into `source`. */
  selStart: number;
  selEnd: number;
  /** The text to log, e.g. `gokhan` or `user.name`. */
  expr: string;
  /** One level of indentation for this file: "  ", "    " or "\t". */
  indentUnit: string;
  /** Line ending of this file: "\n" or "\r\n". */
  eol: string;
}

/** Returned when the selection sits somewhere a log can't go (a type, a class body...). */
export const UNSUPPORTED = "unsupported" as const;
export type PlanResult = EditPlan | typeof UNSUPPORTED;

/**
 * Applies plans to a string. The extension uses VS Code's edit builder
 * instead; this exists so tests can check the final text end-to-end.
 * Applied from the END of the file backwards, so earlier offsets stay valid.
 */
export function applyPlans(source: string, plans: EditPlan[]): string {
  const sorted = [...plans].sort((a, b) => startOf(b) - startOf(a));
  let out = source;
  for (const plan of sorted) {
    out =
      plan.kind === "insert"
        ? out.slice(0, plan.offset) + plan.text + out.slice(plan.offset)
        : out.slice(0, plan.start) + plan.text + out.slice(plan.end);
  }
  return out;
}

export function startOf(plan: EditPlan): number {
  return plan.kind === "insert" ? plan.offset : plan.start;
}

export function endOf(plan: EditPlan): number {
  return plan.kind === "insert" ? plan.offset : plan.end;
}
