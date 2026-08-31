# Gotmpl YAML Highlighter

Syntax highlighting for `*.yaml.gotmpl` files — helmfile and friends.

## Why

A `helmfile.yaml.gotmpl` file is two languages at once: YAML on the outside, Go
template inside `{{ … }}`. VS Code picks one language per file, and every
existing extension resolves that the same way — by declaring `.gotmpl` a
separate language. The consequence is not that the highlighting is poor; it is
that YAML disappears entirely. Keys, anchors, lists and comments stop being
distinguishable. Leaving the file as `yaml` loses the mirror image: to a YAML
grammar, `{{ requiredEnv "IMAGE_TAG" }}` is indistinguishable from any other
string.

This extension keeps both. The file's own grammar includes `source.yaml`
wholesale, and a separate injection grammar layers the Go template scopes on
top of it.

## What it does

- YAML highlighting stays intact — keys, strings, anchors, comments, block scalars
- Go template constructs get their own scopes: delimiters, trim markers, control
  keywords, helmfile functions, sprig functions, strings, numbers, `true`/`false`/`nil`,
  `$variables`, `.Values.paths`, the pipe and assignment operators, template comments
- Template actions are highlighted inside double-quoted YAML strings and inside
  block scalars, not just at the top level
- YAML comments stay comments: `# {{ end }}` is not treated as a template action

## What it does not do

- **It sets no colors.** Your active theme colors the scopes. The extension uses
  conventional TextMate scope names precisely so your theme already knows them.
  Highlighting density is therefore a property of your theme, not of this extension.
- **It only handles `*.yaml.gotmpl`.** Other bases — `.json.gotmpl`, `.conf.gotmpl`,
  `.tpl`, `.tmpl` — and Helm chart templates without the `.gotmpl` suffix are out of scope.
- **`redhat.vscode-yaml` does not serve these files.** They are their own language,
  which is what keeps the template highlighting out of every other YAML file you open.
  Comment toggling, indentation, folding and bracket matching are provided here instead.
- It does not format files or execute templates. It reads.

## Development

```bash
npm install
npm run fetch-yaml-grammar   # copies VS Code's built-in YAML grammar chain into vendor/
npm test                     # tokenization tests, run outside the editor
npm run lint
npx @vscode/vsce package     # build a .vsix
```

The tests run our grammars through `vscode-textmate` — the same engine the
editor uses — and assert scopes by position, so a broken rule fails the run
rather than merely looking wrong on screen.

## License

MIT
