import { supabase } from './supabaseClient';
import { loadLogoBase64 } from './pdfLogo';
import { publishStudentDocument } from './publishStudentDocument';

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
    .select('student_id, first_name, last_name, dob, year_group, form_class')
    .eq('student_id', studentId)
    .single();

  const { data: grades } = await supabase
    .from('transcript_grades')
    .select('subject_id, year_group, term_number, grade, subjects(subject_name, display_name)')
    .eq('student_id', studentId)
    .in('year_group', config.yearGroups);

  const columns = config.yearGroups.flatMap((yg) => TERM_NUMBERS.map((t) => ({ year_group: yg, term_number: t, label: `Y${yg} T${t}` })));

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

  const doc = new jsPDF({ orientation: 'landscape' });
  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }
  if (logoData) doc.addImage(logoData, 'PNG', 12, 8, 40, 16);

  doc.setFontSize(16);
  doc.text(config.label, 148, 18, { align: 'center' });
  doc.setFontSize(11);
  const fullName = `${student?.first_name || ''} ${student?.last_name || ''}`.trim();
  doc.text(`Student: ${fullName}`, 12, 34);
  doc.text(`Year: ${student?.year_group ?? '—'}   Form: ${student?.form_class ?? '—'}`, 12, 40);
  doc.text(`DOB: ${student?.dob ?? '—'}`, 220, 34);

  const head = [['Subject', ...columns.map((c) => c.label)]];
  const body = subjectIds.map((sid) => {
    const row = [subjectNameById[sid]];
    columns.forEach((c) => {
      row.push(gradeBySubjectSlot[`${sid}-${c.year_group}-${c.term_number}`] || '—');
    });
    return row;
  });

  autoTable(doc, {
    startY: 48,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [60, 60, 60], lineWidth: 0.3 },
    headStyles: { fillColor: [122, 26, 26] },
    margin: { left: 12, right: 12 },
  });

  doc.setFontSize(8);
  doc.text(
    'One official exam grade shown per term. Weekly assessment detail is on the separate term test scores report.',
    12,
    doc.lastAutoTable.finalY + 6
  );

  return { doc, student, config };
}

export async function generateKeyStageTranscript(studentId, group) {
  const { doc, student, config } = await buildKeyStageTranscriptDoc(studentId, group);
  const filename = `${(student?.last_name || 'student').toUpperCase()}-${student?.student_id}-${config.documentType}.pdf`;
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
