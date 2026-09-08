import { supabase } from './supabaseClient';

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

function naira(n) {
  return `NGN ${Number(n || 0).toLocaleString()}`;
}

// Shared table styling so every printed PDF in the app (transcript, invoice,
// future reports) gets the same clearly-visible ruled lines. Earlier
// lineWidth of 0.1 with a light grey (180,180,180) printed almost invisibly
// on some printers — 0.3 with near-black prints reliably.
export const PDF_GRID_STYLE = {
  theme: 'grid',
  lineColor: [60, 60, 60],
  lineWidth: 0.3,
};

export async function generateInvoicePdf({ student, term, lineItems, payments, invoiceStatus }) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ orientation: 'portrait' });
  let logoData = null;
  try { logoData = await loadLogoBase64(); } catch (e) { /* logo optional */ }

  if (logoData) {
    doc.addImage(logoData, 'PNG', 14, 10, 30, 12);
  }
  doc.setFontSize(16);
  doc.text('Adorable British College', 105, 18, { align: 'center' });
  doc.setFontSize(11);
  doc.text('Fee Invoice', 105, 25, { align: 'center' });

  doc.setFontSize(10);
  const fullName = `${student?.first_name || ''} ${student?.last_name || ''}`.trim();
  doc.text(`Student: ${fullName}`, 14, 38);
  doc.text(`Year: ${student?.year_group ?? '-'}   Form: ${student?.form_class ?? '-'}`, 14, 44);
  doc.text(`Term: ${term?.name ?? '-'}`, 140, 38);
  doc.text(`Status: ${invoiceStatus ?? '-'}`, 140, 44);

  const totalDue = (lineItems || []).reduce((s, li) => s + Number(li.amount), 0);
  const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const nowDue = totalDue - totalPaid;

  autoTable(doc, {
    startY: 52,
    head: [['Item', 'Amount']],
    body: (lineItems || []).map((li) => [li.description || li.fee_items?.display_name || li.fee_items?.name || '-', naira(li.amount)]),
    foot: [['Total', naira(totalDue)]],
    ...PDF_GRID_STYLE,
    styles: { fontSize: 10, cellPadding: 3, lineColor: PDF_GRID_STYLE.lineColor, lineWidth: PDF_GRID_STYLE.lineWidth },
    headStyles: { fillColor: [122, 26, 26], textColor: 255 },
    footStyles: { fillColor: [238, 243, 248], textColor: 20, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
  });

  let cursorY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text(`Total due: ${naira(totalDue)}`, 14, cursorY);
  doc.text(`Paid so far: ${naira(totalPaid)}`, 14, cursorY + 6);
  doc.setFont(undefined, 'bold');
  doc.text(`Balance now due: ${naira(nowDue)}`, 14, cursorY + 12);
  doc.setFont(undefined, 'normal');
  cursorY += 22;

  if (payments && payments.length > 0) {
    doc.setFontSize(11);
    doc.text('Payment history', 14, cursorY);
    autoTable(doc, {
      startY: cursorY + 4,
      head: [['Date', 'Amount', 'Method', 'Reference']],
      body: payments.map((p) => [p.paid_date, naira(p.amount), p.method || '-', p.reference || '-']),
      ...PDF_GRID_STYLE,
      styles: { fontSize: 9, cellPadding: 2.5, lineColor: PDF_GRID_STYLE.lineColor, lineWidth: PDF_GRID_STYLE.lineWidth },
      headStyles: { fillColor: [122, 26, 26], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
    cursorY = doc.lastAutoTable.finalY + 10;
  }

  if (cursorY > 220) { doc.addPage(); cursorY = 20; }

  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('How to pay', 14, cursorY);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  const payLines = [
    '1. Payments can be made via BANKERS DRAFT from any bank of your choice.',
    '2. Payments can also be done through BILLS PAYMENT AND COLLECTION on the Zenith Bank PLC banking app.',
    "3. School fees payment via bank transfer is accepted. Send a copy of the receipt showing your ward's name",
    '   to the Student Relations Officer (SRO) 48 hours before resumption.',
    "4. All bankers' drafts should be in favour of ADORABLE FOUNDATION FOR EDUCATIONAL DEVELOPMENT.",
  ];
  cursorY += 5;
  payLines.forEach((line) => {
    doc.text(line, 14, cursorY);
    cursorY += 5;
  });

  cursorY += 3;
  doc.setFont(undefined, 'bold');
  doc.text('School fees accounts', 14, cursorY);
  doc.setFont(undefined, 'normal');
  cursorY += 6;
  autoTable(doc, {
    startY: cursorY,
    head: [['Account', 'Name', 'Number', 'Bank']],
    body: [
      ['One', 'Adorable Foundation for Educational Development', '1016123022', 'Zenith Bank PLC'],
      ['Two', 'Adorable Foundation for Educational Development', '0108904357', 'Access (Diamond) Bank PLC'],
    ],
    ...PDF_GRID_STYLE,
    styles: { fontSize: 9, cellPadding: 2.5, lineColor: PDF_GRID_STYLE.lineColor, lineWidth: PDF_GRID_STYLE.lineWidth },
    headStyles: { fillColor: [122, 26, 26], textColor: 255 },
    margin: { left: 14, right: 14 },
  });
  cursorY = doc.lastAutoTable.finalY + 8;

  doc.setFontSize(8);
  doc.text('Please retain this invoice for your records. For queries, contact the Student Relations Officer.', 14, cursorY);

  const filename = `${(student?.last_name || 'student').toUpperCase()}-${student?.student_id}-Invoice-${(term?.name || '').replace(/\s+/g, '')}.pdf`;
  doc.save(filename);
}

export async function generateInvoicePdfForStudent(studentId, termId) {
  const { data: student } = await supabase
    .from('students')
    .select('student_id, first_name, last_name, year_group, form_class')
    .eq('student_id', studentId)
    .single();

  const { data: term } = await supabase
    .from('fee_terms')
    .select('id, name')
    .eq('id', termId)
    .single();

  const { data: invoice } = await supabase
    .from('student_invoices')
    .select('id, status')
    .eq('student_id', studentId)
    .eq('term_id', termId)
    .maybeSingle();

  if (!invoice) return false;

  const [{ data: lineItems }, { data: payments }] = await Promise.all([
    supabase.from('invoice_line_items').select('description, amount, fee_items(name, display_name)').eq('invoice_id', invoice.id).order('created_at'),
    supabase.from('fee_payments').select('amount, method, reference, paid_date').eq('invoice_id', invoice.id).order('paid_date', { ascending: false }),
  ]);

  await generateInvoicePdf({ student, term, lineItems, payments, invoiceStatus: invoice.status });
  return true;
}
