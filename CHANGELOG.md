# Changelog

## 0.5.0

- Ready for the Marketplace: icon, gallery banner, and a README written for
  someone who has not installed the extension yet — what it does, what it does
  not, and the limits it knows about.
- Demo files under `examples/` show every kind of highlighting and every kind of
  diagnostic, without pointing at anyone's real infrastructure.
- Fixed: the "looks like a template" test accepted any lowercase word, which
  made ordinary prose template-shaped — `"write {{ to open an action"` was
  reported as an unclosed action. The name must now be one the reference knows.

## 0.4.0

- Diagnostics for unclosed actions and unbalanced constructs: a construct with
  no `{{ end }}`, a stray `end`, an `else` outside `if` or `with`. On nested
  constructs the report points at the one actually left open.
- A quick fix offers to add the missing `{{ end }}`, but only where the
  insertion point can be told from indentation. Where it cannot, no fix is
  offered: putting `end` in the wrong place is worse than offering nothing.
- `{{` inside a YAML comment stays silent. Inside a quoted string it is
  reported only when what follows looks like a template expression, so prose
  such as `"use {{ to interpolate"` is left alone.

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
