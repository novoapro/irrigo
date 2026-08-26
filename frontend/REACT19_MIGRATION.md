# React 19 Migration Plan

Living document guiding the frontend migration to **React 19.x** with modern
patterns (React Compiler, TanStack Query, decomposition of the `App.tsx` God
component). Update the checkboxes as work lands; each phase is an independently
shippable PR.

**Scope decision:** Full modernization (version bump + Compiler + data-layer &
`App.tsx` decomposition).
**Data-layer decision:** TanStack Query (replaces manual `fetch` + polling).
**Target React version:** latest 19.x — ⚠️ confirm exact pin (the originally
requested `19.2.7` does not exist as a published version).

## Progress at a glance

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| 0 | Safety net & guardrails | 3–4 d | ✅ **Done** |
| 1 | React 19 version bump | 1 d | ✅ **Done** |
| 2 | React Compiler + memo cleanup | 3–4 d | ⬜ Not started |
| 3 | TanStack Query + `App.tsx` decomposition | 1.5–2 wk | ⬜ Not started |
| 4 | React 19-native form idioms (optional) | 2–3 d | ⬜ Not started |

## How to verify (run from `frontend/`)

```bash
npm run lint && npm test && npm run build
```

Every phase must leave all three green before merging.

---

## Phase 0 — Safety net & guardrails ✅ COMPLETED

Prerequisite for everything: you cannot safely refactor a 1,737-line / 47-state
component with no component tests, and the Compiler (Phase 2) requires enforced
Rules of React.

- [x] Add ESLint 9 flat config with `eslint-plugin-react-hooks`
      (`recommended-latest`) + `typescript-eslint` and a `lint` script
      — `frontend/eslint.config.js`
- [x] Fix the 3 hard lint errors (ternary-as-statement in `App.tsx`; allow the
      intentional empty-`catch` idiom in config)
- [x] Characterization tests for `useRealtimeChannel` — connection lifecycle,
      backoff, visibility gating, teardown (10 tests)
- [x] Characterization tests for the `App` orchestrator — mount loads, realtime
      event fan-out, unknown-event resilience (4 tests)
- [x] Wire `@testing-library/jest-dom/vitest` matcher types
      (`src/test/setup.ts`, `src/testing.d.ts`)

**Result:** 97 tests passing (was 83). Lint: 0 errors, 44 warnings. `tsc` clean.
Merged to `main` in commit `ff152f9`.

**Tracked debt for later phases** — 44 lint warnings, including 4
`react-hooks/exhaustive-deps` violations that MUST be resolved before enabling
the Compiler in Phase 2:
- `src/App.tsx:711` (useMemo unnecessary deps)
- `src/App.tsx:1349` (useCallback missing dep `refreshRainPause`)
- `src/hooks/useChartTheme.ts:31` (useMemo unnecessary dep `theme`)
- `src/pages/RecordsPage.tsx:92` (useEffect missing dep `filters`)

---

## Phase 1 — React 19 version bump ✅ COMPLETED

Low risk: no breaking-change APIs are present in the codebase (no
`ReactDOM.render`/`findDOMNode`/string refs/`propTypes`/function `defaultProps`/
`React.FC`). Already on `createRoot`, Vite 7, RR7, Testing Library 16.

- [x] Confirm the exact React version to pin (latest 19.x) — pinned to
      **`^19.2.8`** (the originally requested `19.2.7` now exists but `19.2.8` is
      the latest 19.x; `@types/react@^19.2.18`, `@types/react-dom@^19.2.5`)
- [x] Bump `react`, `react-dom`, `@types/react`, `@types/react-dom` to 19.x
- [x] `npm run build` (tsc) green — two type fixes required:
      `JSX.Element` → `ReactNode` in `src/components/ModeSelector.tsx`, and
      `useRef<number>()` → `useRef<number>(undefined)` (React 19 types make the
      initial arg required) at `src/components/ActionButton.tsx:61,196`
- [x] Full Phase-0 test suite green (97 tests)
- [x] Smoke-check `react-router-dom` 7, `recharts` 2, `react-datepicker` 7 under
      React 19 StrictMode — no invalid/unmet peer deps; `StrictMode` still wraps
      the app in `src/main.tsx`; full build (1031 modules) + test suite pass

**Result:** lint 0 errors / 44 warnings (unchanged), 97 tests passing, `tsc` +
`vite build` clean under React 19.2.8.

---

## Phase 2 — React Compiler + memoization cleanup ⬜

The codebase is heavily hand-memoized (`useCallback` in 26 files, `useMemo` in
6) — exactly what the Compiler removes the need for.

- [ ] Resolve the 4 `exhaustive-deps` warnings from Phase 0 (Rules of React)
- [ ] Install `babel-plugin-react-compiler`; enable via `@vitejs/plugin-react`
      Babel plugins in `vite.config.ts`
- [ ] Turn on the `react-hooks/react-compiler` ESLint rule (`error`)
- [ ] Fix any remaining Rule-of-React violations the compiler/linter reports
- [ ] Ship with existing memoization still in place (compiler is additive/safe)
- [ ] **Follow-up PR:** strip now-redundant `useCallback`/`useMemo`; verify
      auto-memoization in React DevTools

---

## Phase 3 — TanStack Query + `App.tsx` decomposition ⬜

The bulk of the effort and all of the risk. `App.tsx` = 1,737 lines,
47 `useState`, 13 `useEffect`, 5 polling `setInterval`/timeout loops, raw
`fetch()` (30+ call sites in `api.ts`). Do this incrementally, one query family
per PR, each guarded by the Phase-0 tests.

- [ ] Add TanStack Query; wrap app in `QueryClientProvider` (`src/main.tsx`)
- [ ] Migrate query families one PR at a time, deleting the matching
      `setInterval` + `useState`/`useEffect` each time
      (`refetchInterval` replaces manual polling):
  - [ ] status
  - [ ] heartbeats / overview / series
  - [ ] weather forecast
  - [ ] device config
  - [ ] zones / zone states
  - [ ] schedule runs / AI runs
- [ ] Route realtime events through `queryClient.setQueryData` /
      `invalidateQueries` from `useRealtimeChannel`'s `onEvent`
- [ ] Convert writes (POST/PATCH/DELETE in `api.ts`) to `useMutation` with
      cache invalidation
- [ ] Decompose `App.tsx` into a thin layout/routing shell + feature components
      (`DashboardView`, `StatusSection`, `RefreshController`, …), each < ~200
      lines
- [ ] Add component tests alongside each extraction

---

## Phase 4 — React 19-native form idioms (optional) ⬜

- [ ] `useActionState` + `<form action>` for settings and manual-run forms
- [ ] `useOptimistic` for the zone toggle (instant UI before realtime confirm)
- [ ] `ref`-as-prop cleanup where applicable
