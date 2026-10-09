import { isWaecGrade } from './gradeCompare';
import { squareGrade } from './transcriptGrades';

// Subjects Years 10 and 11 sit for WAEC only (subjects.waec_only, migration
// 422: Igbo, Government, Computer and GSM Repairs, Husbandry, Fashion and
// Civics; migration 423: Computing, shown as Digital Technologies). On those years' printed reports they are graded in WAEC, in a
// section of their own under the IGCSE subjects, and their target is the
// student's IGCSE target converted to WAEC (the principal, 9 Oct 2026).
// Years 7-9 stay IGCSE and Year 12 is WAEC already, so nothing changes there.
export function splitsWaecOnly(yearGroup) {
  return yearGroup === 10 || yearGroup === 11;
}

// The school's WAEC boundaries sit on Year 12, as on the KS4/5 transcript.
const WAEC_BOUNDARY_YEAR = 12;

// result: { grade, score, max_score }. A WAEC grade is kept; otherwise the
// score goes through the subject's WAEC boundaries. A grade with no score
// to convert is still printed as it was, rather than dropped.
export function waecResultGrade(boundaryRows, subjectId, result) {
  const square = squareGrade({
    subjectId,
    yearGroup: WAEC_BOUNDARY_YEAR,
    versionScale: 'waec',
    mark: result,
    boundaryRows,
  });
  return square?.grade || result?.grade || '';
}

// An IGCSE target becomes a WAEC grade grade for grade (the principal, 9 Oct
// 2026). This is a fixed table rather than the subject's boundaries,
// because some subjects' Year 10-11 boundaries are Cambridge's (Digital
// Technologies' B starts at 44.67%), and going through the bottom of the
// band would have turned a B target into E8. On the standard 90/80/70...
// boundaries the two give the same answer. A target already in WAEC is
// kept; anything not in the table is printed as it is.
const IGCSE_TO_WAEC = {
  'A*': 'A1+', A: 'A1', B: 'B2', C: 'C4', D: 'C6', E: 'E8', F: 'F9', G: 'F9', U: 'F9',
};

export function waecTarget(target) {
  if (!target) return '';
  const grade = target.trim().toUpperCase();
  if (isWaecGrade(grade)) return grade;
  return IGCSE_TO_WAEC[grade] || target;
}

// The grade boundaries the conversions need, for the given subjects.
export async function loadWaecBoundaries(supabase, subjectIds) {
  if (subjectIds.length === 0) return [];
  const { data } = await supabase
    .from('subject_grade_boundaries')
    .select('subject_id, year_group, grade, min_score')
    .in('subject_id', subjectIds);
  return data || [];
}
