// The school runs on Africa/Lagos (UTC+1, no DST). Two things go wrong if that
// is left implicit:
//
//   - `new Date().toISOString().slice(0, 10)` is the UTC date, an hour behind,
//     so between midnight and 01:00 Lagos it names yesterday and a register
//     opens on the wrong day.
//   - the device's own timezone isn't reliable either — registers get marked
//     from phones and laptops that have travelled or were never set correctly.
//
// Pinning the zone here keeps the browser in step with the database, where
// school_today() / school_now() (migration 123) pin the same zone.
export const SCHOOL_TIMEZONE = 'Africa/Lagos';

// en-CA formats as YYYY-MM-DD, the same shape the DB and <input type="date"> use.
export function schoolToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: SCHOOL_TIMEZONE });
}

// The school's calendar date `days` from today (negative for the past), as
// YYYY-MM-DD. Arithmetic is on a UTC-midnight date so neither the device's
// zone nor toISOString() can shift it by a day.
export function schoolDateOffset(days) {
  const d = new Date(`${schoolToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "HH:MM" at the school right now.
export function schoolClock() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: SCHOOL_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Whole minutes between a period's start_time ("HH:MM:SS") and now, at the
// school. Negative before the period starts, null if the time is unusable.
export function minutesSinceSchoolTime(startTime) {
  if (!startTime) return null;
  const [sh, sm] = startTime.split(':');
  if (sh === undefined || sm === undefined) return null;
  const [nh, nm] = schoolClock().split(':');
  return (Number(nh) * 60 + Number(nm)) - (Number(sh) * 60 + Number(sm));
}

// "Mon"/"Tue"/... for today at the school, matching timetable_slots.day_of_week.
export function schoolWeekdayShort() {
  return new Date().toLocaleDateString('en-GB', { timeZone: SCHOOL_TIMEZONE, weekday: 'short' });
}
