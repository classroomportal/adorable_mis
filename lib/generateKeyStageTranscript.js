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

// Page furniture, in mm, measured off the school's own Word transcript
// ("Individual Report Base Template") so a transcript printed from here is
// indistinguishable from one the office produces by hand: A4 portrait,
// crest centred at the top over a hairline rule, passport photo centred
// below it, a borderless Student / Class / Date of Birth band, then the
// grade grid centred on the page.
//
// Deliberate departures from that Word file, all of them tidy-ups of what
// are plainly accidents of hand-editing rather than design: the rule stops
// at the margin instead of running off the right-hand edge of the paper,
// the Student/Class/DOB values share one type size, and the two stray
// grey-shaded empty cells are not reproduced.
const PAGE_WIDTH = 210;
const MARGIN_X = 12.7;
const CREST = { width: 80, height: 19.8, top: 12.7 };
const TITLE_BASELINE = 46.2;
const RULE_Y = 47.4;
const PHOTO = { width: 36.7, height: 48.3, top: 55.7 };
const SUBJECT_COL_WIDTH = 46;
const TERM_COL_WIDTH = 11.75;
const TABLE_WIDTH = SUBJECT_COL_WIDTH + 9 * TERM_COL_WIDTH;
const TABLE_LEFT = (PAGE_WIDTH - TABLE_WIDTH) / 2;
// Outer border is noticeably heavier than the internal rules, as in the
// Word original (1.5pt around the block, 0.5pt between cells).
const GRID_LINE_WIDTH = 0.17;
const GRID_BORDER_WIDTH = 0.5;

// dd/mm/yyyy, the format the school's printed transcript uses. Deliberately
// not formatUKDate() ("25 Jan 2010"), which is the house style for on-screen
// labels sitting next to a date picker, not for this document.
function formatTranscriptDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = String(isoDate).split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}

// Draws the crest, title and rule. Runs on every page so a transcript that
// spills onto a second page still looks like school stationery.
function drawLetterhead(doc, logoData) {
  if (logoData) {
    doc.addImage(logoData, 'PNG', (PAGE_WIDTH - CREST.width) / 2, CREST.top, CREST.width, CREST.height);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text('Transcript', PAGE_WIDTH / 2, TITLE_BASELINE, { align: 'center' });
  doc.setLineWidth(0.26);
  doc.setDrawColor(0, 0, 0);
  doc.line(MARGIN_X, RULE_Y, PAGE_WIDTH - MARGIN_X, RULE_Y);
}

// The passport photo is boxed rather than stretched: portrait shots are
// stored at whatever aspect the phone that took them used, so it is scaled
// to fit inside the template's frame and centred in it.
function drawStudentPhoto(doc, photoBase64) {
  const dataUrl = `data:image/jpeg;base64,${photoBase64}`;
  let width = PHOTO.width;
  let height = PHOTO.height;
  try {
    const props = doc.getImageProperties(dataUrl);
    const scale = Math.min(PHOTO.width / props.width, PHOTO.height / props.height);
    width = props.width * scale;
    height = props.height * scale;
  } catch (e) { /* fall back to the full frame if the image can't be measured */ }
  doc.addImage(dataUrl, 'JPEG', (PAGE_WIDTH - width) / 2, PHOTO.top + (PHOTO.height - height) / 2, width, height);
}

// Student / Class / Date of Birth, borderless, across the text width. The
// surname is bold and upper-case, as on the printed original.
function drawStudentDetails(doc, student, baseline) {
  const fields = [
    { label: 'Student', x: MARGIN_X, valueX: 28.9 },
    { label: 'Class', x: 93.9, valueX: 108.3 },
    { label: 'Date of Birth', x: 148, valueX: 168.3 },
  ];
  doc.setTextColor(0, 0, 0);
  fields.forEach((f) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(f.label, f.x, baseline);
  });

  doc.setFontSize(11);
  const firstName = `${student?.first_name || ''} `;
  doc.setFont('helvetica', 'normal');
  doc.text(firstName, fields[0].valueX, baseline);
  doc.setFont('helvetica', 'bold');
  doc.text((student?.last_name || '').toUpperCase(), fields[0].valueX + doc.getTextWidth(firstName), baseline);

  doc.setFont('helvetica', 'normal');
  doc.text(student?.form_class || (student?.year_group ? `Year ${student.year_group}` : '—'), fields[1].valueX, baseline);
  doc.text(formatTranscriptDate(student?.dob) || '—', fields[2].valueX, baseline);
}

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

  // With no photo on file the whole block above the grid closes up rather
  // than leaving the template's photo-shaped hole in the page.
  let detailsBaseline = RULE_Y + 12;
  if (student?.photo_base64) {
    drawStudentPhoto(doc, student.photo_base64);
    detailsBaseline = PHOTO.top + PHOTO.height + 17.7;
  }
  drawStudentDetails(doc, student, detailsBaseline);

  const headingBaseline = detailsBaseline + 14.4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Results Table:', MARGIN_X, headingBaseline);
  doc.setLineWidth(0.25);
  doc.line(MARGIN_X, headingBaseline + 1.2, MARGIN_X + doc.getTextWidth('Results Table:'), headingBaseline + 1.2);

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

  autoTable(doc, {
    startY: headingBaseline + 5.5,
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 10,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: GRID_LINE_WIDTH,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 },
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: { fillColor: false, textColor: [0, 0, 0], fontStyle: 'normal' },
    columnStyles,
    margin: { left: TABLE_LEFT, right: TABLE_LEFT, top: RULE_Y + 8 },
    // The letterhead goes on before the table is drawn; the heavier outer
    // border goes on after it, once this page's last row is known.
    willDrawPage: () => drawLetterhead(doc, logoData),
    didDrawPage: (data) => {
      const top = data.table.pageNumber === 1 ? data.settings.startY : data.settings.margin.top;
      doc.setLineWidth(GRID_BORDER_WIDTH);
      doc.setDrawColor(0, 0, 0);
      doc.rect(TABLE_LEFT, top, TABLE_WIDTH, data.cursor.y - top);
      // Subject names are fenced off from the grades by a heavy rule, as
      // on the printed original; the year-group divisions stay hairline.
      doc.line(TABLE_LEFT + SUBJECT_COL_WIDTH, top, TABLE_LEFT + SUBJECT_COL_WIDTH, data.cursor.y);
    },
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  const noteY = doc.lastAutoTable.finalY + 6;
  doc.text(
    body.length
      ? 'One official exam grade shown per term. Weekly assessment detail is on the separate term test scores report.'
      : 'No transcript grades have been recorded for this student in these year groups.',
    TABLE_LEFT,
    noteY
  );
  doc.setTextColor(0, 0, 0);

  // A transcript for a student with a lot of subjects runs to a second
  // page, and loose pages get separated — so once there's more than one,
  // every page says who it belongs to and where it sits in the run. A
  // single-page transcript stays exactly as the template has it.
  const pageCount = doc.getNumberOfPages();
  if (pageCount > 1) {
    const who = `${student?.first_name || ''} ${(student?.last_name || '').toUpperCase()}`.trim();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.text(who, MARGIN_X, 287);
      doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN_X, 287, { align: 'right' });
    }
    doc.setTextColor(0, 0, 0);
  }

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
