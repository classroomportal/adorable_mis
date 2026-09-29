'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

function FeeItemsInner() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultAmount, setDefaultAmount] = useState('');
  const [isOptional, setIsOptional] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState(null);
  // Prices change only when the principal and the college secretary have
  // both approved (migration 259). A new price is proposed here and approved
  // at /bursar/fee-approvals; the database refuses a direct change.
  const [proposing, setProposing] = useState(null); // { id, amount, reason }
  const [proposeStatus, setProposeStatus] = useState(null);

  const [edits, setEdits] = useState({}); // id -> { default_amount, category, is_optional }
  const [savingId, setSavingId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('fee_items').select('id, name, display_name, category, is_optional, default_amount').order('name');
    setItems(data ?? []);
    setLoading(false);
  }

  async function addItem(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setStatus(null);
    const { data: created, error } = await supabase.from('fee_items').insert({
      name: name.trim(),
      category: category.trim() || null,
      is_optional: isOptional,
    }).select('id').single();
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      if (defaultAmount) {
        const { error: pErr } = await supabase.rpc('propose_fee_item_price', {
          p_fee_item_id: created.id, p_amount: Number(defaultAmount), p_reason: 'New fee item',
        });
        setStatus(pErr
          ? `Item added, but the price wasn't sent for approval: ${pErr.message}`
          : 'Item added. Its price has been sent to the principal and the college secretary for approval.');
      }
      setName('');
      setCategory('');
      setDefaultAmount('');
      setIsOptional(false);
      setShowAdd(false);
      await load();
    }
    setAdding(false);
  }

  function edit(id, field, value) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function currentValue(item, field) {
    return edits[item.id]?.[field] !== undefined ? edits[item.id][field] : item[field];
  }

  async function saveItem(item) {
    setSavingId(item.id);
    const patch = edits[item.id] || {};
    const { error } = await supabase
      .from('fee_items')
      .update({
        name: patch.name !== undefined ? patch.name : item.name,
        display_name: patch.display_name !== undefined ? (patch.display_name === '' ? null : patch.display_name) : item.display_name,
        category: patch.category !== undefined ? patch.category : item.category,
        is_optional: patch.is_optional !== undefined ? patch.is_optional : item.is_optional,
      })
      .eq('id', item.id);
    if (!error) {
      setEdits((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
      await load();
    } else {
      setStatus(`Error: ${error.message}`);
    }
    setSavingId(null);
  }

  async function sendProposal(e) {
    e.preventDefault();
    const amount = proposing.amount === '' ? null : Number(proposing.amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) { setProposeStatus('Give an amount of 0 or more.'); return; }
    const { error } = await supabase.rpc('propose_fee_item_price', {
      p_fee_item_id: proposing.id, p_amount: amount, p_reason: proposing.reason,
    });
    if (error) { setProposeStatus(error.message); return; }
    setProposing(null);
    setProposeStatus(null);
    setStatus('Sent for approval. The price changes once the principal and the college secretary have both approved.');
  }

  return (
    <div>
      <h1>Fee Items</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        These are the choices available on Charge Checklist and Add a Charge. Each has one price —
        for students who need a different amount, use the Charge Checklist to type a different
        amount for just them.
      </p>
      <p style={{ fontSize: '0.9rem' }}>
        <strong>Fees are set and approved by the principal and the college secretary together.</strong>{' '}
        A new price is a proposal until both have approved it at <a href="/bursar/fee-approvals">Fee Approvals</a>.
      </p>

      <div className="card">
        <button type="button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add a new fee item'}
        </button>
        {showAdd && (
          <form onSubmit={addItem} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.6rem' }}>
            <label>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Category<br /><input value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '9rem' }} /></label>
            <label>Price to propose (₦)<br /><input type="number" min="0" value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value)} style={{ width: '9rem' }} /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={isOptional} onChange={(e) => setIsOptional(e.target.checked)} /> Optional
            </label>
            <button type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add'}</button>
          </form>
        )}
        {status && <p>{status}</p>}
      </div>

      {loading ? <p>Loading…</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Display name (shown to parents)</th><th>Category</th><th>Price</th><th>Optional</th><th></th></tr></thead>
            <tbody>
              {items.map((item) => {
                const dirty = !!edits[item.id];
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        value={currentValue(item, 'name') || ''}
                        onChange={(e) => edit(item.id, 'name', e.target.value)}
                        style={{ width: '10rem' }}
                      />
                    </td>
                    <td>
                      <input
                        value={currentValue(item, 'display_name') || ''}
                        onChange={(e) => edit(item.id, 'display_name', e.target.value)}
                        placeholder={item.name}
                        style={{ width: '10rem' }}
                      />
                    </td>
                    <td>
                      <input
                        value={currentValue(item, 'category') || ''}
                        onChange={(e) => edit(item.id, 'category', e.target.value)}
                        style={{ width: '9rem' }}
                      />
                    </td>
                    <td>
                      {proposing?.id === item.id ? (
                        <form onSubmit={sendProposal} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          <input type="number" min="0" value={proposing.amount} onChange={(e) => setProposing({ ...proposing, amount: e.target.value })} placeholder="New price" style={{ width: '8rem' }} autoFocus />
                          <input value={proposing.reason} onChange={(e) => setProposing({ ...proposing, reason: e.target.value })} placeholder="Reason" style={{ width: '8rem' }} />
                          <span>
                            <button type="submit">Send</button>{' '}
                            <button type="button" className="secondary" onClick={() => { setProposing(null); setProposeStatus(null); }}>Cancel</button>
                          </span>
                          {proposeStatus && <span style={{ color: '#a3232c', fontSize: '0.85em' }}>{proposeStatus}</span>}
                        </form>
                      ) : (
                        <>
                          {item.default_amount != null ? `₦${Number(item.default_amount).toLocaleString('en-GB')}` : <span style={{ color: '#999' }}>Not set</span>}{' '}
                          <button type="button" className="secondary" style={{ fontSize: '0.8rem' }}
                            onClick={() => { setProposing({ id: item.id, amount: item.default_amount ?? '', reason: '' }); setProposeStatus(null); }}>
                            Propose new price
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!currentValue(item, 'is_optional')}
                        onChange={(e) => edit(item.id, 'is_optional', e.target.checked)}
                      />
                    </td>
                    <td>
                      {dirty && (
                        <button onClick={() => saveItem(item)} disabled={savingId === item.id}>
                          {savingId === item.id ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FeeItemsPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/bursar/fee-items">
      <FeeItemsInner />
    </RequireResource></RequireAuth>
  );
}
