// ---------------------------------------------------------------------------
// placement/ast.ts — v2 placement using a real parser.
//
// Flow:
//   1. Parse the whole file with @babel/parser into an AST.
//   2. Find the PATH from the root down to the smallest node that contains
//      the selection (File > Program > ... > Identifier).
//   3. Walk that path back UP and apply the placement rules (see PLAN.md):
//        Rule 1  function / catch parameter   -> first line inside the body
//        Rule 2  declared variable            -> after the statement
//        Rule 3  used in return/throw/if/loop -> before the statement
//        Rule 4  any other usage              -> after the statement
//   4. Return an EditPlan (offsets only — no VS Code types).
//
// Returns null when the file can't be parsed (caller falls back to the v1
// scanner) and UNSUPPORTED when the selection is somewhere a log can't live.
// ---------------------------------------------------------------------------
import { parse, type ParserPlugin } from "@babel/parser";
import { buildLogStatement } from "../log";
import { UNSUPPORTED, type EditPlan, type PlanInput, type PlanResult } from "./plan";
import { indentAt, lineEnd, lineStart, restOfLineCode, startsLine } from "./text";

/**
 * Our own minimal view of a Babel node. We deliberately don't depend on
 * @babel/types' huge union: we only need `type`, the offsets, and a way to
 * reach children generically.
 */
interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** One step of the root→selection path: the node and the key it hangs off its parent. */
interface PathEntry {
  node: AstNode;
  key: string | null;
}

// --- Node type groups ------------------------------------------------------

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

/**
 * Parents whose child list is a list of statements. A log line is only
 * syntactically safe as a sibling INSIDE one of these lists.
 * Value = the key that holds the list.
 */
const STATEMENT_LISTS: Record<string, string> = {
  Program: "body",
  BlockStatement: "body",
  StaticBlock: "body",
  TSModuleBlock: "body",
  SwitchCase: "consequent",
};

/**
 * Rule 3: a usage under one of these (parent type → keys) means
 * "log BEFORE the statement", otherwise the log would be unreachable
 * (after a return/throw) or show the value too late (if/loop conditions).
 */
const CONTROL_KEYS: Record<string, string[]> = {
  ReturnStatement: ["argument"],
  ThrowStatement: ["argument"],
  IfStatement: ["test"],
  WhileStatement: ["test"],
  DoWhileStatement: ["test"],
  ForStatement: ["init", "test", "update"],
  ForInStatement: ["left", "right"],
  ForOfStatement: ["left", "right"],
  SwitchStatement: ["discriminant"],
};

const LOOP_TYPES = new Set(["ForStatement", "ForInStatement", "ForOfStatement"]);

/** Places where a log makes no sense: types, interfaces, class bodies. */
const UNSUPPORTED_TYPES = new Set([
  "ClassBody",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
]);
const UNSUPPORTED_KEYS = new Set(["typeAnnotation", "returnType", "typeParameters"]);

/** Keys that hold metadata, not child nodes. */
const SKIP_KEYS = new Set([
  "loc",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "tokens",
  "errors",
]);

// --- Parsing ---------------------------------------------------------------

function pluginsFor(languageId: string): ParserPlugin[] {
  switch (languageId) {
    // No "jsx" for plain .ts: it would break `<T>value` type assertions.
    case "typescript":
      return ["typescript", "decorators-legacy"];
    case "typescriptreact":
      return ["typescript", "jsx", "decorators-legacy"];
    default:
      return ["jsx", "decorators-legacy"];
  }
}

function parseSource(source: string, languageId: string): AstNode | null {
  try {
    const file = parse(source, {
      sourceType: "module",
      plugins: pluginsFor(languageId),
      // Code in an editor is often half-written. errorRecovery lets Babel
      // return an AST anyway (with `errors`) instead of throwing.
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowUndeclaredExports: true,
    });
    return file as unknown as AstNode;
  } catch {
    // Some errors are fatal even with errorRecovery → let the caller fall back.
    return null;
  }
}

// --- Walking ---------------------------------------------------------------

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AstNode).type === "string" &&
    typeof (value as AstNode).start === "number"
  );
}

/** All direct child nodes of `node`, with the key each one lives under. */
function childrenOf(node: AstNode): PathEntry[] {
  const out: PathEntry[] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push({ node: item, key });
    } else if (isNode(value)) {
      out.push({ node: value, key });
    }
  }
  return out;
}

/**
 * Root → deepest node that fully contains [start, end].
 * Sibling nodes never overlap, so at each level at most one child matches.
 * This is a hand-written walk instead of @babel/traverse to keep the bundle small.
 */
function findPath(root: AstNode, start: number, end: number): PathEntry[] {
  const path: PathEntry[] = [{ node: root, key: null }];
  let current = root;
  for (;;) {
    const next = childrenOf(current).find((c) => c.node.start <= start && end <= c.node.end);
    if (!next) return path;
    path.push(next);
    current = next.node;
  }
}

// --- Main entry ------------------------------------------------------------

export function planWithAst(input: PlanInput): PlanResult | null {
  const root = parseSource(input.source, input.languageId);
  if (!root) return null;

  const path = findPath(root, input.selStart, input.selEnd);
  const ctx = new Context(input);

  let declared = false;
  let control: AstNode | null = null;

  // Walk from the deepest node back up towards the root.
  for (let i = path.length - 1; i >= 1; i--) {
    const child = path[i].node;
    const key = path[i].key as string;
    const parent = path[i - 1].node;

    if (UNSUPPORTED_TYPES.has(parent.type) || UNSUPPORTED_KEYS.has(key)) return UNSUPPORTED;

    // Rule 1: function or catch parameter → log inside the body.
    if (
      (FUNCTION_TYPES.has(parent.type) && key === "params") ||
      (parent.type === "CatchClause" && key === "param")
    ) {
      return ctx.atBodyStart(parent);
    }

    // A usage inside an arrow's EXPRESSION body: `(n) => n * 2`.
    // The arrow is the variable's scope, so we convert it to a block body
    // and log inside (decision 3). Logging after the outer statement would
    // put the log where `n` doesn't exist.
    if (parent.type === "ArrowFunctionExpression" && key === "body" && child.type !== "BlockStatement") {
      return ctx.convertArrowBody(parent);
    }

    // Rule 2: the selection is (part of) the declared name/pattern.
    if (parent.type === "VariableDeclarator" && key === "id") {
      declared = true;
      // `for (const item of items)` / `for (let i = 0; ...)`: the variable
      // only exists inside the loop → log as the first line of the loop body.
      const declaration = path[i - 2];
      const owner = path[i - 3]?.node;
      if (owner && LOOP_TYPES.has(owner.type) && (declaration.key === "left" || declaration.key === "init")) {
        return ctx.atBodyStart(owner);
      }
    }

    // Rule 3 marker: remember the innermost control-flow statement we pass.
    if (!control && CONTROL_KEYS[parent.type]?.includes(key)) control = parent;

    // Reached a statement that sits directly in a statement list → decide.
    if (STATEMENT_LISTS[parent.type] === key) {
      if (declared) return ctx.after(child);
      if (control?.type === "DoWhileStatement") {
        // Before `do { } while (x)` would log a stale value → end of the body.
        return ctx.atBodyEnd(control.body as AstNode, control);
      }
      // `else if (x)` and unbraced `if (ok) return x;` land here too: the
      // control statement isn't in a list, so `child` is the outer statement.
      if (control) return ctx.before(child);
      return ctx.after(child); // Rule 4
    }
  }

  // Selection outside any statement (e.g. blank space) → let the scanner try.
  return null;
}

// --- Building the edits ----------------------------------------------------

/** Bundles the input with the small text helpers every edit needs. */
class Context {
  private readonly log: string;

  constructor(private readonly input: PlanInput) {
    this.log = buildLogStatement(input.expr);
  }

  private get src(): string {
    return this.input.source;
  }

  private get eol(): string {
    return this.input.eol;
  }

  /**
   * New line AFTER the statement, same indent. We insert at the end of the
   * statement's last LINE (not at statement.end) so a trailing comment like
   * `const x = 1; // note` stays on its own line.
   */
  after(statement: AstNode): EditPlan {
    return {
      kind: "insert",
      offset: lineEnd(this.src, statement.end),
      text: this.eol + indentAt(this.src, statement.start) + this.log,
    };
  }

  /** New line BEFORE the statement, same indent. */
  before(statement: AstNode): EditPlan {
    const indent = indentAt(this.src, statement.start);
    if (startsLine(this.src, statement.start)) {
      return { kind: "insert", offset: lineStart(this.src, statement.start), text: indent + this.log + this.eol };
    }
    // Statement shares its line with something else, e.g. `case "a": return x;`.
    // Inserting at the line start would land before `case` (invalid), so we
    // insert right before the statement and push it to the next line.
    return {
      kind: "insert",
      offset: statement.start,
      text: this.log + this.eol + indent + this.input.indentUnit,
    };
  }

  /**
   * First line inside the body of a function / loop / catch clause.
   * Handles block bodies, arrow expression bodies and unbraced loop bodies.
   */
  atBodyStart(owner: AstNode): EditPlan {
    const body = owner.body as AstNode;
    if (body.type === "BlockStatement") return this.blockStart(body);
    if (owner.type === "ArrowFunctionExpression") return this.convertArrowBody(owner);
    return this.wrapStatement(body, owner); // `for (const x of xs) foo(x);`
  }

  /** Insert right after the `{` of a block. */
  private blockStart(block: AstNode): EditPlan {
    const open = block.start + 1; // just after `{`
    const lineIndent = indentAt(this.src, block.start);
    const statements = block.body as AstNode[];
    const rest = restOfLineCode(this.src, open);

    if (rest === "") {
      // Normal case: `{` ends its line. Match the indent of the first
      // statement if there is one, otherwise one level deeper.
      const inner = statements.length ? indentAt(this.src, statements[0].start) : lineIndent + this.input.indentUnit;
      return { kind: "insert", offset: lineEnd(this.src, open), text: this.eol + inner + this.log };
    }

    // Code follows `{` on the same line: `{}` or `{ return a; }`.
    const inner = lineIndent + this.input.indentUnit;
    const closingIndent = statements.length === 0 && rest.startsWith("}") ? lineIndent : inner;
    return { kind: "insert", offset: open, text: this.eol + inner + this.log + this.eol + closingIndent };
  }

  /** Last line inside a block (used for do...while). */
  atBodyEnd(block: AstNode, owner: AstNode): EditPlan {
    if (block.type !== "BlockStatement") return this.wrapStatement(block, owner);
    const close = block.end - 1; // index of `}`
    const lineIndent = indentAt(this.src, block.start);
    const statements = block.body as AstNode[];
    const inner = statements.length
      ? indentAt(this.src, statements[statements.length - 1].start)
      : lineIndent + this.input.indentUnit;

    if (startsLine(this.src, close)) {
      // `}` is on its own line → new line just above it.
      return { kind: "insert", offset: lineStart(this.src, close), text: inner + this.log + this.eol };
    }
    return { kind: "insert", offset: close, text: this.eol + inner + this.log + this.eol + lineIndent };
  }

  /**
   * `(n) => n * 2`  →  `(n) => {\n  console.log("n:", n)\n  return n * 2\n}`
   * `() => ({ a })` keeps its parentheses: `return ({ a })`.
   */
  convertArrowBody(arrow: AstNode): EditPlan {
    const body = arrow.body as AstNode;
    const extra = body.extra as { parenthesized?: boolean; parenStart?: number } | undefined;

    // Babel reports a parenthesized body without its parens; extend the
    // range so `({ a })` is replaced (and kept) as a whole.
    const start = extra?.parenthesized && typeof extra.parenStart === "number" ? extra.parenStart : body.start;
    const end = extra?.parenthesized ? this.src.indexOf(")", body.end) + 1 : body.end;

    const lineIndent = indentAt(this.src, arrow.start);
    const inner = lineIndent + this.input.indentUnit;
    const { eol } = this;

    return {
      kind: "replace",
      start,
      end,
      text: `{${eol}${inner}${this.log}${eol}${inner}return ${this.src.slice(start, end)}${eol}${lineIndent}}`,
    };
  }

  /** Unbraced body → braced body with the log first. */
  private wrapStatement(statement: AstNode, owner: AstNode): EditPlan {
    const lineIndent = indentAt(this.src, owner.start);
    const inner = lineIndent + this.input.indentUnit;
    const { eol } = this;
    return {
      kind: "replace",
      start: statement.start,
      end: statement.end,
      text: `{${eol}${inner}${this.log}${eol}${inner}${this.src.slice(statement.start, statement.end)}${eol}${lineIndent}}`,
    };
  }
}
