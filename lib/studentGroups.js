// Labels for student groups (migration 284, docs/student-groups-design.md).
// Kind is only a label to sort and filter by; the database checks the values.

export const GROUP_KINDS = [
  { value: 'activity', label: 'Activity' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'marks', label: 'Marks' },
  { value: 'intervention', label: 'Intervention' },
  { value: 'other', label: 'Other' },
];

// Who may see that a student is in the group. Staff always can; the student
// and parent portals show groups marked for them once that stage is built.
export const GROUP_VISIBILITY = [
  { value: 'staff', label: 'Staff only' },
  { value: 'students', label: 'Staff and the students in it' },
  { value: 'students_and_parents', label: 'Staff, the students and their parents' },
];

export const kindLabel = (v) => GROUP_KINDS.find((k) => k.value === v)?.label || v;
export const visibilityLabel = (v) => GROUP_VISIBILITY.find((k) => k.value === v)?.label || v;

// The same people the database lets manage groups (can_manage_student_groups()).
export function canManageGroups(profile, staffRoles) {
  return profile?.role === 'admin' || ['smt', 'pastoral', 'school_office'].some((r) => (staffRoles || []).includes(r));
}

// Groups the system builds (migration 285). Every setting is chosen by the
// person building the list; these are only the starting values on the form.
export const GROUP_RULES = [
  { value: 'negative_behaviour', label: 'Negative behaviour', desc: 'Students whose negative points in a period add up to the threshold or worse.' },
  { value: 'below_target', label: 'Below target', desc: 'Students whose latest grade is below target in at least a number of subjects.' },
];

const fmtDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

function filterWords(s) {
  const parts = [];
  if (s?.year_groups?.length) parts.push(`Year ${s.year_groups.join(', ')}`);
  if (s?.forms?.length) parts.push(`form ${s.forms.join(', ')}`);
  if (s?.houses?.length) parts.push(`house ${s.houses.join(', ')}`);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

// The rule and settings a group was built from, in words.
export function describeRule(rule, s) {
  if (rule === 'negative_behaviour') {
    return `Negative points ${s.threshold} or worse, ${fmtDate(s.from)} to ${fmtDate(s.to)}${filterWords(s)}`;
  }
  if (rule === 'below_target') {
    return `Below target in ${s.min_subjects}+ subject${Number(s.min_subjects) === 1 ? '' : 's'}, results since ${fmtDate(s.since)}${filterWords(s)}`;
  }
  return rule;
}
