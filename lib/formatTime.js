// timetable_slots.start_time/end_time come back as "HH:MM:SS" — trim the
// seconds and join into a compact "HH:MM–HH:MM" range for display.
export function formatTimeRange(start, end) {
  if (!start || !end) return '';
  const trim = (t) => t.slice(0, 5);
  return `${trim(start)}–${trim(end)}`;
}
