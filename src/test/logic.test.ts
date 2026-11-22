// Unit tests for the pure logic, using Node's built-in test runner.
// Run with: npm test   (no VS Code instance needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLogStatement, findInsertionPoint, isLoggableWord } from "../logic";

const TAB = "  "; // pretend the editor uses 2-space indentation

// Small helper: write the code as a template string, get an array of lines back.
const src = (code: string) => code.replace(/^\n/, "").split("\n");

test("single-line statement: log goes right below it", () => {
  const lines = src(`
const gokhan = a + b;
foo();`);
  assert.deepEqual(findInsertionPoint(lines, 0, "gokhan", TAB), {
    afterLine: 0,
    indent: "",
  });
});

test("keeps the indentation of the statement", () => {
  const lines = src(`
function x() {
    const gokhan = 1;
}`);
  assert.deepEqual(findInsertionPoint(lines, 1, "gokhan", TAB), {
    afterLine: 1,
    indent: "    ",
  });
});

test("multi-line object: log goes after the closing brace", () => {
  const lines = src(`
const user = {
  name: "Gökhan",
  city: "Berlin",
};
next();`);
  assert.equal(findInsertionPoint(lines, 0, "user", TAB).afterLine, 3);
});

test("multi-line function call", () => {
  const lines = src(`
const result = fetchData(
  url,
  { method: "POST" }
);`);
  assert.equal(findInsertionPoint(lines, 0, "result", TAB).afterLine, 3);
});

test("method chain on following lines", () => {
  const lines = src(`
const names = users
  .filter((u) => u.active)
  .map((u) => u.name);
done();`);
  assert.equal(findInsertionPoint(lines, 0, "names", TAB).afterLine, 2);
});

test("dangling operator continues the statement", () => {
  const lines = src(`
const total = price +
  tax;
done();`);
  assert.equal(findInsertionPoint(lines, 0, "total", TAB).afterLine, 1);
});

test("brackets inside strings and comments are ignored", () => {
  const lines = src(`
const label = "(not a bracket" // { nor this
done();`);
  assert.equal(findInsertionPoint(lines, 0, "label", TAB).afterLine, 0);
});

test("multi-line template literal", () => {
  const lines = src(`
const html = \`
  <div>(</div>
\`;
done();`);
  assert.equal(findInsertionPoint(lines, 0, "html", TAB).afterLine, 2);
});

test("function parameter: log goes INSIDE the function body", () => {
  const lines = src(`
function save(user) {
  db.write(user);
}`);
  assert.deepEqual(findInsertionPoint(lines, 0, "user", TAB), {
    afterLine: 0,
    indent: "  ",
  });
});

test("arrow callback parameter: log goes inside the callback", () => {
  const lines = src(`
  items.map((item) => {
    return item.id;
  });`);
  assert.deepEqual(findInsertionPoint(lines, 0, "item", TAB), {
    afterLine: 0,
    indent: "    ",
  });
});

test("declared variable with a callback (useMemo): log after the statement", () => {
  const lines = src(`
const sorted = useMemo(() => {
  return [...list].sort();
}, [list]);
return sorted;`);
  assert.equal(findInsertionPoint(lines, 0, "sorted", TAB).afterLine, 2);
});

test("object literal is not treated as a block", () => {
  const lines = src(`
const config = {
  debug: true,
};`);
  assert.equal(findInsertionPoint(lines, 0, "config", TAB).afterLine, 2);
});

test("destructuring: selected name is recognised as declared", () => {
  const lines = src(`
const { data, error } = useQuery(() => {
  return fetchUser();
});`);
  assert.equal(findInsertionPoint(lines, 0, "data", TAB).afterLine, 2);
});

test("count++ does not swallow the next line", () => {
  const lines = src(`
count++
render();`);
  assert.equal(findInsertionPoint(lines, 0, "count", TAB).afterLine, 0);
});

test("buildLogStatement: the exact format Gökhan asked for", () => {
  assert.equal(buildLogStatement("gokhan"), 'console.log("gokhan:", gokhan)');
});

test("buildLogStatement: escapes quotes in the label", () => {
  assert.equal(
    buildLogStatement('obj["key"]'),
    'console.log("obj[\\"key\\"]:", obj["key"])'
  );
});

test("buildLogStatement: collapses multi-line selections", () => {
  assert.equal(
    buildLogStatement("user\n  .name"),
    'console.log("user .name:", user .name)'
  );
});

test("isLoggableWord rejects keywords", () => {
  assert.equal(isLoggableWord("const"), false);
  assert.equal(isLoggableWord("gokhan"), true);
});
