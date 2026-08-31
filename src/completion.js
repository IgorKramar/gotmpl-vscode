// Suggestions offered inside a template action.
//
// A pure function of line text and column, mirroring src/cursor.js: the
// provider turns the returned plain objects into editor API items.
const { allFunctions } = require("./reference.js");
const { KEYWORD_DOCS } = require("./keywords.js");
const { actionSpans } = require("./cursor.js");

/** Paired constructs are offered as snippets that arrive already closed. */
const SNIPPETS = [
  { label: "if", snippet: "if ${1:condition} }}\n$0\n{{ end ", detail: "conditional block" },
  { label: "range", snippet: "range ${1:.Values.items} }}\n$0\n{{ end ", detail: "iteration block" },
  { label: "with", snippet: "with ${1:.Values.section} }}\n$0\n{{ end ", detail: "scoped block" },
];

/**
 * True when `character` sits in the expression part of an action — past the
 * opening delimiter, before the closing one, and not inside a template
 * comment. Standing on `{{` itself is not yet "inside": there is nothing to
 * complete there.
 */
function insideAction(line, character) {
  const span = actionSpans(line).find((s) => character >= s.open && character < s.end);
  if (!span) return false;

  const text = line.slice(span.open, span.end);
  if (text.startsWith("{{/*") || text.startsWith("{{- /*")) return false;

  const afterOpen = span.open + (text.startsWith("{{-") ? 3 : 2);
  const beforeClose = span.terminated ? span.end - (text.endsWith("-}}") ? 3 : 2) : span.end;
  return character >= afterOpen && character <= beforeClose;
}

/** @typedef {{label: string, detail: string, documentation: string, snippet?: string}} Suggestion */

/** @type {Suggestion[] | undefined} */
let cached;

/**
 * The suggestion list never varies by position — only by whether we are inside
 * an action at all. Built once: the editor asks on every keystroke.
 * @returns {Suggestion[]}
 */
function staticSuggestions() {
  if (cached) return cached;

  /** @type {Suggestion[]} */
  const suggestions = SNIPPETS.map((s) => ({
    label: s.label,
    detail: s.detail,
    documentation: KEYWORD_DOCS[s.label].summary,
    snippet: s.snippet,
  }));

  for (const entry of Object.values(allFunctions())) {
    suggestions.push({
      label: entry.name,
      detail: `${entry.source} function`,
      documentation: entry.description,
    });
  }

  for (const [name, doc] of Object.entries(KEYWORD_DOCS)) {
    if (SNIPPETS.some((s) => s.label === name)) continue;
    suggestions.push({ label: name, detail: "template keyword", documentation: doc.summary });
  }

  cached = suggestions;
  return cached;
}

/**
 * @param {string} line
 * @param {number} character
 * @returns {Suggestion[]} empty outside an action — the YAML side belongs to the editor
 */
function completionsFor(line, character) {
  if (typeof line !== "string" || character < 0 || !insideAction(line, character)) return [];

  /** @type {Suggestion[]} */
  return staticSuggestions();
}

module.exports = { completionsFor };
