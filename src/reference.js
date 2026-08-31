// Access to the generated function reference.
//
// Read once and cached: the file ships with the extension and never changes
// while the editor runs.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/** @typedef {{name: string, source: string, category?: string, description: string, example?: string, usage?: string, overrides?: string}} FunctionEntry */

/** @type {Record<string, FunctionEntry> | undefined} */
let cache;

/** @returns {Record<string, FunctionEntry>} */
function allFunctions() {
  if (!cache) {
    cache = JSON.parse(readFileSync(join(__dirname, "..", "data", "functions.json"), "utf8"));
  }
  return cache;
}

/**
 * @param {string} name
 * @returns {FunctionEntry | undefined}
 */
function functionDoc(name) {
  return allFunctions()[name];
}

module.exports = { allFunctions, functionDoc };
