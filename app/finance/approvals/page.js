'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { errorText } from '../../../lib/admissions';
import { loadRequisitions, loadBudgetableCentres } from '../../../lib/requisitions';
import FinanceShell, { money } from '../../components/FinanceShell';
import RequisitionCard from '../../components/RequisitionCard';

// 8. Approvals (migration 346): every requisition waiting for someone, by
// step. To sign (the principal); to cost and approve (the college secretary:
// an approved supplier, prices and the cost centre, then approval, which
// commits the money or waits for contingency); waiting for contingency (the
// principal releases the shortfall); to pay (the bursar, never more than the
// approved total). In practice the principal can do every step to show the
// process; for real entries the database checks who may do each one.

function Approvals({ practice, termId }) {
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [centres, setCentres] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [left, setLeft] = useState({});
  const [costing, setCosting] = useState({}); // id -> { supplier, cc, prices: {itemId: v} }
  const [paying, setPaying] = useState({}); // id -> { amount, date, method, ref }
  const [msg, setMsg] = useState(null);

  useEffect(() => { loadBudgetableCentres().then(setCentres); }, []);
  useEffect(() => { load(); }, [practice, termId]);

  async function load() {
    const [{ rows: r, names: n, error }, sup, pos] = await Promise.all([
      loadRequisitions(termId, practice),
      supabase.from('suppliers').select('id, name').eq('practice', practice).eq('status', 'approved').order('name'),
      supabase.rpc('budget_position', { p_term_id: termId, p_practice: practice }),
    ]);
    if (error || sup.error || pos.error) { setMsg({ error: true, text: errorText(error || sup.error || pos.error) }); return; }
    setRows(r); setNames(n); setSuppliers(sup.data || []);
    setLeft(Object.fromEntries((pos.data || []).map((p) => [p.cost_centre_id, Number(p.remaining)])));
  }

  async function act(promise, done) {
    setMsg(null);
    const { data, error } = await promise;
    if (error) { setMsg({ error: true, text: errorText(error) }); return false; }
    setMsg({ text: typeof done === 'function' ? done(data) : done });
    await load();
    return true;
  }

  function startCosting(r) {
    const prices = {};
    (r.requisition_items || []).forEach((it) => { prices[it.id] = it.unit_price != null ? String(Number(it.unit_price)) : ''; });
    setCosting({ ...costing, [r.id]: { supplier: r.supplier_id ? String(r.supplier_id) : '', cc: r.cost_centre_id ? String(r.cost_centre_id) : '', prices } });
  }

  const groups = [
    ['To sign', 'You agree the need, or reject it with a reason.', (r) => r.status === 'submitted'],
    ['To cost and approve', 'The college secretary chooses an approved supplier, prices each item and confirms the cost centre, then approves. Approval commits the money; if the cost centre hasn’t enough left it waits for contingency.', (r) => ['signed', 'costed'].includes(r.status)],
    ['Waiting for contingency', 'Approving would take the cost centre below zero. Release the shortfall from Contingency, then approve again.', (r) => r.status === 'awaiting_release'],
    ['Waiting for delivery', 'Approved. Whoever asked for it records the delivery at 7. Requests.', (r) => ['approved', 'part_received'].includes(r.status)],
    ['To pay', 'The bursar records each payment; never more than the approved total.', (r) => ['approved', 'part_received', 'received'].includes(r.status) && Number(r.paid_total) < Number(r.total)],
    ['Finished', '', (r) => ['paid', 'rejected', 'cancelled'].includes(r.status)],
  ];

  return (
    <div>
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d' }}>{msg.text}</p>}
      {suppliers.length === 0 && <p style={{ color: '#a3232c' }}>No approved {practice ? 'practice ' : ''}suppliers yet: add one at <a href="/finance/suppliers">6. Suppliers</a> before costing.</p>}
      {groups.map(([title, help, test]) => {
        const list = rows.filter(test);
        if (title === 'Finished' && list.length === 0) return null;
        return (
          <div key={title} style={{ marginTop: '1.25rem' }}>
            <h2 style={{ marginBottom: '0.2rem' }}>{title} ({list.length})</h2>
            {help && <p style={{ fontSize: '0.85rem', color: '#666', marginTop: 0 }}>{help}</p>}
            {list.map((r) => {
              const c = costing[r.id];
              const p = paying[r.id];
              const shortfall = r.status === 'awaiting_release' ? Math.max(Number(r.total) - Math.max(left[r.cost_centre_id] ?? 0, 0), 0) : 0;
              return (
                <RequisitionCard key={`${title}-${r.id}`} r={r} requester={names[r.requester_staff_id]}>
                  {title === 'To sign' && (
                    <p style={{ margin: '0.4rem 0 0' }}>
                      <button type="button" onClick={() => act(supabase.rpc('sign_requisition', { p_id: r.id, p_approve: true, p_note: null }), 'Signed.')}>Sign</button>{' '}
                      <button type="button" className="secondary" onClick={() => { const n = window.prompt('Why reject it?'); if (n) act(supabase.rpc('sign_requisition', { p_id: r.id, p_approve: false, p_note: n }), 'Rejected.'); }}>Reject</button>
                    </p>
                  )}
                  {title === 'To cost and approve' && (
                    c ? (
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        act(supabase.rpc('cost_requisition', { p_id: r.id, p_supplier_id: Number(c.supplier), p_cost_centre_id: Number(c.cc), p_prices: c.prices }), (t) => `Costed: ${money(t)}.`)
                          .then((ok) => { if (ok) { const next = { ...costing }; delete next[r.id]; setCosting(next); } });
                      }} style={{ marginTop: '0.4rem' }}>
                        <label>Supplier{' '}
                          <select value={c.supplier} onChange={(e) => setCosting({ ...costing, [r.id]: { ...c, supplier: e.target.value } })} required>
                            <option value="">Choose…</option>
                            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </label>{' '}
                        <label>Cost centre{' '}
                          <select value={c.cc} onChange={(e) => setCosting({ ...costing, [r.id]: { ...c, cc: e.target.value } })} required>
                            <option value="">Choose…</option>
                            {centres.map((cc) => <option key={cc.id} value={cc.id}>{cc.name} ({money(left[cc.id] ?? 0)} left)</option>)}
                          </select>
                        </label>
                        <div style={{ marginTop: '0.3rem' }}>
                          {(r.requisition_items || []).map((it) => (
                            <label key={it.id} style={{ marginRight: '0.75rem' }}>{it.description} × {Number(it.quantity)}: ₦{' '}
                              <input type="number" min="0" value={c.prices[it.id] ?? ''} required style={{ width: '8rem' }}
                                onChange={(e) => setCosting({ ...costing, [r.id]: { ...c, prices: { ...c.prices, [it.id]: e.target.value } } })} /> each
                            </label>
                          ))}
                        </div>
                        <button type="submit">Save costing</button>{' '}
                        <button type="button" className="secondary" onClick={() => { const next = { ...costing }; delete next[r.id]; setCosting(next); }}>Cancel</button>
                      </form>
                    ) : (
                      <p style={{ margin: '0.4rem 0 0' }}>
                        <button type="button" onClick={() => startCosting(r)}>{r.status === 'costed' ? 'Change costing' : 'Cost it'}</button>{' '}
                        {r.status === 'costed' && (
                          <button type="button" onClick={() => act(supabase.rpc('approve_requisition', { p_id: r.id }), (s) => (s === 'approved' ? 'Approved: the money is committed.' : 'Not enough left in the cost centre: it is waiting for contingency.'))}>
                            Approve ({money(r.total)}; {r.cost_centres?.name} has {money(left[r.cost_centre_id] ?? 0)} left)
                          </button>
                        )}
                      </p>
                    )
                  )}
                  {title === 'Waiting for contingency' && (
                    <p style={{ margin: '0.4rem 0 0' }}>
                      Short by <strong>{money(shortfall)}</strong>.{' '}
                      <button type="button" onClick={() => {
                        const reason = window.prompt(`Release ${money(shortfall)} from Contingency to ${r.cost_centres?.name}. Reason:`);
                        if (reason) act(supabase.rpc('release_contingency', { p_term_id: termId, p_cost_centre_id: r.cost_centre_id, p_amount: shortfall, p_reason: reason, p_requisition_id: r.id, p_practice: practice }), 'Released. Now approve it again.');
                      }}>Release {money(shortfall)} from contingency</button>{' '}
                      <button type="button" onClick={() => act(supabase.rpc('approve_requisition', { p_id: r.id }), (s) => (s === 'approved' ? 'Approved: the money is committed.' : 'Still not enough left.'))}>Approve again</button>{' '}
                      <button type="button" className="secondary" onClick={() => startCosting(r)}>Change costing</button>
                    </p>
                  )}
                  {title === 'To pay' && (
                    p ? (
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        act(supabase.rpc('pay_requisition', { p_id: r.id, p_amount: Number(p.amount), p_paid_on: p.date || null, p_method: p.method, p_reference: p.ref }), (s) => (s === 'paid' ? 'Paid in full.' : 'Part payment recorded.'))
                          .then((ok) => { if (ok) { const next = { ...paying }; delete next[r.id]; setPaying(next); } });
                      }} style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <label>Amount (₦)<br /><input type="number" min="1" value={p.amount} onChange={(e) => setPaying({ ...paying, [r.id]: { ...p, amount: e.target.value } })} required style={{ width: '9rem' }} /></label>
                        <label>Date<br /><input type="date" value={p.date} onChange={(e) => setPaying({ ...paying, [r.id]: { ...p, date: e.target.value } })} /></label>
                        <label>Method<br /><input value={p.method} onChange={(e) => setPaying({ ...paying, [r.id]: { ...p, method: e.target.value } })} placeholder="Transfer" style={{ width: '7rem' }} /></label>
                        <label>Reference<br /><input value={p.ref} onChange={(e) => setPaying({ ...paying, [r.id]: { ...p, ref: e.target.value } })} style={{ width: '8rem' }} /></label>
                        <button type="submit">Record payment</button>
                        <button type="button" className="secondary" onClick={() => { const next = { ...paying }; delete next[r.id]; setPaying(next); }}>Cancel</button>
                      </form>
                    ) : (
                      <p style={{ margin: '0.4rem 0 0' }}>
                        <button type="button" onClick={() => setPaying({ ...paying, [r.id]: { amount: String(Number(r.total) - Number(r.paid_total)), date: '', method: '', ref: '' } })}>
                          Pay ({money(Number(r.total) - Number(r.paid_total))} left)
                        </button>
                      </p>
                    )
                  )}
                  {!['To sign', 'Finished'].includes(title) && (
                    <button type="button" className="secondary" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}
                      onClick={() => { const n = window.prompt('Why cancel it? Anything not yet paid is released.'); if (n) act(supabase.rpc('cancel_requisition', { p_id: r.id, p_note: n }), 'Cancelled.'); }}>Cancel requisition</button>
                  )}
                </RequisitionCard>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function Page() {
  return (
    <FinanceShell resourceKey="/finance/approvals" step={8} title="Approvals"
      intro="Every requisition waiting for someone, by step. Nobody signs or approves their own (your own are signed as you raise them; the college secretary's own are approved by you).">
      {(p) => <Approvals {...p} />}
    </FinanceShell>
  );
}
