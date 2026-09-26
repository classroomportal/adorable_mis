import { supabase } from './supabaseClient';
import { classifyGrade, isWaecGrade } from './gradeCompare';

// Shared by the report-writing pages (/reports/write-subject-comments,
// /reports/write-pastoral-comments) and the end-of-term report PDF, so the
// grades a teacher sees while writing, the facts the AI draft is given and
// the grades printed on the report are all worked out the same way.

export const JUDGEMENT_GRADES = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement'];

// The three things a subject teacher grades alongside their comment, all on
// the JUDGEMENT_GRADES scale. `column` is on report_subject_comments.
export const JUDGEMENTS = [
  { key: 'effort', column: 'effort_grade', label: 'Effort' },
  { key: 'presentation', column: 'presentation_grade', label: 'Presentation of work' },
  { key: 'homework', column: 'homework_grade', label: 'Homework' },
];

// How many weeks of grades the subject teacher sees on screen. Best,
// lowest, average and trend are still worked out over the whole year.
export const SHOWN_WEEKS = 5;

// Who a report period is for: students in its year groups and, when the
// period has joined_from (e.g. "New students check"), only those admitted on
// or after it. A student with no admission_date isn't counted as new
// (migration 193). scopeToReportPeriod narrows a students query;
// inReportPeriod checks a student row already loaded.
export function scopeToReportPeriod(query, period) {
  const years = period.year_groups || [];
  let q = query.in('year_group', years.length ? years : [-1]);
  if (period.joined_from) q = q.gte('admission_date', period.joined_from);
  return q;
}

export function inReportPeriod(student, period) {
  if (!(period.year_groups || []).includes(student.year_group)) return false;
  if (!period.joined_from) return true;
  return !!student.admission_date && student.admission_date >= period.joined_from;
}

// Result sets whose students are narrowed the same way, keyed by
// calendar event_id: the report period linked to a result set through
// calendar_event_id, where that period has joined_from (e.g. "New students
// check"). missing_grades_by_class() applies the same rule (migration 195).
export async function loadResultSetScopes() {
  const { data } = await supabase
    .from('report_periods')
    .select('report_period_id, calendar_event_id, year_groups, joined_from')
    .not('calendar_event_id', 'is', null)
    .not('joined_from', 'is', null)
    .order('report_period_id');
  const byEvent = {};
  for (const p of data || []) if (!byEvent[p.calendar_event_id]) byEvent[p.calendar_event_id] = p;
  return byEvent;
}

// "Years 7, 8" or "Years 7-12, joined since 01/08/2026" — for period headings.
export function describeReportPeriod(period, formatDate = (d) => d) {
  const years = `Years ${(period.year_groups || []).join(', ')}`;
  return period.joined_from ? `${years} — joined since ${formatDate(period.joined_from)}` : years;
}

const EXAM_RESULT_TYPES = new Set(['term_exam_import', 'exam_grade']);
export const isExamResult = (r) => EXAM_RESULT_TYPES.has(r.result_type);

const DAY = 24 * 60 * 60 * 1000;
const toTime = (iso) => new Date(`${iso}T00:00:00Z`).getTime();

// PostgREST caps a response at 1000 rows; a year of weekly results for a
// whole year group is well past that, so read it a page at a time.
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

// The terms of the academic year (September to July) that `termId` falls
// in. A report period without a term uses the year containing today.
export async function loadAcademicYear(termId) {
  const { data: terms } = await supabase
    .from('terms')
    .select('term_id, term_name, start_date, end_date')
    .order('start_date');
  const all = terms || [];
  const anchor = all.find((t) => t.term_id === termId);
  const anchorDate = new Date(anchor ? `${anchor.start_date}T00:00:00Z` : Date.now());
  const startYear = anchorDate.getUTCMonth() >= 7 ? anchorDate.getUTCFullYear() : anchorDate.getUTCFullYear() - 1;
  const from = `${startYear}-08-01`;
  const to = `${startYear + 1}-07-31`;
  const yearTerms = all.filter((t) => t.start_date >= from && t.start_date <= to);
  return {
    terms: yearTerms,
    currentTerm: anchor || null,
    // Results and behaviour are counted from the first day of the first term;
    // before any term dates exist for the year, from 1 August.
    from: yearTerms[0]?.start_date || from,
    to,
  };
}

// "Wk3" for a week of the report's own term, "Jan Wk3" for an earlier term
// in the year — the same Wk numbering as the Term Test Scores PDF.
export function weekLabel(weekStartDate, year) {
  const t = toTime(weekStartDate);
  const term = year.terms.find((x) => t >= toTime(x.start_date) - 3 * DAY && t <= toTime(x.end_date) + 3 * DAY);
  if (!term) return weekStartDate;
  const n = Math.max(1, Math.floor((t - toTime(term.start_date) + 3 * DAY) / (7 * DAY)) + 1);
  if (year.currentTerm && term.term_id === year.currentTerm.term_id) return `Wk${n}`;
  return `${term.term_name.slice(0, 3)} Wk${n}`;
}

export async function loadGradePoints() {
  const { data } = await supabase.from('grade_scale').select('grade, points');
  return Object.fromEntries((data || []).map((g) => [g.grade, Number(g.points)]));
}

// Every result this academic year for these students (optionally one
// subject), oldest first.
export async function loadYearResults({ studentIds, subjectId = null, year }) {
  if (!studentIds.length) return [];
  return fetchAllRows(() => {
    let q = supabase
      .from('results')
      .select('result_id, student_id, subject_id, grade, week_start_date, result_type, subjects(subject_name, display_name)')
      .in('student_id', studentIds)
      .gte('week_start_date', year.from)
      .lte('week_start_date', year.to)
      .not('grade', 'is', null)
      .order('week_start_date')
      .order('result_id');
    if (subjectId) q = q.eq('subject_id', subjectId);
    return q;
  });
}

export async function loadTargets({ studentIds, subjectId = null }) {
  if (!studentIds.length) return {};
  let q = supabase.from('target_grades').select('student_id, subject_id, target_grade').in('student_id', studentIds);
  if (subjectId) q = q.eq('subject_id', subjectId);
  const { data } = await q;
  const out = {};
  for (const t of data || []) out[`${t.student_id}:${t.subject_id}`] = t.target_grade;
  return out;
}

// Best, lowest, average and change over a run of results for one subject.
// Grades the scale doesn't know (e.g. "N") are shown but not ranked.
export function summariseGrades(results, points) {
  const ranked = results.filter((r) => points[r.grade] !== undefined);
  if (!ranked.length) return null;
  let best = ranked[0];
  let lowest = ranked[0];
  for (const r of ranked) {
    if (points[r.grade] > points[best.grade]) best = r;
    if (points[r.grade] < points[lowest.grade]) lowest = r;
  }
  const first = ranked[0];
  const latest = ranked[ranked.length - 1];
  const mean = ranked.reduce((sum, r) => sum + points[r.grade], 0) / ranked.length;
  // The average is reported as the nearest grade on the same scale as the
  // student's latest grade, so an IGCSE run never averages to a WAEC grade.
  const waec = isWaecGrade(latest.grade);
  let average = null;
  for (const [grade, p] of Object.entries(points)) {
    if (isWaecGrade(grade) !== waec) continue;
    if (average === null || Math.abs(p - mean) < Math.abs(points[average] - mean)) average = grade;
  }
  return { first, latest, best, lowest, average, change: points[latest.grade] - points[first.grade] };
}

export function describeVsTarget(grade, target, points) {
  const cls = classifyGrade(target, grade, points);
  if (!cls) return null;
  if (cls === 'on') return 'on target';
  const d = Math.abs(points[grade] - points[target]);
  return `${d} grade${d === 1 ? '' : 's'} ${cls === 'above' ? 'above' : 'below'} target`;
}

// Behaviour points since the start of the year, split plus and minus, with
// the categories behind them (most points first).
export async function loadBehaviourTotals({ studentIds, year }) {
  if (!studentIds.length) return {};
  const events = await fetchAllRows(() => supabase
    .from('behaviour_events')
    .select('event_id, student_id, type, category, points')
    .in('student_id', studentIds)
    .gte('event_date', year.from)
    .lte('event_date', year.to)
    .order('event_id'));
  const out = {};
  for (const e of events) {
    const s = (out[e.student_id] ||= { plus: 0, plusEvents: 0, minus: 0, minusEvents: 0, categories: {} });
    const pts = Number(e.points) || 0;
    const negative = e.type === 'negative' || pts < 0;
    if (negative) { s.minus += pts; s.minusEvents += 1; } else { s.plus += pts; s.plusEvents += 1; }
    const key = `${negative ? '-' : '+'}${e.category || (negative ? 'Negative' : 'Positive')}`;
    const c = (s.categories[key] ||= { name: e.category || (negative ? 'Negative' : 'Positive'), negative, count: 0, points: 0 });
    c.count += 1;
    c.points += pts;
  }
  for (const s of Object.values(out)) {
    const cats = Object.values(s.categories);
    s.positives = cats.filter((c) => !c.negative).sort((a, b) => b.points - a.points);
    s.negatives = cats.filter((c) => c.negative).sort((a, b) => a.points - b.points);
    delete s.categories;
  }
  return out;
}

// A student's latest grade in each subject this year, strongest first
// (ties broken by how far above target). Used for "best" and "weakest".
export function rankSubjects(studentResults, targets, studentId, points) {
  const latestBySubject = {};
  for (const r of studentResults) {
    if (points[r.grade] === undefined) continue;
    latestBySubject[r.subject_id] = r; // results are oldest first
  }
  return Object.values(latestBySubject)
    .map((r) => {
      const target = targets[`${studentId}:${r.subject_id}`] || null;
      const cls = classifyGrade(target, r.grade, points);
      return {
        subjectId: r.subject_id,
        subject: r.subjects?.display_name || r.subjects?.subject_name || `Subject ${r.subject_id}`,
        grade: r.grade,
        target,
        cls,
        diff: cls ? points[r.grade] - points[target] : 0,
      };
    })
    .sort((a, b) => (points[b.grade] - points[a.grade]) || (b.diff - a.diff));
}

// English first, then Maths, then every other subject alphabetically — the
// order subjects appear in on a report.
export function compareReportSubjects(a, b) {
  const rank = (name) => {
    const n = (name || '').trim().toLowerCase();
    if (n === 'english' || n === 'english language') return 0;
    if (n === 'mathematics' || n === 'maths') return 1;
    return 2;
  };
  return (rank(a) - rank(b)) || (a || '').localeCompare(b || '');
}
