// Shared grade-vs-target colour coding, used by the results table, class
// progress table, and the student subject summary. Previously each page had
// its own copy with different comparison rules (some treated "exactly on
// target" as a pass with no middle state, others as a distinct "on target"
// state) and different colour palettes (some coloured the grade text
// directly, some coloured a pill background) — centralised here so
// "above/on/below target" means the same thing and looks the same
// everywhere. Colours are applied as a background pill (badge), not text
// colour, since a solid-coloured letter is harder to read at a glance than
// a coloured chip.

export const STYLE = {
  above: { background: '#dcf5e3', color: '#1a7a3d' },
  on: { background: '#fdecad', color: '#8a6d00' },
  below: { background: '#fbdede', color: '#a3232c' },
};

export const LABEL = { above: 'Above target', on: 'On target', below: 'Below target' };

// WAEC (Year 12) grades. grade_scale carries points for these (A1+ = 10
// down to F9 = 1) and Year 12 targets are set in the same grades, so they
// are compared against the student's own target like any other grade. They
// used to be classified by a fixed band (A1-B3 always "above", C4-C6 "on",
// D7-F9 "below") regardless of target, which told an A1+ target student
// with a B2 they were above target.
const WAEC_GRADES = new Set(['A1+', 'A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9']);

export function isWaecGrade(grade) {
  return WAEC_GRADES.has(grade);
}

// Classifies a single actual grade against a single target grade. Returns
// undefined when there's not enough data to classify (no grade recorded
// yet, no target, an unrecognised grade string, or a WAEC grade against an
// IGCSE target or vice versa — the two scales' points don't line up, e.g.
// B2 and A* are both 8) rather than guessing.
export function classifyGrade(targetGrade, actualGrade, gradePoints) {
  if (!actualGrade || actualGrade === '—' || !targetGrade) return undefined;
  const grade = actualGrade.trim().toUpperCase();
  const target = targetGrade.trim().toUpperCase();
  if (isWaecGrade(grade) !== isWaecGrade(target)) return undefined;
  const targetPoints = gradePoints[target];
  const actualPoints = gradePoints[grade];
  if (targetPoints === undefined || actualPoints === undefined) return undefined;
  if (actualPoints > targetPoints) return 'above';
  if (actualPoints < targetPoints) return 'below';
  return 'on';
}

// Classifies an averaged diff (e.g. a whole class's mean actual points
// minus mean target points). Averages are rarely exactly zero even when
// broadly on track, so a small tolerance keeps a class that's essentially
// on target from being marked above/below by noise.
export function classifyAverage(diff, tolerance = 0.15) {
  if (diff > tolerance) return 'above';
  if (diff < -tolerance) return 'below';
  return 'on';
}

// Picks the target rows worth showing for one student, sorted by subject.
//
// A CAT4 import writes a target for every subject the school offers, so a
// Year 7 ends up with a target in Economics and Add Maths they won't sit for
// years. Callers used to narrow that down by keeping only targets with a
// matching result, which conflated "doesn't take the subject" with "not
// graded yet": a new intake student with 22 targets and no results was told
// they had no targets at all, and a mid-year student saw well under half of
// theirs. Timetabled classes are the real signal — every active student has
// them — so filter on those, keeping any subject that already has a result
// in case the class link is missing.
//
// enrolledSubjectIds is a Set, or null meaning "enrolment not loaded yet",
// which shows everything rather than flashing an empty table.
export function visibleTargets(targets, results, enrolledSubjectIds) {
  const label = (t) => t.subjects?.display_name || t.subjects?.subject_name || '';
  const shown = enrolledSubjectIds
    ? targets.filter((t) => enrolledSubjectIds.has(t.subject_id)
        || results.some((r) => r.subject_id === t.subject_id))
    : targets;
  return [...shown].sort((a, b) => label(a).localeCompare(label(b)));
}
