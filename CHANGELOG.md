# Changelog

## 0.3.0

- Hover on a template keyword or a function shows what it does, with an example.
- Completion inside `{{ … }}` offers functions from the reference and paired
  constructs that arrive already closed. Outside an action nothing is offered:
  the YAML side belongs to the editor.
- The extension gained executable code, so it now declares an entry point.

## 0.2.0

- Function reference generated from the sprig and helmfile documentation:
  216 entries with descriptions, and examples where the sources carry them.
- Grammar function lists now come from that reference. Go template builtins got
  their own scope instead of sitting among helmfile functions.

## 0.1.0

- Syntax highlighting for `*.yaml.gotmpl`: YAML stays intact and Go template
  scopes are layered on top, rather than one replacing the other.
- Highlighting stays out of every other YAML file.
- Colors come from the active theme; the extension declares none.
