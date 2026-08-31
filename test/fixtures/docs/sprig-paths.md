# Path and Filepath Functions

## Paths

Paths separated by the slash character (`/`), processed by the `path` package.

Examples:

- The [Linux](https://en.wikipedia.org/wiki/Linux) and
  [MacOS](https://en.wikipedia.org/wiki/MacOS)
  [filesystems](https://en.wikipedia.org/wiki/File_system):
  `/home/user/file`, `/etc/config`;
- The path component of
  [URIs](https://en.wikipedia.org/wiki/Uniform_Resource_Identifier):
  `https://example.com/some/content/`, `ftp://example.com/file/`.

### base

Return the last element of a path.

```
base "foo/bar/baz"
```

The above prints "baz".

### dir

Return the directory, stripping the last part of the path. So `dir "foo/bar/baz"`
returns `foo/bar`.

### clean

Clean up a path.

```
clean "foo/bar/../baz"
```

The above resolves the `..` and returns `foo/baz`.
