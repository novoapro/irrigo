import { type RefObject } from "react";
import DateTimeInput from "../DateTimeInput";
import OverviewSection, { type OverviewCardDefinition } from "../OverviewSection";

interface HistoryWindowProps {
  filterSummary: string;
  historyFiltersRef: RefObject<HTMLDivElement | null>;
  startDate: Date | null;
  endDate: Date | null;
  onStartDateChange: (value: Date | null) => void;
  onEndDateChange: (value: Date | null) => void;
  filterActive: boolean;
  onResetFilters: () => void;
  overviewCards: OverviewCardDefinition[];
  pressureOverview: OverviewCardDefinition | null;
  trendData: { timestamp: string; psi: number }[];
  latestBaselinePsi?: number;
  overviewSubtitle: string;
  overviewLoading: boolean;
  overviewError: string | null;
}

/** The dashboard's history-window card (date filters + analytics overview). */
const HistoryWindow = ({
  filterSummary,
  historyFiltersRef,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  filterActive,
  onResetFilters,
  overviewCards,
  pressureOverview,
  trendData,
  latestBaselinePsi,
  overviewSubtitle,
  overviewLoading,
  overviewError
}: HistoryWindowProps) => (
  <section className="history-window">
    <article className="history-window-card">
      <header className="history-window-header">
        <div>
          <h3>History window</h3>
          <p className="muted">{filterSummary}</p>
        </div>
      </header>
      <div className="history-window-filters" ref={historyFiltersRef}>
        <div className="records-filters__row">
          <div className="time-filter-field">
            <label htmlFor="history-start">From</label>
            <DateTimeInput
              value={startDate}
              onChange={onStartDateChange}
              max={endDate ?? new Date()}
              placeholder="Beginning of time"
              clearable
            />
          </div>
          <div className="time-filter-field">
            <label htmlFor="history-end">To</label>
            <DateTimeInput
              value={endDate}
              onChange={onEndDateChange}
              min={startDate ?? undefined}
              max={new Date()}
              placeholder="Now"
              clearable
            />
          </div>
        </div>
        {filterActive && (
          <button
            type="button"
            className="history-filter-reset"
            onClick={onResetFilters}
            title="Reset filters"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>
      <div className="history-window-section" aria-label="Analytics">
        <OverviewSection
          cards={overviewCards}
          pressureOverview={pressureOverview}
          trendData={trendData}
          latestBaselinePsi={latestBaselinePsi}
          subtitle={overviewSubtitle}
          loading={overviewLoading}
          error={overviewError}
        />
      </div>
    </article>
  </section>
);

export default HistoryWindow;
