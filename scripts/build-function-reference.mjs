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

/**
 * Functions documented as a list item rather than a heading:
 *
 *     - `b64enc`/`b64dec`: Encode or decode with Base64
 *
 * `docs/encoding.md` uses this shape for every function it describes, so a
 * heading-only parser silently returned nothing for that whole page.
 */
function parseSprigList(text, page) {
  const entries = [];
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*-\s+(`[A-Za-z0-9_]+`(?:\s*\/\s*`[A-Za-z0-9_]+`)*)\s*:\s*(.+)$/);
    if (!item) continue;
    const names = [...item[1].matchAll(/`([A-Za-z0-9_]+)`/g)].map((m) => m[1]);
    const description = item[2].trim();
    for (const name of names) {
      entries.push({ name, source: "sprig", category: page || undefined, description });
    }
  }
  return entries;
}

/**
 * Parse one sprig documentation page. Returns entries in document order.
 *
 * Both `##` and `###` count as function headings: `docs/paths.md` keeps its
 * functions at the third level and uses the second for prose ("Paths",
 * "Filepaths"), so reading only `##` there yields nothing at all.
 */
export function parseSprigPage(text, page = "") {
  const entries = [];
  for (const section of text.split(/^#{2,3} /m).slice(1)) {
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
  // A page may document functions either way; encoding.md uses only the list
  // form, and a heading page yields nothing here, so both run and merge.
  const seen = new Set(entries.map((e) => e.name));
  for (const entry of parseSprigList(text, page)) {
    if (!seen.has(entry.name)) entries.push(entry);
  }
  if (entries.length === 0) {
    const single = parseSprigSingleFunctionPage(text, page);
    if (single) entries.push(single);
  }
  return entries;
}

/**
 * A page describing exactly one function, naming it only inside a fenced block:
 * `docs/uuid.md` is the whole of this case. Deliberately narrow — it applies
 * only when neither headings nor list items produced anything, and only when
 * the block holds a bare identifier.
 */
function parseSprigSingleFunctionPage(text, page) {
  const fence = text.match(/```[a-z]*\n\s*([a-z][A-Za-z0-9_]*)\s*\n```/);
  if (!fence) return undefined;
  const intro = text.split("\n").find((line) => line.trim() && !line.startsWith("#"));
  return {
    name: fence[1],
    source: "sprig",
    category: page || undefined,
    description: intro?.trim() ?? "",
    example: fence[1],
  };
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

if (import.meta.main) {
  const sources = [
    ...SPRIG_PAGES.map((page) => ({
      label: `sprig/${page}`,
      fetch: () => fetchPage(`${SPRIG_RAW}/${page}.md`, `${SPRIG_API}/${page}.md?ref=master`),
      parse: (text) => parseSprigPage(text, page),
    })),
    {
      label: "helmfile",
      fetch: () => attemptFetch(HELMFILE_URL),
      parse: parseHelmfilePage,
    },
  ];

  const results = await Promise.allSettled(
    sources.map(async ({ fetch: get, parse, label }) => {
      const entries = parse(await get());
      // A page that parses to nothing is a failure wearing success. The CDN can
      // answer 200 with an error page, and a reformatted source parses to zero
      // just as quietly — neither raises, and the count check below passes
      // trivially on an empty result. Every documentation page has functions.
      if (entries.length === 0) throw new Error("parsed to zero functions — source changed or is not the expected page");
      return { label, entries };
    }),
  );

  // A partial or empty download must never overwrite the committed reference:
  // the file would silently lose whole categories, and nothing downstream could
  // tell that from a source that genuinely shrank.
  const failures = results
    .map((r, i) => (r.status === "rejected" ? `  ${sources[i].label}: ${r.reason.message}` : null))
    .filter(Boolean);
  if (failures.length > 0) {
    console.error("The reference was left untouched — these sources did not yield functions:");
    for (const line of failures) console.error(line);
    process.exit(1);
  }

  const parsed = results.map((r) => r.value);
  const sprig = parsed.filter((r) => r.label !== "helmfile").flatMap((r) => r.entries);
  const helmfile = parsed.find((r) => r.label === "helmfile").entries;
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
