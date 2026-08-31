import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAt } from "../src/cursor.js";

/** Resolve at the first column of `needle`, found as a whole token. */
const at = (line, needle, offset = 0) => resolveAt(line, line.indexOf(needle) + offset);

// --- boundaries: where this project's recurring bug lives ------------------

test("курсор на первом символе имени возвращает это имя", () => {
  const line = 'key: {{ requiredEnv "X" }}';
  assert.equal(at(line, "requiredEnv")?.name, "requiredEnv");
});

test("курсор на последнем символе имени возвращает то же имя", () => {
  const line = 'key: {{ requiredEnv "X" }}';
  const last = line.indexOf("requiredEnv") + "requiredEnv".length - 1;
  assert.equal(resolveAt(line, last)?.name, "requiredEnv");
});

test("курсор сразу за именем имя не возвращает", () => {
  const line = 'key: {{ requiredEnv "X" }}';
  const past = line.indexOf("requiredEnv") + "requiredEnv".length;
  const got = resolveAt(line, past);
  assert.notEqual(got?.name, "requiredEnv", `на пробеле за именем вернулось ${JSON.stringify(got)}`);
});

test("имя, являющееся подстрокой другого, не подменяется", () => {
  // splitList содержит split: подстрочный поиск отдал бы одно за другое.
  const line = "{{ splitList $sep $s }} {{ split $sep $s }}";
  assert.equal(at(line, "splitList")?.name, "splitList");
  const second = line.indexOf("split", line.indexOf("splitList") + 1);
  assert.equal(resolveAt(line, second)?.name, "split");
});

test("в конвейере подсказка относится к функции под курсором", () => {
  // Covers AE5.
  const line = '{{ readFile "nats.conf" | indent 16 }}';
  assert.equal(at(line, "readFile")?.name, "readFile");
  assert.equal(at(line, "indent")?.name, "indent");
});

// --- outside the action ----------------------------------------------------

test("курсор в YAML-части строки со вставкой даёт пустой результат", () => {
  const line = '    config: {{ readFile "x" }}';
  assert.equal(resolveAt(line, 4), null, "на слове config");
  assert.equal(resolveAt(line, 11), null, "на пробеле перед вставкой");
});

test("строка без вставок даёт пустой результат в любой позиции", () => {
  const line = "plain: value";
  for (let i = 0; i < line.length; i++) assert.equal(resolveAt(line, i), null, `позиция ${i}`);
});

test("позиция за концом строки и пустая строка не роняют разбор", () => {
  const line = "{{ trim }}";
  assert.equal(resolveAt(line, line.length), null);
  assert.equal(resolveAt(line, 999), null);
  assert.equal(resolveAt("", 0), null);
  assert.equal(resolveAt(line, -1), null);
});

// --- token kinds -----------------------------------------------------------

test("ограничители опознаются как ограничители, а не функции", () => {
  const line = "{{ trim }}";
  assert.equal(resolveAt(line, 0)?.kind, "delimiter");
  assert.equal(resolveAt(line, line.indexOf("}}"))?.kind, "delimiter");
});

test("trim-маркер входит в ограничитель", () => {
  const line = "{{- if .x }}";
  assert.equal(resolveAt(line, 0)?.name, "{{-");
});

test("три категории функций различаются", () => {
  assert.equal(at('{{ requiredEnv "X" }}', "requiredEnv")?.kind, "helmfile-function");
  assert.equal(at("{{ printf \"%s\" .X }}", "printf")?.kind, "builtin-function");
  assert.equal(at("{{ .X | indent 2 }}", "indent")?.kind, "sprig-function");
  assert.equal(at("{{ if .X }}", "if")?.kind, "keyword");
});

test("путь и переменная опознаются отдельно от функций", () => {
  assert.equal(at("{{ range $k, $v := .Values.env }}", "$k")?.kind, "variable");
  assert.equal(at("{{ range $k, $v := .Values.env }}", ".Values")?.kind, "path");
  assert.equal(at("{{ range $k, $v := .Values.env }}", ".Values")?.name, ".Values.env");
});

test("содержимое строкового литерала не считается функцией", () => {
  const line = '{{ readFile "indent" }}';
  const inside = line.indexOf("indent");
  assert.equal(resolveAt(line, inside)?.kind, "string");
});

// --- several actions, unterminated actions ---------------------------------

test("в строке с двумя вставками каждая разбирается своей", () => {
  const line = '{{ requiredEnv "A" }}:{{ requiredEnv "B" }}';
  const second = line.indexOf("requiredEnv", 10);
  assert.equal(resolveAt(line, second)?.name, "requiredEnv");
  // двоеточие между вставками — вне обеих
  assert.equal(resolveAt(line, line.indexOf("}}:") + 2), null);
});

test("незакрытая вставка разбирается, а не роняет функцию", () => {
  const line = "{{ if .Values.debug";
  assert.equal(at(line, "if")?.kind, "keyword");
  assert.equal(at(line, ".Values")?.kind, "path");
});

test("комментарий шаблона опознаётся целиком", () => {
  const line = "{{/* a note with {{ inside */}}";
  assert.equal(resolveAt(line, line.indexOf("note"))?.kind, "comment");
});
