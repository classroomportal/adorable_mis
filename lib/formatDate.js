// Formats an ISO date string (YYYY-MM-DD, as stored by <input type="date">
// and in the DB) as an unambiguous UK-style label, e.g. "15 Sep 2026".
// Native <input type="date"> pickers render in whatever format the device's
// regional settings dictate (US devices show M/D/Y) — that's OS-level and
// can't be overridden from the app. This label sits alongside the input so
// the selected date is always readable, regardless of device locale.
export function formatUKDate(isoDateString) {
  if (!isoDateString) return '';
  const [year, month, day] = isoDateString.split('-');
  if (!year || !month || !day) return '';
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
