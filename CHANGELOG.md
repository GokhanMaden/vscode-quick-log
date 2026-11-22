# Changelog

## 0.2.0

- Log placement now uses a real parser (`@babel/parser`) instead of a line scanner.
- Declared variables are logged **after** the statement; values used in `return`, `throw`, `if` or loop conditions are logged **before** it.
- Function, callback and `catch` parameters are logged as the first line inside the body.
- Arrow functions with an expression body (`(n) => n * 2`) are converted to a block body so the log fits.
- `for...of` / `for...in` / `for` loop variables are logged inside the loop.
- Types, interfaces and class bodies show a message instead of inserting invalid code.
- Falls back to the v1 scanner if the file can't be parsed.
- Bundled with esbuild: the extension ships as a single file.

## 0.1.0

- First version: `Cmd+Shift+K` / `Ctrl+Shift+K` inserts `console.log("name:", name)` below the statement.
- Multi-line statements, method chains and template strings handled by a line scanner.
- Multi-cursor support, single undo step.
