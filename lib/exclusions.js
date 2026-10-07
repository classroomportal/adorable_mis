// Exclusions (migration 396, the principal 7 Oct 2026): X ("Excluded from
// school") is the principal's and the college secretary's. Only they can
// enter, change or remove an X mark, and they record exclusions (internal or
// sent home) at /attendance/exclusions. The database refuses everyone else
// (attendance_exclusion_guard); these helpers only stop the pages offering
// what would be refused.

export const EXCLUSION_CODE = 'X';

export function canUseExclusionCode(staffRoles) {
  return (staffRoles || []).some((r) => r === 'principal' || r === 'college_secretary');
}

// The codes a register drop-down offers: X only to those two, or when it is
// already the mark so it still shows.
export function offeredCodes(codes, canExclude, current) {
  return (codes || []).filter((c) => c.code !== EXCLUSION_CODE || canExclude || current === EXCLUSION_CODE);
}

// An X mark the viewer can't change.
export function lockedExclusion(code, canExclude) {
  return code === EXCLUSION_CODE && !canExclude;
}
