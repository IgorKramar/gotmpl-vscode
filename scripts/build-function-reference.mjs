// Builds data/functions.json from the sprig and helmfile documentation.
//
// Parsing is separated from fetching on purpose: the parsers take text, not
// URLs, so the tests can exercise them against committed fixtures without
// reaching the network. Only the CLI entry point below downloads anything.
import { writeFileSync } from "node:fs";

const SPRIG_BASE = "https://raw.githubusercontent.com/Masterminds/sprig/master/docs";
const SPRIG_PAGES = [
  "conversion", "crypto", "date", "defaults", "dicts", "encoding",
  "flow_control", "integer_slice", "lists", "math", "mathf", "network",
  "os", "paths", "reflection", "semver", "string_slice", "strings", "url", "uuid",
];
const HELMFILE_URL =
  "https://raw.githubusercontent.com/helmfile/helmfile/main/docs/templating_funcs.md";

const OUT = "data/functions.json";

/**
 * A sprig heading may name more than one function, comma-separated
 * (`## merge, mustMerge`) or joined by " and " (`## quote and squote`).
 * Prose sections ("A Note on Dict Internals", "Type Functions") share the
 * heading level, and the only thing separating them from real entries is
 * shape: a sprig function name is an identifier starting lowercase.
 */
function splitSprigHeading(heading) {
  return heading
    .split(",")
    .flatMap((chunk) => chunk.split(" and "))
    .map((part) => part.trim())
    .filter((part) => /^[a-z][A-Za-z0-9_]*$/.test(part));
}

/** Description is the prose before the first fenced block; the block is the example. */
function splitBody(body) {
  const fence = body.match(/```[a-z]*\n([\s\S]*?)```/);
  const prose = (fence ? body.slice(0, fence.index) : body)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return { description: prose, example: fence ? fence[1].trim() : undefined };
}

/** The example's first line doubles as a usage sample when it calls the function. */
function usageFrom(example, name) {
  if (!example) return undefined;
  const first = example.split("\n")[0].trim();
  return first.includes(name) ? first : undefined;
}

/** Parse one sprig documentation page. Returns entries in document order. */
export function parseSprigPage(text, page = "") {
  const entries = [];
  for (const section of text.split(/^## /m).slice(1)) {
    const [heading, ...rest] = section.split("\n");
    const body = rest.join("\n");
    const names = splitSprigHeading(heading);
    if (names.length === 0) continue;
    const { description, example } = splitBody(body);
    for (const name of names) {
      entries.push({
        name,
        source: "sprig",
        category: page || undefined,
        description,
        example,
        usage: usageFrom(example, name),
      });
    }
  }
  return entries;
}

/** Parse the helmfile page. Its headings are `#### ` plus a backticked name. */
export function parseHelmfilePage(text) {
  const entries = [];
  for (const section of text.split(/^#### /m).slice(1)) {
    const [heading, ...rest] = section.split("\n");
    const name = heading.match(/^`([^`]+)`/)?.[1];
    if (!name) continue;
    const { description, example } = splitBody(rest.join("\n"));
    entries.push({
      name,
      source: "helmfile",
      description,
      example,
      usage: usageFrom(example, name),
    });
  }
  return entries;
}

/**
 * Merge both sources into one name -> entry map.
 *
 * `env` and `get` exist in both. Inside a helmfile the helmfile definition is
 * the one that applies, so it wins — by an explicit rule over the source field,
 * not by whichever list happens to be merged last. A silent ordering could not
 * be checked and would not be noticed when it broke.
 */
export function mergeEntries(sprigEntries, helmfileEntries) {
  const byName = new Map();
  for (const entry of sprigEntries) byName.set(entry.name, entry);
  for (const entry of helmfileEntries) {
    const existing = byName.get(entry.name);
    byName.set(entry.name, existing ? { ...entry, overrides: existing.source } : entry);
  }
  return Object.fromEntries([...byName].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Counts the build prints. The only place a changed source becomes visible.
 *
 * Parsed counts and post-merge counts are reported separately: after the merge
 * `env` and `get` belong to helmfile, so "from sprig" would read two short of
 * what the sprig documentation actually contains. Completeness must be checked
 * against what was parsed, not against what survived the merge.
 */
export function summarize(functions, parsed = {}) {
  const all = Object.values(functions);
  return {
    parsedSprig: parsed.sprig,
    parsedHelmfile: parsed.helmfile,
    total: all.length,
    sprig: all.filter((f) => f.source === "sprig").length,
    helmfile: all.filter((f) => f.source === "helmfile").length,
    overridden: all.filter((f) => f.overrides).length,
    withoutDescription: all.filter((f) => !f.description).length,
    withoutExample: all.filter((f) => !f.example).length,
    withoutUsage: all.filter((f) => !f.usage).length,
  };
}

async function fetchText(url) {
  // raw.githubusercontent.com answers 400 to a request with no User-Agent, and
  // Node's fetch sends none by default — unlike curl, which is why this works
  // by hand and fails in the script.
  const response = await fetch(url, {
    headers: { "user-agent": "gotmpl-yaml-highlighter build script" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

if (import.meta.main) {
  const sprig = (
    await Promise.all(
      SPRIG_PAGES.map(async (page) => parseSprigPage(await fetchText(`${SPRIG_BASE}/${page}.md`), page)),
    )
  ).flat();
  const helmfile = parseHelmfilePage(await fetchText(HELMFILE_URL));
  const functions = mergeEntries(sprig, helmfile);

  writeFileSync(OUT, `${JSON.stringify(functions, null, 2)}\n`);

  const counts = summarize(functions, { sprig: sprig.length, helmfile: helmfile.length });
  console.log(`Wrote ${OUT}`);
  console.log(`  parsed from sprig:    ${counts.parsedSprig}`);
  console.log(`  parsed from helmfile: ${counts.parsedHelmfile}`);
  console.log(`  total after merge:    ${counts.total}`);
  console.log(`  kept as sprig:        ${counts.sprig}`);
  console.log(`  kept as helmfile:     ${counts.helmfile}`);
  console.log(`  helmfile overrides:   ${counts.overridden}`);
  console.log(`  without description:  ${counts.withoutDescription}`);
  console.log(`  without example:      ${counts.withoutExample}`);
  console.log(`  without usage:        ${counts.withoutUsage}`);
  if (counts.withoutDescription > 0) {
    console.error("\nEntries without a description mean the parser lost content — investigate.");
    process.exit(1);
  }
}
