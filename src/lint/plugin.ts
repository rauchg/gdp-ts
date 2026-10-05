/**
 * Lint rules that close the gaps the type system cannot. TypeScript cannot
 * stop `{} as UserIsProjectAdmin<U, P>`; these rules make that, and the other
 * ways of minting or forging a proof, a lint error.
 *
 * Written against the ESLint rule API, which Oxlint's JS plugins also
 * implement, so the same rules run under both. Use them through the presets
 * in `@gdp-ts/core/lint/eslint` and `@gdp-ts/core/lint/oxlint`, which scope each rule to
 * the right files.
 *
 * All rules are syntactic (no type information), so they are fast and work on
 * any TypeScript version.
 */

/** The ESTree / TS-ESTree shapes these rules read. Kept minimal on purpose. */
interface Node {
  type: string;
  [key: string]: unknown;
}

interface Context {
  options: readonly unknown[];
  report(descriptor: { node: Node; message: string }): void;
}

interface RuleModule {
  meta: {
    type: "problem";
    docs: { description: string };
    schema: unknown[];
  };
  create(context: Context): Record<string, (node: Node) => void>;
}

/** The npm package whose imports these rules watch. */
const PACKAGE = "@gdp-ts/core";

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

const child = (node: Node, key: string): Node | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};

const children = (node: Node, key: string): Node[] => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};

const name = (node: Node | undefined): string | undefined =>
  node?.type === "Identifier" && typeof node["name"] === "string" ? node["name"] : undefined;

const sourceOf = (node: Node): string | undefined => {
  const value = child(node, "source")?.["value"];
  return typeof value === "string" ? value : undefined;
};

/** Every node in a subtree (skipping `parent` back-references). */
function* walk(node: Node): Generator<Node> {
  yield node;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    if (isNode(value)) yield* walk(value);
    else if (Array.isArray(value)) for (const item of value) if (isNode(item)) yield* walk(item);
  }
}

const isDefineProofCall = (node: Node | undefined, defineProof: Set<string>, namespaces: Set<string>): boolean => {
  if (node?.type !== "CallExpression") return false;
  const callee = child(node, "callee");
  if (defineProof.has(name(callee) ?? "")) return true;
  return (
    callee?.type === "MemberExpression" &&
    namespaces.has(name(child(callee, "object")) ?? "") &&
    (callee["computed"]
      ? child(callee, "property")?.["value"] === "defineProof"
      : name(child(callee, "property")) === "defineProof")
  );
};

/** Tracks local names bound to `defineProof` and to `import * as x from "@gdp-ts/core"`. */
function gdpImports() {
  const defineProof = new Set<string>();
  const namespaces = new Set<string>();
  return {
    defineProof,
    namespaces,
    ImportDeclaration(node: Node) {
      if (sourceOf(node) !== PACKAGE || node["importKind"] === "type") return;
      for (const specifier of children(node, "specifiers")) {
        if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(name(child(specifier, "local")) ?? "");
        if (
          specifier.type === "ImportSpecifier" &&
          specifier["importKind"] !== "type" &&
          name(child(specifier, "imported")) === "defineProof"
        ) {
          defineProof.add(name(child(specifier, "local")) ?? "");
        }
      }
    },
  };
}

const noDefineProof: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Only trusted modules (proofs/) may call defineProof; everywhere else, get proofs from them." },
    schema: [],
  },
  create(context) {
    const imports = gdpImports();
    return {
      ImportDeclaration(node) {
        imports.ImportDeclaration(node);
        for (const specifier of children(node, "specifiers")) {
          if (specifier.type === "ImportSpecifier" && imports.defineProof.has(name(child(specifier, "local")) ?? "")) {
            context.report({ node: specifier, message: "Only modules in proofs/ may import defineProof." });
          }
        }
      },
      CallExpression(node) {
        if (isDefineProofCall(node, new Set(), imports.namespaces)) {
          context.report({ node, message: "Only modules in proofs/ may call defineProof." });
        }
      },
    };
  },
};

const noExportedProver: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "A prover must stay private to its trusted module; export the proof type and the check." },
    schema: [],
  },
  create(context) {
    const imports = gdpImports();
    const provers = new Set<string>();
    const message = "Do not export the prover. Export the proof interface and the checking function.";
    const isProver = (node: Node | undefined) =>
      isDefineProofCall(node, imports.defineProof, imports.namespaces) || provers.has(name(node) ?? "");
    return {
      ImportDeclaration: imports.ImportDeclaration,
      VariableDeclarator(node) {
        const id = name(child(node, "id"));
        if (id && isDefineProofCall(child(node, "init"), imports.defineProof, imports.namespaces)) provers.add(id);
      },
      "Program:exit"(program) {
        for (const statement of children(program, "body")) {
          if (statement.type === "ExportDefaultDeclaration" && isProver(child(statement, "declaration"))) {
            context.report({ node: statement, message });
          }
          if (statement.type !== "ExportNamedDeclaration" || statement["exportKind"] === "type") continue;
          const declaration = child(statement, "declaration");
          for (const declarator of declaration ? children(declaration, "declarations") : []) {
            if (isProver(child(declarator, "init"))) context.report({ node: declarator, message });
          }
          if (sourceOf(statement)) continue; // `export { x } from "./y"` re-exports another module's binding
          for (const specifier of children(statement, "specifiers")) {
            if (specifier["exportKind"] !== "type" && provers.has(name(child(specifier, "local")) ?? "")) {
              context.report({ node: specifier, message });
            }
          }
        }
      },
    };
  },
};

const DEFAULT_PROOF_IMPORTS = ["(^|/)proofs(/|$)"];

const noProofAssertion: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "No type assertions to gdp-ts types (Named, Proof) or to types imported from proofs/: that is how a proof is forged.",
    },
    schema: [
      {
        type: "object",
        properties: { proofImports: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const option = context.options[0] as { proofImports?: string[] } | undefined;
    const proofImports = (option?.proofImports ?? DEFAULT_PROOF_IMPORTS).map((pattern) => new RegExp(pattern));
    const guarded = new Set<string>(); // local names of gdp-ts and proof types
    const guardedNamespaces = new Set<string>();

    const check = (node: Node) => {
      const annotation = child(node, "typeAnnotation");
      if (!annotation) return;
      for (const part of walk(annotation)) {
        if (part.type !== "TSTypeReference") continue;
        const typeName = child(part, "typeName");
        const direct = name(typeName);
        const namespace = typeName?.type === "TSQualifiedName" ? name(child(typeName, "left")) : undefined;
        if ((direct && guarded.has(direct)) || (namespace && guardedNamespaces.has(namespace))) {
          const shown = direct ?? `${namespace}.${name(child(typeName ?? part, "right")) ?? ""}`;
          context.report({
            node,
            message: `Do not assert a proof or Named type (${shown}). Get the proof from its trusted module in proofs/.`,
          });
          return;
        }
      }
    };

    return {
      ImportDeclaration(node) {
        const source = sourceOf(node) ?? "";
        if (source !== PACKAGE && !proofImports.some((pattern) => pattern.test(source))) return;
        for (const specifier of children(node, "specifiers")) {
          const local = name(child(specifier, "local"));
          if (!local) continue;
          if (specifier.type === "ImportSpecifier") guarded.add(local);
          else guardedNamespaces.add(local); // `import * as p` and default imports
        }
      },
      TSAsExpression: check,
      TSTypeAssertion: check,
    };
  },
};

const isConstAssertion = (node: Node) => {
  const annotation = child(node, "typeAnnotation");
  return annotation?.type === "TSTypeReference" && name(child(annotation, "typeName")) === "const";
};

const noTypeAssertion: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Strict mode: no type assertions (`as`, `<T>x`) outside trusted modules. `as const` is fine." },
    schema: [],
  },
  create(context) {
    const check = (node: Node) => {
      if (!isConstAssertion(node)) {
        context.report({ node, message: "No type assertions outside proofs/ (strict mode). The honest path never needs one." });
      }
    };
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
};

const noAny: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Strict mode: no `any` outside trusted modules; it silently satisfies any proof parameter." },
    schema: [],
  },
  create(context) {
    return {
      TSAnyKeyword(node) {
        context.report({ node, message: "No `any` outside proofs/ (strict mode): it satisfies any proof parameter." });
      },
    };
  },
};

export const rules = {
  "no-define-proof": noDefineProof,
  "no-exported-prover": noExportedProver,
  "no-proof-assertion": noProofAssertion,
  "no-type-assertion": noTypeAssertion,
  "no-any": noAny,
};

const plugin = { meta: { name: "gdp-ts" }, rules };
export default plugin;
