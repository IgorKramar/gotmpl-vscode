import { test } from "node:test";
import assert from "node:assert/strict";
import { completionsFor } from "../src/completion.js";
import { actionSpans } from "../src/cursor.js";

const inside = (line, needle) => completionsFor(line, line.indexOf(needle) + 1);

test("внутри вставки список непустой и несёт обе группы функций", () => {
  const items = inside("key: {{ req }}", "req");
  const labels = new Set(items.map((i) => i.label));
  assert.ok(labels.has("requiredEnv"), "нет функции helmfile");
  assert.ok(labels.has("indent"), "нет функции sprig");
});

test("вне вставки предложений нет", () => {
  // Covers R7: YAML-часть остаётся за редактором.
  const line = '    config: {{ readFile "x" }}';
  assert.deepEqual(completionsFor(line, 4), []);
});

test("в строке без вставок предложений нет", () => {
  const line = "plain: value";
  for (let i = 0; i < line.length; i++) {
    assert.deepEqual(completionsFor(line, i), [], `позиция ${i}`);
  }
});

test("в комментарии шаблона предложений нет", () => {
  assert.deepEqual(completionsFor("{{/* note */}}", 6), []);
});

test("каждое предложение несёт описание", () => {
  // Утверждение о единице данных: предложение без описания означает, что
  // чтение справочника сломалось, и это не поймает никакая сверка списков.
  const items = inside("{{ x }}", "x");
  const empty = items.filter((i) => !i.documentation || !i.detail);
  assert.deepEqual(empty.map((i) => i.label), []);
});

test("список не содержит имён с заглавной буквы", () => {
  // Поля структур однажды уже попали в справочник функциями.
  const items = inside("{{ x }}", "x");
  const capitalised = items.filter((i) => /^[A-Z]/.test(i.label));
  assert.deepEqual(capitalised.map((i) => i.label), []);
});

test("сниппеты парных конструкций приходят с закрывающим end", () => {
  const items = inside("{{ x }}", "x");
  for (const name of ["if", "range", "with"]) {
    const item = items.find((i) => i.label === name);
    assert.ok(item?.snippet, `${name}: нет сниппета`);
    assert.match(item.snippet, /\{\{ end $/, `${name}: сниппет не закрывает конструкцию`);
  }
});

test("незакрытая вставка предложения даёт", () => {
  // Файл набирают: курсор внутри ещё не закрытой вставки — обычный случай.
  assert.ok(completionsFor("key: {{ req", 9).length > 0);
});

test("границы вставки согласованы между разбором и автодополнением", () => {
  // Две реализации «внутри вставки» однажды разошлись на колонках
  // ограничителей. Теперь источник один, и это утверждение его удерживает:
  // предложения появляются только там, где разбор видит вставку.
  const line = 'key: {{ readFile "x" }} tail';
  const spans = actionSpans(line);
  for (let i = 0; i < line.length; i++) {
    const inSpan = spans.some((s) => i >= s.open && i < s.end);
    const hasSuggestions = completionsFor(line, i).length > 0;
    if (hasSuggestions) {
      assert.ok(inSpan, `позиция ${i}: предложения есть, а вставки в этой колонке нет`);
    }
  }
  // И обратная сторона: внутри выражения предложения обязаны быть, иначе
  // проверка выше проходила бы на автодополнении, не предлагающем ничего.
  assert.ok(completionsFor(line, line.indexOf("readFile") + 2).length > 0);
});

test("вид предложения решается в проверяемой части, и ключевые слова не выдаются за функции", () => {
  // Вид выбирался в провайдере по наличию поля snippet, поэтому end, else и
  // остальные конструкции попадали в разряд функций — а провайдер проверить
  // нечем.
  const items = inside("{{ x }}", "x");
  const kindOf = (label) => items.find((i) => i.label === label)?.kind;
  assert.equal(kindOf("if"), "snippet");
  assert.equal(kindOf("end"), "keyword");
  assert.equal(kindOf("else"), "keyword");
  assert.equal(kindOf("requiredEnv"), "function");
  assert.equal(kindOf("indent"), "function");
  const unknown = items.filter((i) => !["snippet", "function", "keyword"].includes(i.kind));
  assert.deepEqual(unknown.map((i) => i.label), []);
});
