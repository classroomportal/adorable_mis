// The Worry Box (migration 391). Every worry, with the student's name, is
// read by the DSL and the principal only; the database checks that
// (can_read_worries(), on the roles themselves, so admin is not enough).
// This file only holds the wording shared by the student and staff pages.

// The order students see them in. The keys are fixed by a check constraint
// on worries.category and in send_worry() / record_paper_worry().
export const WORRY_CATEGORIES = [
  { key: 'bullying', label: 'Bullying, unkindness or friendship problems', short: 'Bullying / friends' },
  { key: 'staff', label: 'Something a member of staff said or did', short: 'A member of staff' },
  { key: 'feelings', label: 'How I am feeling', short: 'Feelings' },
  { key: 'home', label: 'Home or family', short: 'Home / family' },
  { key: 'boarding', label: 'The boarding house', short: 'Boarding' },
  { key: 'equipment', label: 'Equipment, rooms, food or facilities', short: 'Equipment / facilities' },
  { key: 'other', label: 'Something else', short: 'Something else' },
];

export function worryCategoryLabel(key, { short = false } = {}) {
  const c = WORRY_CATEGORIES.find((x) => x.key === key);
  return c ? (short ? c.short : c.label) : key;
}

// What a student sees for each status.
export const WORRY_STATUS_STUDENT = {
  new: 'Sent',
  open: 'Read by staff',
  closed: 'Closed',
};

export const WORRY_STATUS_STAFF = {
  new: 'New',
  open: 'Open',
  closed: 'Closed',
};

export function holdsWorryRole(staffRoles) {
  // Guidance staff too since migration 402.
  return (staffRoles || []).some((r) => r === 'dsl' || r === 'principal' || r === 'guidance');
}
