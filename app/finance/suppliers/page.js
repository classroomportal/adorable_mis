'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { errorText } from '../../../lib/admissions';
import FinanceShell from '../../components/FinanceShell';

// 6. Suppliers (migration 346): the approved suppliers list. Requisitions
// can only be costed with, and paid to, an approved supplier. A supplier is
// approved by the principal and the college secretary together (one approval
// for a practice supplier); changing bank details sends it back for
// approval. Suspended or archived, never deleted.

const EMPTY = { name: '', supplies: '', contact_name: '', phone: '', email: '', bank_name: '', account_name: '', account_number: '' };
const FIELDS = [
  ['name', 'Name'], ['supplies', 'What they supply'], ['contact_name', 'Contact'], ['phone', 'Phone'], ['email', 'Email'],
  ['bank_name', 'Bank'], ['account_name', 'Account name'], ['account_number', 'Account number'],
];
const STATUS = {
  proposed: ['Waiting for approval', '#fff1cc', '#7a5a00'],
  approved: ['Approved', '#dcf5e3', '#1a7a3d'],
  suspended: ['Suspended', '#fbdede', '#a3232c'],
  archived: ['Archived', '#eee', '#555'],
};

function SupplierForm({ initial, onSave, onCancel, label }) {
  const [f, setF] = useState(initial);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f); }} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {FIELDS.map(([k, l]) => (
        <label key={k} style={{ margin: 0 }}>{l}<br />
          <input value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={k === 'name'} style={{ width: k === 'supplies' ? '14rem' : '10rem' }} />
        </label>
      ))}
      <button type="submit">{label}</button>
      {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
    </form>
  );
}

function Suppliers({ practice }) {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(); }, [practice]);

  async function load() {
    const { data, error } = await supabase.from('suppliers').select('*').eq('practice', practice).order('name');
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setList(data || []);
  }

  async function act(promise, done) {
    setMsg(null);
    const { data, error } = await promise;
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setMsg({ text: typeof done === 'function' ? done(data) : done });
    setEditing(null);
    await load();
  }

  const shown = list.filter((s) => showOld || s.status !== 'archived');

  return (
    <div>
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d' }}>{msg.text}</p>}
      <div className="card">
        <button type="button" onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Close' : '+ Propose a supplier'}</button>
        {showAdd && (
          <div style={{ marginTop: '0.6rem' }}>
            <SupplierForm initial={EMPTY} label="Propose" onSave={(f) => { act(supabase.rpc('propose_supplier', { p_supplier: f, p_practice: practice }), 'Proposed. It can be used once approved.'); setShowAdd(false); }} />
          </div>
        )}
      </div>
      <label style={{ fontSize: '0.85rem' }}><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show archived</label>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Supplier</th><th>Supplies</th><th>Contact</th><th>Bank</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((s) => editing === s.id ? (
              <tr key={s.id}><td colSpan={6}>
                <SupplierForm initial={s} label="Save" onCancel={() => setEditing(null)}
                  onSave={(f) => act(supabase.rpc('update_supplier', { p_id: s.id, p_supplier: f }), (r) => (r === 'saved' ? 'Saved.' : 'Saved. The bank details changed, so it needs approval again before it can be used.'))} />
              </td></tr>
            ) : (
              <tr key={s.id}>
                <td><strong>{s.name}</strong></td>
                <td style={{ fontSize: '0.85rem' }}>{s.supplies}</td>
                <td style={{ fontSize: '0.85rem' }}>{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ')}</td>
                <td style={{ fontSize: '0.85rem' }}>{[s.bank_name, s.account_name, s.account_number].filter(Boolean).join(' · ')}</td>
                <td>
                  <span className="badge" style={{ background: STATUS[s.status][1], color: STATUS[s.status][2] }}>{STATUS[s.status][0]}</span>
                  {s.status === 'proposed' && <div style={{ fontSize: '0.75rem' }}>{s.principal_approved_at ? 'Principal ✓ ' : ''}{s.secretary_approved_at ? 'College secretary ✓' : ''}</div>}
                  {s.status_note && <div style={{ fontSize: '0.75rem', color: '#666' }}>{s.status_note}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {s.status === 'proposed' && <button type="button" onClick={() => act(supabase.rpc('approve_supplier', { p_id: s.id }), (r) => (r === 'approved' ? 'Approved.' : 'Your approval is recorded; it needs the other approver.'))}>Approve</button>}{' '}
                  {s.status !== 'archived' && <button type="button" className="secondary" onClick={() => setEditing(s.id)}>Edit</button>}{' '}
                  {s.status === 'approved' && <button type="button" className="secondary" onClick={() => { const n = window.prompt('Why suspend this supplier?'); if (n) act(supabase.rpc('set_supplier_status', { p_id: s.id, p_status: 'suspended', p_note: n }), 'Suspended.'); }}>Suspend</button>}{' '}
                  {s.status === 'suspended' && <button type="button" className="secondary" onClick={() => act(supabase.rpc('set_supplier_status', { p_id: s.id, p_status: 'approved', p_note: null }), 'Restored.')}>Restore</button>}{' '}
                  {s.status !== 'archived' && <button type="button" className="secondary" onClick={() => { const n = window.prompt('Why archive this supplier?'); if (n) act(supabase.rpc('set_supplier_status', { p_id: s.id, p_status: 'archived', p_note: n }), 'Archived.'); }}>Archive</button>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} style={{ color: '#666' }}>No suppliers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <FinanceShell resourceKey="/finance/suppliers" step={6} title="Suppliers" noTerm
      intro="Requisitions can only be costed with, and paid to, an approved supplier. You and the college secretary approve each one; a change of bank details sends it back for approval. Suppliers are suspended or archived, never deleted.">
      {(p) => <Suppliers {...p} />}
    </FinanceShell>
  );
}
