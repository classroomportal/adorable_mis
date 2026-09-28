// "Add to my calendar" for Academic Calendar events. Every event is a single
// all-day date (calendar_events.event_date), so each becomes an all-day entry:
// an .ics file for Apple Calendar, Outlook and most phones, or a Google
// Calendar link. Nothing is sent anywhere — the file is built in the browser.

const SCHOOL_NAME = 'Adorable British College';

// Shared by the staff calendar (/calendar) and the parents' view.
export const CALENDAR_CATEGORY_LABELS = {
  term_boundary: 'Term boundary',
  relp: 'ReLP (test)',
  exam: 'Exam',
  teacher_assessment: 'Teacher Assessment',
  consult_day: 'Consult day',
  awareness_day: 'Awareness day',
  holiday: 'Holiday',
  other: 'Other',
  report_period: 'Report period',
};

// YYYY-MM-DD -> YYYYMMDD, and the day after (all-day DTEND is exclusive).
// UTC arithmetic so the device's time zone can't shift the date.
function compactDate(iso) {
  return iso.replaceAll('-', '');
}
function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventTitle(ev) {
  return ev.year_group_note ? `${ev.event_name} (${ev.year_group_note})` : ev.event_name;
}

// RFC 5545 text escaping, then folding at 75 octets (approximated by
// characters, which is what calendar apps tolerate in practice).
function escapeText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function fold(line) {
  const out = [];
  for (let i = 0; i < line.length; i += 74) out.push((i === 0 ? '' : ' ') + line.slice(i, i + 74));
  return out.join('\r\n');
}

function vevent(ev, categoryLabel, stamp) {
  return [
    'BEGIN:VEVENT',
    // Stable per event, so re-importing updates rather than duplicates.
    `UID:calendar-event-${ev.event_id}@misform.work`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(ev.event_date)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDay(ev.event_date))}`,
    `SUMMARY:${escapeText(`${SCHOOL_NAME}: ${eventTitle(ev)}`)}`,
    categoryLabel ? `DESCRIPTION:${escapeText(categoryLabel)}` : null,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ].filter(Boolean).map(fold).join('\r\n');
}

// One .ics holding every event passed in. labelFor(category) gives the
// description line.
export function buildIcs(events, labelFor = () => '') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Formwork//Academic Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.map((ev) => vevent(ev, labelFor(ev.category), stamp)),
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
}

export function downloadIcs(events, filename, labelFor) {
  const blob = new Blob([buildIcs(events, labelFor)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalendarUrl(ev, categoryLabel = '') {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${SCHOOL_NAME}: ${eventTitle(ev)}`,
    dates: `${compactDate(ev.event_date)}/${compactDate(nextDay(ev.event_date))}`,
    details: categoryLabel,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
