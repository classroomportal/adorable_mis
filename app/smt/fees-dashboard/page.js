'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function FeesDashboardInner() {
  const { profile, staffRoles } = useAuth();
  const canPublish = profile?.role === 'admin' || (staffRoles || []).includes('smt');

  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [term, setTerm] = useState(null);

  const [invoices, setInvoices] = useState([]); // {id, student_id, status, year_group, form_class}
  const [lineItems, setLineItems] = useState([]); // {invoice_id, amount, fee_items(name)}
  const [payments, setPayments] = useState([]); // {invoice_id, amount}

  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('fee_terms').select('*').order('id', { ascending: false });
      setTerms(data ?? []);
      const current = (data ?? []).find((t) => t.is_current);
      if (current) setTermId(String(current.id));
    })();
  }, []);

  useEffect(() => {
    if (!termId) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

  async function loadData() {
    setLoading(true);
    setError('');

    const { data: t } = await supabase.from('fee_terms').select('*').eq('id', termId).maybeSingle();
    setTerm(t || null);

    const { data: inv } = await supabase
      .from('student_invoices')
      .select('id, student_id, status, students(year_group, form_class, status)')
      .eq('term_id', termId);
    const activeInvoices = (inv || []).filter((i) => i.students?.status === 'active');
    setInvoices(activeInvoices);

    const invoiceIds = activeInvoices.map((i) => i.id);
    if (invoiceIds.length === 0) {
      setLineItems([]);
      setPayments([]);
      setLoading(false);
      return;
    }

    const [{ data: items }, { data: pays }] = await Promise.all([
      supabase.from('invoice_line_items').select('invoice_id, amount, fee_items(name)').in('invoice_id', invoiceIds),
      supabase.from('fee_payments').select('invoice_id, amount').in('invoice_id', invoiceIds),
    ]);
    setLineItems(items || []);
    setPayments(pays || []);
    setLoading(false);
  }

  async function togglePublish() {
    if (!term) return;
    setPublishing(true);
    setError('');
    const { error: err } = await supabase.rpc('set_term_published', {
      p_term_id: term.id,
      p_published: !term.published_to_parents,
    });
    if (err) {
      setError(err.message);
    } else {
      await loadData();
    }
    setPublishing(false);
  }

  const invoiceById = useMemo(() => {
    const m = new Map();
    invoices.forEach((i) => m.set(i.id, i));
    return m;
  }, [invoices]);

  const totals = useMemo(() => {
    const totalDue = lineItems.reduce((s, li) => s + Number(li.amount), 0);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
    return { totalDue, totalPaid, outstanding: totalDue - totalPaid };
  }, [lineItems, payments]);

  const byYearGroup = useMemo(() => {
    const map = new Map();
    for (const li of lineItems) {
      const inv = invoiceById.get(li.invoice_id);
      const yg = inv?.students?.year_group ?? 'Unknown';
      if (!map.has(yg)) map.set(yg, { due: 0, paid: 0 });
      map.get(yg).due += Number(li.amount);
    }
    for (const p of payments) {
      const inv = invoiceById.get(p.invoice_id);
      const yg = inv?.students?.year_group ?? 'Unknown';
      if (!map.has(yg)) map.set(yg, { due: 0, paid: 0 });
      map.get(yg).paid += Number(p.amount);
    }
    return Array.from(map.entries())
      .map(([yg, v]) => ({ yearGroup: yg, due: v.due, paid: v.paid, outstanding: v.due - v.paid }))
      .sort((a, b) => (a.yearGroup > b.yearGroup ? 1 : -1));
  }, [lineItems, payments, invoiceById]);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const li of lineItems) {
      const name = li.fee_items?.name || 'Other';
      map.set(name, (map.get(name) || 0) + Number(li.amount));
    }
    return Array.from(map.entries())
      .map(([name, due]) => ({ name, due }))
      .sort((a, b) => b.due - a.due);
  }, [lineItems]);

  const statusCounts = useMemo(() => {
    const counts = { paid: 0, partial: 0, unpaid: 0 };
    invoices.forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; });
    return counts;
  }, [invoices]);

  return (
    <div>
      <h1>Fees — SMT Dashboard</h1>

      <div className="card">
        <label>
          Term
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.is_current ? ' (current)' : ''}</option>
            ))}
          </select>
        </label>

        {term && (
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span className={`badge ${term.published_to_parents ? 'badge-positive' : 'badge-negative'}`}>
              {term.published_to_parents ? 'Visible to parents' : 'Not visible to parents'}
            </span>
            {term.published_to_parents && term.published_at && (
              <span style={{ fontSize: '0.85rem', color: '#666' }}>
                Published {new Date(term.published_at).toLocaleDateString()}
              </span>
            )}
            {canPublish ? (
              <button onClick={togglePublish} disabled={publishing}>
                {publishing ? 'Working…' : term.published_to_parents ? 'Hide from parents' : 'Publish to parents'}
              </button>
            ) : (
              <span style={{ fontSize: '0.85rem', color: '#666' }}>Only admin/SMT can change this</span>
            )}
          </div>
        )}
        {error && <p style={{ color: '#a3232c', marginTop: '0.5rem' }}>{error}</p>}
      </div>

      {loading ? <p>Loading…</p> : (
        <>
          <div className="card">
            <h2>This term</h2>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>Expected</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{naira(totals.totalDue)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>Collected</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a7a3d' }}>{naira(totals.totalPaid)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>Outstanding</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a3232c' }}>{naira(totals.outstanding)}</div>
              </div>
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <span className="badge badge-positive">{statusCounts.paid || 0} paid</span>
              <span className="badge" style={{ background: '#fff4e0', color: '#a3691a' }}>{statusCounts.partial || 0} partial</span>
              <span className="badge badge-negative">{statusCounts.unpaid || 0} unpaid</span>
            </div>
          </div>

          <div className="card">
            <h2>By year group</h2>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Year</th><th>Expected</th><th>Collected</th><th>Outstanding</th></tr></thead>
                <tbody>
                  {byYearGroup.map((r) => (
                    <tr key={r.yearGroup}>
                      <td>{r.yearGroup}</td>
                      <td>{naira(r.due)}</td>
                      <td>{naira(r.paid)}</td>
                      <td>{naira(r.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>By fee item</h2>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Item</th><th>Expected</th></tr></thead>
                <tbody>
                  {byCategory.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>{naira(r.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FeesDashboardPage() {
  return (
    <RequireAuth>
      <FeesDashboardInner />
    </RequireAuth>
  );
}
