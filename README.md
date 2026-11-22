# Quick Log

Stop typing `console.log` by hand. Select a variable, press **Cmd+Shift+K** (Ctrl+Shift+K on Windows/Linux), and get:

```js
const gokhan = a + b;
console.log("gokhan:", gokhan)
```

Works in JavaScript, TypeScript, JSX and TSX files.

## How it works

| Situation | Result |
| --- | --- |
| Variable selected | `console.log("name:", name)` on the line below the statement, same indentation |
| Nothing selected, cursor on a word | Logs that word |
| Nothing selected, cursor on empty space | Inserts `console.log()` with the cursor inside the parens |
| Multi-line statement (object, call, chain, template string) | Log goes after the statement ends |
| Function / callback parameter (`items.map((item) => {`) | Log goes as the first line inside the body |
| Multiple cursors | One log per cursor, single undo step |

> Note: on macOS this overrides VS Code's default **Delete Line** shortcut (Cmd+Shift+K) in JS/TS files. Change it anytime in *Keyboard Shortcuts* → search "Quick Log".

## Develop

```bash
npm install
npm test          # unit tests for the insertion logic (no VS Code needed)
```

Press **F5** in VS Code to open an Extension Development Host with the extension loaded.

## Install locally

```bash
npm run package                      # creates quick-log-0.1.0.vsix
code --install-extension quick-log-0.1.0.vsix
```

## Project structure

```
src/
  extension.ts      # VS Code glue: reads selections, applies edits
  logic.ts          # pure logic: where does the log go? (unit-tested)
  test/logic.test.ts
```

## Known limitations

The statement-end detection is a lightweight line scanner, not a full parser:

- Brackets inside regex literals (`/[(]/`) are counted as real brackets.
- `${...}` inside template literals is treated as plain text.
- JSX text containing an apostrophe (`<p>Don't</p>`) can confuse the scanner.

## License

MIT
