import { isWaecGrade } from './gradeCompare';
import { gradeFromScore, squareGrade } from './transcriptGrades';

// Subjects Years 10 and 11 sit for WAEC only (subjects.waec_only, migration
// 422: Igbo, Government, Computer and GSM Repairs, Husbandry, Fashion and
// Civics). On those years' printed reports they are graded in WAEC, in a
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

// An IGCSE target becomes the WAEC grade at the bottom of its band: the
// band's min_score in the subject's boundaries for the student's year
// group, through the subject's WAEC boundaries (with the school's standard
// boundaries A* -> A1+, A -> A1, B -> B2, C -> C4, D -> C6, E -> E8, F/G ->
// F9). A target already in WAEC is kept; one with no band to convert
// through is printed as it is.
export function waecTarget(boundaryRows, subjectId, yearGroup, target) {
  if (!target || isWaecGrade(target)) return target || '';
  const band = boundaryRows.find((b) => b.subject_id === subjectId
    && b.year_group === yearGroup && b.grade === target);
  if (!band) return target;
  return gradeFromScore(boundaryRows, subjectId, WAEC_BOUNDARY_YEAR, 'waec', band.min_score, 100) || target;
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
