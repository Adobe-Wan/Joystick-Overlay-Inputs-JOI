// ESLint 9 flat config. Lints the inline <script> blocks of JOI.html (via eslint-plugin-html) as browser
// code, and the test suite as Node code. Run with `npm run lint`.
const js = require("@eslint/js");
const html = require("eslint-plugin-html");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/", "test-results/", "playwright-report/", "blob-report/", "dist/", "profile.js"] },
  js.configs.recommended,
  {
    files: ["**/*.html"],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Set by the optional profile.js next to the page, and by OBS's browser source.
        JOI_PROFILE: "readonly", STAYONTARGET_PROFILE: "readonly", JOYVIZ_PROFILE: "readonly", obsstudio: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      // Storage and EyeDropper calls are wrapped in try/catch on purpose (private mode, blocked storage).
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] }
  },
  {
    // Code that runs inside the page: the init script, and page.evaluate() callbacks that use the app's globals.
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
    rules: { "no-undef": "off" }
  }
];
