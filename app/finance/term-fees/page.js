'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatMoney, errorText } from '../../../lib/admissions';

// Fees by year and term (migration 343, the principal 3 Oct 2026: "I was
// expecting to put the fees per year and per term in"). For a chosen school
// term, every locked fee item's price for each year group, and where it comes
// from: a price approved for that term, else the item's year price, else its
// single price. A term's list is proposed here and applies only when the
// principal and the college secretary have both approved it at Fee Approvals
// (propose_fee_item_term_prices / approve_fee_price_change). Charging
// (enforce_locked_fee_price) and the term forecast both use these prices.

const YEARS = [7, 8, 9, 10, 11, 12];
const money = (v) => formatMoney(Number(v || 0));

function TermFeesInner() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [items, setItems] = useState([]);
  const [yearPrices, setYearPrices] = useState({}); // item -> yg -> amount
  const [termPrices, setTermPrices] = useState({}); // item -> yg -> amount (this term)
  const [pending, setPending] = useState({}); // item -> true
  const [editing, setEditing] = useState(null); // { id, prices: { yg: str }, reason }
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    supabase.from('terms').select('term_id, term_name, start_date').order('start_date').then(({ data }) => {
      const list = data || [];
      setTerms(list);
      const today = new Date().toISOString().slice(0, 10);
      const next = list.find((t) => t.start_date > today) || list[list.length - 1];
      if (next) setTermId(String(next.term_id));
    });
  }, []);

  useEffect(() => { if (termId) load(); }, [termId]);

  async function load() {
    const [it, yp, tp, pc] = await Promise.all([
      supabase.from('fee_items').select('id, name, category, default_amount, price_locked, charge_term_ids').eq('price_locked', true).order('name'),
      supabase.from('fee_item_year_prices').select('fee_item_id, year_group, amount'),
      supabase.from('fee_item_term_prices').select('fee_item_id, year_group, amount').eq('term_id', Number(termId)),
      supabase.from('fee_price_changes').select('fee_item_id').eq('kind', 'fee_item_term_prices').eq('term_id', Number(termId)).eq('status', 'pending'),
    ]);
    const err = it.error || yp.error || tp.error || pc.error;
    if (err) { setMsg({ error: true, text: errorText(err) }); return; }
    // A fee charged only in some terms (migration 348) is listed only in those.
    setItems((it.data || []).filter((i) => !(i.charge_term_ids || []).length || i.charge_term_ids.includes(Number(termId))));
    const y = {}; (yp.data || []).forEach((r) => { (y[r.fee_item_id] ||= {})[r.year_group] = Number(r.amount); });
    const t = {}; (tp.data || []).forEach((r) => { (t[r.fee_item_id] ||= {})[r.year_group] = Number(r.amount); });
    const p = {}; (pc.data || []).forEach((r) => { p[r.fee_item_id] = true; });
    setYearPrices(y); setTermPrices(t); setPending(p);
  }

  function effective(item, yg) {
    const t = termPrices[item.id]?.[yg];
    if (t != null) return { amount: t, from: 'term' };
    const y = yearPrices[item.id]?.[yg];
    if (y != null) return { amount: y, from: 'year' };
    if (item.default_amount != null) return { amount: Number(item.default_amount), from: 'single' };
    return { amount: null, from: 'none' };
  }

  function startEdit(item) {
    const prices = {};
    YEARS.forEach((yg) => { const e = effective(item, yg); prices[yg] = e.amount != null ? String(e.amount) : ''; });
    setEditing({ id: item.id, prices, reason: '' });
    setMsg(null);
  }

  async function send(e) {
    e.preventDefault();
    const prices = {};
    for (const yg of YEARS) {
      const v = String(editing.prices[yg] ?? '').trim();
      if (v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { setMsg({ error: true, text: `Year ${yg}: give an amount of 0 or more.` }); return; }
      prices[yg] = n;
    }
    const { error } = await supabase.rpc('propose_fee_item_term_prices', {
      p_fee_item_id: editing.id, p_term_id: Number(termId), p_prices: prices, p_reason: editing.reason,
    });
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setEditing(null);
    setMsg({ text: 'Sent for approval. These prices apply once you and the college secretary have both approved them at Fee Approvals.' });
    await load();
  }

  const termName = terms.find((t) => String(t.term_id) === termId)?.term_name || '';
  const FROM = { term: `Set for ${termName}`, year: 'Year price', single: 'Single price', none: 'No approved price' };

  return (
    <div>
      <p style={{ margin: 0 }}><a href="/">← Dashboard</a></p>
      <h1>2. Fees</h1>
      <p style={{ color: '#666', margin: '0 0 0.5rem' }}>Fees by year and term</p>
      <p style={{ fontSize: '0.85rem', background: '#fff1cc', padding: '0.4rem 0.6rem', borderRadius: 4 }}>
        Only you and the college secretary can see the Budget while it is being built.
      </p>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        The termly price of each fee for each year group. A term only needs its own list where it differs (for example
        Year 12 paying Terms 2 and 3 together in Term 2, and nothing in Term 3); otherwise the fee&apos;s year price, or its
        single price, applies. New prices apply once you and the college secretary have both approved them at{' '}
        <a href="/bursar/fee-approvals">Fee Approvals</a>. The bursar can then charge only these prices, and the term
        forecast uses them.
      </p>
      <label>Term{' '}
        <select value={termId} onChange={(e) => { setTermId(e.target.value); setEditing(null); }}>
          {terms.map((t) => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
        </select>
      </label>
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d' }}>{msg.text}</p>}

      <div className="table-scroll" style={{ marginTop: '0.8rem' }}>
        <table>
          <thead>
            <tr><th>Fee</th>{YEARS.map((y) => <th key={y} style={{ textAlign: 'right' }}>Y{y}</th>)}<th></th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr>
                  <td>{item.name}<div style={{ fontSize: '0.75rem', color: '#666' }}>{item.category}</div></td>
                  {YEARS.map((yg) => {
                    const e = effective(item, yg);
                    return (
                      <td key={yg} style={{ textAlign: 'right', whiteSpace: 'nowrap', background: e.from === 'term' ? '#fff1cc' : undefined }}
                        title={FROM[e.from]}>
                        {e.amount != null ? money(e.amount) : <span style={{ color: '#a3232c' }}>none</span>}
                      </td>
                    );
                  })}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {pending[item.id]
                      ? <span className="badge" style={{ background: '#fff1cc', color: '#7a5a00' }}>Waiting for approval</span>
                      : editing?.id !== item.id && <button type="button" className="secondary" style={{ fontSize: '0.8rem' }} onClick={() => startEdit(item)}>Set {termName} prices</button>}
                  </td>
                </tr>
                {editing?.id === item.id && (
                  <tr>
                    <td colSpan={YEARS.length + 2}>
                      <form onSubmit={send} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        {YEARS.map((yg) => (
                          <label key={yg} style={{ margin: 0 }}>Y{yg}<br />
                            <input type="number" min="0" value={editing.prices[yg] ?? ''} placeholder="Year price" style={{ width: '8rem' }}
                              onChange={(e) => setEditing({ ...editing, prices: { ...editing.prices, [yg]: e.target.value } })} />
                          </label>
                        ))}
                        <label style={{ margin: 0 }}>Reason<br />
                          <input value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} style={{ width: '12rem' }} />
                        </label>
                        <button type="submit">Send for approval</button>
                        <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                      </form>
                      <p style={{ fontSize: '0.8rem', color: '#666', margin: '0.3rem 0 0' }}>
                        Leave a year blank to use the fee&apos;s year price in {termName}. Use 0 for a year that pays nothing this term.
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#666', fontSize: '0.85rem' }}>
        Shaded prices are set for {termName}; hover over a price to see where it comes from. Only fees locked to approved
        prices are listed (tuition, activity, technology, medical and exam fees), and only those charged in {termName}.
        To add a fee, or choose which terms it is charged in, use <a href="/bursar/fee-items">Fees &amp; Bills → 1 Fees</a>.
      </p>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><RequireResource resourceKey="/finance/term-fees"><TermFeesInner /></RequireResource></RequireAuth>;
}
