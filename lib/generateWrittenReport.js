import { supabase } from './supabaseClient';
import { loadLogoBase64 } from './pdfLogo';
import { publishStudentDocument } from './publishStudentDocument';
import { JUDGEMENTS, isExamResult, loadAcademicYear, compareReportSubjects } from './reportWriting';
import {
  MARGIN_X,
  CONTENT_WIDTH,
  CONTINUATION_TOP,
  createLetterhead,
  drawStudentBlock,
  gridTableStyles,
  drawTableOutline,
  drawNote,
  addPageIdentification,
} from './pdfSchoolDocument';

// The written report parents receive at the end of a report period, on the
// same stationery as the transcript and Term Test Scores. Each subject's
// grades sit beside that subject's comment — English first, then Maths,
// then the rest alphabetically — followed by the Mentor, Houseparent and
// SMT comments. Only comments a checker has approved are printed.
//
// No attendance: the school is a boarding school and doesn't report on it.

const GRADES_COL_WIDTH = 50;
const HEADING_FILL = [238, 242, 247];
const PASTORAL_ORDER = [
  { type: 'mentor', label: 'Mentor' },
  { type: 'houseparent', label: 'Houseparent' },
  { type: 'smt', label: 'SMT' },
];

const staffName = (s) => (s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : '');

export function writtenReportTitle(period) {
  return (period?.name || 'Report').replace(/\bReports\b/, 'Report');
}

// The grade printed beside a subject: the student's exam grade in the
// report period's term if they sat one, otherwise their most recent result.
function reportGrades(results) {
  const bySubject = {};
  for (const r of results) {
    const cur = bySubject[r.subject_id];
    // results are oldest first, so a later row replaces an earlier one —
    // except that nothing replaces an exam grade but another exam grade.
    if (!cur || isExamResult(r) || !isExamResult(cur)) bySubject[r.subject_id] = r;
  }
  return Object.fromEntries(Object.entries(bySubject).map(([k, r]) => [k, r.grade]));
}

async function loadReport(studentId, period) {
  const year = await loadAcademicYear(period.term_id);
  const term = year.currentTerm;
  const from = term?.start_date || year.from;
  const to = term?.end_date || year.to;

  const [{ data: student }, { data: subjectRows }, { data: pastoralRows }, { data: results }] = await Promise.all([
    supabase.from('students')
      .select('student_id, first_name, last_name, dob, year_group, form_class, photo_base64')
      .eq('student_id', studentId).single(),
    supabase.from('report_subject_comments')
      .select('subject_id, comment, status, effort_grade, presentation_grade, homework_grade, subjects(subject_name, display_name), staff!report_subject_comments_staff_id_fkey(first_name, last_name)')
      .eq('report_period_id', period.report_period_id).eq('student_id', studentId),
    supabase.from('report_pastoral_comments')
      .select('comment_type, comment, status, staff!report_pastoral_comments_staff_id_fkey(first_name, last_name)')
      .eq('report_period_id', period.report_period_id).eq('student_id', studentId),
    supabase.from('results')
      .select('subject_id, grade, result_type, week_start_date, result_id')
      .eq('student_id', studentId)
      .gte('week_start_date', from).lte('week_start_date', to)
      .not('grade', 'is', null)
      .order('week_start_date').order('result_id'),
  ]);

  const written = (r) => r.comment && r.comment.trim();
  const subjects = (subjectRows || [])
    .filter((r) => r.status === 'checked' && written(r))
    .map((r) => ({ ...r, name: r.subjects?.display_name || r.subjects?.subject_name || `Subject ${r.subject_id}` }))
    .sort((a, b) => compareReportSubjects(a.name, b.name));
  const pastoral = PASTORAL_ORDER
    .map((p) => ({ ...p, row: (pastoralRows || []).find((r) => r.comment_type === p.type && r.status === 'checked' && written(r)) }))
    .filter((p) => p.row);
  const unchecked = [...(subjectRows || []), ...(pastoralRows || [])].filter((r) => r.status !== 'checked' && written(r)).length;

  return { student, subjects, pastoral, unchecked, grades: reportGrades(results || []) };
}

async function buildWrittenReportDoc(studentId, period) {
  const [{ jsPDF }, autoTableModule, report] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadReport(studentId, period),
  ]);
  const autoTable = autoTableModule.default;
  const { student, subjects, pastoral, grades } = report;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = writtenReportTitle(period);
  doc.setProperties({ title: `${title} — ${student?.first_name || ''} ${student?.last_name || ''}`.trim() });

  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }
  const letterhead = createLetterhead(doc, logoData, title);
  const startY = drawStudentBlock(doc, student) + 8;

  // One heading row per section (subject and teacher, or pastoral role and
  // writer), then the grades and comment beneath it.
  const body = [];
  const heading = (text) => [{ content: text, colSpan: 2, styles: { fontStyle: 'bold', fillColor: HEADING_FILL } }];
  for (const s of subjects) {
    const teacher = staffName(s.staff);
    body.push(heading(teacher ? `${s.name} — ${teacher}` : s.name));
    const lines = [`Grade: ${grades[s.subject_id] || '—'}`, ...JUDGEMENTS.map((j) => `${j.label}: ${s[j.column] || '—'}`)];
    body.push([lines.join('\n'), s.comment.trim()]);
  }
  for (const p of pastoral) {
    const writer = staffName(p.row.staff);
    body.push(heading(writer ? `${p.label} — ${writer}` : p.label));
    body.push([{ content: p.row.comment.trim(), colSpan: 2 }]);
  }

  if (body.length === 0) {
    drawNote(doc, 'No comments have been approved for this report yet.', MARGIN_X, startY + 4);
  } else {
    autoTable(doc, {
      startY,
      body,
      ...gridTableStyles(9, 2),
      styles: { ...gridTableStyles(9, 2).styles, halign: 'left', valign: 'top' },
      columnStyles: { 0: { cellWidth: GRADES_COL_WIDTH, fontSize: 8.5 }, 1: { cellWidth: CONTENT_WIDTH - GRADES_COL_WIDTH } },
      rowPageBreak: 'avoid',
      margin: { left: MARGIN_X, right: MARGIN_X, top: CONTINUATION_TOP },
      willDrawPage: letterhead,
      didDrawPage: (data) => drawTableOutline(doc, data, { left: MARGIN_X, width: CONTENT_WIDTH, startY }),
    });
    const keyY = Math.min(doc.lastAutoTable.finalY + 6, 280);
    drawNote(
      doc,
      'Grade: the exam grade for this term, or the most recent assessment where there was no exam. '
        + 'Effort, presentation of work and homework: Excellent · Good · Satisfactory · Needs Improvement.',
      MARGIN_X,
      keyY,
      { maxWidth: CONTENT_WIDTH, fontSize: 7.5 }
    );
  }
  letterhead();
  addPageIdentification(doc, student);
  return { doc, report };
}

function fileName(student, period) {
  return [
    (student?.last_name || 'STUDENT').toUpperCase(),
    student?.first_name || '',
    String(student?.student_id ?? '').padStart(6, '0'),
    writtenReportTitle(period),
  ].filter(Boolean).join('-').replace(/\s+/g, '_') + '.pdf';
}

// Staff preview: downloads the report as it would be published, without
// publishing it.
export async function downloadWrittenReport(studentId, period) {
  const { doc, report } = await buildWrittenReportDoc(studentId, period);
  doc.save(fileName(report.student, period));
  return report;
}

// Publishes the report to the student's documents for parents to see. A
// student with no approved comments at all is skipped rather than sent an
// empty report. Returns what happened, and how many written comments were
// left out because they haven't been approved yet.
export async function publishWrittenReport(studentId, period) {
  const { doc, report } = await buildWrittenReportDoc(studentId, period);
  const printed = report.subjects.length + report.pastoral.length;
  if (printed === 0) return { published: false, printed, unchecked: report.unchecked };
  await publishStudentDocument({
    doc,
    studentId,
    // Per report period rather than per term, so two report periods in the
    // same term don't overwrite each other's reports.
    documentType: `written_report_${period.report_period_id}`,
    termId: period.term_id || null,
    title: writtenReportTitle(period),
  });
  return { published: true, printed, unchecked: report.unchecked };
}
