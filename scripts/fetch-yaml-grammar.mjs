// Copies VS Code's built-in YAML grammar chain into vendor/ for out-of-editor
// tokenization tests. The grammar ships with the editor and is versioned with
// it, so a checked-in copy would go stale silently.
//
// The chain matters: source.yaml is a thin dispatcher that includes
// source.yaml.1.2 by default and source.yaml.embedded for embedding. Copying
// only yaml.tmLanguage.json would produce a grammar that highlights nothing.
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CANDIDATES = [
  "/usr/share/code/resources/app/extensions/yaml/syntaxes",
  "/usr/lib/code/extensions/yaml/syntaxes",
  "/opt/visual-studio-code/resources/app/extensions/yaml/syntaxes",
  "/usr/share/code-oss/resources/app/extensions/yaml/syntaxes",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/yaml/syntaxes",
  join(homedir(), "AppData/Local/Programs/Microsoft VS Code/resources/app/extensions/yaml/syntaxes"),
];

const OUT = "vendor/yaml-syntaxes";

// `--if-missing` makes this a no-op once the grammar is in place, so it can run
// as a pretest hook without recopying on every test run.
if (process.argv.includes("--if-missing") && existsSync(join(OUT, "yaml.tmLanguage.json"))) {
  process.exit(0);
}

const source = CANDIDATES.find((dir) => existsSync(join(dir, "yaml.tmLanguage.json")));
if (!source) {
  console.error("VS Code's built-in YAML grammar was not found. Looked in:");
  for (const dir of CANDIDATES) console.error(`  ${dir}`);
  console.error("\nVS Code must be installed to run the tokenization tests.");
  console.error("If it lives somewhere else, add that path to CANDIDATES in this script.");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const copied = readdirSync(source).filter((f) => f.endsWith(".tmLanguage.json"));
for (const file of copied) copyFileSync(join(source, file), join(OUT, file));

console.log(`Copied ${copied.length} grammar files from ${source} to ${OUT}/`);
for (const file of copied) console.log(`  ${file}`);
