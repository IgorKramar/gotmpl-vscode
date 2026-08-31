import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  parseSprigPage,
  parseHelmfilePage,
  mergeEntries,
  summarize,
} from "../scripts/build-function-reference.mjs";

const DOCS = "test/fixtures/docs";
const fixture = (name) => readFileSync(`${DOCS}/${name}`, "utf8");
const byName = (entries) => Object.fromEntries(entries.map((e) => [e.name, e]));

// --- U8: the parsers, offline, against real documentation fragments ---------

test("одиночный заголовок даёт одну запись с описанием", () => {
  const found = byName(parseSprigPage(fixture("sprig-strings.md"), "strings"));
  assert.ok(found.trim, "trim не разобран");
  assert.equal(found.trim.source, "sprig");
  assert.equal(found.trim.category, "strings");
  assert.match(found.trim.description, /removes space/);
  assert.ok(found.trim.example, "у trim должен быть пример");
});

test("заголовок через запятую даёт запись на каждую функцию", () => {
  const found = byName(parseSprigPage(fixture("sprig-dicts.md"), "dicts"));
  for (const name of ["merge", "mustMerge"]) {
    assert.ok(found[name], `${name} не разобран`);
    assert.ok(found[name].description, `${name} без описания`);
  }
  assert.equal(found.merge.example, found.mustMerge.example, "пример у пары общий");
});

test('заголовок через " and " даёт запись на каждую функцию', () => {
  const found = byName(parseSprigPage(fixture("sprig-strings.md"), "strings"));
  for (const name of ["quote", "squote"]) {
    assert.ok(found[name], `${name} не разобран`);
    assert.ok(found[name].description, `${name} без описания`);
  }
});

test("прозаический раздел записи не даёт", () => {
  const names = parseSprigPage(fixture("sprig-dicts.md"), "dicts").map((e) => e.name);
  assert.ok(
    !names.some((n) => n.includes(" ") || /^[A-Z]/.test(n)),
    `в записи попал не идентификатор: ${names.join(", ")}`,
  );
  assert.deepEqual(names.sort(), ["merge", "mustMerge"]);
});

test("функция без примера даёт запись, а не пропуск", () => {
  const found = byName(parseSprigPage(fixture("sprig-date.md"), "date"));
  assert.ok(found.now, "now потерян");
  assert.ok(found.now.description, "now без описания");
  assert.equal(found.now.example, undefined);
  assert.equal(found.now.usage, undefined);
});

test("форма helmfile разбирается своим разбором", () => {
  const found = byName(parseHelmfilePage(fixture("helmfile-templating-funcs.md")));
  assert.deepEqual(Object.keys(found).sort(), ["env", "readFile", "requiredEnv"]);
  assert.equal(found.requiredEnv.source, "helmfile");
  assert.match(found.requiredEnv.description, /required for template rendering/);
});

test("разборы не путают источники", () => {
  // sprig-разбор на файле helmfile и наоборот: заголовки разного уровня,
  // поэтому каждый должен вернуть пусто, а не наполовину разобранное.
  assert.equal(parseSprigPage(fixture("helmfile-templating-funcs.md")).length, 0);
  assert.equal(parseHelmfilePage(fixture("sprig-strings.md")).length, 0);
});

test("при слиянии определение helmfile побеждает и это видно в записи", () => {
  const sprig = parseSprigPage("## env\n\nSprig's own env.\n\n```\nenv \"HOME\"\n```\n");
  const helmfile = parseHelmfilePage(fixture("helmfile-templating-funcs.md"));
  const merged = mergeEntries(sprig, helmfile);
  assert.equal(merged.env.source, "helmfile");
  assert.equal(merged.env.overrides, "sprig", "перезапись должна быть видна полем, а не подразумеваться");
});

test("функция без пересечения слиянием не трогается", () => {
  const sprig = parseSprigPage(fixture("sprig-strings.md"), "strings");
  const merged = mergeEntries(sprig, parseHelmfilePage(fixture("helmfile-templating-funcs.md")));
  assert.equal(merged.trim.source, "sprig");
  assert.equal(merged.trim.overrides, undefined);
});

test("списочная форма даёт записи", () => {
  // encoding.md документирует функции только списком: заголовочный разбор
  // возвращал по этой странице ноль, и её функции терялись целиком.
  const found = byName(parseSprigPage(fixture("sprig-encoding.md"), "encoding"));
  for (const name of ["b64enc", "b64dec", "b32enc", "b32dec"]) {
    assert.ok(found[name], `${name} не разобран`);
    assert.ok(found[name].description, `${name} без описания`);
  }
});

test("заголовки третьего уровня считаются функциями", () => {
  // paths.md держит функции на ###, а ## занимает прозой.
  const found = byName(parseSprigPage(fixture("sprig-paths.md"), "paths"));
  for (const name of ["base", "dir", "clean"]) {
    assert.ok(found[name], `${name} не разобран`);
  }
  assert.ok(!found.Paths, "прозаический раздел не должен становиться функцией");
});

test("страница про одну функцию с именем в блоке разбирается", () => {
  const found = byName(parseSprigPage(fixture("sprig-uuid.md"), "uuid"));
  assert.ok(found.uuidv4, "uuidv4 не разобран");
  assert.ok(found.uuidv4.description, "uuidv4 без описания");
});

// --- U9: completeness, checked by a second independent path ----------------

/**
 * Counts function names in the fixtures WITHOUT touching the generator's
 * parsers. Two independent routes to one number: agreement is the proof.
 * Comparing the reference against itself would be green on a broken generator.
 */
function countHeadingsIndependently() {
  const names = new Set();
  for (const file of readdirSync(DOCS)) {
    const text = fixture(file);
    let sawAny = false;
    for (const line of text.split("\n")) {
      // headings, second or third level
      const heading = line.match(/^#{2,3} (.+)$/);
      if (heading) {
        for (const chunk of heading[1].split(",")) {
          for (const part of chunk.split(" and ")) {
            const name = part.trim();
            if (/^[a-z][A-Za-z0-9_]*$/.test(name)) {
              names.add(name);
              sawAny = true;
            }
          }
        }
      }
      // list items: - `a`/`b`: description
      const item = line.match(/^\s*-\s+(`[A-Za-z0-9_]+`(?:\s*\/\s*`[A-Za-z0-9_]+`)*)\s*:/);
      if (item) {
        for (const [, name] of item[1].matchAll(/`([A-Za-z0-9_]+)`/g)) {
          names.add(name);
          sawAny = true;
        }
      }
      // helmfile headings
      const helmfile = line.match(/^#### `([^`]+)`$/);
      if (helmfile) {
        names.add(helmfile[1]);
        sawAny = true;
      }
    }
    // a page naming its single function only inside a fenced block
    if (!sawAny) {
      const fence = text.match(/```[a-z]*\n\s*([a-z][A-Za-z0-9_]*)\s*\n```/);
      if (fence) names.add(fence[1]);
    }
  }
  return names;
}

let allFixtures;
function parseAllFixtures() {
  if (allFixtures) return allFixtures;
  const sprig = readdirSync(DOCS)
    .filter((f) => f.startsWith("sprig-"))
    .flatMap((f) => parseSprigPage(fixture(f), f.replace(/^sprig-|\.md$/g, "")));
  const helmfile = readdirSync(DOCS)
    .filter((f) => f.startsWith("helmfile-"))
    .flatMap((f) => parseHelmfilePage(fixture(f)));
  allFixtures = mergeEntries(sprig, helmfile);
  return allFixtures;
}

test("число записей совпадает с независимо посчитанным по образцам", () => {
  const parsed = Object.keys(parseAllFixtures()).length;
  const counted = countHeadingsIndependently().size;
  assert.equal(parsed, counted, `разбор дал ${parsed}, прямой подсчёт — ${counted}`);
});

test("списки имён совпадают целиком, а не только длиной", () => {
  const parsed = new Set(Object.keys(parseAllFixtures()));
  const counted = countHeadingsIndependently();
  const missing = [...counted].filter((n) => !parsed.has(n));
  const extra = [...parsed].filter((n) => !counted.has(n));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
});

test("записей без описания нет", () => {
  const without = Object.values(parseAllFixtures()).filter((e) => !e.description);
  assert.deepEqual(without.map((e) => e.name), []);
});

test("число записей без примера закреплено", () => {
  // Растёт молча — значит источник изменился или разбор потерял блоки.
  // В образцах примера нет у now, untitle и пары quote/squote: их общий
  // раздел в документации описание несёт, а фенсированный блок — нет.
  const counts = summarize(parseAllFixtures());
  assert.equal(counts.withoutExample, 9);
});

test("usage вызывает свою функцию, а не ту, чьё имя её содержит", () => {
  // splitList содержит split: подстрочный поиск отдавал split чужой пример.
  const entries = Object.values(JSON.parse(readFileSync("data/functions.json", "utf8")));
  const wrong = entries.filter(
    (e) => e.usage && !new RegExp(`(?<![A-Za-z0-9_$])${e.name}(?![A-Za-z0-9_])`).test(e.usage),
  );
  assert.deepEqual(wrong.map((e) => `${e.name}: ${e.usage}`), []);
});

// --- the shipped reference is the generator's output, not a hand-edited file -

test("сгенерированный справочник содержит обе группы и помечает перезапись", () => {
  const functions = JSON.parse(readFileSync("data/functions.json", "utf8"));
  const counts = summarize(functions);
  assert.ok(counts.helmfile >= 19, `функций helmfile: ${counts.helmfile}`);
  assert.ok(counts.sprig > 150, `функций sprig: ${counts.sprig}`);
  assert.equal(counts.withoutDescription, 0);
  assert.equal(functions.env.source, "helmfile");
  assert.equal(functions.env.overrides, "sprig");
});
