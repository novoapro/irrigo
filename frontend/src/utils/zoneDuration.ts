/**
 * zoneDuration — persistence helpers for a zone's manually-selected run
 * duration (in minutes). The value is stored per-zone in localStorage so the
 * duration slider remembers the user's last choice across reloads.
 *
 * WHY ITS OWN FILE: these used to be exported from ZoneCard.tsx. Vite's React
 * Fast Refresh can only hot-swap a module that exports *components only* — a
 * non-component export (the storage key + helper) forces a full page reload on
 * every edit. Moving them here keeps ZoneCard.tsx a components-only module.
 */

// Kept in sync with the slider bounds in ZoneCard.
const MIN_DURATION = 1;
const MAX_DURATION = 60;

export const DURATION_STORAGE_KEY = "irrigo:zone-duration:";

export const getPersistedDuration = (zoneId: string, fallback: number): number => {
  try {
    const v = localStorage.getItem(DURATION_STORAGE_KEY + zoneId);
    if (v !== null) {
      const n = Number(v);
      if (n >= MIN_DURATION && n <= MAX_DURATION) return n;
    }
  } catch { /* ignore */ }
  return fallback;
};
