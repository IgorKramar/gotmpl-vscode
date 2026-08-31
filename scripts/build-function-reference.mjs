// Builds data/functions.json from the sprig and helmfile documentation.
//
// Parsing is separated from fetching on purpose: the parsers take text, not
// URLs, so the tests can exercise them against committed fixtures without
// reaching the network. Only the CLI entry point below downloads anything.
import { writeFileSync } from "node:fs";

const SPRIG_RAW = "https://raw.githubusercontent.com/Masterminds/sprig/master/docs";
const SPRIG_API = "https://api.github.com/repos/Masterminds/sprig/contents/docs";
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

/**
 * The example's first line doubles as a usage sample when it calls the function.
 *
 * The name must appear as a whole identifier: a substring match handed `split`
 * the example for `splitList`, because one name contains the other. A heading
 * naming several functions carries one example, so the others simply get no
 * usage rather than a call to their neighbour.
 */
function usageFrom(example, name) {
  if (!example) return undefined;
  const first = example.split("\n")[0].trim();
  const whole = new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_])`);
  return whole.test(first) ? first : undefined;
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

async function attemptFetch(url, headers = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": "gotmpl-yaml-highlighter build script", ...headers },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return response.text();
}

/**
 * Fetch a documentation page, falling back to the Contents API.
 *
 * The raw CDN answers 400 for some files that exist in the repository —
 * `docs/crypto.md` does so persistently, reproduced with curl, while the
 * Contents API serves the same file fine. Raw stays the primary path because
 * the API allows only 60 unauthenticated requests an hour; the fallback is
 * spent only on pages the CDN refuses.
 */
async function fetchPage(rawUrl, apiUrl) {
  try {
    return await attemptFetch(rawUrl);
  } catch (rawError) {
    try {
      return await attemptFetch(apiUrl, { accept: "application/vnd.github.raw" });
    } catch (apiError) {
      throw new Error(`raw: ${rawError.message}; api: ${apiError.message} for ${rawUrl}`);
    }
  }
}

async function fetchText(url) {
  return attemptFetch(url);
}

if (import.meta.main) {
  const results = await Promise.allSettled(
    SPRIG_PAGES.map(async (page) =>
      parseSprigPage(await fetchPage(`${SPRIG_RAW}/${page}.md`, `${SPRIG_API}/${page}.md?ref=master`), page),
    ),
  );
  const failed = SPRIG_PAGES.filter((_, i) => results[i].status === "rejected");

  // A partial download must never overwrite the committed reference: the file
  // would silently lose whole categories, and nothing downstream could tell
  // that from a source that genuinely shrank.
  if (failed.length > 0) {
    console.error("Could not fetch every sprig page, so the reference was left untouched:");
    for (const [i, page] of SPRIG_PAGES.entries()) {
      if (results[i].status === "rejected") console.error(`  ${page}: ${results[i].reason.message}`);
    }
    console.error("\nBoth the raw CDN and the Contents API refused these pages.");
    process.exit(1);
  }

  const sprig = results.flatMap((r) => r.value);
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
