# Template Functions

#### `env`
The `env` function allows you to declare a particular environment variable as an optional for template rendering.
If the environment variable is unset or empty, the template rendering will continue with an empty string as a value.

```yaml
{{ $envValue := env "envName" }}
```

#### `requiredEnv`
The `requiredEnv` function allows you to declare a particular environment variable as required for template rendering.
If the environment variable is unset or empty, the template rendering will fail with an error message.

```yaml
{{ $envValue := requiredEnv "envName" }}
```

> If the environment variable value starts with '/' (forward slash) and [Git for Windows](https://git-scm.com/download/win) is used, you must set `MSYS_NO_PATHCONV=1` to preserve values as-is, or the environment variable value will be prefixed with the `C:\Program Files\Git`. [reference](https://github.com/git-for-windows/build-extra/blob/main/ReleaseNotes.md#known-issues)

#### `readFile`
The `readFile` function allows you to read a file and return its content as the function output. On failure, the template rendering will fail with an error message.

```yaml
{{ $fileContent := readFile "./myfile" }}
```
