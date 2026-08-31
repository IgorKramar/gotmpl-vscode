# Gotmpl YAML Highlighter

A VS Code extension for `*.yaml.gotmpl` files (helmfile and friends).

It keeps the YAML highlighting and layers Go template parsing on top, instead
of replacing one with the other — which is what every existing extension does,
and why those files end up either as flat YAML with an invisible template, or
as a template with no YAML at all.

**Work in progress.** See `docs/plans/` for the requirements.
