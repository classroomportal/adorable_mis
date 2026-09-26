import { PDF_GRID_STYLE } from './generateInvoicePdf';

// Tuckshop order sheets as a downloadable PDF, built from the same grouped
// data /tuckshop/order-sheets renders. Every table starts on a new page, so
// each restaurant's student list and its item totals can be handed out
// separately. "NGN" rather than ₦: jsPDF's built-in fonts have no naira sign.

function naira(n) {
  return `NGN ${Number(n || 0).toLocaleString()}`;
}

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function totalsRows(totals) {
  const rows = totals.map((t) => [t.name, String(t.qty), naira(t.qty * t.price)]);
  rows.push([
    'Total',
    String(totals.reduce((s, t) => s + t.qty, 0)),
    naira(totals.reduce((s, t) => s + t.qty * t.price, 0)),
  ]);
  return rows;
}

export async function generateOrderSheetsPdf({ forDate, locked, closesLabel, restaurants, allTotals, studentCount }) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ orientation: 'portrait' });
  const status = locked ? `Final - orders locked ${closesLabel}` : 'PROVISIONAL - ordering still open';
  const printed = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  let first = true;

  // One table per page, with its heading above it.
  function tablePage(title, subtitle, table) {
    if (!first) doc.addPage();
    first = false;
    doc.setFontSize(14);
    doc.text(title, 14, 16);
    doc.setFontSize(9);
    doc.text(subtitle, 14, 22);
    const lastRowBold = table.totalRow
      ? { didParseCell: (d) => { if (d.section === 'body' && d.row.index === table.body.length - 1) d.cell.styles.fontStyle = 'bold'; } }
      : {};
    autoTable(doc, {
      startY: 27,
      head: [table.head],
      body: table.body,
      ...PDF_GRID_STYLE,
      styles: { fontSize: 9, cellPadding: 1.5, lineColor: PDF_GRID_STYLE.lineColor, lineWidth: PDF_GRID_STYLE.lineWidth },
      headStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' },
      columnStyles: table.columnStyles || {},
      margin: { left: 14, right: 14 },
      ...lastRowBold,
    });
  }

  const dateLabel = longDate(forDate);
  const right = { halign: 'right' };

  tablePage(
    `Tuckshop orders - ${dateLabel}`,
    `All restaurants - ${studentCount} student${studentCount === 1 ? '' : 's'} - ${status} - printed ${printed}`,
    {
      head: ['Restaurant', 'Students', 'Items', 'Value'],
      body: restaurants.map((r) => [
        r.label,
        String(r.students.length),
        String(r.totals.reduce((s, t) => s + t.qty, 0)),
        naira(r.totals.reduce((s, t) => s + t.qty * t.price, 0)),
      ]),
      columnStyles: { 1: right, 2: right, 3: right },
    },
  );

  tablePage(
    `Item totals, all restaurants - ${dateLabel}`,
    status,
    { head: ['Item', 'Qty', 'Value'], body: totalsRows(allTotals), columnStyles: { 1: right, 2: right }, totalRow: true },
  );

  restaurants.forEach((r) => {
    const sub = `${r.students.length} student${r.students.length === 1 ? '' : 's'} - ${status}`;
    tablePage(`${r.label} - ${dateLabel}`, sub, {
      head: ['Student', 'Form', 'Order', 'Amount', 'Given'],
      body: r.students.map((s) => [
        `${s.student?.last_name || ''}, ${s.student?.first_name || ''}`,
        s.student?.form_class || (s.student?.year_group ? `Year ${s.student.year_group}` : ''),
        s.items.map((it) => `${it.qty} x ${it.name}`).join(', '),
        naira(s.items.reduce((n, it) => n + it.qty * it.price, 0)),
        s.fulfilled ? 'Yes' : '',
      ]),
      columnStyles: { 3: right, 4: { halign: 'center', cellWidth: 16 } },
    });
    tablePage(`Item totals, ${r.label} - ${dateLabel}`, sub, {
      head: ['Item', 'Qty', 'Value'],
      body: totalsRows(r.totals),
      columnStyles: { 1: right, 2: right },
      totalRow: true,
    });
  });

  doc.save(`tuckshop-orders-${forDate}.pdf`);
}
