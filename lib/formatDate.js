// Formats an ISO date string (YYYY-MM-DD, as stored by <input type="date">
// and in the DB) as an unambiguous UK-style label, e.g. "15 Sep 2026".
// Native <input type="date"> pickers render in whatever format the device's
// regional settings dictate (US devices show M/D/Y) — that's OS-level and
// can't be overridden from the app. This label sits alongside the input so
// the selected date is always readable, regardless of device locale.
// Pass { weekday: true } to lead with the day, e.g. "Tue, 22 Sep 2026".
export function formatUKDate(isoDateString, { weekday = false } = {}) {
  if (!isoDateString) return '';
  const [year, month, day] = isoDateString.split('-');
  if (!year || !month || !day) return '';
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    ...(weekday && { weekday: 'short' }),
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Formats a timestamp (timestamptz from the DB) as a UK-style date and time in
// the school's timezone, e.g. "2 Oct 2026, 14:05". Never use a bare
// toLocaleString(): it follows the device's locale, so US-set devices show
// "10/2/2026, 2:05:00 PM". Pass { time: false } for the date alone.
export function formatUKDateTime(iso, { time = true } = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    day: 'numeric', month: 'short', year: 'numeric',
    ...(time && { hour: '2-digit', minute: '2-digit' }),
  });
}
