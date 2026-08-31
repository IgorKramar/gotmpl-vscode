// What sits under the cursor, as a pure function of line text and column.
//
// The provider layer cannot be exercised outside a running editor, so all the
// judgement lives here and is covered by the ordinary test run. Everything the
// provider does with this result is API plumbing without branches.

const HELMFILE = new Set([
  "env", "envExec", "exec", "expandSecretRefs", "fetchSecretValue", "fromYaml",
  "get", "getOrNil", "include", "isDir", "isFile", "readDir", "readDirEntries",
  "readFile", "required", "requiredEnv", "setValueAtPath", "toYaml", "tpl",
]);

const GO_BUILTIN = new Set([
  "and", "call", "eq", "ge", "gt", "html", "index", "js", "le", "len", "lt",
  "ne", "not", "or", "print", "printf", "println", "slice", "urlquery",
]);

const KEYWORDS = new Set([
  "if", "else", "end", "range", "with", "define", "template", "block",
  "break", "continue",
]);

/**
 * Spans of every `{{ … }}` action on the line, closed or not.
 *
 * Exported because "is this column inside an action" is one question with one
 * answer: a second implementation drifted on the delimiter columns before this
 * became shared.
 */
function actionSpans(line) {
  const spans = [];
  let from = 0;
  for (;;) {
    const open = line.indexOf("{{", from);
    if (open === -1) break;
    const close = line.indexOf("}}", open + 2);
    // An unterminated action still owns the rest of the line: the file is being
    // typed, and the cursor is usually inside exactly that action.
    const end = close === -1 ? line.length : close + 2;
    spans.push({ open, end, terminated: close !== -1 });
    from = end;
  }
  return spans;
}

/** Tokens inside one action span, in source order. */
function tokenize(line, span) {
  const inner = line.slice(span.open, span.end);
  const tokens = [];
  const push = (kind, text, offset) =>
    tokens.push({ kind, text, start: span.open + offset, end: span.open + offset + text.length });

  const pattern = new RegExp(
    [
      "(\\{\\{-?|-?\\}\\})", // 1 delimiters, trim marker included
      "(/\\*[\\s\\S]*?\\*/)", // 2 template comment
      '("(?:[^"\\\\]|\\\\.)*"?|`[^`]*`?)', // 3 string, possibly unterminated
      "(\\$[A-Za-z_][A-Za-z0-9_]*|\\$)", // 4 variable
      "(\\.[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*|\\.)", // 5 path
      "(\\b\\d+(?:\\.\\d+)?\\b)", // 6 number
      "([A-Za-z_][A-Za-z0-9_]*)", // 7 bare identifier
      "(\\||:=|=)", // 8 operator
    ].join("|"),
    "g",
  );

  for (let m; (m = pattern.exec(inner)) !== null; ) {
    const [text] = m;
    if (m[1]) push("delimiter", text, m.index);
    else if (m[2]) push("comment", text, m.index);
    else if (m[3]) push("string", text, m.index);
    else if (m[4]) push("variable", text, m.index);
    else if (m[5]) push("path", text, m.index);
    else if (m[6]) push("number", text, m.index);
    else if (m[7]) push("identifier", text, m.index);
    else if (m[8]) push("operator", text, m.index);
  }
  return tokens;
}

/** Which of the three lists an identifier belongs to. */
function classifyIdentifier(name) {
  if (KEYWORDS.has(name)) return "keyword";
  if (HELMFILE.has(name)) return "helmfile-function";
  if (GO_BUILTIN.has(name)) return "builtin-function";
  return "sprig-function";
}

/**
 * The token at `character`, or null when the cursor is outside any action.
 *
 * A token owns the columns from its first character through its last: the
 * position just past a name belongs to no token, which is what keeps a name
 * from being reported when the cursor has already left it.
 *
 * @param {string} line
 * @param {number} character
 * @returns {{kind: string, name: string, start: number, end: number} | null}
 */
function resolveAt(line, character) {
  if (typeof line !== "string" || character < 0 || character >= line.length) return null;

  const span = actionSpans(line).find((s) => character >= s.open && character < s.end);
  if (!span) return null;

  const token = tokenize(line, span).find((t) => character >= t.start && character < t.end);
  if (!token) return null;

  const kind = token.kind === "identifier" ? classifyIdentifier(token.text) : token.kind;
  return { kind, name: token.text, start: token.start, end: token.end };
}

module.exports = { resolveAt, actionSpans, HELMFILE, GO_BUILTIN, KEYWORDS };
