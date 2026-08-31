import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAt } from "../src/cursor.js";
import { hoverFor } from "../src/hover.js";

/** Hover markdown at the first occurrence of `needle` on the line. */
const hoverAt = (line, needle) => hoverFor(resolveAt(line, line.indexOf(needle)));

test("наведение на управляющую конструкцию даёт описание и пример", () => {
  const md = hoverAt("{{ if .Values.debug }}", "if");
  assert.match(md, /template keyword/);
  assert.match(md, /condition/i);
  assert.match(md, /```gotmpl/, "должен быть блок с примером");
  assert.match(md, /\{\{ end \}\}/, "пример конструкции показывает закрытие");
});

test("наведение на функцию helmfile даёт описание и помечает источник", () => {
  const md = hoverAt('{{ requiredEnv "IMAGE_TAG" }}', "requiredEnv");
  assert.match(md, /helmfile function/);
  assert.match(md, /environment variable/i);
});

test("наведение на функцию sprig помечает свой источник", () => {
  const md = hoverAt("{{ .X | indent 2 }}", "indent");
  assert.match(md, /sprig function/);
});

test("функция без примера даёт описание и не даёт пустого блока", () => {
  // now описана в sprig без единого примера.
  const md = hoverAt("{{ now }}", "now");
  assert.ok(md, "подсказка должна быть");
  assert.doesNotMatch(md, /```gotmpl\s*```/, "пустой блок примера недопустим");
  assert.match(md, /date/i);
});

test("перезаписанная функция показывает определение helmfile и называет перезапись", () => {
  const md = hoverAt('{{ env "HOME" }}', "env");
  assert.match(md, /helmfile function, overriding sprig/);
});

test("неизвестное имя подсказки не даёт", () => {
  assert.equal(hoverAt("{{ nosuchfunction }}", "nosuchfunction"), null);
});

test("путь и переменная подсказки не дают", () => {
  assert.equal(hoverAt("{{ .Values.image }}", ".Values"), null);
  assert.equal(hoverAt("{{ range $k := .X }}", "$k"), null);
});

test("вне вставки подсказки нет", () => {
  const line = '    config: {{ readFile "x" }}';
  assert.equal(hoverFor(resolveAt(line, 4)), null);
});

test("в конвейере подсказка про функцию под курсором", () => {
  // Covers AE5.
  const line = '{{ readFile "nats.conf" | indent 16 }}';
  assert.match(hoverAt(line, "readFile"), /helmfile function/);
  assert.match(hoverAt(line, "indent"), /sprig function/);
});

test("каждая описанная конструкция имеет и текст, и пример", () => {
  // Утверждение о единице данных: пустое описание — поломка, а не свойство.
  for (const name of ["if", "else", "end", "range", "with", "define", "template", "block"]) {
    const md = hoverFor({ kind: "keyword", name });
    assert.ok(md, `${name}: подсказки нет`);
    assert.ok(md.split("\n").filter(Boolean).length >= 3, `${name}: подсказка пуста`);
  }
});
