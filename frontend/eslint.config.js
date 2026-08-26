import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Flat config. Phase 0 of the React 19 migration: this exists primarily to
// enforce the Rules of React (via eslint-plugin-react-hooks), which is a
// prerequisite for enabling the React Compiler in Phase 2. The dedicated
// `react-hooks/react-compiler` rule is turned on in Phase 2.
export default tseslint.config(
  {
    ignores: ["dist", "coverage", "node_modules"]
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // v7 exposes flat-config variants under `configs.flat`; recommended-latest
      // enables the Rules-of-React set plus React Compiler diagnostics (Phase 2).
      reactHooks.configs.flat["recommended-latest"]
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      "react-refresh": reactRefresh
    },
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true }
      ],
      // Swallowing errors in an empty catch is an intentional idiom here
      // (e.g. localStorage access in private mode).
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Surface unused code without failing the migration build; tighten later.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      // React Compiler diagnostics (Rules of React) run at `error` — the
      // severity `eslint-plugin-react-hooks` v7 `recommended-latest` ships. All
      // violations were resolved in Phase 2/3 (the data layer moved to TanStack
      // Query, removing the effect-driven setState; a few genuinely-legitimate
      // external-system sync effects carry a narrowly-scoped, documented
      // `eslint-disable`). No per-rule downgrades remain.
    }
  },
  {
    // Node-context config files.
    files: ["*.config.{js,ts}"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // Test files: allow vitest globals (globals: true in vitest config).
    files: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**"],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
);
