// Edge cases that don't fit the input/expected fixture format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planWithAst } from "../placement/ast";
import { applyPlans, planLog, UNSUPPORTED, type PlanInput } from "../placement";

// Builds a PlanInput from code with a «selection».
function input(raw: string, languageId = "typescript"): PlanInput {
  const selStart = raw.indexOf("«");
  const selEnd = raw.indexOf("»") - 1;
  const source = raw.replace("«", "").replace("»", "");
  return { source, languageId, selStart, selEnd, expr: source.slice(selStart, selEnd), indentUnit: "  ", eol: "\n" };
}

test("type alias name is unsupported (types aren't values)", () => {
  assert.equal(planWithAst(input("type «User» = { name: string };")), UNSUPPORTED);
});

test("interface member is unsupported", () => {
  assert.equal(planWithAst(input("interface User {\n  «name»: string;\n}")), UNSUPPORTED);
});

test("class property is unsupported", () => {
  assert.equal(planWithAst(input("class Store {\n  «count» = 0;\n}")), UNSUPPORTED);
});

test("usage inside a class METHOD still works", () => {
  const i = input("class Store {\n  inc() {\n    «this.count»++;\n  }\n}");
  const plan = planLog(i);
  assert.notEqual(plan, UNSUPPORTED);
  if (plan === UNSUPPORTED) return;
  assert.equal(
    applyPlans(i.source, [plan]),
    'class Store {\n  inc() {\n    this.count++;\n    console.log("this.count:", this.count)\n  }\n}'
  );
});

test("CRLF files keep CRLF line endings", () => {
  const i = { ...input("const «a» = 1;\r\nnext();"), eol: "\r\n" };
  const plan = planLog(i);
  if (plan === UNSUPPORTED) return assert.fail("unexpected UNSUPPORTED");
  assert.equal(applyPlans(i.source, [plan]), 'const a = 1;\r\nconsole.log("a:", a)\r\nnext();');
});

test(".ts files don't enable JSX, so <T> casts parse", () => {
  const i = input("const «value» = <string>raw;\nnext();");
  const plan = planWithAst(i);
  if (!plan || plan === UNSUPPORTED) return assert.fail("AST should handle this");
  assert.equal(applyPlans(i.source, [plan]), 'const value = <string>raw;\nconsole.log("value:", value)\nnext();');
});
