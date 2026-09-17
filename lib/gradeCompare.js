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

// WAEC (Year 12) grades A1-F9 aren't on the same points scale as target
// grades, so they're classified by a fixed band rather than relative to a
// target, then folded into the same three-way above/on/below palette above
// instead of a separate colour scheme.
const WAEC_BAND = {
  'A1+': 'above', 'A1': 'above', 'B2': 'above', 'B3': 'above',
  'C4': 'on', 'C5': 'on', 'C6': 'on',
  'D7': 'below', 'E8': 'below', 'F9': 'below',
};

export function isWaecGrade(grade) {
  return Object.prototype.hasOwnProperty.call(WAEC_BAND, grade);
}

// Classifies a single actual grade against a single target grade. Returns
// undefined when there's not enough data to classify (no grade recorded
// yet, or an unrecognised grade string) rather than guessing.
export function classifyGrade(targetGrade, actualGrade, gradePoints) {
  if (!actualGrade || actualGrade === '—') return undefined;
  const grade = actualGrade.trim().toUpperCase();
  if (isWaecGrade(grade)) return WAEC_BAND[grade];
  const targetPoints = gradePoints[targetGrade];
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
