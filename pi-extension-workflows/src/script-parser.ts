import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { parse } from "acorn";
import { WorkflowValidationError } from "./errors.ts";
import { validateWorkflowScriptMeta } from "./script-schema.ts";
import type { WorkflowScriptDefinition } from "./types.ts";

const FORBIDDEN_IDENTIFIERS = new Set([
  "process",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "Deno",
  "Bun",
  "eval",
  "Function",
  "WebAssembly",
]);

export type ParseWorkflowScriptOptions = {
  sourcePath?: string;
  enforceFilename?: boolean;
};

type NodeLike = {
  type: string;
  start: number;
  end: number;
  loc?: { start?: { line?: number; column?: number } };
  [key: string]: unknown;
};

function location(node: NodeLike): string {
  const line = node.loc?.start?.line;
  const column = node.loc?.start?.column;
  return line ? ` at ${line}:${(column ?? 0) + 1}` : "";
}

function propertyKey(node: NodeLike, issues: string[]): string | undefined {
  if (node.type === "Identifier") return String(node.name);
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  issues.push(`meta contains an unsupported property key${location(node)}.`);
  return undefined;
}

function staticValue(node: NodeLike | null | undefined, issues: string[]): unknown {
  if (!node) {
    issues.push("meta contains an empty value.");
    return undefined;
  }

  if (node.type === "Literal") {
    const value = node.value;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    issues.push(`meta contains an unsupported literal${location(node)}.`);
    return undefined;
  }

  if (node.type === "UnaryExpression" && node.operator === "-" && (node.argument as NodeLike)?.type === "Literal") {
    const value = (node.argument as NodeLike).value;
    if (typeof value === "number") return -value;
  }

  if (node.type === "ArrayExpression") {
    const elements = node.elements as Array<NodeLike | null>;
    return elements.map((element, index) => {
      if (!element) {
        issues.push(`meta array contains a hole at index ${index}${location(node)}.`);
        return undefined;
      }
      if (element.type === "SpreadElement") {
        issues.push(`meta arrays cannot contain spread elements${location(element)}.`);
        return undefined;
      }
      return staticValue(element, issues);
    });
  }

  if (node.type === "ObjectExpression") {
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const property of node.properties as NodeLike[]) {
      if (property.type !== "Property" || property.kind !== "init" || property.computed || property.method || property.shorthand) {
        issues.push(`meta must use plain, non-computed object properties${location(property)}.`);
        continue;
      }
      const key = propertyKey(property.key as NodeLike, issues);
      if (!key) continue;
      if (seen.has(key)) {
        issues.push(`meta contains duplicate property '${key}'${location(property)}.`);
        continue;
      }
      seen.add(key);
      result[key] = staticValue(property.value as NodeLike, issues);
    }
    return result;
  }

  issues.push(`meta values must be static literals; found ${node.type}${location(node)}.`);
  return undefined;
}

function walk(node: unknown, visit: (node: NodeLike, parent?: NodeLike) => void, parent?: NodeLike): void {
  if (!node || typeof node !== "object") return;
  const candidate = node as Partial<NodeLike>;
  if (typeof candidate.type === "string" && typeof candidate.start === "number" && typeof candidate.end === "number") {
    visit(candidate as NodeLike, parent);
    parent = candidate as NodeLike;
  }
  for (const [key, value] of Object.entries(candidate)) {
    if (["loc", "start", "end", "type", "range"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit, parent));
    else walk(value, visit, parent);
  }
}

function isPropertyKeyIdentifier(node: NodeLike, parent?: NodeLike): boolean {
  return parent?.type === "Property" && parent.key === node && !parent.computed;
}

function validateExecutableSyntax(program: NodeLike, metaStatement: NodeLike, issues: string[]): void {
  walk(program, (node, parent) => {
    if (node === metaStatement) return;
    if (node.type === "ImportDeclaration" || node.type === "ImportExpression") {
      issues.push(`imports are not available in workflow scripts${location(node)}.`);
      return;
    }
    if (node.type.startsWith("Export")) {
      issues.push(`only the first 'export const meta = {...}' declaration is allowed${location(node)}.`);
      return;
    }
    if (node.type === "WithStatement" || node.type === "DebuggerStatement") {
      issues.push(`${node.type} is not available in workflow scripts${location(node)}.`);
      return;
    }
    if (node.type === "Identifier" && FORBIDDEN_IDENTIFIERS.has(String(node.name)) && !isPropertyKeyIdentifier(node, parent)) {
      issues.push(`identifier '${String(node.name)}' is not available in workflow scripts${location(node)}.`);
    }
  });
}

function metaDeclaration(program: NodeLike, issues: string[]): { statement?: NodeLike; init?: NodeLike } {
  const statements = program.body as NodeLike[];
  const statement = statements[0];
  if (!statement || statement.type !== "ExportNamedDeclaration") {
    issues.push("the first statement must be 'export const meta = {...}'.");
    return {};
  }

  const declaration = statement.declaration as NodeLike | undefined;
  const declarations = declaration?.declarations as NodeLike[] | undefined;
  const declarator = declarations?.[0];
  const id = declarator?.id as NodeLike | undefined;
  if (
    declaration?.type !== "VariableDeclaration"
    || declaration.kind !== "const"
    || declarations?.length !== 1
    || declarator?.type !== "VariableDeclarator"
    || id?.type !== "Identifier"
    || id.name !== "meta"
    || !(declarator.init as NodeLike | undefined)
  ) {
    issues.push("the first statement must be exactly one 'export const meta = {...}' declaration.");
    return { statement };
  }

  return { statement, init: declarator.init as NodeLike };
}

function expectedName(options: ParseWorkflowScriptOptions): string | undefined {
  if (!options.enforceFilename || !options.sourcePath) return undefined;
  const extension = extname(options.sourcePath);
  return basename(options.sourcePath, extension);
}

export function parseWorkflowScript(source: string, options: ParseWorkflowScriptOptions = {}): WorkflowScriptDefinition {
  const issues: string[] = [];
  let program: NodeLike;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowHashBang: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    }) as unknown as NodeLike;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowValidationError([`invalid workflow JavaScript: ${message}`], options.sourcePath);
  }

  const extracted = metaDeclaration(program, issues);
  let rawMeta: unknown;
  if (extracted.init) rawMeta = staticValue(extracted.init, issues);
  if (extracted.statement) validateExecutableSyntax(program, extracted.statement, issues);
  if (issues.length > 0) throw new WorkflowValidationError(issues, options.sourcePath);

  const meta = validateWorkflowScriptMeta(rawMeta, {
    sourcePath: options.sourcePath,
    expectedName: expectedName(options),
  });
  const statement = extracted.statement as NodeLike;
  const body = `${source.slice(0, statement.start)}${source.slice(statement.end)}`.trim();
  if (!body) throw new WorkflowValidationError(["workflow script body must not be empty."], options.sourcePath);

  return {
    meta,
    source,
    body,
    sourceHash: createHash("sha256").update(source, "utf8").digest("hex"),
  };
}
