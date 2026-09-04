import { supabase } from './supabaseClient';

// Converts term.start_date/end_date into a series of week columns
// (Wk1, Wk2, ...), 7 days apart, even if a given week has no results.
// Exported so the importer can reuse the same week numbering.
export function buildWeekColumns(term) {
  const weeks = [];
  let cursor = new Date(term.start_date + 'T00:00:00Z');
  const end = new Date(term.end_date + 'T00:00:00Z');
  let i = 1;
  while (cursor <= end) {
    weeks.push({ label: `Wk${i}`, date: cursor.toISOString().slice(0, 10) });
    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
    i += 1;
  }
  return weeks;
}

// A result's week_start_date is matched to the nearest term week column
// (within 3 days either side) rather than requiring an exact date match,
// since import week-pickers may not land on the exact 7-day cursor.
function nearestWeekLabel(weeks, weekStartDate) {
  const target = new Date(weekStartDate + 'T00:00:00Z').getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const w of weeks) {
    const diff = Math.abs(new Date(w.date + 'T00:00:00Z').getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = w; }
  }
  return bestDiff <= 3 * 24 * 60 * 60 * 1000 ? best?.label : null;
}

async function loadLogoBase64() {
  const res = await fetch('/logo.png');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function generateTranscript(studentId, termId = null) {
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

  const { data: allTerms } = await supabase
    .from('terms')
    .select('term_id, term_name, start_date, end_date')
    .order('start_date');
  const terms = termId ? (allTerms || []).filter((t) => t.term_id === termId) : allTerms;

  const { data: results } = await supabase
    .from('results')
    .select('subject_id, week_start_date, grade, score, result_type, subjects(subject_name, display_name)')
    .eq('student_id', studentId)
    .order('week_start_date');

  const { data: targets } = await supabase
    .from('target_grades')
    .select('subject_id, target_grade, subjects(subject_name, display_name)')
    .eq('student_id', studentId);

  const targetBySubject = Object.fromEntries(
    (targets || []).map((t) => [t.subject_id, t.target_grade])
  );

  // Key stage from year group: KS3 = 7-9, KS4 = 10-11, KS5 = 12.
  const yg = student?.year_group;
  const studentKeyStage = yg <= 9 ? 'KS3' : yg <= 11 ? 'KS4' : 'KS5';
  const { data: ksRows } = await supabase.from('subject_key_stages').select('subject_id, key_stage');
  const taggedStagesBySubject = {};
  (ksRows || []).forEach((r) => {
    if (!taggedStagesBySubject[r.subject_id]) taggedStagesBySubject[r.subject_id] = new Set();
    taggedStagesBySubject[r.subject_id].add(r.key_stage);
  });
  // A subject qualifies if it's untagged (shows everywhere by default)
  // or explicitly tagged for this student's key stage. Chris prefers
  // occasional extra untagged subjects over risking a hidden grade.
  function matchesKeyStage(subjectId) {
    const tags = taggedStagesBySubject[subjectId];
    return !tags || tags.size === 0 || tags.has(studentKeyStage);
  }

  // Collect every subject that appears in either results or targets and
  // matches the student's key stage. NOT filtered by classes.subject_id
  // enrollment — a single class can assess multiple subjects (e.g. a
  // combined vocational or CCA-style slot), so class-to-subject linkage
  // is too narrow a signal for what a student is actually taking.
  const subjectNameById = {};
  (results || []).forEach((r) => {
    if (!matchesKeyStage(r.subject_id)) return;
    subjectNameById[r.subject_id] = r.subjects?.display_name || r.subjects?.subject_name || `Subject ${r.subject_id}`;
  });
  (targets || []).forEach((t) => {
    if (!matchesKeyStage(t.subject_id)) return;
    if (!subjectNameById[t.subject_id]) {
      subjectNameById[t.subject_id] = t.subjects?.display_name || t.subjects?.subject_name || `Subject ${t.subject_id}`;
    }
  });
  const subjectIds = Object.keys(subjectNameById).map(Number).sort((a, b) =>
    subjectNameById[a].localeCompare(subjectNameById[b])
  );

  const doc = new jsPDF({ orientation: 'landscape' });
  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }

  if (logoData) {
    doc.addImage(logoData, 'PNG', 12, 8, 40, 16);
  }
  doc.setFontSize(16);
  doc.text('Transcript', 148, 18, { align: 'center' });

  doc.setFontSize(11);
  const fullName = `${student?.first_name || ''} ${student?.last_name || ''}`.trim();
  doc.text(`Student: ${fullName}`, 12, 34);
  doc.text(`Year: ${student?.year_group ?? '—'}   Form: ${student?.form_class ?? '—'}`, 12, 40);
  doc.text(`DOB: ${student?.dob ?? '—'}`, 220, 34);

  let cursorY = 48;

  for (const term of terms || []) {
    const weeks = buildWeekColumns(term);
    if (weeks.length === 0) continue;

    const head = [['Subject', ...weeks.map((w) => w.label), 'Target']];
    const body = subjectIds.map((sid) => {
      const row = [subjectNameById[sid]];
      const cellByWeek = {};
      (results || [])
        .filter((r) => r.subject_id === sid)
        .forEach((r) => {
          const label = nearestWeekLabel(weeks, r.week_start_date);
          if (!label) return;
          const marker = r.result_type === 'Exam' ? '*' : '';
          cellByWeek[label] = `${r.grade || '—'}${marker}`;
        });
      weeks.forEach((w) => row.push(cellByWeek[w.label] || ''));
      row.push(targetBySubject[sid] || '—');
      return row;
    });

    if (cursorY > 170) { doc.addPage('landscape'); cursorY = 20; }

    doc.setFontSize(12);
    doc.text(`${term.term_name} (${term.start_date} – ${term.end_date})`, 12, cursorY);

    autoTable(doc, {
      startY: cursorY + 4,
      head,
      body,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.5, lineColor: [180, 180, 180], lineWidth: 0.1 },
      headStyles: { fillColor: [122, 26, 26] },
      margin: { left: 12, right: 12 },
      didDrawPage: () => {},
    });

    cursorY = doc.lastAutoTable.finalY + 12;
  }

  doc.setFontSize(8);
  doc.text('* = Exam result. Unmarked = ReLP (weekly assessment).', 12, 200);

  const termSuffix = termId && terms?.[0] ? `-${terms[0].term_name.replace(/\s+/g, '')}` : '';
  const filename = `${(student?.last_name || 'student').toUpperCase()}-${student?.student_id}-Transcript${termSuffix}.pdf`;
  doc.save(filename);
}
