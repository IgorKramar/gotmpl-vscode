# String Functions

Sprig has a number of string manipulation functions.

## trim

The `trim` function removes space from either side of a string:

```
trim "   hello    "
```

The above produces `hello`

## quote and squote

These functions wrap a string in double quotes (`quote`) or single quotes
(`squote`).

## untitle

Remove title casing. `untitle "Hello World"` produces `hello world`.
