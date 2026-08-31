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

let registry;
export async function makeRegistry() {
  if (registry) return registry;
  registry = new Registry({
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
  return registry;
}

const grammars = new Map();
async function grammarFor(scopeName) {
  if (!grammars.has(scopeName)) {
    const registry = await makeRegistry();
    const grammar = await registry.loadGrammar(scopeName);
    if (!grammar) throw new Error(`grammar not found: ${scopeName}`);
    grammars.set(scopeName, grammar);
  }
  return grammars.get(scopeName);
}

/** Tokenize `text` with `scopeName`, returning one array of tokens per line. */
export async function tokenize(text, scopeName = "source.yaml.gotmpl") {
  const grammar = await grammarFor(scopeName);
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

/**
 * Column of `needle` in `row`, or -1.
 *
 * A bare indexOf finds substrings inside larger identifiers — "eq" inside
 * `requiredEnv`, "include" inside `included` — and the assertion then reads
 * scopes for the wrong token. When the needle is an identifier, require word
 * boundaries around it; when it carries punctuation (`{{`, `:=`, `| indent`),
 * fall back to a plain search since boundaries do not apply.
 */
function columnOf(row, needle) {
  if (!/^[A-Za-z_$][A-Za-z0-9_]*$/.test(needle)) return row.indexOf(needle);
  // `$` opens a template variable and is also a regex metacharacter, so the
  // needle is escaped before it becomes a pattern.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = row.match(new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_])`));
  return match ? match.index : -1;
}

/** Scopes at the first occurrence of `needle`, searched across all lines. */
export function scopesOf(lines, source, needle) {
  const rows = source.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const col = columnOf(rows[i], needle);
    if (col !== -1) return scopesAt(lines, i, col);
  }
  throw new Error(`not found in source: ${needle}`);
}

/**
 * Scopes at `needle` on the first line satisfying `lineMatches`.
 *
 * Most assertions here need a specific occurrence, not the first one in the
 * file — the same construct appears on several lines of a fixture.
 */
export function scopesOnLine(lines, source, lineMatches, needle) {
  const rows = source.split(/\r?\n/);
  const row = rows.findIndex(lineMatches);
  if (row === -1) throw new Error(`no line matched for: ${needle}`);
  const col = columnOf(rows[row], needle);
  if (col === -1) throw new Error(`"${needle}" not on the matched line: ${rows[row]}`);
  return scopesAt(lines, row, col);
}
