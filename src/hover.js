// Turns a resolved cursor token into hover markdown.
//
// A pure function: the provider passes what the cursor resolver found and gets
// back either markdown or null. Everything that decides *what to show* lives
// here, where the ordinary test run reaches it.
const { functionDoc } = require("./reference.js");
const { keywordDoc } = require("./keywords.js");

const SOURCE_LABEL = { helmfile: "helmfile", sprig: "sprig" };

function fenced(code) {
  return ["```gotmpl", code, "```"].join("\n");
}

/**
 * @param {{kind: string, name: string} | null} token
 * @returns {string | null} markdown, or null when nothing is worth showing
 */
function hoverFor(token) {
  if (!token) return null;

  if (token.kind === "keyword") {
    const doc = keywordDoc(token.name);
    if (!doc) return null;
    return [`**\`${token.name}\`** — template keyword`, "", doc.summary, "", fenced(doc.example)].join("\n");
  }

  if (token.kind.endsWith("-function")) {
    const doc = functionDoc(token.name);
    if (!doc) return null;

    const origin = SOURCE_LABEL[doc.source] ?? doc.source;
    const heading = doc.overrides
      ? `**\`${doc.name}\`** — ${origin} function, overriding ${doc.overrides}`
      : `**\`${doc.name}\`** — ${origin} function`;

    const parts = [heading, "", doc.description];
    // The example is optional in the reference: a fair share of sprig functions
    // have none. An empty code block would be worse than no block.
    if (doc.example) parts.push("", fenced(doc.example));
    return parts.join("\n");
  }

  // Paths and variables resolve against values the extension never sees, and a
  // guess would be worse than silence.
  return null;
}

module.exports = { hoverFor };
