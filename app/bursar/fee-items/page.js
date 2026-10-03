'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import AddFeeForm from '../../components/AddFeeForm';

const YEARS = [7, 8, 9, 10, 11, 12];
const naira = (v) => `₦${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

function FeeItemsInner() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [status, setStatus] = useState(null);
  // Which terms each fee is charged in (migration 348); empty = every term.
  const [terms, setTerms] = useState([]);
  const [editingTerms, setEditingTerms] = useState(null); // { id, all, ids }
  // Prices change only when the principal and the college secretary have
  // both approved (migration 259). A new price is proposed here and approved
  // at /bursar/fee-approvals; the database refuses a direct change.
  const [proposing, setProposing] = useState(null); // { id, amount, reason }
  const [proposeStatus, setProposeStatus] = useState(null);
  // Locked items (migration 260) have an approved price per year group.
  const [yearPrices, setYearPrices] = useState({}); // id -> { yg: amount }
  const [proposingYears, setProposingYears] = useState(null); // { id, prices: { yg: str }, reason }

  const [edits, setEdits] = useState({}); // id -> { default_amount, category, is_optional }
  const [savingId, setSavingId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data }, { data: yp }, { data: t }] = await Promise.all([
      supabase.from('fee_items').select('id, name, display_name, category, is_optional, default_amount, price_locked, charge_term_ids').order('name'),
      supabase.from('fee_item_year_prices').select('fee_item_id, year_group, amount'),
      supabase.from('terms').select('term_id, term_name, start_date').order('start_date'),
    ]);
    setTerms(t ?? []);
    setItems(data ?? []);
    const byItem = {};
    (yp || []).forEach((r) => { (byItem[r.fee_item_id] ||= {})[r.year_group] = Number(r.amount); });
    setYearPrices(byItem);
    setLoading(false);
  }

  async function saveTerms(e) {
    e.preventDefault();
    if (!editingTerms.all && editingTerms.ids.length === 0) { setStatus('Tick at least one term, or choose Every term.'); return; }
    const { error } = await supabase.from('fee_items')
      .update({ charge_term_ids: editingTerms.all ? null : editingTerms.ids })
      .eq('id', editingTerms.id);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setEditingTerms(null);
    setStatus(null);
    await load();
  }

  function termsText(item) {
    const ids = item.charge_term_ids || [];
    if (ids.length === 0) return 'Every term';
    return terms.filter((t) => ids.includes(t.term_id)).map((t) => t.term_name).join(', ');
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

  async function sendYearProposal(e) {
    e.preventDefault();
    const prices = {};
    for (const yg of YEARS) {
      const v = String(proposingYears.prices[yg] ?? '').trim();
      if (v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { setProposeStatus(`Year ${yg}: give an amount of 0 or more.`); return; }
      prices[yg] = n;
    }
    const { error } = await supabase.rpc('propose_fee_item_year_prices', {
      p_fee_item_id: proposingYears.id, p_prices: prices, p_reason: proposingYears.reason,
    });
    if (error) { setProposeStatus(error.message); return; }
    setProposingYears(null);
    setProposeStatus(null);
    setStatus('Year prices sent for approval. They apply once the principal and the college secretary have both approved.');
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
      <p style={{ margin: 0 }}><a href="/">← Dashboard</a></p>
      <h1>1. Fees</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Step 1 of Fees &amp; Bills: the fees the school charges, which terms each is charged in and its price.
        Then 2. Approve (the principal and the college secretary), 3. Discounts, 4. Charge, 5. Payments.
      </p>
      <p style={{ fontSize: '0.9rem' }}>
        <strong>Fees are set and approved by the principal and the college secretary together.</strong>{' '}
        A new price is a proposal until both have approved it at <a href="/bursar/fee-approvals">Fee Approvals</a>.
      </p>

      <div className="card">
        <button type="button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add a fee'}
        </button>
        {showAdd && <AddFeeForm onDone={(text) => { setShowAdd(false); setStatus(text); load(); }} />}
        {status && <p>{status}</p>}
      </div>

      {loading ? <p>Loading…</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Display name (shown to parents)</th><th>Category</th><th>Terms charged</th><th>Price</th><th>Optional</th><th></th></tr></thead>
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
                    <td style={{ fontSize: '0.85em' }}>
                      {editingTerms?.id === item.id ? (
                        <form onSubmit={saveTerms} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <label><input type="checkbox" checked={editingTerms.all} onChange={(e) => setEditingTerms({ ...editingTerms, all: e.target.checked })} /> Every term</label>
                          {!editingTerms.all && terms.map((t) => (
                            <label key={t.term_id}>
                              <input type="checkbox" checked={editingTerms.ids.includes(t.term_id)}
                                onChange={() => setEditingTerms({ ...editingTerms, ids: editingTerms.ids.includes(t.term_id) ? editingTerms.ids.filter((x) => x !== t.term_id) : [...editingTerms.ids, t.term_id] })} /> {t.term_name}
                            </label>
                          ))}
                          <span><button type="submit">Save</button>{' '}<button type="button" className="secondary" onClick={() => setEditingTerms(null)}>Cancel</button></span>
                        </form>
                      ) : (
                        <>
                          {termsText(item)}{' '}
                          <button type="button" className="secondary" style={{ fontSize: '0.8rem' }}
                            onClick={() => setEditingTerms({ id: item.id, all: !(item.charge_term_ids || []).length, ids: item.charge_term_ids || [] })}>Change</button>
                        </>
                      )}
                    </td>
                    <td>
                      {item.price_locked ? (
                        proposingYears?.id === item.id ? (
                          <form onSubmit={sendYearProposal} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            {YEARS.map((yg) => (
                              <label key={yg} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', margin: 0 }}>
                                Y{yg}
                                <input type="number" min="0" value={proposingYears.prices[yg] ?? ''} placeholder="Not set" style={{ width: '8rem' }}
                                  onChange={(e) => setProposingYears({ ...proposingYears, prices: { ...proposingYears.prices, [yg]: e.target.value } })} />
                              </label>
                            ))}
                            <input value={proposingYears.reason} onChange={(e) => setProposingYears({ ...proposingYears, reason: e.target.value })} placeholder="Reason" style={{ width: '10rem' }} />
                            <span>
                              <button type="submit">Send</button>{' '}
                              <button type="button" className="secondary" onClick={() => { setProposingYears(null); setProposeStatus(null); }}>Cancel</button>
                            </span>
                            {proposeStatus && <span style={{ color: '#a3232c', fontSize: '0.85em' }}>{proposeStatus}</span>}
                          </form>
                        ) : (
                          <>
                            <span className="badge" style={{ background: '#e6eefb', color: '#1d4a8f' }} title="Charged only at the approved price for the student's year group">Locked</span>
                            <div style={{ fontSize: '0.85em', margin: '0.25rem 0' }}>
                              {YEARS.map((yg) => {
                                const v = yearPrices[item.id]?.[yg] ?? item.default_amount;
                                return <div key={yg}>Y{yg}: {v != null ? naira(v) : <span style={{ color: '#999' }}>not approved</span>}</div>;
                              })}
                            </div>
                            <button type="button" className="secondary" style={{ fontSize: '0.8rem' }}
                              onClick={() => {
                                const cur = {};
                                YEARS.forEach((yg) => { const v = yearPrices[item.id]?.[yg]; cur[yg] = v != null ? String(v) : ''; });
                                setProposingYears({ id: item.id, prices: cur, reason: '' }); setProposeStatus(null);
                              }}>
                              Propose year prices
                            </button>
                          </>
                        )
                      ) : proposing?.id === item.id ? (
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
                          {item.default_amount != null ? `₦${Number(item.default_amount).toLocaleString('en-GB', { maximumFractionDigits: 0 })}` : <span style={{ color: '#999' }}>Not set</span>}{' '}
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
