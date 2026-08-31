// Runs our grammars through the same engine VS Code uses, outside the editor.
// Anything this file proves, the editor does too — and anything it cannot
// prove is a real gap, not a testing artifact.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Both libraries are CommonJS and Node's ESM detector does not surface all of
// their exports as named ones, so require them rather than fighting interop.
const { Registry, parseRawGrammar, INITIAL } = require("vscode-textmate");
const { loadWASM, createOnigScanner, createOnigString } = require("vscode-oniguruma");

const GRAMMARS = {
  // ours
  "source.yaml.gotmpl": "syntaxes/yaml-gotmpl.tmLanguage.json",
  "gotmpl.injection": "syntaxes/gotmpl-injection.tmLanguage.json",
  // VS Code's built-in YAML chain, copied by scripts/fetch-yaml-grammar.mjs
  "source.yaml": "vendor/yaml-syntaxes/yaml.tmLanguage.json",
  "source.yaml.1.0": "vendor/yaml-syntaxes/yaml-1.0.tmLanguage.json",
  "source.yaml.1.1": "vendor/yaml-syntaxes/yaml-1.1.tmLanguage.json",
  "source.yaml.1.2": "vendor/yaml-syntaxes/yaml-1.2.tmLanguage.json",
  "source.yaml.1.3": "vendor/yaml-syntaxes/yaml-1.3.tmLanguage.json",
  "source.yaml.embedded": "vendor/yaml-syntaxes/yaml-embedded.tmLanguage.json",
};

const INJECTIONS = ["gotmpl.injection"];

let onigLib;
async function getOnigLib() {
  if (!onigLib) {
    const wasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");
    await loadWASM(readFileSync(wasmPath).buffer);
    onigLib = {
      createOnigScanner: (sources) => createOnigScanner(sources),
      createOnigString: (str) => createOnigString(str),
    };
  }
  return onigLib;
}

export async function makeRegistry() {
  return new Registry({
    onigLib: await getOnigLib(),
    loadGrammar: async (scopeName) => {
      const path = GRAMMARS[scopeName];
      if (!path) return null;
      return parseRawGrammar(readFileSync(path, "utf8"), path);
    },
    // Deliberately unconditional: hand the injection to EVERY scope and let
    // the library's own injectionSelector do the filtering. Returning it only
    // for source.yaml.gotmpl would make the isolation test (U6) a tautology —
    // it would confirm this wiring instead of the editor's behavior.
    getInjections: () => INJECTIONS,
  });
}

/** Tokenize `text` with `scopeName`, returning one array of tokens per line. */
export async function tokenize(text, scopeName = "source.yaml.gotmpl") {
  const registry = await makeRegistry();
  const grammar = await registry.loadGrammar(scopeName);
  if (!grammar) throw new Error(`grammar not found: ${scopeName}`);

  const lines = text.split(/\r?\n/);
  const result = [];
  let ruleStack = INITIAL;
  for (const line of lines) {
    const { tokens, ruleStack: next } = grammar.tokenizeLine(line, ruleStack);
    result.push(tokens.map((t) => ({ ...t, text: line.slice(t.startIndex, t.endIndex) })));
    ruleStack = next;
  }
  return result;
}

/** All scopes covering the first occurrence of `needle` on the line containing it. */
export function scopesAt(lines, lineNo, column) {
  const token = lines[lineNo].find((t) => column >= t.startIndex && column < t.endIndex);
  return token ? token.scopes : [];
}

/** Scopes at the first occurrence of `needle`, searched across all lines. */
export function scopesOf(lines, source, needle) {
  const rows = source.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const col = rows[i].indexOf(needle);
    if (col !== -1) return scopesAt(lines, i, col);
  }
  throw new Error(`not found in source: ${needle}`);
}
