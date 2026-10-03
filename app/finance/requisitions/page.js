'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { errorText } from '../../../lib/admissions';
import { loadRequisitions, loadBudgetableCentres } from '../../../lib/requisitions';
import FinanceShell from '../../components/FinanceShell';
import RequisitionCard from '../../components/RequisitionCard';

// 7. Requests (migration 346): raise a requisition and follow it through:
// signed by the principal, costed and approved by the college secretary,
// delivered (recorded here by whoever asked for it), paid by the bursar. A
// requisition can be withdrawn before it is approved; nothing is deleted.

const NEW_ITEM = { description: '', quantity: '1', unit: '' };

function Requests({ practice, termId }) {
  const [centres, setCentres] = useState([]);
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [form, setForm] = useState({ cc: '', reason: '', needed: '', items: [{ ...NEW_ITEM }] });
  const [receiving, setReceiving] = useState(null); // { id, qty: {itemId: n}, note }
  const [msg, setMsg] = useState(null);

  useEffect(() => { loadBudgetableCentres().then(setCentres); }, []);
  useEffect(() => { load(); }, [practice, termId]);

  async function load() {
    const { rows: r, names: n, error } = await loadRequisitions(termId, practice);
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setRows(r); setNames(n);
  }

  async function act(promise, done) {
    setMsg(null);
    const { data, error } = await promise;
    if (error) { setMsg({ error: true, text: errorText(error) }); return false; }
    setMsg({ text: typeof done === 'function' ? done(data) : done });
    await load();
    return true;
  }

  function setItem(i, field, value) {
    const items = form.items.slice();
    items[i] = { ...items[i], [field]: value };
    setForm({ ...form, items });
  }

  async function raise(e) {
    e.preventDefault();
    const items = form.items.filter((it) => it.description.trim()).map((it) => ({ ...it, quantity: Number(it.quantity) || 1 }));
    const ok = await act(supabase.rpc('raise_requisition', {
      p_term_id: termId, p_cost_centre_id: form.cc ? Number(form.cc) : null, p_reason: form.reason,
      p_needed_by: form.needed || null, p_items: items, p_practice: practice,
    }), 'Raised. It now goes to be signed (yours are signed as you raise them).');
    if (ok) setForm({ cc: '', reason: '', needed: '', items: [{ ...NEW_ITEM }] });
  }

  return (
    <div>
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d' }}>{msg.text}</p>}
      <form className="card" onSubmit={raise}>
        <strong>Raise a requisition</strong>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem' }}>
          <label style={{ flex: '1 1 18rem' }}>What it is for<br /><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required style={{ width: '100%' }} /></label>
          <label>Cost centre (suggested)<br />
            <select value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })}>
              <option value="">Not sure</option>
              {centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Needed by<br /><input type="date" value={form.needed} onChange={(e) => setForm({ ...form, needed: e.target.value })} /></label>
        </div>
        <table style={{ marginTop: '0.5rem' }}>
          <thead><tr><th>Item</th><th>Quantity</th><th>Unit</th><th></th></tr></thead>
          <tbody>
            {form.items.map((it, i) => (
              <tr key={i}>
                <td><input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="e.g. Emulsion paint, white" style={{ width: '18rem' }} /></td>
                <td><input type="number" min="0.01" step="any" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} style={{ width: '5rem' }} /></td>
                <td><input value={it.unit} onChange={(e) => setItem(i, 'unit', e.target.value)} placeholder="drums" style={{ width: '6rem' }} /></td>
                <td>{form.items.length > 1 && <button type="button" className="secondary" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { ...NEW_ITEM }] })}>+ Another item</button>{' '}
        <button type="submit">Raise requisition</button>
        <p style={{ fontSize: '0.8rem', color: '#666', margin: '0.4rem 0 0' }}>No prices needed: the college secretary costs it with an approved supplier.</p>
      </form>

      <h2>Requisitions this term</h2>
      {rows.length === 0 && <p style={{ color: '#666' }}>None yet.</p>}
      {rows.map((r) => (
        <RequisitionCard key={r.id} r={r} requester={names[r.requester_staff_id]}>
          {['approved', 'part_received', 'paid'].includes(r.status) && (r.requisition_items || []).some((it) => Number(it.quantity_received) < Number(it.quantity)) && (
            receiving?.id === r.id ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                act(supabase.rpc('receive_requisition', { p_id: r.id, p_received: receiving.qty, p_note: receiving.note }), (s) => (s === 'received' ? 'Recorded: delivered in full.' : 'Recorded: part delivered.'));
                setReceiving(null);
              }} style={{ marginTop: '0.4rem' }}>
                {(r.requisition_items || []).map((it) => (
                  <label key={it.id} style={{ marginRight: '0.75rem' }}>{it.description}: received{' '}
                    <input type="number" min="0" max={Number(it.quantity)} step="any" value={receiving.qty[it.id] ?? ''} style={{ width: '5rem' }}
                      onChange={(e) => setReceiving({ ...receiving, qty: { ...receiving.qty, [it.id]: e.target.value } })} /> of {Number(it.quantity)}
                  </label>
                ))}
                <input value={receiving.note} onChange={(e) => setReceiving({ ...receiving, note: e.target.value })} placeholder="Note (e.g. one drum damaged)" style={{ width: '16rem' }} />{' '}
                <button type="submit">Save delivery</button>{' '}
                <button type="button" className="secondary" onClick={() => setReceiving(null)}>Cancel</button>
              </form>
            ) : (
              <button type="button" onClick={() => {
                const qty = {}; (r.requisition_items || []).forEach((it) => { qty[it.id] = String(Number(it.quantity)); });
                setReceiving({ id: r.id, qty, note: '' });
              }}>Record delivery</button>
            )
          )}{' '}
          {['submitted', 'signed', 'costed', 'awaiting_release'].includes(r.status) && (
            <button type="button" className="secondary" onClick={() => { const n = window.prompt('Why withdraw it?'); if (n) act(supabase.rpc('cancel_requisition', { p_id: r.id, p_note: n }), 'Withdrawn.'); }}>Withdraw</button>
          )}
        </RequisitionCard>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <FinanceShell resourceKey="/finance/requisitions" step={7} title="Requests"
      intro="Any member of staff will raise requisitions here and follow each one through: signed by you, costed and approved by the college secretary, delivered, paid by the bursar.">
      {(p) => <Requests {...p} />}
    </FinanceShell>
  );
}
