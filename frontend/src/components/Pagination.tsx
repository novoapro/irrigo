/**
 * Pagination
 * ----------
 * A small, purely *presentational* pagination control: a "previous" button, a
 * "Page X of Y" status label, and a "next" button. It renders the exact
 * markup that several list pages (AI Runs, Irrigations, Logs) were each
 * hand-writing, so they can share one component instead of duplicating the
 * same JSX.
 *
 * ### "Presentational" / "controlled" — what that means here
 * This component holds no state of its own. It doesn't know the current page
 * or decide when a button should be disabled — the parent owns all of that.
 * The parent tells it:
 *   - which page it's on (`page`) and how many there are (`totalPages`) — for
 *     the label,
 *   - whether moving back/forward is possible (`hasPreviousPage` /
 *     `hasNextPage`) — which drives the buttons' `disabled` state,
 *   - what to do when a button is clicked (`onPrev` / `onNext`).
 *
 * Keeping the *when-can-I-navigate* logic in the parent matters: different
 * pages compute it differently (some from a server `meta` object, some from a
 * plain `page < totalPages` check). By accepting the already-computed booleans
 * we stay faithful to each page's original behaviour while still sharing the
 * markup.
 *
 * The button faces are the literal "<" and ">" characters (via `&lt;`/`&gt;`),
 * which is also their accessible name — kept identical to the original markup
 * so existing styles and tests are unaffected.
 *
 * @example
 * <Pagination
 *   page={page}
 *   totalPages={totalPages}
 *   hasPreviousPage={page > 1}
 *   hasNextPage={page < totalPages}
 *   onPrev={() => setPage((p) => Math.max(1, p - 1))}
 *   onNext={() => setPage((p) => p + 1)}
 * />
 */
interface PaginationProps {
  /** The current page number (1-based), shown in the "Page X of Y" label. */
  page: number;
  /** Total number of pages, shown as the "Y" in "Page X of Y". */
  totalPages: number;
  /** When false, the "previous" button is disabled. */
  hasPreviousPage: boolean;
  /** When false, the "next" button is disabled. */
  hasNextPage: boolean;
  /** Called when the user clicks the "previous" (`<`) button. */
  onPrev: () => void;
  /** Called when the user clicks the "next" (`>`) button. */
  onNext: () => void;
}

const Pagination = ({
  page,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  onPrev,
  onNext
}: PaginationProps) => {
  return (
    <div className="pagination-controls">
      <button
        type="button"
        className="ghost-button"
        onClick={onPrev}
        disabled={!hasPreviousPage}
      >
        &lt;
      </button>
      <span className="muted pagination-status">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="ghost-button"
        onClick={onNext}
        disabled={!hasNextPage}
      >
        &gt;
      </button>
    </div>
  );
};

export default Pagination;
