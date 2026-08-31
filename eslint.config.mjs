const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  fetch: "readonly",
  setTimeout: "readonly",
};

export default [
  {
    // ES modules: scripts and tests.
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "error",
    },
  },
  {
    // CommonJS: the extension itself, which VS Code loads that way.
    // This block was missing at first, and its absence was invisible — `lint`
    // reported clean because it was reading nothing under src/.
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...nodeGlobals, require: "readonly", module: "writable", __dirname: "readonly" },
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "error",
    },
  },
];
