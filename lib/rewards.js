// Reward Store (migration 370): students spend merit points on rewards.
// The merit total never changes; spending is its own ledger
// (reward_purchases) and every rule is in the database (buy_reward(),
// decide_reward(), cancel_reward(), mark_reward_used()). These are labels.

export const REWARD_STATUS = {
  requested: 'Waiting to be accepted',
  approved: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  used: 'Used',
};

export const REWARD_STATUS_STAFF = {
  ...REWARD_STATUS,
  requested: 'Waiting',
};

export const LIMIT_PERIODS = {
  week: 'week',
  fortnight: 'fortnight',
  half_term: 'half term',
  term: 'term',
  year: 'school year',
};

export const DATE_RULES = {
  '': 'No date',
  school_day: 'A school day (Mon–Fri in term)',
  term_day: 'Any day in term',
};

export function limitText(item) {
  if (!item.per_student_limit) return null;
  const n = item.per_student_limit;
  const times = n === 1 ? 'Once' : n === 2 ? 'Twice' : `${n} times`;
  return `${times} a ${LIMIT_PERIODS[item.limit_period] || item.limit_period}`;
}

// "Friday 9 October"
export function rewardDay(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
