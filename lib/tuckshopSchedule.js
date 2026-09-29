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

// Special pre-order sessions (migration 241): a one-off window and item
// list for one delivery date, which replaces the weekly rota for that date
// and isn't stopped by the manual closure.
export async function loadSpecialSessions(supabase) {
  const { data } = await supabase
    .from('tuckshop_special_sessions')
    .select('id, name, for_date, opens_at, closes_at, max_per_item, max_food, max_other, tuckshop_special_session_items(tuckshop_item_id)')
    .order('for_date', { ascending: false });
  return (data || []).map((s) => ({
    ...s,
    itemIds: (s.tuckshop_special_session_items || []).map((i) => i.tuckshop_item_id),
  }));
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
export function windowFor(forDate, schedule, specials = []) {
  const special = specials.find((s) => s.for_date === forDate);
  if (special) return { opensAt: new Date(special.opens_at), closesAt: new Date(special.closes_at) };
  const row = (schedule || []).find((r) => r.service_dow === isoDow(forDate));
  if (!row) return null;
  return {
    opensAt: lagosMoment(forDate, (row.service_dow - row.opens_dow + 7) % 7, row.opens_time),
    closesAt: lagosMoment(forDate, (row.service_dow - row.closes_dow + 7) % 7, row.closes_time),
  };
}

// The manual closure set at /tuckshop/ordering (system_settings, migrations
// 119-120): tuckshop_ordering_closed() refuses student orders while the Lagos
// date is before tuckshop_ordering_closed_until, so ordering reopens at
// midnight Lagos on that date. Returns that moment, or null if not closed.
export async function loadClosure(supabase) {
  const { data } = await supabase
    .from('system_settings')
    .select('tuckshop_ordering_closed_until')
    .limit(1)
    .maybeSingle();
  const until = data?.tuckshop_ordering_closed_until;
  if (!until) return null;
  const reopensAt = new Date(`${until}T00:00:00+01:00`);
  return Date.now() < reopensAt.getTime() ? reopensAt : null;
}

// True when the manual closure (not the rota) is what stops orders for this
// date: it's in force now and lasts past the date's own closing time.
// Special sessions aren't stopped by it.
export function closedByClosure(forDate, schedule, specials = [], closure = null) {
  if (!closure || specials.some((s) => s.for_date === forDate)) return false;
  const w = windowFor(forDate, schedule, specials);
  return !!w && Date.now() < w.closesAt.getTime() && w.closesAt.getTime() <= closure.getTime();
}

export function isLocked(forDate, schedule, specials = [], closure = null) {
  const w = windowFor(forDate, schedule, specials);
  return !w || Date.now() >= w.closesAt.getTime() || closedByClosure(forDate, schedule, specials, closure);
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
