import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokenize, scopesOf, scopesAt, scopesOnLine } from "./tokenize.mjs";

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

/** Scopes at `needle` on the first line of `file` satisfying `lineMatches`. */
async function scopesOnMatchingLine(file, lineMatches, needle, scopeName) {
  const src = fixture(file);
  return scopesOnLine(await tokenize(src, scopeName), src, lineMatches, needle);
}

/** Asserts no token anywhere in `file` carries a gotmpl scope. */
async function assertNoTemplateScopes(file, scopeName, message) {
  const lines = await tokenize(fixture(file), scopeName);
  for (const line of lines) {
    for (const token of line) {
      assert.ok(
        !token.scopes.some((s) => s.includes("gotmpl") && s !== "source.yaml.gotmpl"),
        `${message} на "${token.text}": ${token.scopes.join(" ")}`,
      );
    }
  }
}

// --- U2: the mechanism itself -------------------------------------------

test("инъекция применяется на верхнем уровне значения", async () => {
  const scopes = await gotmplScopesAt("probe.yaml.gotmpl", "{{");
  assert.ok(has(scopes, "punctuation.section.embedded"), scopes.join(" "));
});

test("инъекция применяется внутри строки в двойных кавычках", async () => {
  const scopes = await scopesOnMatchingLine(
    "strings-and-blocks.yaml.gotmpl", (l) => l.startsWith("quoted:"), "{{",
  );
  assert.ok(has(scopes, "punctuation.section.embedded"), scopes.join(" "));
  assert.ok(scopes.includes("string.quoted.double.yaml"), "YAML-строка тоже должна остаться");
});

test("инъекция применяется внутри блочного скаляра", async () => {
  const scopes = await scopesOnMatchingLine(
    "strings-and-blocks.yaml.gotmpl", (l) => l.includes("raw {{"), "{{",
  );
  assert.ok(has(scopes, "punctuation.section.embedded"), scopes.join(" "));
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
  const digit = await scopesOnMatchingLine(
    "constructs.yaml.gotmpl", (l) => l.includes("{{ 3 }}"), "3",
  );
  assert.ok(has(digit, "constant.numeric"), digit.join(" "));
});

test("trim-маркер отделён от ключевого слова", async () => {
  const dash = await scopesOnMatchingLine(
    "constructs.yaml.gotmpl", (l) => l.includes("{{- if"), "-",
  );
  assert.ok(has(dash, "keyword.operator.trim"), dash.join(" "));
});

test("оператор конвейера — keyword.operator", async () => {
  const pipe = await scopesOnMatchingLine(
    "constructs.yaml.gotmpl", (l) => l.includes("| indent"), "|",
  );
  assert.ok(has(pipe, "keyword.operator"), pipe.join(" "));
});

test("оператор := — keyword.operator", async () => {
  const op = await scopesOnMatchingLine(
    "constructs.yaml.gotmpl", (l) => l.includes(":="), ":=",
  );
  assert.ok(has(op, "keyword.operator"), op.join(" "));
});

test("функция без пробелов внутри {{ }} тоже опознаётся", async () => {
  // Регрессия: lookahead требовал пробел, скобку или конец строки, поэтому
  // {{trim}} — валидный Go-шаблон — оставался без области функции.
  const line = "tight: {{trim}}";
  const lines = await tokenize(line);
  const scopes = scopesOf(lines, line, "trim");
  assert.ok(has(scopes, "entity.name.function"), scopes.join(" "));
});

test("комментарий шаблона поглощает вложенные {{ }}", async () => {
  const inner = await scopesOnMatchingLine(
    "constructs.yaml.gotmpl", (l) => l.includes("/*"), "{{ and }}",
  );
  assert.ok(inner.includes("comment.block.gotmpl"), inner.join(" "));
  assert.ok(
    !has(inner, "punctuation.section.embedded"),
    `вложенная вставка не должна открываться: ${inner.join(" ")}`,
  );
});

// --- U5: the corpus ------------------------------------------------------

test("{{ в комментарии YAML не открывает вставку", async () => {
  const scopes = await scopesOnMatchingLine(
    "strings-and-blocks.yaml.gotmpl", (l) => l.startsWith("#"), "{{",
  );
  assert.ok(has(scopes, "comment"), scopes.join(" "));
  assert.ok(!has(scopes, "punctuation.section.embedded"), scopes.join(" "));
});

test("вложенные range и if — оба ключевые слова", async () => {
  for (const word of ["range", "if"]) {
    const scopes = await scopesOnMatchingLine(
      "strings-and-blocks.yaml.gotmpl", (l) => l.includes(`{{- ${word}`), word,
    );
    assert.ok(has(scopes, "keyword.control"), `${word}: ${scopes.join(" ")}`);
  }
});

test("свёрнутый скаляр > ведёт себя как литеральный |", async () => {
  const scopes = await scopesOnMatchingLine(
    "strings-and-blocks.yaml.gotmpl", (l) => l.includes("folded {{"), "{{",
  );
  assert.ok(has(scopes, "punctuation.section.embedded"), scopes.join(" "));
});

test("файл без вставок не получает ни одной области шаблона", async () => {
  await assertNoTemplateScopes("no-actions.yaml.gotmpl", undefined, "неожиданная область шаблона");
});

// --- U6: isolation from other YAML files --------------------------------

for (const [file, what] of [
  ["plain.yaml", "обычный YAML"],
  ["workflow.yaml", "workflow GitHub Actions"],
]) {
  test(`инъекция не течёт в ${what}`, async () => {
    await assertNoTemplateScopes(file, "source.yaml", `инъекция протекла в ${what}`);
  });
}

test("тот же текст в .yaml.gotmpl области получает — иначе два теста выше проходили бы и на сломанной грамматике", async () => {
  const scopes = await scopesOnMatchingLine(
    "plain.yaml", (l) => l.startsWith("host:"), "{{", "source.yaml.gotmpl",
  );
  assert.ok(
    has(scopes, "punctuation.section.embedded"),
    `грамматика должна работать на нашем scope: ${scopes.join(" ")}`,
  );
});

// --- U10: the function lists come from the reference, not from memory ------

test("функции helmfile, добавленные по справочнику, опознаются", async () => {
  for (const name of ["fetchSecretValue", "include"]) {
    const scopes = await gotmplScopesAt("constructs.yaml.gotmpl", name);
    assert.ok(has(scopes, "support.function.gotmpl"), `${name}: ${scopes.join(" ")}`);
  }
});

test("встроенные функции Go несут собственную область", async () => {
  for (const name of ["eq", "printf"]) {
    const scopes = await gotmplScopesAt("constructs.yaml.gotmpl", name);
    assert.ok(has(scopes, "support.function.builtin.gotmpl"), `${name}: ${scopes.join(" ")}`);
  }
});

test("три категории функций различимы между собой", async () => {
  const [helmfile, builtin, sprig] = await Promise.all([
    gotmplScopesAt("constructs.yaml.gotmpl", "requiredEnv"),
    gotmplScopesAt("constructs.yaml.gotmpl", "printf"),
    gotmplScopesAt("constructs.yaml.gotmpl", "indent"),
  ]);
  const pick = (scopes) => scopes.find((s) => s.includes("function"));
  assert.equal(new Set([pick(helmfile), pick(builtin), pick(sprig)]).size, 3,
    `области совпали: ${pick(helmfile)} / ${pick(builtin)} / ${pick(sprig)}`);
});
