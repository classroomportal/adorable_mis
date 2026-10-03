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
  const [detailsOpen, setDetailsOpen] = useState(null); // fee id whose name is being edited
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

  // Discount (the line apply_student_discount() writes discounts under, found
  // by its name) and the tuck shop top-up lines aren't fees anyone charges,
  // so they are listed apart and can't be renamed here.
  function isSystemItem(item) {
    return ['discount', 'tuckshop'].includes(String(item.category || '').trim().toLowerCase());
  }

  function yearPriceText(item) {
    const v = YEARS.map((yg) => yearPrices[item.id]?.[yg] ?? item.default_amount ?? null);
    if (v.every((x) => x == null)) return <span style={{ color: '#999' }}>Not approved yet</span>;
    if (v.every((x) => x === v[0])) return `${naira(v[0])} (every year)`;
    return YEARS.map((yg, i) => `Y${yg} ${v[i] != null ? naira(v[i]) : '–'}`).join(' · ');
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
        <>
          <h2 style={{ marginBottom: '0.3rem' }}>Fees the school charges</h2>
          {items.filter((it) => !isSystemItem(it)).map((item) => {
            const dirty = !!edits[item.id];
            const open = detailsOpen === item.id;
            return (
              <div key={item.id} className="card" style={{ padding: '0.75rem 0.9rem', margin: '0.6rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <div>
                    <strong style={{ fontSize: '1.05rem' }}>{item.display_name || item.name}</strong>
                    {item.display_name && item.display_name !== item.name && <span style={{ color: '#666', fontSize: '0.85rem' }}> ({item.name})</span>}
                    <div style={{ fontSize: '0.85rem', color: '#666' }}>
                      {item.category || 'No category'}{item.is_optional ? ' · Optional' : ''}
                      {item.price_locked && <span className="badge" style={{ background: '#e6eefb', color: '#1d4a8f', marginLeft: '0.4rem' }} title="Charged only at the approved price for the student's year group">Approved price only</span>}
                    </div>
                  </div>
                  <button type="button" className="secondary" style={{ fontSize: '0.8rem' }} onClick={() => setDetailsOpen(open ? null : item.id)}>
                    {open ? 'Close' : 'Edit name'}
                  </button>
                </div>

                {open && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', margin: '0.5rem 0' }}>
                    <label>Name<br /><input value={currentValue(item, 'name') || ''} onChange={(e) => edit(item.id, 'name', e.target.value)} style={{ width: '12rem' }} /></label>
                    <label>Shown to parents as<br /><input value={currentValue(item, 'display_name') || ''} onChange={(e) => edit(item.id, 'display_name', e.target.value)} placeholder={item.name} style={{ width: '12rem' }} /></label>
                    <label>Category<br /><input value={currentValue(item, 'category') || ''} onChange={(e) => edit(item.id, 'category', e.target.value)} style={{ width: '9rem' }} /></label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <input type="checkbox" checked={!!currentValue(item, 'is_optional')} onChange={(e) => edit(item.id, 'is_optional', e.target.checked)} /> Optional
                    </label>
                    {dirty && (
                      <button type="button" onClick={() => saveItem(item)} disabled={savingId === item.id}>
                        {savingId === item.id ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>Charged in: </span>
                  {editingTerms?.id === item.id ? (
                    <form onSubmit={saveTerms} style={{ marginTop: '0.3rem' }}>
                      <label style={{ display: 'block' }}><input type="radio" checked={editingTerms.all} onChange={() => setEditingTerms({ ...editingTerms, all: true })} /> Every term</label>
                      <label style={{ display: 'block' }}><input type="radio" checked={!editingTerms.all} onChange={() => setEditingTerms({ ...editingTerms, all: false })} /> Only in the terms I tick:</label>
                      <div style={{ paddingLeft: '1.5rem', opacity: editingTerms.all ? 0.45 : 1 }}>
                        {terms.map((t) => (
                          <label key={t.term_id} style={{ display: 'block' }}>
                            <input type="checkbox" disabled={editingTerms.all} checked={editingTerms.ids.includes(t.term_id)}
                              onChange={() => setEditingTerms({ ...editingTerms, ids: editingTerms.ids.includes(t.term_id) ? editingTerms.ids.filter((x) => x !== t.term_id) : [...editingTerms.ids, t.term_id] })} /> {t.term_name}
                          </label>
                        ))}
                      </div>
                      <button type="submit">Save</button>{' '}
                      <button type="button" className="secondary" onClick={() => setEditingTerms(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      {termsText(item)}{' '}
                      <button type="button" className="secondary" style={{ fontSize: '0.8rem' }}
                        onClick={() => setEditingTerms({ id: item.id, all: !(item.charge_term_ids || []).length, ids: item.charge_term_ids || [] })}>Change terms</button>
                    </>
                  )}
                </div>

                <div style={{ marginTop: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>Price: </span>
                  {item.price_locked ? (
                    proposingYears?.id === item.id ? (
                      <form onSubmit={sendYearProposal} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.3rem' }}>
                        {YEARS.map((yg) => (
                          <label key={yg} style={{ margin: 0 }}>Y{yg}<br />
                            <input type="number" min="0" value={proposingYears.prices[yg] ?? ''} placeholder="Not charged" style={{ width: '7.5rem' }}
                              onChange={(e) => setProposingYears({ ...proposingYears, prices: { ...proposingYears.prices, [yg]: e.target.value } })} />
                          </label>
                        ))}
                        <label style={{ margin: 0 }}>Reason<br /><input value={proposingYears.reason} onChange={(e) => setProposingYears({ ...proposingYears, reason: e.target.value })} style={{ width: '10rem' }} /></label>
                        <button type="submit">Send for approval</button>
                        <button type="button" className="secondary" onClick={() => { setProposingYears(null); setProposeStatus(null); }}>Cancel</button>
                        {proposeStatus && <span style={{ color: '#a3232c', fontSize: '0.85em', width: '100%' }}>{proposeStatus}</span>}
                      </form>
                    ) : (
                      <>
                        {yearPriceText(item)}{' '}
                        <button type="button" className="secondary" style={{ fontSize: '0.8rem' }}
                          onClick={() => {
                            const cur = {};
                            YEARS.forEach((yg) => { const v = yearPrices[item.id]?.[yg]; cur[yg] = v != null ? String(v) : ''; });
                            setProposingYears({ id: item.id, prices: cur, reason: '' }); setProposeStatus(null);
                          }}>
                          Change prices
                        </button>
                      </>
                    )
                  ) : proposing?.id === item.id ? (
                    <form onSubmit={sendProposal} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.3rem' }}>
                      <label style={{ margin: 0 }}>New price (₦)<br /><input type="number" min="0" value={proposing.amount} onChange={(e) => setProposing({ ...proposing, amount: e.target.value })} style={{ width: '8rem' }} autoFocus /></label>
                      <label style={{ margin: 0 }}>Reason<br /><input value={proposing.reason} onChange={(e) => setProposing({ ...proposing, reason: e.target.value })} style={{ width: '10rem' }} /></label>
                      <button type="submit">Send for approval</button>
                      <button type="button" className="secondary" onClick={() => { setProposing(null); setProposeStatus(null); }}>Cancel</button>
                      {proposeStatus && <span style={{ color: '#a3232c', fontSize: '0.85em', width: '100%' }}>{proposeStatus}</span>}
                    </form>
                  ) : (
                    <>
                      {item.default_amount != null ? naira(item.default_amount) : <span style={{ color: '#999' }}>Typed when charging</span>}{' '}
                      <button type="button" className="secondary" style={{ fontSize: '0.8rem' }}
                        onClick={() => { setProposing({ id: item.id, amount: item.default_amount ?? '', reason: '' }); setProposeStatus(null); }}>
                        Change price
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          <h2 style={{ marginBottom: '0.3rem' }}>Used by the system</h2>
          <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0 }}>
            These aren&apos;t fees you charge, so they can&apos;t be changed here. <strong>Discount</strong> is the line a
            discount or bursary given at <a href="/bursar/discounts">3. Discounts</a> appears under on a bill, as a minus
            amount. The <strong>Tuck Shop</strong> lines record money put on a student&apos;s tuck shop balance.
          </p>
          <ul style={{ marginTop: 0 }}>
            {items.filter(isSystemItem).map((item) => <li key={item.id}>{item.display_name || item.name}</li>)}
          </ul>
        </>
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
