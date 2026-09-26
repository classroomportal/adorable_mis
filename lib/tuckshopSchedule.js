// Tuckshop ordering windows. The rota lives in tuckshop_order_schedule
// (migration 187): one row per tuckshop day (ISO weekday), with the weekday
// and time ordering opens and closes before it. The database is the
// authority — save_tuckshop_order() checks the window — this mirrors
// tuckshop_order_window() so pages can label dates without a round trip.
// Lagos is UTC+1 all year, so the offset is written in.

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayName = (isoDow) => WEEKDAYS[isoDow - 1];

// Students see a warning this long before ordering closes.
export const WARNING_HOURS = 12;

export async function loadSchedule(supabase) {
  const { data } = await supabase
    .from('tuckshop_order_schedule')
    .select('service_dow, opens_dow, opens_time, closes_dow, closes_time')
    .order('service_dow');
  return data || [];
}

function isoDow(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function lagosMoment(isoDate, daysBefore, time) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysBefore);
  return new Date(`${d.toISOString().slice(0, 10)}T${time.slice(0, 5)}:00+01:00`);
}

// { opensAt, closesAt } for a date, or null if it isn't a tuckshop day.
export function windowFor(forDate, schedule) {
  const row = (schedule || []).find((r) => r.service_dow === isoDow(forDate));
  if (!row) return null;
  return {
    opensAt: lagosMoment(forDate, (row.service_dow - row.opens_dow + 7) % 7, row.opens_time),
    closesAt: lagosMoment(forDate, (row.service_dow - row.closes_dow + 7) % 7, row.closes_time),
  };
}

export function isLocked(forDate, schedule) {
  const w = windowFor(forDate, schedule);
  return !w || Date.now() >= w.closesAt.getTime();
}

// "11pm" / "9:30am" from a "HH:MM[:SS]" string.
export function timeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`;
}

// "11pm on Thursday 1 October", in Lagos time.
export function momentLabel(date) {
  const d = new Date(date);
  const hhmm = d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false });
  const day = d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' });
  return `${timeLabel(hhmm)} on ${day}`;
}

export function longDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// Warning text in the last WARNING_HOURS before ordering closes, or null.
export function closingWarning(forDate, closesAt) {
  const close = new Date(closesAt);
  const ms = close.getTime() - Date.now();
  if (ms <= 0 || ms > WARNING_HOURS * 3600000) return null;
  const hours = Math.floor(ms / 3600000);
  const left = hours >= 1 ? `${hours} hour${hours === 1 ? '' : 's'} left` : 'less than an hour left';
  return `Tuckshop orders for ${longDate(forDate)} close at ${momentLabel(close)} (${left}). After that you can't place, change or cancel your order.`;
}
