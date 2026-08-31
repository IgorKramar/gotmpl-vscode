// Control-flow constructs of Go's template language.
//
// These are not in data/functions.json and cannot be: the reference is
// generated from the sprig and helmfile libraries, while these belong to the
// template language itself. Nine entries, written by hand, in English.

const KEYWORD_DOCS = {
  if: {
    summary: "Renders its body when the condition is truthy. Empty values — false, 0, nil, an empty string, list or map — are falsy.",
    example: '{{ if eq .Environment.Name "prod" }}\n  replicas: 2\n{{ end }}',
  },
  else: {
    summary: "Alternative branch of an `if` or `with`. Chains as `else if` for further conditions.",
    example: "{{ if .Values.debug }}\n  level: debug\n{{ else }}\n  level: info\n{{ end }}",
  },
  end: {
    summary: "Closes the nearest open `if`, `range`, `with`, `define` or `block`. Every one of them requires it.",
    example: "{{ range .Values.ports }}\n  - {{ . }}\n{{ end }}",
  },
  range: {
    summary: "Iterates a list or map, rebinding the dot to each element. `{{ range $k, $v := .Map }}` binds key and value instead.",
    example: "{{ range $key, $value := .Values.env }}\n  - name: {{ $key }}\n    value: {{ $value | quote }}\n{{ end }}",
  },
  with: {
    summary: "Rebinds the dot to the given value when it is non-empty, and skips the body when it is empty.",
    example: "{{ with .Values.resources }}\n  resources:\n{{ toYaml . | indent 4 }}\n{{ end }}",
  },
  define: {
    summary: "Declares a named template for later use with `template`.",
    example: '{{ define "labels" }}\napp: {{ .Name }}\n{{ end }}',
  },
  template: {
    summary: "Renders a template declared by `define`. The second argument becomes the dot inside it.",
    example: '{{ template "labels" . }}',
  },
  block: {
    summary: "Declares a template and renders it in one step, giving an overridable default.",
    example: '{{ block "name" . }}default{{ end }}',
  },
  break: {
    summary: "Stops the enclosing `range` early.",
    example: "{{ range .items }}{{ if .last }}{{ break }}{{ end }}{{ end }}",
  },
  continue: {
    summary: "Skips to the next iteration of the enclosing `range`.",
    example: "{{ range .items }}{{ if .skip }}{{ continue }}{{ end }}{{ . }}{{ end }}",
  },
};

/** @param {string} name */
function keywordDoc(name) {
  return KEYWORD_DOCS[name];
}

module.exports = { keywordDoc, KEYWORD_DOCS };
