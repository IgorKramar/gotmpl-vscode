// Suggestions offered inside a template action.
//
// A pure function of line text and column, mirroring src/cursor.js: the
// provider turns the returned plain objects into editor API items.
const { allFunctions } = require("./reference.js");
const { KEYWORD_DOCS } = require("./keywords.js");

/** Paired constructs are offered as snippets that arrive already closed. */
const SNIPPETS = [
  { label: "if", snippet: "if ${1:condition} }}\n$0\n{{ end ", detail: "conditional block" },
  { label: "range", snippet: "range ${1:.Values.items} }}\n$0\n{{ end ", detail: "iteration block" },
  { label: "with", snippet: "with ${1:.Values.section} }}\n$0\n{{ end ", detail: "scoped block" },
];

/**
 * True when `character` sits inside a `{{ … }}` action — and not inside a
 * template comment, where a suggestion list would be noise.
 */
function insideAction(line, character) {
  let from = 0;
  for (;;) {
    const open = line.indexOf("{{", from);
    if (open === -1) return false;
    const close = line.indexOf("}}", open + 2);
    const end = close === -1 ? line.length : close + 2;
    if (character > open && character <= (close === -1 ? line.length : close)) {
      return !line.slice(open, end).startsWith("{{/*") && !line.slice(open, end).startsWith("{{- /*");
    }
    from = end;
  }
}

/** @typedef {{label: string, detail: string, documentation: string, snippet?: string}} Suggestion */

/**
 * @param {string} line
 * @param {number} character
 * @returns {Suggestion[]} empty outside an action — the YAML side belongs to the editor
 */
function completionsFor(line, character) {
  if (typeof line !== "string" || character < 0 || !insideAction(line, character)) return [];

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

  return suggestions;
}

module.exports = { completionsFor };
