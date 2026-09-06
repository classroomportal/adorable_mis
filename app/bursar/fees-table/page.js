'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

const STATUS_STYLES = {
  paid: 'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  unpaid: 'bg-red-50 text-red-700 border-red-200',
};

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function toCsv(rows) {
  const header = ['Student', 'Form Class', 'Year Group', 'Total Due', 'Paid', 'Balance', 'Status'];
  const lines = rows.map((r) =>
    [r.name, r.form_class, r.year_group, r.total_due, r.total_paid, r.balance, r.status]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

function FeesTableInner() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');

  const [yearGroup, setYearGroup] = useState('');
  const [formClass, setFormClass] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false });
      setTerms(data ?? []);
      const current = (data ?? []).find((t) => t.is_current);
      if (current) setTermId(String(current.id));
    })();
  }, []);

  useEffect(() => {
    if (!termId) return;
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

  async function loadRows() {
    setLoading(true);

    let studentQuery = supabase
      .from('students')
      .select('student_id, first_name, last_name, form_class, year_group')
      .eq('status', 'active');
    if (yearGroup) studentQuery = studentQuery.eq('year_group', Number(yearGroup));
    if (formClass) studentQuery = studentQuery.eq('form_class', formClass);

    const { data: students } = await studentQuery.order('last_name');
    if (!students || students.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const studentIds = students.map((s) => s.student_id);

    const { data: invoices } = await supabase
      .from('student_invoices')
      .select('id, student_id, status')
      .eq('term_id', Number(termId))
      .in('student_id', studentIds);

    const invoiceIds = (invoices ?? []).map((i) => i.id);

    const [{ data: lineItems }, { data: payments }] = await Promise.all([
      invoiceIds.length
        ? supabase.from('invoice_line_items').select('invoice_id, amount').in('invoice_id', invoiceIds)
        : Promise.resolve({ data: [] }),
      invoiceIds.length
        ? supabase.from('fee_payments').select('invoice_id, amount').in('invoice_id', invoiceIds)
        : Promise.resolve({ data: [] }),
    ]);

    const dueByInvoice = {};
    (lineItems ?? []).forEach((li) => {
      dueByInvoice[li.invoice_id] = (dueByInvoice[li.invoice_id] || 0) + Number(li.amount);
    });
    const paidByInvoice = {};
    (payments ?? []).forEach((p) => {
      paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + Number(p.amount);
    });

    const invoiceByStudent = {};
    (invoices ?? []).forEach((inv) => {
      invoiceByStudent[inv.student_id] = inv;
    });

    let built = students.map((s) => {
      const inv = invoiceByStudent[s.student_id];
      const total_due = inv ? dueByInvoice[inv.id] || 0 : 0;
      const total_paid = inv ? paidByInvoice[inv.id] || 0 : 0;
      return {
        student_id: s.student_id,
        name: `${s.first_name} ${s.last_name}`,
        form_class: s.form_class,
        year_group: s.year_group,
        total_due,
        total_paid,
        balance: total_due - total_paid,
        status: inv ? inv.status : 'no invoice',
      };
    });

    if (statusFilter) {
      built = built.filter((r) => r.status === statusFilter);
    }

    setRows(built);
    setLoading(false);
  }

  function handleExport() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = rows.reduce(
    (acc, r) => ({
      due: acc.due + r.total_due,
      paid: acc.paid + r.total_paid,
      balance: acc.balance + r.balance,
    }),
    { due: 0, paid: 0, balance: 0 }
  );

  return (
    <div className="min-h-screen bg-[#FAF9F6] pb-24">
      <header className="bg-[#B23A2E] text-white px-5 pt-6 pb-5">
        <p className="text-sm text-white/70">Fees & Bills</p>
        <h1 className="text-xl font-semibold mt-0.5">All students</h1>
        <p className="text-sm text-white/80 mt-1">Fee position for every active student this term.</p>
      </header>

      <main className="px-5 mt-5 space-y-4 max-w-4xl mx-auto">
        <section className="bg-white rounded-xl border border-black/5 p-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-sm font-medium text-neutral-700">Term</label>
            <select
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700">Year group</label>
            <select
              value={yearGroup}
              onChange={(e) => setYearGroup(e.target.value)}
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            >
              <option value="">All</option>
              {[7, 8, 9, 10, 11, 12].map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            >
              <option value="">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="no invoice">No invoice</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className="text-sm font-medium text-neutral-700">Form class</label>
            <input
              value={formClass}
              onChange={(e) => setFormClass(e.target.value)}
              placeholder="e.g. 10A"
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            />
          </div>

          <button
            type="button"
            onClick={loadRows}
            className="col-span-2 bg-[#B23A2E] text-white rounded-lg py-2.5 text-sm font-medium"
          >
            Apply filters
          </button>
        </section>

        <section className="bg-white rounded-xl border border-black/5 p-4 flex justify-between items-center text-sm">
          <div className="space-x-4">
            <span className="text-neutral-500">
              Due <span className="font-medium text-neutral-800">{naira(totals.due)}</span>
            </span>
            <span className="text-neutral-500">
              Paid <span className="font-medium text-neutral-800">{naira(totals.paid)}</span>
            </span>
            <span className="text-neutral-500">
              Balance <span className="font-medium text-neutral-800">{naira(totals.balance)}</span>
            </span>
          </div>
          <button type="button" onClick={handleExport} className="text-[#B23A2E] font-medium">
            Export CSV
          </button>
        </section>

        <section className="bg-white rounded-xl border border-black/5 overflow-hidden">
          {loading ? (
            <p className="p-4 text-sm text-neutral-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">No students match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 border-b border-neutral-200">
                    <th className="px-3 py-2.5 font-medium">Student</th>
                    <th className="px-3 py-2.5 font-medium">Class</th>
                    <th className="px-3 py-2.5 font-medium text-right">Due</th>
                    <th className="px-3 py-2.5 font-medium text-right">Paid</th>
                    <th className="px-3 py-2.5 font-medium text-right">Balance</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.student_id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#EEF3F8]'}>
                      <td className="px-3 py-2.5">
                        <a href={`/bursar/payments?student=${r.student_id}`} className="text-[#B23A2E] font-medium">
                          {r.name}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-600">
                        {r.form_class} · Y{r.year_group}
                      </td>
                      <td className="px-3 py-2.5 text-right text-neutral-700">{naira(r.total_due)}</td>
                      <td className="px-3 py-2.5 text-right text-neutral-700">{naira(r.total_paid)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-neutral-800">{naira(r.balance)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-2 py-1 rounded-full border font-medium ${STATUS_STYLES[r.status] ?? 'border-neutral-200 text-neutral-500'}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default function FeesTablePage() {
  return (
    <RequireAuth>
      <FeesTableInner />
    </RequireAuth>
  );
}
