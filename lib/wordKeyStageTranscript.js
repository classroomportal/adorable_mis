import { loadKeyStageTranscript, transcriptFileName } from './generateKeyStageTranscript';
import { formatSchoolDate } from './pdfSchoolDocument';

// The key stage transcript as an editable Word document, for the school
// office: leavers' transcripts are applied for through the office, which
// sometimes needs to tidy one up (a subject name, a note) before it goes
// out. Same content as the PDF (loadKeyStageTranscript), laid out the same
// way: crest and title in the page header, the photo, the student line,
// then the results grid with its two header rows repeated on every page.
// Staff only; parents only ever get the PDF.

const MM = 56.7; // twips per millimetre (page setup and table widths)
const PX = 3.78; // pixels per millimetre at 96 dpi (image sizes)
const MARGIN_MM = 12.7;
const SUBJECT_COL_MM = 46;
const TERM_COL_MM = 11.75;
const FONT = 'Arial';

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Photos are stored at whatever aspect the phone used, so the image is
// scaled to fit the template's 36.7 x 48.3 mm frame rather than stretched.
function measureImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function fitInto(src, maxWmm, maxHmm) {
  const size = await measureImage(src);
  if (!size) return { width: maxWmm * PX, height: maxHmm * PX };
  const scale = Math.min(maxWmm / size.width, maxHmm / size.height);
  return { width: size.width * scale * PX, height: size.height * scale * PX };
}

async function loadLogoBytes() {
  try {
    const res = await fetch('/logo.png');
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return null;
  }
}

export async function downloadKeyStageTranscriptWord(studentId, group) {
  const [docx, transcript, logo] = await Promise.all([
    import('docx'),
    loadKeyStageTranscript(studentId, group),
    loadLogoBytes(),
  ]);
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header,
    AlignmentType, WidthType, BorderStyle, VerticalAlign, TableLayoutType,
  } = docx;
  const { student, config, columns, rows, note } = transcript;

  const text = (t, opts = {}) => new TextRun({ text: t, font: FONT, size: 20, ...opts });
  const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const thick = { style: BorderStyle.SINGLE, size: 12, color: '000000' };
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

  // Crest, title and rule, repeated on every page like the PDF letterhead.
  const headerChildren = [];
  if (logo) {
    headerChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 80 * PX, height: 19.8 * PX } })],
    }));
  }
  headerChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 4 } },
    children: [text(config.heading, { bold: true, size: 24 })],
  }));

  const body = [];

  if (student?.photo_base64) {
    const src = `data:image/jpeg;base64,${student.photo_base64}`;
    const size = await fitInto(src, 36.7, 48.3);
    body.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 240 },
      children: [new ImageRun({ type: 'jpg', data: base64ToBytes(student.photo_base64), transformation: size })],
    }));
  }

  // Student / Class / Date of Birth on one borderless line, surname bold
  // and upper-case as on the printed original.
  const detail = (label, runs) => new TableCell({
    borders: noBorders,
    children: [new Paragraph({ children: [text(`${label}  `, { size: 18, color: '555555' }), ...runs] })],
  });
  body.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [new TableRow({
      children: [
        detail('Student', [text(`${student?.first_name || ''} `, { size: 22 }), text((student?.last_name || '').toUpperCase(), { size: 22, bold: true })]),
        detail('Class', [text(student?.form_class || (student?.year_group ? `Year ${student.year_group}` : '—'), { size: 22 })]),
        detail('Date of Birth', [text(formatSchoolDate(student?.dob) || '—', { size: 22 })]),
      ],
    })],
  }));

  body.push(new Paragraph({
    spacing: { before: 360, after: 120 },
    children: [text('Results Table:', { bold: true, underline: {}, size: 22 })],
  }));

  // The grid: a wide subject column, then one column per (year, term),
  // under a row of year groups spanning their three terms.
  const cell = (children, { width, columnSpan, rowSpan, align = AlignmentType.CENTER, borders } = {}) => new TableCell({
    children: [new Paragraph({ alignment: align, children })],
    width: width ? { size: width * MM, type: WidthType.DXA } : undefined,
    columnSpan,
    rowSpan,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    borders: borders || { top: thin, bottom: thin, left: thin, right: thin },
  });
  const termsPerYear = columns.length / config.yearGroups.length;
  const subjectBorders = { top: thin, bottom: thin, left: thick, right: thick };

  const headRows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell([text('')], { width: SUBJECT_COL_MM, rowSpan: 2, borders: { ...subjectBorders, top: thick } }),
        ...config.yearGroups.map((yg) => cell([text(`Year ${yg}`)], { columnSpan: termsPerYear, borders: { top: thick, bottom: thin, left: thin, right: thin } })),
      ],
    }),
    new TableRow({
      tableHeader: true,
      children: columns.map((c) => cell([text(c.label)], { width: TERM_COL_MM })),
    }),
  ];
  const bodyRows = rows.map((r) => new TableRow({
    cantSplit: true,
    children: [
      cell([text(r.subject, { bold: true })], { width: SUBJECT_COL_MM, align: AlignmentType.LEFT, borders: subjectBorders }),
      ...r.squares.map((sq) => cell([text(sq ? sq.grade : '', { italics: !!sq?.otherScale })], { width: TERM_COL_MM })),
    ],
  }));

  body.push(new Table({
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    width: { size: (SUBJECT_COL_MM + columns.length * TERM_COL_MM) * MM, type: WidthType.DXA },
    columnWidths: [SUBJECT_COL_MM * MM, ...columns.map(() => TERM_COL_MM * MM)],
    borders: { top: thick, bottom: thick, left: thick, right: thick, insideHorizontal: thin, insideVertical: thin },
    rows: [...headRows, ...bodyRows],
  }));

  body.push(new Paragraph({
    spacing: { before: 160 },
    children: [text(note, { size: 16, color: '5A5A5A' })],
  }));

  const doc = new Document({
    creator: 'Formwork',
    title: `${config.label} — ${student?.first_name || ''} ${student?.last_name || ''}`.trim(),
    sections: [{
      properties: {
        page: {
          size: { width: 210 * MM, height: 297 * MM },
          margin: { top: 50 * MM, bottom: MARGIN_MM * MM, left: MARGIN_MM * MM, right: MARGIN_MM * MM, header: MARGIN_MM * MM },
        },
      },
      headers: { default: new Header({ children: headerChildren }) },
      children: body,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = transcriptFileName(student, config, 'docx');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
