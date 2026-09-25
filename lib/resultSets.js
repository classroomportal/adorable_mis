import { formatUKDate } from './formatDate';

// Groups a student's results into the result sets they belong to, newest
// first, so a page can offer "which set?" instead of listing every mark
// from every week in one long table.
//
// resultSetEvents is the calendar_events rows flagged is_result_set. A mark
// belongs to a set if it carries its result_set_event_id, or carries none
// and sits on the set's date — gradebook and term-exam imports aren't
// tagged — the same rule as belongsToResultSet() on /classes/progress and
// missing_grades_by_class() (migration 175). An untagged mark on a date with
// no result set still gets its own entry, labelled by week, rather than
// disappearing.
export function groupResultSets(results, resultSetEvents) {
  const byId = new Map(resultSetEvents.map((ev) => [ev.event_id, ev]));
  const byDate = new Map(resultSetEvents.map((ev) => [ev.event_date, ev]));
  const sets = new Map();
  for (const r of results) {
    const ev = byId.get(r.result_set_event_id)
      ?? (r.result_set_event_id == null ? byDate.get(r.week_start_date) : undefined);
    const key = ev ? `e${ev.event_id}` : `w${r.week_start_date}`;
    if (!sets.has(key)) {
      sets.set(key, ev
        ? { key, label: `${ev.event_name} (${formatUKDate(ev.event_date)})`, date: ev.event_date, results: [] }
        : { key, label: `Week of ${formatUKDate(r.week_start_date)}`, date: r.week_start_date || '', results: [] });
    }
    sets.get(key).results.push(r);
  }
  return [...sets.values()].sort((a, b) => b.date.localeCompare(a.date));
}
