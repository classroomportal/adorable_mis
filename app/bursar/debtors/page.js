'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function toCsv(rows) {
  const header = ['Student', 'Form Class', 'Year Group', 'Balance', 'Status', 'Parent Name', 'Parent Phone', 'Parent Email'];
  const lines = rows.map((r) =>
    [r.name, r.form_class, r.year_group, r.balance, r.status, r.parentName, r.parentPhone, r.parentEmail]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

function DebtorsInner() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [yearGroup, setYearGroup] = useState('');
  const [sortBy, setSortBy] = useState('balance'); // 'balance' | 'name'
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

    const { data: students } = await supabase
      .from('students')
      .select('student_id, first_name, last_name, form_class, year_group')
      .eq('status', 'active');
    const studentById = new Map((students || []).map((s) => [s.student_id, s]));

    const { data: invoices } = await supabase
      .from('student_invoices')
      .select('id, student_id, status')
      .eq('term_id', termId);

    const invoiceIds = (invoices || []).map((i) => i.id);
    if (invoiceIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const [{ data: items }, { data: pays }, { data: links }] = await Promise.all([
      supabase.from('invoice_line_items').select('invoice_id, amount').in('invoice_id', invoiceIds),
      supabase.from('fee_payments').select('invoice_id, amount').in('invoice_id', invoiceIds),
      supabase.from('student_parent').select('student_id, parents(first_name, last_name, phone, email)'),
    ]);

    const parentByStudent = new Map();
    (links || []).forEach((l) => {
      if (l.parents && !parentByStudent.has(l.student_id)) parentByStudent.set(l.student_id, l.parents);
    });

    const dueByInvoice = new Map();
    (items || []).forEach((li) => dueByInvoice.set(li.invoice_id, (dueByInvoice.get(li.invoice_id) || 0) + Number(li.amount)));
    const paidByInvoice = new Map();
    (pays || []).forEach((p) => paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + Number(p.amount)));

    const built = (invoices || [])
      .map((inv) => {
        const student = studentById.get(inv.student_id);
        if (!student) return null;
        const due = dueByInvoice.get(inv.id) || 0;
        const paid = paidByInvoice.get(inv.id) || 0;
        const balance = due - paid;
        const parent = parentByStudent.get(inv.student_id);
        return {
          invoiceId: inv.id,
          studentId: inv.student_id,
          name: `${student.first_name} ${student.last_name}`,
          form_class: student.form_class,
          year_group: student.year_group,
          status: inv.status,
          balance,
          parentName: parent ? `${parent.first_name} ${parent.last_name}` : '',
          parentPhone: parent?.phone || '',
          parentEmail: parent?.email || '',
        };
      })
      .filter((r) => r && r.balance > 0);

    setRows(built);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (yearGroup) list = list.filter((r) => String(r.year_group) === yearGroup);
    list = [...list].sort((a, b) => (sortBy === 'balance' ? b.balance - a.balance : a.name.localeCompare(b.name)));
    return list;
  }, [rows, yearGroup, sortBy]);

  const totalOutstanding = useMemo(() => filtered.reduce((s, r) => s + r.balance, 0), [filtered]);
  const yearGroups = useMemo(() => Array.from(new Set(rows.map((r) => r.year_group))).sort((a, b) => a - b), [rows]);

  function downloadCsv() {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'debtors.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1>Debtors List</h1>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
        <label>
          Term
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_current ? ' (current)' : ''}</option>)}
          </select>
        </label>
        <label>
          Year group
          <select value={yearGroup} onChange={(e) => setYearGroup(e.target.value)}>
            <option value="">All</option>
            {yearGroups.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Sort by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="balance">Balance (highest first)</option>
            <option value="name">Name</option>
          </select>
        </label>
        <button onClick={downloadCsv} type="button">Export CSV</button>
      </div>

      {loading ? <p>Loading…</p> : (
        <>
          <div className="card">
            <strong>{filtered.length}</strong> students owing, totalling <strong>{naira(totalOutstanding)}</strong>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Student</th><th>Form</th><th>Year</th><th>Balance</th><th>Status</th>
                  <th>Parent</th><th>Phone</th><th>Email</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.invoiceId}>
                    <td><a href={`/bursar/payments?student=${r.studentId}`}>{r.name}</a></td>
                    <td>{r.form_class}</td>
                    <td>{r.year_group}</td>
                    <td style={{ fontWeight: 700 }}>{naira(r.balance)}</td>
                    <td><span className={`badge ${r.status === 'paid' ? 'badge-positive' : 'badge-negative'}`}>{r.status}</span></td>
                    <td>{r.parentName}</td>
                    <td>{r.parentPhone}</td>
                    <td>{r.parentEmail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function DebtorsPage() {
  return (
    <RequireAuth>
      <DebtorsInner />
    </RequireAuth>
  );
}
