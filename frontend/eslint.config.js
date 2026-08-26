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
      // React Compiler diagnostics (Phase 2). eslint-plugin-react-hooks v7's
      // `recommended-latest` promotes the compiler's Rules-of-React checks to
      // `error`. The compiler build itself is safe (it bails out per-component
      // on code it can't optimize), so these are advisory. The bulk are
      // `set-state-in-effect` on App.tsx's effect-driven state, which Phase 3
      // (TanStack Query + decomposition) removes wholesale. Surface them as
      // tracked debt at `warn` — matching the Phase 0 approach — instead of
      // hard-gating this phase. `rules-of-hooks` stays at its default `error`.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/set-state-in-render": "warn"
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
