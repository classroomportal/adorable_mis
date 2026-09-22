// The school's house style for a student-facing PDF, in one place so the
// transcript and the termly grade report can't drift apart.
//
// Every measurement here (in mm) is taken off the school's own Word
// document, the "Individual Report Base Template" the office prints by
// hand: A4 portrait, crest centred at the top over a hairline rule,
// passport photo centred below it, a borderless Student / Class / Date of
// Birth band, then black-ruled tables centred on the page.
export const PAGE_WIDTH = 210;
export const MARGIN_X = 12.7;
export const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X;
export const CREST = { width: 80, height: 19.8, top: 12.7 };
export const TITLE_BASELINE = 46.2;
export const RULE_Y = 47.4;
export const PHOTO = { width: 36.7, height: 48.3, top: 55.7 };
// The outer border of a table is noticeably heavier than the rules between
// its cells, as in the Word original (1.5pt around the block, 0.5pt inside).
export const GRID_LINE_WIDTH = 0.17;
export const GRID_BORDER_WIDTH = 0.5;
// Where a table continues onto a second page, it starts here — clear of the
// letterhead, which is reprinted on every page.
export const CONTINUATION_TOP = RULE_Y + 8;

// dd/mm/yyyy, the format the school's printed documents use. Deliberately
// not formatUKDate() ("25 Jan 2010"), which is the house style for on-screen
// labels sitting next to a date picker, not for these documents.
export function formatSchoolDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = String(isoDate).split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}

function drawLetterhead(doc, logoData, title) {
  if (logoData) {
    doc.addImage(logoData, 'PNG', (PAGE_WIDTH - CREST.width) / 2, CREST.top, CREST.width, CREST.height);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(title, PAGE_WIDTH / 2, TITLE_BASELINE, { align: 'center' });
  doc.setLineWidth(0.26);
  doc.setDrawColor(0, 0, 0);
  doc.line(MARGIN_X, RULE_Y, PAGE_WIDTH - MARGIN_X, RULE_Y);
}

// Returns a function that stamps the letterhead on whichever page is
// current, at most once per page. A document built from several tables asks
// for the letterhead once per table per page, and printing the same bold
// title twice over itself shows.
export function createLetterhead(doc, logoData, title) {
  const painted = new Set();
  return () => {
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    if (painted.has(page)) return;
    painted.add(page);
    drawLetterhead(doc, logoData, title);
  };
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
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  fields.forEach((f) => doc.text(f.label, f.x, baseline));

  doc.setFontSize(11);
  const firstName = `${student?.first_name || ''} `;
  doc.text(firstName, fields[0].valueX, baseline);
  doc.setFont('helvetica', 'bold');
  doc.text((student?.last_name || '').toUpperCase(), fields[0].valueX + doc.getTextWidth(firstName), baseline);

  doc.setFont('helvetica', 'normal');
  doc.text(student?.form_class || (student?.year_group ? `Year ${student.year_group}` : '—'), fields[1].valueX, baseline);
  doc.text(formatSchoolDate(student?.dob) || '—', fields[2].valueX, baseline);
}

// Draws the photo and details band on the current page and reports the
// baseline it used. With no photo on file the block closes up rather than
// leaving the template's photo-shaped hole in the page.
export function drawStudentBlock(doc, student) {
  let baseline = RULE_Y + 12;
  if (student?.photo_base64) {
    drawStudentPhoto(doc, student.photo_base64);
    baseline = PHOTO.top + PHOTO.height + 17.7;
  }
  drawStudentDetails(doc, student, baseline);
  return baseline;
}

// A bold, underlined run-in heading — the template's "Results Table:" idiom.
export function drawSectionHeading(doc, text, baseline, { x = MARGIN_X, fontSize = 11 } = {}) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  doc.setTextColor(0, 0, 0);
  doc.text(text, x, baseline);
  doc.setLineWidth(0.25);
  doc.setDrawColor(0, 0, 0);
  doc.line(x, baseline + 1.2, x + doc.getTextWidth(text), baseline + 1.2);
  return baseline;
}

// autoTable styling for the black-ruled grid: no fill anywhere, headers in
// regular weight, row labels bold, everything centred but the first column.
export function gridTableStyles(fontSize = 10, padding = 1.6) {
  return {
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: GRID_LINE_WIDTH,
      cellPadding: { top: padding, bottom: padding, left: 1.5, right: 1.5 },
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: { fillColor: false, textColor: [0, 0, 0], fontStyle: 'normal' },
  };
}

// Heavy outer border for whatever part of a table landed on this page, plus
// heavy vertical rules wherever a column needs fencing off (the subject
// names, the target grade); the divisions inside the grid stay hairline.
export function drawTableOutline(doc, data, { left, width, startY, dividers = [] }) {
  const top = data.table.pageNumber === 1 ? startY : data.settings.margin.top;
  doc.setLineWidth(GRID_BORDER_WIDTH);
  doc.setDrawColor(0, 0, 0);
  doc.rect(left, top, width, data.cursor.y - top);
  dividers.forEach((x) => doc.line(left + x, top, left + x, data.cursor.y));
}

// Small grey print under a table. With a maxWidth the text wraps; the
// baseline after the last line is returned so callers can keep going.
export function drawNote(doc, text, x, y, { maxWidth, fontSize = 8 } = {}) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(90, 90, 90);
  const lines = maxWidth ? doc.splitTextToSize(text, maxWidth) : [text];
  const lineHeight = fontSize * 0.42;
  lines.forEach((line, i) => doc.text(line, x, y + i * lineHeight));
  doc.setTextColor(0, 0, 0);
  return y + (lines.length - 1) * lineHeight;
}

// Loose pages get separated, so once a document runs to more than one page
// every page says who it belongs to and where it sits in the run. A
// single-page document stays exactly as the template has it.
export function addPageIdentification(doc, student) {
  const pageCount = doc.getNumberOfPages();
  if (pageCount < 2) return;
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
