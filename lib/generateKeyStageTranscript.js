import { supabase } from './supabaseClient';
import { loadLogoBase64 } from './pdfLogo';
import { publishStudentDocument } from './publishStudentDocument';
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
// for that slot yet. Backed by transcript_grades (migration 097), a
// dedicated table keyed by (student, subject, year_group, term_number) and
// filled by a one-off manual import, not derived from the weekly results
// pipeline — a past/transferring student's historical grades don't reliably
// line up with a `terms` row at all.
//
// Split into two documents because a student's subject list usually
// changes at the KS3/KS4 boundary — KS4 and KS5 (Y12) share one document
// per house decision.
const KEY_STAGE_GROUPS = {
  ks3: { yearGroups: [7, 8, 9], label: 'KS3 Transcript', documentType: 'ks3_transcript' },
  ks4_5: { yearGroups: [10, 11, 12], label: 'KS4/5 Transcript', documentType: 'ks4_5_transcript' },
};

export const KEY_STAGE_GROUP_OPTIONS = Object.entries(KEY_STAGE_GROUPS).map(([value, c]) => ({ value, label: c.label }));

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

  const { data: grades } = await supabase
    .from('transcript_grades')
    .select('subject_id, year_group, term_number, grade, subjects(subject_name, display_name)')
    .eq('student_id', studentId)
    .in('year_group', config.yearGroups);

  const columns = config.yearGroups.flatMap((yg) => TERM_NUMBERS.map((t) => ({ year_group: yg, term_number: t, label: `T${t}` })));

  const subjectNameById = {};
  (grades || []).forEach((g) => {
    subjectNameById[g.subject_id] = g.subjects?.display_name || g.subjects?.subject_name || `Subject ${g.subject_id}`;
  });
  const subjectIds = Object.keys(subjectNameById).map(Number).sort((a, b) =>
    subjectNameById[a].localeCompare(subjectNameById[b])
  );

  const gradeBySubjectSlot = {};
  (grades || []).forEach((g) => {
    gradeBySubjectSlot[`${g.subject_id}-${g.year_group}-${g.term_number}`] = g.grade;
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${config.label} — ${student?.first_name || ''} ${student?.last_name || ''}`.trim() });

  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }
  const letterhead = createLetterhead(doc, logoData, 'Transcript');

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
      row.push(gradeBySubjectSlot[`${sid}-${c.year_group}-${c.term_number}`] || '');
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

  drawNote(
    doc,
    body.length
      ? 'One official exam grade shown per term. Weekly assessment detail is on the separate term test scores report.'
      : 'No transcript grades have been recorded for this student in these year groups.',
    TABLE_LEFT,
    doc.lastAutoTable.finalY + 6
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
    `A_B_C_Transcript_${years[0]}-${years[years.length - 1]}`,
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
