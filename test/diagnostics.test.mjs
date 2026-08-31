import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { analyze, endInsertionPoint, MESSAGES } from "../src/diagnostics.js";

const messages = (text) => analyze(text).map((f) => f.message);

// --- silence first: a false positive costs more here than a miss -----------

test("текст с {{ внутри YAML-строки находок не даёт", () => {
  // Covers AE4.
  assert.deepEqual(analyze('description: "используйте {{ для вставки"'), []);
});

test("{{ }} внутри комментария YAML находок не даёт", () => {
  // Covers AE4.
  assert.deepEqual(analyze("# {{ end }} в комментарии"), []);
  assert.deepEqual(analyze("key: value  # {{ if .x }}"), []);
});

test("закрытая вставка внутри строки молчит", () => {
  assert.deepEqual(analyze('desc: "prefix {{ requiredEnv \\"X\\" }} suffix"'), []);
});

test("конструкции внутри комментария шаблона в стек не идут", () => {
  assert.deepEqual(analyze("{{/* {{ if .x }} без end */}}"), []);
});

test("пустой файл и файл без вставок молчат", () => {
  assert.deepEqual(analyze(""), []);
  assert.deepEqual(analyze("a: 1\nb: two\nc:\n  - three"), []);
});

test("весь тестовый корпус молчит", () => {
  const dir = "test/fixtures";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".gotmpl") || f.endsWith(".yaml"))) {
    const found = analyze(readFileSync(`${dir}/${file}`, "utf8"));
    assert.deepEqual(
      found.map((f) => `${file}:${f.line + 1} ${f.message}`),
      [],
    );
  }
});

test("эталонный helmfile молчит", (t) => {
  // Файл живёт вне репозитория; его отсутствие должно быть видно, а не проглочено.
  const path = "/home/ikramar/projects/ir-gsm/helmfile.yaml.gotmpl";
  if (!existsSync(path)) {
    t.skip("эталонный helmfile недоступен на этой машине");
    return;
  }
  const found = analyze(readFileSync(path, "utf8"));
  assert.deepEqual(found.map((f) => `строка ${f.line + 1}: ${f.message}`), []);
});

test("молчание содержательно: ошибка находится в каждой фикстуре", () => {
  // Без этого проверки выше проходили бы и на разборе, который не находит
  // ничего. Проверяется каждая фикстура, а не одна: слепота может быть
  // частичной — разбор видит конструкции в одном контексте и не видит в другом.
  const dir = "test/fixtures";
  const fixtures = readdirSync(dir).filter((f) => f.endsWith(".gotmpl"));
  assert.ok(fixtures.length >= 4, "корпус должен быть непустым");

  for (const file of fixtures) {
    const clean = readFileSync(`${dir}/${file}`, "utf8");
    assert.deepEqual(analyze(clean), [], `${file}: фикстура должна быть корректной`);
    const broken = `${clean}\n{{ if .Values.debug }}\n`;
    assert.deepEqual(
      analyze(broken).map((f) => f.message),
      [MESSAGES.unclosedConstruct("if")],
      `${file}: внесённая ошибка не найдена — разбор слеп на этом файле`,
    );
  }
});

test("несколько незакрытых конструкций дают разные точки вставки", () => {
  const text = "a:\n  {{ if .x }}\n    b: 1\n  {{ range .y }}\n    c: 2\n  d: 3";
  const unclosed = analyze(text).filter((f) => f.message.startsWith("Unclosed `"));
  assert.equal(unclosed.length, 2);
  const points = unclosed.map((f) => endInsertionPoint(text, f.line));
  assert.notDeepEqual(points[0], points[1], "две правки не должны целить в одну строку");
  assert.ok(points.every(Boolean), "обе точки определимы на этом примере");
});

// --- what it must find -----------------------------------------------------

test("открывающая конструкция без end", () => {
  // Covers AE3.
  const found = analyze("{{ if .Values.debug }}\nfoo: bar");
  assert.deepEqual(found.map((f) => f.message), [MESSAGES.unclosedConstruct("if")]);
  assert.equal(found[0].line, 0);
});

test("на вложенности находка указывает на действительно незакрытую", () => {
  const found = analyze("{{ range .a }}\n{{ if .b }}\n{{ end }}\n");
  assert.deepEqual(found.map((f) => f.message), [MESSAGES.unclosedConstruct("range")]);
  assert.equal(found[0].line, 0, "позиция на range, а не на закрытом if");
});

test("лишний end", () => {
  assert.deepEqual(messages("foo: bar\n{{ end }}"), [MESSAGES.strayEnd]);
});

test("else вне if и with", () => {
  assert.deepEqual(messages("{{ else }}"), [MESSAGES.strayElse]);
  assert.deepEqual(messages("{{ range .a }}\n{{ else }}\n{{ end }}"), [MESSAGES.strayElse]);
});

test("else внутри if и внутри with находок не даёт", () => {
  assert.deepEqual(analyze("{{ if .a }}\n{{ else }}\n{{ end }}"), []);
  assert.deepEqual(analyze("{{ with .a }}\n{{ else }}\n{{ end }}"), []);
});

test("незакрытая вставка вне строки", () => {
  assert.deepEqual(messages('key: {{ requiredEnv "X"'), [MESSAGES.unclosedAction]);
});

test("проза с {{ внутри строки молчит, даже когда следом идёт слово", () => {
  // Регрессия: признак принимал любой идентификатор со строчной буквы, из-за
  // чего английская проза становилась шаблоном — «write {{ to open an action»
  // подчёркивалось. Имя должно быть тем, которое справочник действительно знает.
  for (const line of [
    'note: "write {{ to open an action"',
    'desc: "используйте {{ для вставки"',
    'desc: "скобки {{ и }} парные"',
    'hint: "the {{ marker starts a template"',
  ]) {
    assert.deepEqual(analyze(line), [], line);
  }
});

test("незакрытая вставка внутри строки находится, когда похожа на шаблон", () => {
  // Цена KTD13 с другой стороны: настоящая ошибка внутри строки не теряется.
  assert.deepEqual(messages('desc: "оборвана {{ requiredEnv "'), [MESSAGES.unclosedAction]);
  assert.deepEqual(messages('desc: "оборвана {{ if .x"'), [MESSAGES.unclosedAction]);
  assert.deepEqual(messages('desc: "оборвана {{ quote"'), [MESSAGES.unclosedAction]);
});

test("все конструкции закрыты — молчит", () => {
  const text = [
    "{{ if .a }}",
    "  {{ range .b }}",
    "    {{ with .c }}",
    "    {{ end }}",
    "  {{ end }}",
    "{{ else }}",
    "  x: 1",
    "{{ end }}",
  ].join("\n");
  assert.deepEqual(analyze(text), []);
});

// --- quick fix: where `end` would go --------------------------------------

test("место вставки end — там, где отступ возвращается к уровню открытия", () => {
  const text = [
    "releases:",
    "  - name: app",
    "    values:",
    "      {{- if .prod }}",
    "        replicas: 2",
    "      other: x",
  ].join("\n");
  assert.deepEqual(endInsertionPoint(text, 3), { line: 5, indent: "      " });
});

test("место не определяется — правка не предлагается", () => {
  // Открытие на нулевом отступе: уровень возврата неотличим от чего угодно.
  assert.equal(endInsertionPoint("{{ if .x }}\nfoo: bar", 0), null);
  // Ничего не следует за открытием.
  assert.equal(endInsertionPoint("a:\n  {{ if .x }}", 1), null);
});
