'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function ChargeChecklistInner() {
  const [feeItems, setFeeItems] = useState([]);
  const [terms, setTerms] = useState([]);
  const [feeItemId, setFeeItemId] = useState('');
  const [termId, setTermId] = useState('');
  const [description, setDescription] = useState('');
  const [flatAmount, setFlatAmount] = useState('');

  const [students, setStudents] = useState([]);
  const [chargedIds, setChargedIds] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [filterYear, setFilterYear] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: items } = await supabase.from('fee_items').select('id, name, default_amount').or('category.is.null,category.neq.Tuckshop').order('name');
      setFeeItems(items ?? []);
      const { data: t } = await supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false });
      setTerms(t ?? []);
      const current = (t ?? []).find((x) => x.is_current);
      if (current) setTermId(String(current.id));
      const { data: s } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, year_group, form_class, fee_band')
        .eq('status', 'active')
        .order('year_group')
        .order('last_name');
      setStudents(s ?? []);
    })();
  }, []);

  // When fee item changes: prefill the flat amount from its default.
  useEffect(() => {
    const item = feeItems.find((f) => String(f.id) === String(feeItemId));
    setFlatAmount(item?.default_amount ? String(item.default_amount) : '');
  }, [feeItemId, feeItems]);

  async function refreshChargedStatus() {
    if (!feeItemId || !termId) {
      setChargedIds(new Set());
      return;
    }
    setLoading(true);
    const { data: invoices } = await supabase.from('student_invoices').select('id, student_id').eq('term_id', termId);
    const invoiceByStudent = new Map((invoices || []).map((i) => [i.id, i.student_id]));
    const invoiceIds = (invoices || []).map((i) => i.id);
    if (invoiceIds.length === 0) {
      setChargedIds(new Set());
      setLoading(false);
      return;
    }
    const { data: lines } = await supabase
      .from('invoice_line_items')
      .select('invoice_id')
      .in('invoice_id', invoiceIds)
      .eq('fee_item_id', feeItemId);
    const ids = new Set((lines || []).map((l) => invoiceByStudent.get(l.invoice_id)));
    setChargedIds(ids);
    setLoading(false);
  }

  useEffect(() => { refreshChargedStatus(); setSelected(new Set()); }, [feeItemId, termId]); // eslint-disable-line

  function amountFor(student) {
    return flatAmount ? Number(flatAmount) : null;
  }

  const filtered = useMemo(() => {
    let list = students;
    if (filterYear) list = list.filter((s) => String(s.year_group) === filterYear);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q));
    }
    return list;
  }, [students, filterYear, query]);

  const yearGroups = useMemo(() => Array.from(new Set(students.map((s) => s.year_group))).sort((a, b) => a - b), [students]);

  function toggle(studentId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function selectAllShowing() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((s) => { if (!chargedIds.has(s.student_id) && amountFor(s) !== null) next.add(s.student_id); });
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function submit() {
    if (selected.size === 0 || !feeItemId || !termId) return;
    setSubmitting(true);
    setStatus(null);
    const { data: userData } = await supabase.auth.getUser();
    const createdBy = userData?.user?.id;

    let ok = 0, fail = 0;
    for (const studentId of selected) {
      const student = students.find((s) => s.student_id === studentId);
      const amount = amountFor(student);
      if (amount === null) { fail++; continue; }
      const { error } = await supabase.rpc('apply_fee_charge_batch', {
        p_fee_item_id: feeItemId,
        p_term_id: termId,
        p_description: description || null,
        p_amount: amount,
        p_target_type: 'individual',
        p_target_value: String(studentId),
        p_created_by: createdBy,
      });
      if (error) fail++; else ok++;
    }

    setStatus(`Charged ${ok} student${ok === 1 ? '' : 's'}.${fail > 0 ? ` ${fail} failed.` : ''}`);
    setSelected(new Set());
    await refreshChargedStatus();
    setSubmitting(false);
  }

  return (
    <div>
      <h1>Charge Checklist</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Pick one fee item and term, then tick students to charge. Anyone already charged for this
        item this term shows "Charged" and is skipped, so you can see at a glance who's left.
      </p>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <label>
          Fee item
          <select value={feeItemId} onChange={(e) => setFeeItemId(e.target.value)}>
            <option value="">-- choose --</option>
            {feeItems.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label>
          Term
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_current ? ' (current)' : ''}</option>)}
          </select>
        </label>
        <label>
          Description (optional)
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
        </label>

        <label>
          Amount (₦)
          <input type="number" min="0" value={flatAmount} onChange={(e) => setFlatAmount(e.target.value)} style={{ width: '10rem' }} />
        </label>
      </div>

      {feeItemId && termId && (
        <>
          <div className="card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>
              Filter year
              <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
                <option value="">All</option>
                {yearGroups.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label>
              Search name
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button type="button" onClick={selectAllShowing}>Select all showing</button>
            <button type="button" onClick={clearSelection}>Clear selection</button>
          </div>

          {loading ? <p>Loading…</p> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th></th><th>Student</th><th>Year</th><th>Form</th><th>Level</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {filtered.map((s) => {
                    const already = chargedIds.has(s.student_id);
                    const amount = amountFor(s);
                    return (
                      <tr key={s.student_id} style={already ? { opacity: 0.55 } : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(s.student_id)}
                            disabled={already || amount === null}
                            onChange={() => toggle(s.student_id)}
                          />
                        </td>
                        <td>{s.first_name} {s.last_name}</td>
                        <td>{s.year_group}</td>
                        <td>{s.form_class}</td>
                        <td>{s.fee_band || '—'}</td>
                        <td>{amount === null ? <span style={{ color: '#a3232c' }}>no amount set</span> : naira(amount)}</td>
                        <td>
                          <span className={`badge ${already ? 'badge-positive' : 'badge-negative'}`}>
                            {already ? 'Charged' : 'Not yet'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <strong>{selected.size}</strong> selected
            <button onClick={submit} disabled={selected.size === 0 || submitting} style={{ marginLeft: '0.75rem' }}>
              {submitting ? 'Charging…' : `Charge ${selected.size} student${selected.size === 1 ? '' : 's'}`}
            </button>
            {status && <p>{status}</p>}
          </div>
        </>
      )}
    </div>
  );
}

export default function ChargeChecklistPage() {
  return (
    <RequireAuth>
      <ChargeChecklistInner />
    </RequireAuth>
  );
}
