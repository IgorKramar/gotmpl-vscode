// Finds unclosed actions and unbalanced constructs across a whole document.
//
// A pure function of text: the provider turns findings into editor objects and
// decides nothing. Balance cannot be judged line by line — a construct opens on
// one line and closes on another — so this walks the document with a stack,
// while src/cursor.js keeps owning the single-line question.
const { actionSpans, HELMFILE, GO_BUILTIN, KEYWORDS } = require("./cursor.js");

const OPENING = new Set(["if", "range", "with", "define", "block"]);

/** @typedef {{line: number, start: number, end: number, message: string}} Finding */

/**
 * Does the text right after `{{` look like a template expression?
 *
 * Inside a quoted YAML string `{{` is ambiguous: `"use {{ to interpolate"` is
 * prose, `"broken {{ requiredEnv "X"` is a real unclosed action, and the only
 * thing that would separate them — a closing `}}` — is exactly what is missing.
 * The tie is broken on what follows: a keyword, a known function, a path or a
 * variable reads as template; anything else reads as text. The cost is named in
 * KTD13: a literal `"{{ if"` inside a string will be reported.
 */
function looksLikeTemplate(rest) {
  const head = rest.replace(/^-?\s*/, "");
  if (/^[.$]/.test(head)) return true;
  const word = head.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  if (!word) return false;
  return KEYWORDS.has(word) || HELMFILE.has(word) || GO_BUILTIN.has(word) || /^[a-z]/.test(word);
}

/**
 * Scans one line once for both things that depend on quoting: the ranges
 * covered by quoted strings, and where a YAML comment starts.
 *
 * One scanner, not two. Both answers need the same state — which quote is
 * open — and two independent implementations of "am I inside a string" is
 * exactly the shape that drifted apart elsewhere in this extension.
 *
 * @param {string} line
 * @returns {{quoted: {start: number, end: number}[], comment: number}}
 */
function scanLine(line) {
  /** @type {{start: number, end: number}[]} */
  const quoted = [];
  let quote = null;
  let start = 0;
  let comment = -1;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) {
        quoted.push({ start, end: i + 1 });
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      start = i;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      comment = i;
      break;
    }
  }
  // An unterminated quote owns the rest of the line: the file is being typed.
  if (quote) quoted.push({ start, end: line.length });

  return { quoted, comment };
}

/**
 * Ranges of `{{/* … *\/}}` comments over the whole text, as [start, end) offsets.
 *
 * Found before the document is split into actions, because a `}}` inside the
 * comment body ends an action span early — the comment then never looks closed,
 * a "we are inside a comment" flag sticks forever, and everything after it is
 * silently ignored. That is not hypothetical: it is what the first version did,
 * and the check that caught it was the one asserting silence is meaningful.
 */
function templateCommentRanges(text) {
  const ranges = [];
  const open = /\{\{-?\s*\/\*/g;
  for (let m; (m = open.exec(text)) !== null; ) {
    const close = text.indexOf("*/", m.index + m[0].length);
    if (close === -1) {
      ranges.push({ start: m.index, end: text.length });
      break;
    }
    const after = text.slice(close + 2).match(/^\s*-?\}\}/);
    const end = close + 2 + (after ? after[0].length : 0);
    ranges.push({ start: m.index, end });
    open.lastIndex = end;
  }
  return ranges;
}

const MESSAGES = {
  unclosedAction: "Unclosed action: `{{` has no matching `}}`.",
  unclosedConstruct: (word) => `Unclosed \`${word}\`: no matching \`{{ end }}\`.`,
  strayEnd: "Unexpected `{{ end }}`: nothing is open here.",
  strayElse: "`{{ else }}` outside an `if` or `with`.",
};

/**
 * @param {string} text full document text
 * @returns {Finding[]}
 */
function analyze(text) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {{word: string, line: number, start: number, end: number}[]} */
  const stack = [];

  const commentRanges = templateCommentRanges(text);
  const lines = text.split(/\r?\n/);
  let lineOffset = 0;
  for (const [lineNo, line] of lines.entries()) {
    const offsetOfLine = lineOffset;
    lineOffset += line.length + 1;
    const { quoted, comment } = scanLine(line);

    for (const span of actionSpans(line)) {
      // A YAML comment swallows everything after it, template syntax included.
      if (comment !== -1 && span.open > comment) continue;

      // Anything inside a template comment is inert, nesting included.
      const absolute = offsetOfLine + span.open;
      if (commentRanges.some((r) => absolute >= r.start && absolute < r.end)) continue;

      const body = line.slice(span.open, span.end);

      if (!span.terminated) {
        const insideString = quoted.some((r) => span.open >= r.start && span.open < r.end);
        const rest = line.slice(span.open + 2);
        if (!insideString || looksLikeTemplate(rest)) {
          findings.push({
            line: lineNo,
            start: span.open,
            end: Math.min(span.open + 2, line.length),
            message: MESSAGES.unclosedAction,
          });
        }
        continue;
      }

      const word = body.match(/^\{\{-?\s*([A-Za-z]+)/)?.[1];
      if (!word || !KEYWORDS.has(word)) continue;

      const at = { line: lineNo, start: span.open, end: span.end };
      if (OPENING.has(word)) {
        stack.push({ word, ...at });
      } else if (word === "end") {
        if (stack.length === 0) findings.push({ ...at, message: MESSAGES.strayEnd });
        else stack.pop();
      } else if (word === "else") {
        const top = stack[stack.length - 1];
        if (!top || (top.word !== "if" && top.word !== "with")) {
          findings.push({ ...at, message: MESSAGES.strayElse });
        }
      }
    }
  }

  // Whatever is still open was never closed. The position comes from the stack,
  // so nesting points at the construct that is actually unclosed.
  for (const open of stack) {
    findings.push({
      line: open.line,
      start: open.start,
      end: open.end,
      message: MESSAGES.unclosedConstruct(open.word),
    });
  }

  return findings.sort((a, b) => a.line - b.line || a.start - b.start);
}

/**
 * Where `{{ end }}` should go for a construct opened at `openLine`, or null.
 *
 * The block ends where indentation returns to the opening level. When that
 * cannot be told — the construct opens at column zero, or nothing follows —
 * this returns null and no quick fix is offered: inserting `end` in the wrong
 * place is worse than offering nothing, because the user applies it and gets
 * a different bug.
 *
 * @param {string} text
 * @param {number} openLine
 * @returns {{line: number, indent: string} | null}
 */
function endInsertionPoint(text, openLine) {
  const lines = text.split(/\r?\n/);
  const opening = lines[openLine];
  if (opening === undefined) return null;

  const indent = opening.match(/^\s*/)?.[0] ?? "";
  if (indent.length === 0) return null;

  for (let i = openLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const here = line.match(/^\s*/)?.[0].length ?? 0;
    if (here <= indent.length) return { line: i, indent };
  }
  return null;
}

module.exports = { analyze, endInsertionPoint, MESSAGES };
