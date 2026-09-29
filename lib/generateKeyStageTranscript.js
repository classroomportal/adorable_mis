import { supabase } from './supabaseClient';
import { loadLogoBase64 } from './pdfLogo';
import { publishStudentDocument } from './publishStudentDocument';
import { squareGrade } from './transcriptGrades';
import {
  PAGE_WIDTH,
  CONTINUATION_TOP,
  createLetterhead,
  drawStudentBlock,
  drawSectionHeading,
  gridTableStyles,
  drawTableOutline,
  drawNote,
  addPageIdentification,
} from './pdfSchoolDocument';

// The permanent, cumulative transcript: a FIXED column per (year group,
// term) across a whole key stage — e.g. KS3 is always Y7 T1, Y7 T2, Y7 T3,
// Y8 T1, ... Y9 T3 (9 columns) — whether or not a grade has been entered
// for that slot yet.
//
// Each square is that term's end-of-term exam. Its grade comes from the
// exam's result set ("Y10 Term 1 Exam", placed by calendar_events
// exam_year_group / exam_term, migration 246), or failing that from
// transcript_grades (migration 097), where grades from before the exams were
// result sets were imported straight into squares. lib/transcriptGrades.js
// decides between them.
//
// Split into two documents because a student's subject list usually
// changes at the KS3/KS4 boundary — KS4 and KS5 (Y12) share one document
// per house decision. Years 10-11 are graded on both scales, so KS4/5 comes
// in an IGCSE and a WAEC version; KS3 is IGCSE only and Year 12 WAEC only
// (principal, 28 Sept 2026).
const KEY_STAGE_GROUPS = {
  ks3: {
    yearGroups: [7, 8, 9], scale: 'igcse', label: 'KS3 Transcript', heading: 'Transcript',
    documentType: 'ks3_transcript', fileSuffix: '',
    note: 'One end-of-term exam grade shown per term, on the IGCSE scale.',
  },
  ks4_5: {
    yearGroups: [10, 11, 12], scale: 'igcse', label: 'KS4/5 Transcript (IGCSE)', heading: 'Transcript (IGCSE)',
    documentType: 'ks4_5_transcript', fileSuffix: '',
    note: 'One end-of-term exam grade shown per term: IGCSE grades for Years 10 and 11, WAEC grades for Year 12.',
  },
  ks4_5_waec: {
    yearGroups: [10, 11, 12], scale: 'waec', label: 'KS4/5 Transcript (WAEC)', heading: 'Transcript (WAEC)',
    documentType: 'ks4_5_waec_transcript', fileSuffix: '_WAEC',
    note: "One end-of-term exam grade shown per term, on the WAEC scale. Years 10 and 11 are worked out from the exam score using the school's WAEC grade boundaries.",
  },
};

export const KEY_STAGE_GROUP_OPTIONS = Object.entries(KEY_STAGE_GROUPS).map(([value, c]) => ({ value, label: c.label, yearGroups: c.yearGroups }));

const TERM_NUMBERS = [1, 2, 3];

// The page furniture lives in pdfSchoolDocument; what's left here is this
// document's own grid — a wide column of subject names, then nine grade
// columns the page is easily wide enough to give a fixed width.
const SUBJECT_COL_WIDTH = 46;
const TERM_COL_WIDTH = 11.75;
const TABLE_WIDTH = SUBJECT_COL_WIDTH + 9 * TERM_COL_WIDTH;
const TABLE_LEFT = (PAGE_WIDTH - TABLE_WIDTH) / 2;

async function buildKeyStageTranscriptDoc(studentId, group) {
  const config = KEY_STAGE_GROUPS[group];
  if (!config) throw new Error(`Unknown key stage transcript group: ${group}`);

  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const { data: student } = await supabase
    .from('students')
    .select('student_id, first_name, last_name, dob, year_group, form_class, photo_base64')
    .eq('student_id', studentId)
    .single();

  // Every error is thrown rather than read as "no grades": a transcript
  // quietly missing a year's exams would be published to parents as if
  // complete.
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data || []; };

  const legacy = must(await supabase
    .from('transcript_grades')
    .select('subject_id, year_group, term_number, grade, subjects(subject_name, display_name)')
    .eq('student_id', studentId)
    .in('year_group', config.yearGroups));

  const examSets = must(await supabase
    .from('calendar_events')
    .select('event_id, event_date, exam_year_group, exam_term')
    .in('exam_year_group', config.yearGroups));
  const setById = new Map(examSets.map((e) => [e.event_id, e]));

  const marks = setById.size === 0 ? [] : must(await supabase
    .from('results')
    .select('subject_id, grade, score, max_score, result_set_event_id, subjects(subject_name, display_name)')
    .eq('student_id', studentId)
    .in('result_set_event_id', [...setById.keys()]));

  const columns = config.yearGroups.flatMap((yg) => TERM_NUMBERS.map((t) => ({ year_group: yg, term_number: t, label: `T${t}` })));
  const slotKey = (subjectId, yearGroup, term) => `${subjectId}-${yearGroup}-${term}`;

  const subjectNameById = {};
  const nameSubject = (row) => {
    subjectNameById[row.subject_id] = row.subjects?.display_name || row.subjects?.subject_name || `Subject ${row.subject_id}`;
  };

  const legacyBySlot = {};
  legacy.forEach((g) => {
    nameSubject(g);
    legacyBySlot[slotKey(g.subject_id, g.year_group, g.term_number)] = g.grade;
  });

  // A student who repeated a year has two sets for the same square; the
  // later one is the grade that stands.
  const markBySlot = {};
  const markDateBySlot = {};
  marks.forEach((m) => {
    const set = setById.get(m.result_set_event_id);
    if (!set || (!m.grade && m.score == null)) return;
    nameSubject(m);
    const key = slotKey(m.subject_id, set.exam_year_group, set.exam_term);
    if (markDateBySlot[key] && markDateBySlot[key] > set.event_date) return;
    markBySlot[key] = m;
    markDateBySlot[key] = set.event_date;
  });

  const subjectIds = Object.keys(subjectNameById).map(Number).sort((a, b) =>
    subjectNameById[a].localeCompare(subjectNameById[b])
  );

  const boundaryRows = subjectIds.length === 0 ? [] : must(await supabase
    .from('subject_grade_boundaries')
    .select('subject_id, year_group, grade, min_score')
    .in('subject_id', subjectIds)
    .in('year_group', [...new Set([...config.yearGroups, 12])]));

  let anyOtherScale = false;
  const gradeBySubjectSlot = {};
  subjectIds.forEach((sid) => {
    columns.forEach((c) => {
      const key = slotKey(sid, c.year_group, c.term_number);
      const square = squareGrade({
        subjectId: sid,
        yearGroup: c.year_group,
        versionScale: config.scale,
        mark: markBySlot[key],
        legacyGrade: legacyBySlot[key],
        boundaryRows,
      });
      if (!square) return;
      if (square.otherScale) anyOtherScale = true;
      gradeBySubjectSlot[key] = square.otherScale
        ? { content: square.grade, styles: { fontStyle: 'italic' } }
        : square.grade;
    });
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${config.label} — ${student?.first_name || ''} ${student?.last_name || ''}`.trim() });

  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }
  const letterhead = createLetterhead(doc, logoData, config.heading);

  const detailsBaseline = drawStudentBlock(doc, student);
  const headingBaseline = detailsBaseline + 14.4;
  drawSectionHeading(doc, 'Results Table:', headingBaseline);

  // Two header rows: the year group spanning its three terms, then the
  // terms themselves. The subject column's header is intentionally blank,
  // as on the printed original.
  const head = [
    [{ content: '', rowSpan: 2 }, ...config.yearGroups.map((yg) => ({ content: `Year ${yg}`, colSpan: TERM_NUMBERS.length }))],
    columns.map((c) => c.label),
  ];
  const body = subjectIds.map((sid) => {
    const row = [subjectNameById[sid]];
    columns.forEach((c) => {
      row.push(gradeBySubjectSlot[slotKey(sid, c.year_group, c.term_number)] || '');
    });
    return row;
  });

  const columnStyles = { 0: { cellWidth: SUBJECT_COL_WIDTH, halign: 'left', fontStyle: 'bold' } };
  columns.forEach((_, i) => { columnStyles[i + 1] = { cellWidth: TERM_COL_WIDTH }; });

  const startY = headingBaseline + 5.5;
  autoTable(doc, {
    startY,
    head,
    body,
    ...gridTableStyles(10),
    columnStyles,
    margin: { left: TABLE_LEFT, right: TABLE_LEFT, top: CONTINUATION_TOP },
    // The letterhead goes on before the table is drawn; the heavier outer
    // border and subject divider go on after it, once this page's last row
    // is known.
    willDrawPage: letterhead,
    didDrawPage: (data) => drawTableOutline(doc, data, {
      left: TABLE_LEFT,
      width: TABLE_WIDTH,
      startY,
      dividers: [SUBJECT_COL_WIDTH],
    }),
  });

  const otherScale = config.scale === 'waec' ? 'IGCSE' : 'WAEC';
  drawNote(
    doc,
    body.length
      ? `${config.note}${anyOtherScale ? ` Grades in italics were only recorded on the ${otherScale} scale, with no score to work this scale out from.` : ''} Weekly assessment detail is on the separate term test scores report.`
      : 'No transcript grades have been recorded for this student in these year groups.',
    TABLE_LEFT,
    doc.lastAutoTable.finalY + 6,
    { maxWidth: TABLE_WIDTH }
  );
  addPageIdentification(doc, student);

  return { doc, student, config };
}

export async function generateKeyStageTranscript(studentId, group) {
  const { doc, student, config } = await buildKeyStageTranscriptDoc(studentId, group);
  // Matches the office's own filing convention, e.g.
  // ABIODUN-OYEYEMI-Brian-000193-A_B_C_Transcript_10-12.pdf
  const years = config.yearGroups;
  const filename = [
    (student?.last_name || 'STUDENT').toUpperCase(),
    student?.first_name || '',
    String(student?.student_id ?? '').padStart(6, '0'),
    `A_B_C_Transcript_${years[0]}-${years[years.length - 1]}${config.fileSuffix}`,
  ].filter(Boolean).join('-').replace(/\s+/g, '_') + '.pdf';
  doc.save(filename);
}

// Term-independent (term_id is always null): this is a single cumulative
// document per key-stage group, not a per-term one — republishing overwrites
// the previous copy with the latest full picture.
export async function publishKeyStageTranscript(studentId, group) {
  const { doc, config } = await buildKeyStageTranscriptDoc(studentId, group);
  return publishStudentDocument({
    doc,
    studentId,
    documentType: config.documentType,
    termId: null,
    title: config.label,
  });
}
