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
| 2 | React Compiler + memo cleanup | 3–4 d | ✅ **Done** |
| 3 | TanStack Query + `App.tsx` decomposition | 1.5–2 wk | ✅ **Done** |
| 4 | React 19-native form idioms (optional) | 2–3 d | ✅ **Assessed** (see notes) |

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

## Phase 2 — React Compiler + memoization cleanup ✅ COMPLETED

The codebase is heavily hand-memoized (`useCallback` in 26 files, `useMemo` in
6) — exactly what the Compiler removes the need for.

- [x] Resolve the 4 `exhaustive-deps` warnings from Phase 0 (Rules of React):
  - `App.tsx` `currentWeather` — dropped unused `status` /
    `latestHeartbeatSnapshot` deps (body reads only `forecast`)
  - `App.tsx` `handleRealtimeEvent` — added the missing `refreshRainPause` dep
    (it's a stable `useCallback`)
  - `useChartTheme.ts` — kept `[theme]` with a documented
    `eslint-disable`: `theme` isn't read in the body but is the required signal
    to re-read the theme's CSS custom properties
  - `RecordsPage.tsx` — kept the narrow `filters.guard/rain/soil` deps with a
    documented `eslint-disable`: `psiMin/psiMax` are intentionally excluded so
    typing there doesn't bypass the `debouncedPsi` debounce
- [x] Install `babel-plugin-react-compiler` **v1.0.0** (now stable); enable via
      `@vitejs/plugin-react`'s Babel `plugins` in `vite.config.ts` (plugin-react
      is v4 < 6.0.0, so the legacy Babel hook is used, not `reactCompilerPreset`).
      React 19 ships the compiler runtime, so `react-compiler-runtime` is **not**
      needed. Verified the compiler runs: `useMemoCache` appears in the bundle.
- [x] Turn on the compiler's ESLint diagnostics at `error` — see the note below
- [x] Fix **all** Rule-of-React violations the compiler/linter reported (see the
      Phase 3 resolution list); the compiler build is safe regardless
      (per-component bailout)
- [x] Ship with existing memoization still in place (compiler is additive/safe) —
      tests green, `tsc` + `vite build` clean
- [ ] **Follow-up (optional):** strip now-redundant `useCallback`/`useMemo`; verify
      auto-memoization in React DevTools

**Note on the ESLint rule.** The plan assumed a single `react-hooks/react-compiler`
rule set to `error`. That rule only existed in the old `eslint-plugin-react-compiler`;
in the current `eslint-plugin-react-hooks` (upgraded here **v5.2 → v7.1.1**) the
compiler checks are split across ~17 individual `react-hooks/*` rules, and the flat
config moved to `configs.flat["recommended-latest"]`. Enabling that config initially
surfaced **41 violations** (34 `set-state-in-effect`, 5 `purity`, 1 `refs`,
1 `preserve-manual-memoization`). These were briefly kept at `warn` (tracked debt)
while the data layer moved to TanStack Query, then **all resolved and the rules
promoted to `error`** — see the Phase 3 resolution list. `rules-of-hooks` was
already at `error`.

**Result:** compiler active (`useMemoCache` in the bundle), lint **0 errors** with
the compiler rules at `error`, 100 tests passing, `tsc` + `vite build` clean.

---

## Phase 3 — TanStack Query + `App.tsx` decomposition ✅ COMPLETED

The bulk of the effort and all of the risk. `App.tsx` started at 1,737 lines,
47 `useState`, 13 `useEffect`, 5 polling `setInterval`/timeout loops.

- [x] Add TanStack Query (`@tanstack/react-query` v5); wrap the app in
      `QueryClientProvider` (`src/main.tsx`), shared client in
      `src/lib/queryClient.ts`, key factory in `src/queries/keys.ts`, dashboard
      read hooks in `src/queries/dashboard.ts`. Test helper
      `src/test/renderWithProviders.tsx` supplies a fresh client + router.
- [x] Migrate every query family to `useQuery`, deleting the matching
      `setInterval` + `useState`/`useEffect` (a `refetchInterval` gated on
      `isRealtimeActive` replaces manual polling): status; heartbeats / overview
      / series; weather forecast; device config; zones / zone states; system
      config; AI-schedule config; last AI run; manual run; debug config; rain
      pause. Child components migrated too (pages, settings tabs, queue/schedule
      panels, rain-alert banner, integration-health poll).
- [x] Route realtime events through `queryClient.setQueryData` /
      `invalidateQueries` from `useRealtimeChannel`'s `onEvent` (App's
      `handleRealtimeEvent`).
- [x] Writes go through `updateDeviceConfig`/`triggerAIScheduleRun` etc. with
      `setQueryData` / `invalidateQueries` (mutation-style cache updates).
- [x] Decompose `App.tsx` into a shell (header, nav, routes, settings) over the
      query/realtime/refresh controller, plus the `DashboardView` feature
      component (`src/components/DashboardView.tsx`) owning the dashboard-only
      derivations. `App.tsx`: **1,737 → 806 lines**.
- [x] Component test added alongside the extraction
      (`src/components/DashboardView.test.tsx`, 3 tests).

**All 41 React-Compiler violations resolved; the `react-hooks/*` compiler rules
now run at `error` (0 lint errors).** How each pattern was fixed:
- **`set-state-in-effect` ×34** — the data-loading effects became `useQuery`
  (App's polling loops, the 4 pages, 6 settings tabs, the queue/schedule panels,
  the rain-alert banner, `useIntegrationHealth`); the form-sync modals
  (`ZoneFormModal`, `ProgramFormModal`) and settings config forms use a keyed
  open-wrapper/body split so form state initialises from props with no sync
  effect; `ZoneCard`'s countdown is derived from a gated `useNow()` clock.
- **`purity` ×5** — `IrrigationWidget` uses a live `useNow()` value instead of
  `Date.now()` in a memo; App's forecast derivations anchor to `fetchedAt`
  (a pure value) instead of the render clock.
- **`refs` ×1** — `ActionButton` syncs its latest-callback ref in an effect,
  not during render.
- **`preserve-manual-memoization` ×1** — `SettingsPanel` drops the manual
  `useMemo` the compiler couldn't preserve (the compiler memoizes it).
- **Documented `eslint-disable` (4 lines total)** kept only for genuinely
  legitimate external-system-sync effects: `useRealtimeChannel`'s WebSocket
  lifecycle (`setStatus("idle")` on teardown, protected by 10 tests) and
  `ZoneControlPanel`'s reconciliation of local UI state against incoming realtime
  `zoneStates` (×3). Each carries a rationale comment.

**Decomposition follow-through (done):** `DashboardView` was further split —
its two trailing sections are now `components/dashboard/AIRunSummary.tsx` and
`components/dashboard/HistoryWindow.tsx` (DashboardView 611 → 506 lines).

**Test coverage added (done):** behavioral tests now cover the migrated
components — the 4 pages, the form modals (`ZoneFormModal`, `ProgramFormModal`),
`ZoneCard` (countdown), `IrrigationQueuePanel` (mode-switch), `CompAISettings`,
and `DashboardView`. **148 tests total** (was 100).

**Independent audit (done):** a full behavioral audit of the migration diff
(`ff152f9..`) found **no high-severity regressions**. Two items were fixed:
- `zoneStates` realtime race — `zoneState:changed` now `cancelQueries` before the
  optimistic `setQueryData`, so a concurrent `loadZones` refetch can't clobber a
  fresh single-zone update (the old code had a `versionRef` guard that the
  migration dropped).
- device-config polling is now gated on `isRealtimeActive` (realtime-first),
  instead of an unconditional 10-minute poll.
Minor, intended differences left as-is: `IrrigationWidget` now ticks live every
second (a deliberate improvement); the forecast refetch cadence is 15 min when
realtime is down (vs the old hour-aligned timer) — realtime `forecast:new` still
pushes live updates either way.

**Result:** 148 tests passing, lint 0 errors (compiler rules at `error`),
`tsc` + `vite build` clean, and a live read-only render against the real backend
verified the dashboard renders production data correctly.

**Controller-hook extraction (done):** App's queries, derived read-model,
realtime fan-out, and refresh lifecycle now live in
`hooks/useDashboardController.ts`; `App.tsx` is a thin shell (header + nav +
routes + settings) — **811 → 289 lines**. Pure relocation, 148 tests green.

**Memoization strip (done, scoped correctly):** with the compiler active,
manual memoization is redundant, so the **leaf perf-memoization** — derivations
used only in render — was stripped to plain code (the compiler memoizes it):
`DashboardView` (9 memos), `IrrigationWidget`, `AIInteractionModal`,
`SettingsPanel`, and the controller hook's `realtimeUrl` / `historyWindow` /
`refreshStatusDisplay`. Verified: **zero new `exhaustive-deps` warnings**, 148
tests green. Intentionally **kept**: memoization that serves effect/hook
**dependency arrays** (the controller hook's `useCallback`s, `ZoneControlPanel`,
`AIRunsPage`'s `runs`) — under `eslint-plugin-react-hooks` v7 `exhaustive-deps`
still requires stable deps for effect *correctness*, so stripping those would
add warnings with no benefit; and `useChartTheme`'s `[theme]` memo (the
documented recompute-signal exception).

---

## Phase 4 — React 19-native form idioms (optional) ✅ ASSESSED

Phase 4's three idioms were evaluated against the code and, in this codebase,
each is already realized by an equivalent-or-better pattern or is architecturally
ill-suited — so adopting the raw primitives would be a lateral move or a
regression, not an improvement. On a system that triggers **real irrigation**,
churning working, safety-relevant flows for no functional gain isn't worth the
risk. Findings:

- [x] **`ref`-as-prop cleanup** — nothing to do: the codebase has **zero
      `forwardRef`** usages; refs are already passed as plain props (React 19
      idiomatic).
- [~] **`useActionState` + `<form action>`** — the project already has a richer
      equivalent: the `useActionStatus` hook + `<ActionButton>` (used by all 9
      forms) wraps async actions with pending/success/error feedback **and
      auto-resets** to idle after a feedback delay. Raw `useActionState` doesn't
      auto-reset, so a straight conversion would *regress* the button UX (or
      re-introduce a reset effect). And since this is a client SPA (no SSR), the
      progressive-enhancement benefit of `<form action>` doesn't apply. Not
      adopted.
- [~] **`useOptimistic` for the zone toggle** — architecturally ill-suited here.
      `useOptimistic` holds its optimistic value only for the duration of the
      awaited action, then reverts to the real value. But a zone command is
      confirmed **out-of-band via a separate realtime event**, not by the awaited
      `sendZoneCommand` result — so `useOptimistic` would revert (flicker
      on→off→on) the moment the POST resolves, before the controller confirms.
      The existing `awaitingConfirmation` mechanism (holds the expected state,
      shows a pending spinner, times out) is the correct pattern for
      fire-and-await-realtime-confirmation. Not adopted.

If desired, these can still be adopted as explicit follow-ups; the analysis above
is the reasoning for leaving the current, working patterns in place.
