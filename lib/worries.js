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
  { key: 'equipment', label: 'Facilities: equipment, rooms, food, water or toilets', short: 'Facilities' },
  { key: 'other', label: 'Something else', short: 'Something else' },
];

// Facilities or Other (migration 407, the principal 8 Oct 2026). Facilities
// is the 'equipment' category; everything else is Other. Students choose
// between the two first; staff move a misfiled worry with set_worry_category().
export const FACILITIES_CATEGORY = 'equipment';
export const OTHER_CATEGORIES = WORRY_CATEGORIES.filter((c) => c.key !== FACILITIES_CATEGORY);

export const WORRY_AREAS = {
  facilities: { label: 'Facilities', hint: 'Equipment, rooms, food, water, toilets' },
  other: { label: 'Other', hint: 'Friends, staff, feelings, home, boarding, anything else' },
};

export function worryArea(category) {
  return category === FACILITIES_CATEGORY ? 'facilities' : 'other';
}

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
