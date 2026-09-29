// An admissions letter (applicant_letters, migration 256) as an A4 PDF: the
// school crest over a hairline rule, the date, the subject in bold, then
// the body exactly as it was produced. The body is plain text; a blank line
// separates paragraphs and a single line break is kept as one.
import { loadLogoBase64 } from './pdfLogo';
import { PAGE_WIDTH, MARGIN_X, CONTENT_WIDTH, CREST, formatSchoolDate } from './pdfSchoolDocument';
import { LETTER_KIND_LABELS } from './admissions';

const LEFT = MARGIN_X + 7.3; // a 20mm letter margin
const TEXT_WIDTH = CONTENT_WIDTH - 2 * 7.3;
const RULE_Y = CREST.top + CREST.height + 4;
const BOTTOM = 277;
const CONTINUATION_TOP = 20;
const FONT_SIZE = 11;
const LINE_HEIGHT = FONT_SIZE * 0.3528 * 1.45;

// The letter's date on the school's clock (Lagos, UTC+1, no DST).
function lagosDate(ts) {
  if (!ts) return '';
  return new Date(new Date(ts).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function generateAdmissionLetterPdf({ letter, applicant }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }
  if (logoData) {
    doc.addImage(logoData, 'PNG', (PAGE_WIDTH - CREST.width) / 2, CREST.top, CREST.width, CREST.height);
  }
  doc.setLineWidth(0.26);
  doc.setDrawColor(0, 0, 0);
  doc.line(MARGIN_X, RULE_Y, PAGE_WIDTH - MARGIN_X, RULE_Y);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT_SIZE);
  let y = RULE_Y + 12;
  doc.text(formatSchoolDate(lagosDate(letter.sent_at)), PAGE_WIDTH - LEFT, y, { align: 'right' });

  y += LINE_HEIGHT * 2;
  doc.setFont('helvetica', 'bold');
  const subjectLines = doc.splitTextToSize(letter.subject || '', TEXT_WIDTH);
  subjectLines.forEach((line) => { doc.text(line, LEFT, y); y += LINE_HEIGHT; });
  y += LINE_HEIGHT;

  doc.setFont('helvetica', 'normal');
  const paragraphs = String(letter.body || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  paragraphs.forEach((para, p) => {
    const lines = para.split('\n').flatMap((l) => (l.trim() === '' ? [''] : doc.splitTextToSize(l, TEXT_WIDTH)));
    lines.forEach((line) => {
      if (y > BOTTOM) {
        doc.addPage();
        y = CONTINUATION_TOP;
      }
      doc.text(line, LEFT, y);
      y += LINE_HEIGHT;
    });
    if (p < paragraphs.length - 1) y += LINE_HEIGHT;
  });

  const pageCount = doc.getNumberOfPages();
  if (pageCount > 1) {
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN_X, 287, { align: 'right' });
    }
    doc.setTextColor(0, 0, 0);
  }

  const kind = LETTER_KIND_LABELS[letter.letter_kind] || 'Letter';
  const name = `${applicant?.last_name || ''} ${applicant?.first_name || ''}`.trim() || 'Applicant';
  doc.save(`${name} - ${kind}.pdf`.replace(/[\\/:*?"<>|]/g, ''));
}
