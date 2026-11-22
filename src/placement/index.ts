// ---------------------------------------------------------------------------
// placement/index.ts — single entry point: AST first, scanner as fallback.
// ---------------------------------------------------------------------------
import { planWithAst } from "./ast";
import type { PlanInput, PlanResult } from "./plan";
import { planWithScanner } from "./scanner";

export function planLog(input: PlanInput): PlanResult {
  // null = Babel couldn't parse the file, or the selection isn't inside any
  // statement. Either way the v1 scanner still gives a reasonable answer.
  return planWithAst(input) ?? planWithScanner(input);
}

export { applyPlans, endOf, startOf, UNSUPPORTED } from "./plan";
export type { EditPlan, PlanInput, PlanResult } from "./plan";
