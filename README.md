# Quick Log

Stop typing `console.log` by hand. Select a variable, press **Cmd+Shift+K** (Ctrl+Shift+K on Windows/Linux), and get:

```js
const gokhan = a + b;
console.log("gokhan:", gokhan)
```

Works in JavaScript, TypeScript, JSX and TSX files.

## How it works

Quick Log parses the file with [`@babel/parser`](https://babeljs.io/docs/babel-parser) and places the log where it actually makes sense:

| You select… | The log goes… |
| --- | --- |
| A variable being **declared** (`const user = …`, destructuring too) | **After** the whole statement, even if it spans many lines |
| A variable **used** in `return`, `throw`, an `if` / loop condition | **Before** that statement (after a `return` it would never run) |
| A **function / callback / catch parameter** | As the **first line inside** the body |
| A parameter or usage in an arrow like `(n) => n * 2` | The arrow is **converted** to `{ console.log(…); return n * 2 }` |
| A `for (const item of items)` loop variable | First line inside the loop |
| Anything else | After the statement |
| Nothing (cursor on a word) | Logs that word |
| Nothing (cursor on empty space) | Inserts `console.log()` with the cursor inside |

Multiple cursors get one log each, in a single undo step. Types, interfaces and class bodies are skipped with a short message. If the file can't be parsed at all, Quick Log falls back to a simple line scanner.

> Note: on macOS this overrides VS Code's default **Delete Line** shortcut (Cmd+Shift+K) in JS/TS files. Change it anytime in *Keyboard Shortcuts* → search "Quick Log".

## Develop

```bash
npm install
npm test          # unit + fixture tests (no VS Code needed)
```

Press **F5** in VS Code to open an Extension Development Host (esbuild rebuilds on save).

To add a test case, create `test/fixtures/<name>/input.ts` with the selection marked as `«name»`, and `expected.ts` with the result. No code changes needed.

## Install locally

```bash
npm run package                      # creates quick-log-0.2.0.vsix
code --install-extension quick-log-0.2.0.vsix
```

## Project structure

```
src/
  extension.ts          # VS Code glue: selections in, edits out
  log.ts                # the console.log text
  placement/
    ast.ts              # v2: Babel AST + placement rules
    scanner.ts          # v1 line scanner, used as fallback
    plan.ts             # EditPlan: offsets-only contract between the two sides
test/fixtures/          # input/expected pairs
```

The extension is bundled with esbuild into a single `dist/extension.js`, so the `.vsix` ships without `node_modules`.

## License

MIT
