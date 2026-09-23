// Nova-T numbers a lesson's place in the week as one slot number, day-major:
// slot = (day - 1) * 9 + period, Mon–Fri, 9 periods a day (Registration,
// Lessons 1–6, The Other Half, Evening Prep — see the periods table). So
// 1–9 is Monday, 10–18 Tuesday, and so on. Verified against the Prep groups,
// which only land on Evening Prep every weekday this way (sql/015); the
// period-major reading sql/013 first assumed put ordinary lessons into
// Registration and Evening Prep.
export const NOVA_T_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const NOVA_T_PERIODS_PER_DAY = 9;

export function decodeNovaTSlot(slotStr) {
  const slot = parseInt(slotStr, 10);
  if (!Number.isFinite(slot) || slot < 1) return null;
  const dayIndex = Math.floor((slot - 1) / NOVA_T_PERIODS_PER_DAY);
  if (dayIndex >= NOVA_T_DAYS.length) return null;
  return {
    day_of_week: NOVA_T_DAYS[dayIndex],
    period_number: ((slot - 1) % NOVA_T_PERIODS_PER_DAY) + 1,
  };
}

export function slotKey(dayOfWeek, periodNumber) {
  return `${dayOfWeek}|${periodNumber}`;
}
