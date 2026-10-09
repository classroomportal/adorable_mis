import { supabase } from './supabaseClient';
import { formatUKDate } from './formatDate';
import { loadLogoBase64 } from './pdfLogo';
import { publishStudentDocument } from './publishStudentDocument';
import { buildWeekColumns, loadHolidayDates, weekForDate } from './termWeeks';
import { splitsWaecOnly, waecResultGrade, waecTarget, loadWaecBoundaries } from './waecSubjects';
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
// The subject column is at least this wide, and widens to fit the longest
// subject name on one line (e.g. "Citizenship and National Heritage", the
// principal, 9 Oct 2026), taking the room from the week columns but never
// squeezing a week below FIT_WEEK_COL_WIDTH, which still holds "A* / B".
const SUBJECT_COL_WIDTH = 42;
const FIT_WEEK_COL_WIDTH = 11;
const SUBJECT_FONT_SIZE = 8;
const CELL_SIDE_PADDING = 1.5;
const TARGET_COL_WIDTH = 14;
const MIN_WEEK_COL_WIDTH = 6;
const MAX_WEEK_COL_WIDTH = 16;
// A special result set (migration 358, e.g. "Y12 Mocks") replaces the week
// column its date falls in, headed by its name (the principal, 4 Oct 2026:
// Year 12's mocks take the place of that week's assessment). A set whose
// date matches no week, or a second
// set in the same week, gets a column of its own after the weeks.
// In a week's place the column keeps the week's width (a wider one squeezed
// "Wk10" onto two lines) and its name is printed smaller, wrapping by word.
const SPECIAL_COL_WIDTH = 16;
const SPECIAL_HEAD_FONT_SIZE = 6.5;
// Light grey for a week in which the subject wasn't assessed.
const NOT_ASSESSED_FILL = [225, 225, 225];
// Years 10-11 (lib/waecSubjects): the IGCSE subjects first, then the
// subjects sat for WAEC only, each under a title row, with a thick line
// between the two sections (the principal, 9 Oct 2026).
const IGCSE_SECTION_TITLE = 'IGCSE and WAEC Subjects';
const WAEC_SECTION_TITLE = 'WAEC Only Subjects';
const SECTION_RULE_WIDTH = 1.2;

function weekColumnWidth(weekCount, specialCount, subjectWidth = SUBJECT_COL_WIDTH) {
  const available = CONTENT_WIDTH - subjectWidth - TARGET_COL_WIDTH - specialCount * SPECIAL_COL_WIDTH;
  return Math.min(MAX_WEEK_COL_WIDTH, Math.max(MIN_WEEK_COL_WIDTH, available / weekCount));
}

// Wide enough for the longest name in bold, within what the weeks can spare.
function subjectColumnWidth(doc, names, weekCount, specialCount) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(SUBJECT_FONT_SIZE);
  const longest = Math.max(0, ...names.map((n) => doc.getTextWidth(String(n))));
  const wanted = Math.ceil(longest + 2 * CELL_SIDE_PADDING + 1);
  const spare = CONTENT_WIDTH - TARGET_COL_WIDTH - specialCount * SPECIAL_COL_WIDTH - weekCount * FIT_WEEK_COL_WIDTH;
  return Math.max(SUBJECT_COL_WIDTH, Math.min(wanted, spare));
}

// A result's week_start_date goes in the week it falls in (lib/termWeeks).
function nearestWeekLabel(weeks, weekStartDate) {
  return weekForDate(weeks, weekStartDate)?.label ?? null;
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
    .select('subject_id, week_start_date, grade, score, max_score, result_type, result_set_event_id, subjects(subject_name, display_name), calendar_events(event_name)')
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

  // The subjects sat for WAEC only (migration 422), and the boundaries
  // that turn their grades and targets into WAEC. Read separately so that,
  // without the column, the report still prints as it did.
  let waecOnly = new Set();
  let waecBoundaries = [];
  if (splitsWaecOnly(yg)) {
    const { data: waecRows, error: waecError } = await supabase
      .from('subjects').select('subject_id').eq('waec_only', true);
    if (!waecError) waecOnly = new Set((waecRows || []).map((r) => r.subject_id));
    waecBoundaries = await loadWaecBoundaries(supabase, [...waecOnly]);
  }
  const cellGrade = (r) => (waecOnly.has(r.subject_id)
    ? waecResultGrade(waecBoundaries, r.subject_id, r)
    : r.grade || '');
  const targetFor = (sid) => (waecOnly.has(sid)
    ? waecTarget(targetBySubject[sid])
    : targetBySubject[sid] || '');
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
  //
  // Once the year group has been assessed at all this term, every subject
  // the student takes also gets a row, marked or not: squares for weeks it
  // wasn't assessed in are shaded, so the white gaps left are marks that
  // are genuinely missing. A term nobody has been assessed in yet keeps the
  // plain "no results" line instead of a grid of empty subjects.
  async function subjectsForTerm(weeks, assessments, assessedByWeek, specialSets) {
    const subjectNameById = {};
    (results || []).forEach((r) => {
      if (!matchesKeyStage(r.subject_id)) return;
      // A mark in one of this term's special sets counts whatever its date.
      if (!specialSets.has(r.result_set_event_id) && !nearestWeekLabel(weeks, r.week_start_date)) return;
      subjectNameById[r.subject_id] = r.subjects?.display_name || r.subjects?.subject_name || `Subject ${r.subject_id}`;
    });
    const termAssessed = Object.keys(assessedByWeek).length > 0
      || [...specialSets.values()].some((set) => set.subjects.size > 0);
    const unmarked = !termAssessed ? [] : [...new Set(
      assessments
        .filter((a) => a.enrolled && matchesKeyStage(a.subject_id) && !subjectNameById[a.subject_id])
        .map((a) => a.subject_id)
    )];
    if (unmarked.length > 0) {
      const { data: subs } = await supabase
        .from('subjects')
        .select('subject_id, subject_name, display_name')
        .in('subject_id', unmarked);
      (subs || []).forEach((s) => {
        subjectNameById[s.subject_id] = s.display_name || s.subject_name || `Subject ${s.subject_id}`;
      });
    }
    // WAEC-only subjects (Years 10-11) go after the others, in their own
    // section; waecOnly is empty for every other year.
    const subjectIds = Object.keys(subjectNameById).map(Number).sort((a, b) =>
      Number(waecOnly.has(a)) - Number(waecOnly.has(b))
      || subjectNameById[a].localeCompare(subjectNameById[b])
    );
    return { subjectIds, subjectNameById };
  }

  // Which subjects the student's year group was assessed in, week by week
  // (migration 174). A week with no assessments at all for the year, such
  // as one that hasn't happened yet, has no entry here and stays white.
  async function assessmentsForTerm(term, weeks) {
    const { data, error } = await supabase.rpc('report_week_assessments', {
      p_student_id: studentId,
      p_from: term.start_date,
      p_to: term.end_date,
    });
    if (error) return { assessments: [], assessedByWeek: {} };
    const assessedByWeek = {};
    (data || []).forEach((a) => {
      if (!a.week_start_date) return; // a subject the student takes, not an assessment
      const label = nearestWeekLabel(weeks, a.week_start_date);
      if (!label) return;
      if (!assessedByWeek[label]) assessedByWeek[label] = new Set();
      assessedByWeek[label].add(a.subject_id);
    });
    return { assessments: data || [], assessedByWeek };
  }

  // The special result sets in this term that concern the student (migration
  // 358), oldest first, each with the subjects anyone was marked in. Their
  // marks are shown in the set's own column, never in a week.
  async function specialSetsForTerm(term) {
    const { data, error } = await supabase.rpc('report_special_set_assessments', {
      p_student_id: studentId,
      p_from: term.start_date,
      p_to: term.end_date,
    });
    const sets = new Map();
    if (error) return sets;
    [...(data || [])]
      .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.event_id - b.event_id)
      .forEach((row) => {
        if (!sets.has(row.event_id)) sets.set(row.event_id, { ...row, subjects: new Set() });
        if (row.subject_id != null) sets.get(row.event_id).subjects.add(row.subject_id);
      });
    return sets;
  }

  // The weeks holding an end-of-term exam result set (category 'exam') for
  // the student's year group, or for every year: the term's last week is
  // exam week, and its column says so rather than Wk10.
  async function examWeeksForTerm(term, weeks) {
    const { data } = await supabase
      .from('calendar_events')
      .select('event_date, exam_year_group')
      .eq('category', 'exam')
      .eq('is_result_set', true)
      .gte('event_date', term.start_date)
      .lte('event_date', term.end_date);
    const labels = new Set();
    (data || [])
      .filter((e) => e.exam_year_group == null || e.exam_year_group === student?.year_group)
      .forEach((e) => {
        const label = nearestWeekLabel(weeks, e.event_date);
        if (label) labels.add(label);
      });
    return labels;
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
  let anyShaded = false;
  let anyWaecSection = false;
  for (const term of terms || []) {
    const holidays = await loadHolidayDates(term.start_date, term.end_date);
    const weeks = buildWeekColumns(term, holidays);
    if (weeks.length === 0) continue;
    const { assessments, assessedByWeek } = await assessmentsForTerm(term, weeks);
    const specialSets = await specialSetsForTerm(term);
    const specials = [...specialSets.values()];
    const setByWeek = new Map(); // week label -> the special set in its place
    const extraSets = [];
    specials.forEach((set) => {
      const label = nearestWeekLabel(weeks, set.event_date);
      if (label && !setByWeek.has(label)) setByWeek.set(label, set);
      else extraSets.push(set);
    });
    const { subjectIds, subjectNameById } = await subjectsForTerm(weeks, assessments, assessedByWeek, specialSets);
    const examWeeks = await examWeeksForTerm(term, weeks);
    // What a week's column is headed: a special set's name in its place,
    // "Exam" for the end-of-term exam week, otherwise Wk<n>.
    const weekHeading = (w) => setByWeek.get(w.label)?.event_name ?? (examWeeks.has(w.label) ? 'Exam' : w.label);

    // Each term gets its own page: a term's grid and the key to it belong
    // together, and a reader flicking through wants one term per sheet.
    if (renderedTerms.length > 0) {
      doc.addPage();
      letterhead();
      cursorY = CONTINUATION_TOP + 6;
    }
    renderedTerms.push(term);

    const subjectWidth = subjectColumnWidth(doc, subjectIds.map((sid) => subjectNameById[sid]), weeks.length, extraSets.length);
    const weekWidth = weekColumnWidth(weeks.length, extraSets.length, subjectWidth);
    const weeksWidth = weeks.length * weekWidth;
    const tableWidth = subjectWidth + weeksWidth + extraSets.length * SPECIAL_COL_WIDTH + TARGET_COL_WIDTH;
    const tableLeft = (PAGE_WIDTH - tableWidth) / 2;

    // The subject column's header is left blank, as on the printed
    // original; the week and target columns label themselves.
    const setHead = (set) => ({ content: set.event_name, styles: { fontSize: SPECIAL_HEAD_FONT_SIZE } });
    const head = [['', ...weeks.map((w) => (setByWeek.has(w.label) ? setHead(setByWeek.get(w.label)) : weekHeading(w))), ...extraSets.map(setHead), 'Target']];
    const columnCount = weeks.length + extraSets.length + 2;
    const subjectRows = subjectIds.map((sid) => {
      const row = [subjectNameById[sid]];
      const cellByWeek = {};
      const cellBySet = {};
      (results || [])
        .filter((r) => r.subject_id === sid)
        .forEach((r) => {
          // An official exam grade is set in bold rather than flagged with
          // an asterisk: the school grades in A*/A1+ notation, so "A*" plus
          // a marker used to print as the unreadable "A**".
          const isExam = r.result_type === 'exam_grade' || r.result_type === 'term_exam_import';
          const grade = cellGrade(r);
          const cell = isExam ? { content: grade, styles: { fontStyle: 'bold' } } : grade;
          if (specialSets.has(r.result_set_event_id)) { cellBySet[r.result_set_event_id] = cell; return; }
          const label = nearestWeekLabel(weeks, r.week_start_date);
          if (!label) return;
          (cellByWeek[label] ||= []).push({ grade, isExam });
        });
      // Two marks in one week (e.g. a Monday TA and a Friday ReLP) are both
      // shown, oldest first, rather than the later hiding the earlier.
      Object.entries(cellByWeek).forEach(([label, marks]) => {
        const content = marks.map((m) => m.grade).filter(Boolean).join(' / ');
        cellByWeek[label] = marks.every((m) => m.isExam) ? { content, styles: { fontStyle: 'bold' } } : content;
      });
      // An empty square in a week the year group was assessed, but not in
      // this subject, is shaded: nothing was due. An empty white square in
      // an assessed week means a mark is missing.
      // In a week a special set has replaced, its mark comes first; a
      // weekly mark from that week still shows if the subject wasn't in it.
      weeks.forEach((w) => {
        const set = setByWeek.get(w.label);
        const cell = (set && cellBySet[set.event_id]) || cellByWeek[w.label];
        if (cell) { row.push(cell); return; }
        const assessed = assessedByWeek[w.label];
        const anyAssessed = !!assessed || (set?.subjects.size ?? 0) > 0;
        if (anyAssessed && !assessed?.has(sid) && !set?.subjects.has(sid)) {
          anyShaded = true;
          row.push({ content: '', styles: { fillColor: NOT_ASSESSED_FILL } });
        } else {
          row.push('');
        }
      });
      extraSets.forEach((set) => {
        if (cellBySet[set.event_id]) { row.push(cellBySet[set.event_id]); return; }
        if (set.subjects.size > 0 && !set.subjects.has(sid)) {
          anyShaded = true;
          row.push({ content: '', styles: { fillColor: NOT_ASSESSED_FILL } });
        } else {
          row.push('');
        }
      });
      row.push(targetFor(sid));
      return row;
    });

    // Years 10-11 with a WAEC-only subject: a title row over each section.
    const waecStart = subjectIds.findIndex((sid) => waecOnly.has(sid));
    const sectionRow = (title) => [{
      content: title,
      colSpan: columnCount,
      styles: { halign: 'left', fontStyle: 'bold', fontSize: 8.5 },
    }];
    const sectionRowIndexes = new Set();
    const waecTitleIndex = waecStart < 0 ? -1 : waecStart + (waecStart > 0 ? 1 : 0);
    let body = subjectRows;
    if (waecStart >= 0) {
      body = [
        ...(waecStart > 0 ? [sectionRow(IGCSE_SECTION_TITLE), ...subjectRows.slice(0, waecStart)] : []),
        sectionRow(WAEC_SECTION_TITLE),
        ...subjectRows.slice(waecStart),
      ];
      if (waecStart > 0) sectionRowIndexes.add(0);
      sectionRowIndexes.add(waecTitleIndex);
    }
    // Where the title rows fall on each page, so the column dividers stop
    // short of them.
    const sectionGaps = {};

    const columnStyles = { 0: { cellWidth: subjectWidth, halign: 'left', fontStyle: 'bold' } };
    weeks.forEach((_, i) => { columnStyles[i + 1] = { cellWidth: weekWidth }; });
    extraSets.forEach((_, i) => { columnStyles[weeks.length + 1 + i] = { cellWidth: SPECIAL_COL_WIDTH }; });
    columnStyles[weeks.length + extraSets.length + 1] = { cellWidth: TARGET_COL_WIDTH };

    drawSectionHeading(doc, `${term.term_name} (${formatUKDate(term.start_date)} – ${formatUKDate(term.end_date)})`, cursorY);

    // Nothing to tabulate: a grid of empty week headers says less than one
    // plain sentence, so say the sentence and move on to the next term.
    if (subjectRows.length === 0) {
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
      didDrawCell: (data) => {
        if (data.section !== 'body' || !sectionRowIndexes.has(data.row.index)) return;
        const page = doc.getCurrentPageInfo().pageNumber;
        const { y, height } = data.cell;
        (sectionGaps[page] ||= []).push({ top: y, bottom: y + height });
        // The thick line between the IGCSE and WAEC sections.
        if (data.row.index === waecTitleIndex && waecTitleIndex > 0) {
          doc.setLineWidth(SECTION_RULE_WIDTH);
          doc.setDrawColor(0, 0, 0);
          doc.line(tableLeft, y, tableLeft + tableWidth, y);
        }
      },
      didDrawPage: (data) => drawTableOutline(doc, data, {
        left: tableLeft,
        width: tableWidth,
        startY: gradesStartY,
        gaps: sectionGaps[doc.getCurrentPageInfo().pageNumber] || [],
        // Subject names and the target grade are fenced off from the
        // week-by-week record either side of them.
        // Special result sets that replace no week sit in their own block
        // after the weeks.
        dividers: [
          subjectWidth,
          ...(extraSets.length ? [subjectWidth + weeksWidth] : []),
          tableWidth - TARGET_COL_WIDTH,
        ],
      }),
    });
    drewAnyGrid = true;
    if (waecStart >= 0) anyWaecSection = true;
    cursorY = doc.lastAutoTable.finalY + 10;

    // For each week column, list the distinct category/result-set label(s)
    // of whatever data landed there (e.g. "Short Test", "Big ReLP",
    // "Exam Grade") so it's clear what kind of assessment each column is,
    // without collapsing the existing Week 1/Week 2 layout.
    const categoryByWeek = {};
    weeks.forEach((w) => { categoryByWeek[w.label] = new Set(); });
    (results || []).forEach((r) => {
      if (specialSets.has(r.result_set_event_id)) return; // headed by its own name
      const label = nearestWeekLabel(weeks, r.week_start_date);
      if (!label) return;
      categoryByWeek[label].add(categoryLabel(r));
    });

    // A week nothing landed in needs no entry in the key — the grid above
    // already shows it empty. The key runs in as a wrapped line rather
    // than a second table: it is a caption for the grid, not a rival to it.
    const keyEntries = weeks
      .map((w) => [weekHeading(w), Array.from(categoryByWeek[w.label]).join(' / ')])
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
      'Official exam grades are shown in bold. Everything else is weekly assessment — ReLP, Short Test or Teacher Assessment.'
        + (anyShaded ? ' Shaded squares: subject not assessed that week.' : '')
        + (anyWaecSection ? ' WAEC Only Subjects are graded in WAEC; their target is the IGCSE target converted to WAEC.' : ''),
      MARGIN_X,
      Math.min(cursorY, 280),
      { maxWidth: CONTENT_WIDTH }
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
