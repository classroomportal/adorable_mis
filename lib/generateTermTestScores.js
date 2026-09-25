import { supabase } from './supabaseClient';
import { formatUKDate } from './formatDate';
import { loadLogoBase64 } from './pdfLogo';
import { publishStudentDocument } from './publishStudentDocument';
import {
  PAGE_WIDTH,
  CONTENT_WIDTH,
  MARGIN_X,
  CONTINUATION_TOP,
  createLetterhead,
  drawStudentBlock,
  drawSectionHeading,
  gridTableStyles,
  drawTableOutline,
  drawNote,
  addPageIdentification,
} from './pdfSchoolDocument';

// This report is drawn on the same A4 portrait stationery as the
// transcript (see pdfSchoolDocument) — crest, rule, photo, details band —
// so the two documents a parent receives are recognisably a pair. What
// differs is the grid: a column per week of the term rather than per term
// of the key stage, plus the student's target grade.
//
// A term runs 11-12 weeks, which fits the page comfortably at a fixed
// column width; the width is worked out from the actual week count anyway,
// so a longer term narrows the columns instead of running off the paper.
const SUBJECT_COL_WIDTH = 42;
const TARGET_COL_WIDTH = 14;
const MIN_WEEK_COL_WIDTH = 6;
const MAX_WEEK_COL_WIDTH = 16;

function weekColumnWidth(weekCount) {
  const available = CONTENT_WIDTH - SUBJECT_COL_WIDTH - TARGET_COL_WIDTH;
  return Math.min(MAX_WEEK_COL_WIDTH, Math.max(MIN_WEEK_COL_WIDTH, available / weekCount));
}

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

function categoryLabel(result) {
  if (result.calendar_events?.event_name) return result.calendar_events.event_name;
  const labels = {
    term_exam_import: 'Term Exam',
    short_test: 'Short Test',
    teacher_assessment: 'Teacher Assessment',
    exam_grade: 'Exam Grade',
  };
  return labels[result.result_type] || result.result_type || '—';
}

// Builds the term-test-scores jsPDF document in memory without doing
// anything with it — shared by the live "Download Report" button
// (generateTermTestScores, below) and the staff publish flow
// (publishTermTestScores) so both paths render an identical PDF from a
// single implementation.
async function buildTermTestScoresDoc(studentId, termId) {
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
    .select('subject_id, week_start_date, grade, score, result_type, result_set_event_id, subjects(subject_name, display_name), calendar_events(event_name)')
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
  // A subject qualifies ONLY if it's explicitly tagged for this student's
  // key stage. Most subjects are now tagged (checked Sept 2026), so the
  // small remaining untagged set is either stale duplicate subject codes
  // or genuinely missing tags — either way, safer to hide than leak in.
  function matchesKeyStage(subjectId) {
    const tags = taggedStagesBySubject[subjectId];
    return !!tags && tags.has(studentKeyStage);
  }

  // A subject earns a row in a term's grid only if it has a result that
  // lands in one of that term's weeks (and matches the student's key
  // stage). Targets alone don't earn a row. Collecting subjects across
  // every term used to give the September grid empty rows for subjects
  // that only appeared in last year's July exam import (French, Igbo, PE…
  // for a student who has since dropped them), which read to staff as
  // "missing grades".
  function subjectsForTerm(weeks) {
    const subjectNameById = {};
    (results || []).forEach((r) => {
      if (!matchesKeyStage(r.subject_id)) return;
      if (!nearestWeekLabel(weeks, r.week_start_date)) return;
      subjectNameById[r.subject_id] = r.subjects?.display_name || r.subjects?.subject_name || `Subject ${r.subject_id}`;
    });
    const subjectIds = Object.keys(subjectNameById).map(Number).sort((a, b) =>
      subjectNameById[a].localeCompare(subjectNameById[b])
    );
    return { subjectIds, subjectNameById };
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `Termly Grade Report — ${student?.first_name || ''} ${student?.last_name || ''}`.trim() });

  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }
  const letterhead = createLetterhead(doc, logoData, 'Termly Grade Report');

  const detailsBaseline = drawStudentBlock(doc, student);
  let cursorY = detailsBaseline + 14.4;

  const renderedTerms = [];
  let drewAnyGrid = false;
  for (const term of terms || []) {
    const weeks = buildWeekColumns(term);
    if (weeks.length === 0) continue;
    const { subjectIds, subjectNameById } = subjectsForTerm(weeks);

    // Each term gets its own page: a term's grid and the key to it belong
    // together, and a reader flicking through wants one term per sheet.
    if (renderedTerms.length > 0) {
      doc.addPage();
      letterhead();
      cursorY = CONTINUATION_TOP + 6;
    }
    renderedTerms.push(term);

    const weekWidth = weekColumnWidth(weeks.length);
    const tableWidth = SUBJECT_COL_WIDTH + weeks.length * weekWidth + TARGET_COL_WIDTH;
    const tableLeft = (PAGE_WIDTH - tableWidth) / 2;

    // The subject column's header is left blank, as on the printed
    // original; the week and target columns label themselves.
    const head = [['', ...weeks.map((w) => w.label), 'Target']];
    const body = subjectIds.map((sid) => {
      const row = [subjectNameById[sid]];
      const cellByWeek = {};
      (results || [])
        .filter((r) => r.subject_id === sid)
        .forEach((r) => {
          const label = nearestWeekLabel(weeks, r.week_start_date);
          if (!label) return;
          // An official exam grade is set in bold rather than flagged with
          // an asterisk: the school grades in A*/A1+ notation, so "A*" plus
          // a marker used to print as the unreadable "A**".
          const isExam = r.result_type === 'exam_grade' || r.result_type === 'term_exam_import';
          const grade = r.grade || '';
          cellByWeek[label] = isExam ? { content: grade, styles: { fontStyle: 'bold' } } : grade;
        });
      weeks.forEach((w) => row.push(cellByWeek[w.label] || ''));
      row.push(targetBySubject[sid] || '');
      return row;
    });

    const columnStyles = { 0: { cellWidth: SUBJECT_COL_WIDTH, halign: 'left', fontStyle: 'bold' } };
    weeks.forEach((_, i) => { columnStyles[i + 1] = { cellWidth: weekWidth }; });
    columnStyles[weeks.length + 1] = { cellWidth: TARGET_COL_WIDTH };

    drawSectionHeading(doc, `${term.term_name} (${formatUKDate(term.start_date)} – ${formatUKDate(term.end_date)})`, cursorY);

    // Nothing to tabulate: a grid of empty week headers says less than one
    // plain sentence, so say the sentence and move on to the next term.
    if (body.length === 0) {
      cursorY = drawNote(doc, 'No results have been recorded for this student in this term.', tableLeft, cursorY + 7) + 10;
      continue;
    }

    const gradesStartY = cursorY + 5.5;
    autoTable(doc, {
      startY: gradesStartY,
      head,
      body,
      ...gridTableStyles(8, 1.2),
      columnStyles,
      margin: { left: tableLeft, right: tableLeft, top: CONTINUATION_TOP },
      willDrawPage: letterhead,
      didDrawPage: (data) => drawTableOutline(doc, data, {
        left: tableLeft,
        width: tableWidth,
        startY: gradesStartY,
        // Subject names and the target grade are fenced off from the
        // week-by-week record either side of them.
        dividers: [SUBJECT_COL_WIDTH, tableWidth - TARGET_COL_WIDTH],
      }),
    });
    drewAnyGrid = true;
    cursorY = doc.lastAutoTable.finalY + 10;

    // For each week column, list the distinct category/result-set label(s)
    // of whatever data landed there (e.g. "Short Test", "Big ReLP",
    // "Exam Grade") so it's clear what kind of assessment each column is,
    // without collapsing the existing Week 1/Week 2 layout.
    const categoryByWeek = {};
    weeks.forEach((w) => { categoryByWeek[w.label] = new Set(); });
    (results || []).forEach((r) => {
      const label = nearestWeekLabel(weeks, r.week_start_date);
      if (!label) return;
      categoryByWeek[label].add(categoryLabel(r));
    });

    // A week nothing landed in needs no entry in the key — the grid above
    // already shows it empty. The key runs in as a wrapped line rather
    // than a second table: it is a caption for the grid, not a rival to it.
    const keyEntries = weeks
      .map((w) => [w.label, Array.from(categoryByWeek[w.label]).join(' / ')])
      .filter(([, types]) => types)
      .map(([label, types]) => `${label} ${types}`);
    if (keyEntries.length === 0) continue;

    if (cursorY > 265) { doc.addPage(); letterhead(); cursorY = CONTINUATION_TOP + 6; }
    drawSectionHeading(doc, 'Assessment Types:', cursorY, { x: tableLeft, fontSize: 9 });
    cursorY = drawNote(doc, keyEntries.join('   ·   '), tableLeft, cursorY + 5, { maxWidth: tableWidth, fontSize: 7.5 }) + 7;
  }

  if (renderedTerms.length === 0) {
    drawNote(doc, 'No term dates have been set up, so there is nothing to report on yet.', MARGIN_X, cursorY);
  } else if (drewAnyGrid) {
    // Only worth explaining the bold where there are grades to read.
    drawNote(
      doc,
      'Official exam grades are shown in bold. Everything else is weekly assessment — ReLP, Short Test or Teacher Assessment.',
      MARGIN_X,
      Math.min(cursorY, 283)
    );
  }
  addPageIdentification(doc, student);

  return { doc, student, terms };
}

export async function generateTermTestScores(studentId, termId = null) {
  const { doc, student, terms } = await buildTermTestScoresDoc(studentId, termId);
  // Matches the office's filing convention, as the transcript does, e.g.
  // ANI-Frederick-000026-A_B_C_Report_September_Term_2026.pdf
  const termPart = termId && terms?.[0] ? terms[0].term_name : 'All_Terms';
  const filename = [
    (student?.last_name || 'STUDENT').toUpperCase(),
    student?.first_name || '',
    String(student?.student_id ?? '').padStart(6, '0'),
    `A_B_C_Report_${termPart}`,
  ].filter(Boolean).join('-').replace(/\s+/g, '_') + '.pdf';
  doc.save(filename);
}

// Builds the same PDF, then uploads it to the private student-documents
// bucket and upserts the matching student_documents row (overwriting any
// previous copy for this student/term) instead of downloading it locally.
// Used by the staff-only /reports/generate "Generate & Publish" flow.
export async function publishTermTestScores(studentId, termId = null) {
  const { doc, terms } = await buildTermTestScoresDoc(studentId, termId);
  const title = termId && terms?.[0] ? `Term Test Scores — ${terms[0].term_name}` : 'Term Test Scores — All terms';
  return publishStudentDocument({ doc, studentId, documentType: 'term_test_scores', termId, title });
}
