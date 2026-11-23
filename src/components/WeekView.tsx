// Weekly planner (placeholder until it's built on the new foundation).
export function WeekView() {
  return (
    <main id="week-view" className="areas-view">
      <div className="empty"><div className="big">Weekly planner</div>Coming next.</div>
    </main>
  );
}

/** Returns true if the weekly auto-draft started (so the daily auto-plan should wait), false if not, null while deciding. */
export function useWeeklyAuto(): boolean | null {
  return false;
}
