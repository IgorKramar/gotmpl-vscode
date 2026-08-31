import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokenize, scopesOf, scopesAt } from "./tokenize.mjs";

const fixture = (name) => readFileSync(`test/fixtures/${name}`, "utf8");

/** gotmpl scopes at `needle`, minus the structural ones every token carries. */
async function gotmplScopesAt(file, needle, scopeName) {
  const src = fixture(file);
  const lines = await tokenize(src, scopeName);
  return scopesOf(lines, src, needle).filter(
    (s) => s.includes("gotmpl") && s !== "source.yaml.gotmpl" && !s.startsWith("meta.embedded"),
  );
}

const has = (scopes, prefix) => scopes.some((s) => s.startsWith(prefix));

// --- U2: the mechanism itself -------------------------------------------

test("инъекция применяется на верхнем уровне значения", async () => {
  const scopes = await gotmplScopesAt("probe.yaml.gotmpl", "{{");
  assert.ok(has(scopes, "punctuation.section.embedded"), scopes.join(" "));
});

test("инъекция применяется внутри строки в двойных кавычках", async () => {
  const src = fixture("strings-and-blocks.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.startsWith("quoted:"));
  const scopes = scopesAt(lines, row, rows[row].indexOf("{{"));
  assert.ok(scopes.some((s) => s.startsWith("punctuation.section.embedded")), scopes.join(" "));
  assert.ok(scopes.includes("string.quoted.double.yaml"), "YAML-строка тоже должна остаться");
});

test("инъекция применяется внутри блочного скаляра", async () => {
  const src = fixture("strings-and-blocks.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.includes('raw {{'));
  const scopes = scopesAt(lines, row, rows[row].indexOf("{{"));
  assert.ok(scopes.some((s) => s.startsWith("punctuation.section.embedded")), scopes.join(" "));
});

test("YAML-подсветка сохраняется", async () => {
  const src = fixture("probe.yaml.gotmpl");
  const lines = await tokenize(src);
  const scopes = scopesAt(lines, 0, 0);
  assert.ok(scopes.includes("entity.name.tag.yaml"), scopes.join(" "));
});

// --- U3: every construct R2 names ---------------------------------------

const CONSTRUCTS = [
  ["requiredEnv", "support.function"],
  ["readFile", "support.function"],
  ["if", "keyword.control"],
  ["range", "keyword.control"],
  ["with", "keyword.control"],
  ["end", "keyword.control"],
  ['"prod"', "string.quoted.double"],
  ["nil", "constant.language"],
  ["$key", "variable.other"],
  [".Environment", "variable.other.member"],
  ["indent", "entity.name.function"],
  ["quote", "entity.name.function"],
];

for (const [needle, want] of CONSTRUCTS) {
  test(`область для ${needle} — ${want}`, async () => {
    const scopes = await gotmplScopesAt("constructs.yaml.gotmpl", needle);
    assert.ok(has(scopes, want), `ожидалось ${want}, получено: ${scopes.join(" ") || "(нет)"}`);
  });
}

test("число внутри вставки — constant.numeric", async () => {
  const scopes = await gotmplScopesAt("constructs.yaml.gotmpl", "{{ 3 }}");
  assert.ok(scopes.some((s) => s.startsWith("punctuation.section.embedded")));
  const src = fixture("constructs.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.includes("{{ 3 }}"));
  const digit = scopesAt(lines, row, rows[row].indexOf("{{ 3 }}") + 3);
  assert.ok(digit.some((s) => s.startsWith("constant.numeric")), digit.join(" "));
});

test("trim-маркер отделён от ключевого слова", async () => {
  const src = fixture("constructs.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.includes("{{- if"));
  const dash = scopesAt(lines, row, rows[row].indexOf("{{-") + 2);
  assert.ok(dash.some((s) => s.startsWith("keyword.operator.trim")), dash.join(" "));
});

test("оператор конвейера — keyword.operator", async () => {
  const src = fixture("constructs.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.includes("| indent"));
  const pipe = scopesAt(lines, row, rows[row].indexOf("| indent"));
  assert.ok(pipe.some((s) => s.startsWith("keyword.operator")), pipe.join(" "));
});

test("оператор := — keyword.operator", async () => {
  const src = fixture("constructs.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.includes(":="));
  const op = scopesAt(lines, row, rows[row].indexOf(":="));
  assert.ok(op.some((s) => s.startsWith("keyword.operator")), op.join(" "));
});

test("комментарий шаблона поглощает вложенные {{ }}", async () => {
  const src = fixture("constructs.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.includes("/*"));
  const inner = scopesAt(lines, row, rows[row].indexOf("{{ and }}"));
  assert.ok(inner.includes("comment.block.gotmpl"), inner.join(" "));
  assert.ok(
    !inner.some((s) => s.startsWith("punctuation.section.embedded")),
    `вложенная вставка не должна открываться: ${inner.join(" ")}`,
  );
});

// --- U5: the corpus ------------------------------------------------------

test("{{ в комментарии YAML не открывает вставку", async () => {
  const src = fixture("strings-and-blocks.yaml.gotmpl");
  const lines = await tokenize(src);
  const scopes = scopesAt(lines, 0, src.split("\n")[0].indexOf("{{"));
  assert.ok(scopes.some((s) => s.startsWith("comment")), scopes.join(" "));
  assert.ok(!scopes.some((s) => s.startsWith("punctuation.section.embedded")), scopes.join(" "));
});

test("вложенные range и if — оба ключевые слова", async () => {
  const src = fixture("strings-and-blocks.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  for (const word of ["range", "if"]) {
    const row = rows.findIndex((l) => l.includes(`{{- ${word}`));
    const scopes = scopesAt(lines, row, rows[row].indexOf(word));
    assert.ok(scopes.some((s) => s.startsWith("keyword.control")), `${word}: ${scopes.join(" ")}`);
  }
});

test("свёрнутый скаляр > ведёт себя как литеральный |", async () => {
  const src = fixture("strings-and-blocks.yaml.gotmpl");
  const lines = await tokenize(src);
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.includes("folded {{"));
  const scopes = scopesAt(lines, row, rows[row].indexOf("{{"));
  assert.ok(scopes.some((s) => s.startsWith("punctuation.section.embedded")), scopes.join(" "));
});

test("файл без вставок не получает ни одной области шаблона", async () => {
  const src = fixture("no-actions.yaml.gotmpl");
  const lines = await tokenize(src);
  for (const line of lines) {
    for (const token of line) {
      assert.ok(
        !token.scopes.some((s) => s.includes("gotmpl") && s !== "source.yaml.gotmpl"),
        `неожиданная область шаблона на "${token.text}": ${token.scopes.join(" ")}`,
      );
    }
  }
});

// --- U6: isolation from other YAML files --------------------------------

test("обычный .yaml с {{ }} не затронут", async () => {
  const src = fixture("plain.yaml");
  const lines = await tokenize(src, "source.yaml");
  for (const line of lines) {
    for (const token of line) {
      assert.ok(
        !token.scopes.some((s) => s.includes("gotmpl")),
        `инъекция протекла в обычный YAML на "${token.text}": ${token.scopes.join(" ")}`,
      );
    }
  }
});

test("GitHub Actions ${{ }} не затронут", async () => {
  const src = fixture("workflow.yaml");
  const lines = await tokenize(src, "source.yaml");
  for (const line of lines) {
    for (const token of line) {
      assert.ok(
        !token.scopes.some((s) => s.includes("gotmpl")),
        `инъекция протекла в workflow на "${token.text}": ${token.scopes.join(" ")}`,
      );
    }
  }
});

test("тот же текст в .yaml.gotmpl области получает — иначе два теста выше проходили бы и на сломанной грамматике", async () => {
  const src = fixture("plain.yaml");
  const lines = await tokenize(src, "source.yaml.gotmpl");
  const rows = src.split("\n");
  const row = rows.findIndex((l) => l.startsWith("host:"));
  const scopes = scopesAt(lines, row, rows[row].indexOf("{{"));
  assert.ok(
    scopes.some((s) => s.startsWith("punctuation.section.embedded")),
    `грамматика должна работать на нашем scope: ${scopes.join(" ")}`,
  );
});
