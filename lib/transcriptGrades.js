import { isWaecGrade } from './gradeCompare';

// Works out the grade each transcript square shows, from two sources:
//
//   exam marks  results rows in an end-of-term exam result set, which
//               calendar_events.exam_year_group / exam_term place in a
//               (year group, term) square (migration 246)
//   legacy      transcript_grades, the grades imported straight into
//               transcript squares before the exams were result sets
//               (migration 097). They carry a grade but no score.
//
// Which scale a square is graded in depends on the year group, not the
// subject (principal, 28 Sept 2026): Years 7-9 sit IGCSE only, Year 12 WAEC
// only, and Years 10-11 get both, so the KS4/5 transcript comes in an IGCSE
// and a WAEC version. A square wants its grade in that scale, taken in this
// order:
//
//   1. the exam mark's own grade, if it's in the wanted scale
//   2. the legacy grade, if it's in the wanted scale
//   3. the exam mark's score converted through the subject's grade
//      boundaries for that scale: its own year group's for IGCSE, Year 12's
//      for WAEC (the school's WAEC boundaries sit on Year 12)
//   4. otherwise whichever grade there is, flagged `otherScale`, so a grade
//      recorded only in the other scale (and with no score to convert) is
//      still shown rather than silently dropped, and the PDF can say so.
export function scaleForSquare(yearGroup, versionScale) {
  if (yearGroup <= 9) return 'igcse';
  if (yearGroup >= 12) return 'waec';
  return versionScale;
}

function inScale(grade, scale) {
  if (!grade) return false;
  return scale === 'waec' ? isWaecGrade(grade) : !isWaecGrade(grade);
}

// boundaryRows: subject_grade_boundaries rows ({ subject_id, year_group,
// grade, min_score }). The first band whose min_score the percentage
// reaches wins, so a score in the gap between two whole-number bands
// (89.5 between 80-89 and 90-100) takes the lower band rather than none.
export function gradeFromScore(boundaryRows, subjectId, boundaryYear, scale, score, maxScore) {
  if (score == null || score === '') return null;
  const max = Number(maxScore);
  const pct = max > 0 ? (Number(score) / max) * 100 : Number(score);
  if (Number.isNaN(pct)) return null;
  const bands = boundaryRows
    .filter((b) => b.subject_id === subjectId && b.year_group === boundaryYear && inScale(b.grade, scale))
    .sort((a, b) => Number(b.min_score) - Number(a.min_score));
  const band = bands.find((b) => pct >= Number(b.min_score));
  return band ? band.grade : null;
}

// mark: { grade, score, max_score } or undefined; legacyGrade: text or
// undefined. Returns { grade, otherScale } or null when there's nothing.
export function squareGrade({ subjectId, yearGroup, versionScale, mark, legacyGrade, boundaryRows }) {
  const scale = scaleForSquare(yearGroup, versionScale);
  if (inScale(mark?.grade, scale)) return { grade: mark.grade, otherScale: false };
  if (inScale(legacyGrade, scale)) return { grade: legacyGrade, otherScale: false };
  if (mark) {
    const boundaryYear = scale === 'waec' ? 12 : yearGroup;
    const worked = gradeFromScore(boundaryRows, subjectId, boundaryYear, scale, mark.score, mark.max_score);
    if (worked) return { grade: worked, otherScale: false };
  }
  const any = mark?.grade || legacyGrade;
  return any ? { grade: any, otherScale: true } : null;
}
