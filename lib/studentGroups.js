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
