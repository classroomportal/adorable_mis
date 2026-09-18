import { supabase } from './supabaseClient';
import { loadLogoBase64 } from './pdfLogo';
import { publishStudentDocument } from './publishStudentDocument';

// The permanent, cumulative transcript: one official exam grade per subject
// per term, built up over a whole key stage rather than reset each term like
// the term-test-scores report. Split into two documents because a student's
// subject list (and grading scale) usually changes at the KS3/KS4 boundary —
// KS4 and KS5 (Y12) share one document per house decision.
//
// Which subjects/terms appear is driven entirely by subject_key_stages tags
// and where qualifying results actually exist — never by the student's
// *current* year group. Using the current year group would make a Y10+
// student's KS3 transcript regenerate empty, since they're no longer "in"
// KS3 by that measure even though their historical KS3 grades are exactly
// the point of the document.
const KEY_STAGE_GROUPS = {
  ks3: { tags: ['KS3'], label: 'KS3 Transcript', documentType: 'ks3_transcript' },
  ks4_5: { tags: ['KS4', 'KS5'], label: 'KS4/5 Transcript', documentType: 'ks4_5_transcript' },
};

export const KEY_STAGE_GROUP_OPTIONS = Object.entries(KEY_STAGE_GROUPS).map(([value, c]) => ({ value, label: c.label }));

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

  const { data: ksRows } = await supabase.from('subject_key_stages').select('subject_id, key_stage');
  const qualifyingSubjectIds = new Set(
    (ksRows || []).filter((r) => config.tags.includes(r.key_stage)).map((r) => r.subject_id)
  );

  // Only exam-style results count towards this record — a single official
  // grade per subject per term, not every weekly short test/ReLP score
  // (those live on the separate term test scores report).
  const { data: results } = await supabase
    .from('results')
    .select('subject_id, week_start_date, grade, result_type, subjects(subject_name, display_name)')
    .eq('student_id', studentId)
    .in('result_type', ['exam_grade', 'term_exam_import'])
    .order('week_start_date');
  const relevantResults = (results || []).filter((r) => qualifyingSubjectIds.has(r.subject_id));

  const { data: allTerms } = await supabase
    .from('terms')
    .select('term_id, term_name, start_date, end_date')
    .order('start_date');

  function termFor(weekStartDate) {
    const t = new Date(weekStartDate + 'T00:00:00Z').getTime();
    return (allTerms || []).find((term) => {
      const start = new Date(term.start_date + 'T00:00:00Z').getTime();
      const end = new Date(term.end_date + 'T00:00:00Z').getTime();
      return t >= start && t <= end;
    });
  }

  // Only show terms that actually have a qualifying grade, rather than every
  // term in the school's history — the columns grow as the key stage
  // progresses instead of starting mostly blank.
  const termIdsWithData = new Set();
  relevantResults.forEach((r) => {
    const t = termFor(r.week_start_date);
    if (t) termIdsWithData.add(t.term_id);
  });
  const terms = (allTerms || []).filter((t) => termIdsWithData.has(t.term_id));

  const subjectNameById = {};
  relevantResults.forEach((r) => {
    subjectNameById[r.subject_id] = r.subjects?.display_name || r.subjects?.subject_name || `Subject ${r.subject_id}`;
  });
  const subjectIds = Object.keys(subjectNameById).map(Number).sort((a, b) =>
    subjectNameById[a].localeCompare(subjectNameById[b])
  );

  // One cell per (subject, term): the latest qualifying grade recorded that
  // term, in case more than one exam-grade entry was logged for it.
  const gradeBySubjectTerm = {};
  relevantResults.forEach((r) => {
    const t = termFor(r.week_start_date);
    if (!t) return;
    const key = `${r.subject_id}-${t.term_id}`;
    const existing = gradeBySubjectTerm[key];
    if (!existing || r.week_start_date >= existing.week_start_date) {
      gradeBySubjectTerm[key] = r;
    }
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

  const head = [['Subject', ...terms.map((t) => t.term_name)]];
  const body = subjectIds.map((sid) => {
    const row = [subjectNameById[sid]];
    terms.forEach((t) => {
      const r = gradeBySubjectTerm[`${sid}-${t.term_id}`];
      row.push(r?.grade || '—');
    });
    return row;
  });

  autoTable(doc, {
    startY: 48,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, lineColor: [60, 60, 60], lineWidth: 0.3 },
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
