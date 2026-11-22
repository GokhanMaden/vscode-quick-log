// ---------------------------------------------------------------------------
// Fixture tests: real code in, real code out.
//
// Each folder in test/fixtures/ holds:
//   input.<ext>     code with the selection marked as «gokhan»
//   expected.<ext>  what the file should look like after Cmd+Shift+K
// The extension decides the language (.ts / .tsx / .js / .jsx).
// To add a case: create a folder with those two files — no code changes.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { applyPlans, planLog, UNSUPPORTED } from "../placement";

// Compiled to out/test/, fixtures live in <repo>/test/fixtures/.
const FIXTURES = join(__dirname, "..", "..", "test", "fixtures");

const LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
};

for (const name of readdirSync(FIXTURES).sort()) {
  const dir = join(FIXTURES, name);
  const inputFile = readdirSync(dir).find((f) => f.startsWith("input."));
  if (!inputFile) continue;
  const ext = extname(inputFile);

  test(`fixture: ${name}`, () => {
    const raw = readFileSync(join(dir, inputFile), "utf8");
    const expected = readFileSync(join(dir, `expected${ext}`), "utf8");

    // Remove the «» markers and remember where the selection was.
    const selStart = raw.indexOf("«");
    const selEnd = raw.indexOf("»") - 1; // -1 because « is removed first
    assert.ok(selStart !== -1 && selEnd > selStart, "input needs a «selection»");
    const source = raw.replace("«", "").replace("»", "");

    const plan = planLog({
      source,
      languageId: LANGUAGE[ext],
      selStart,
      selEnd,
      expr: source.slice(selStart, selEnd),
      indentUnit: "  ",
      eol: "\n",
    });

    assert.notEqual(plan, UNSUPPORTED);
    if (plan === UNSUPPORTED) return;
    assert.equal(applyPlans(source, [plan]), expected);
  });
}
