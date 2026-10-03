'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { errorText } from '../../lib/admissions';

// "Add a fee" in numbered steps (migration 348, the principal 3 Oct 2026:
// "Adding fee items needs to be clearly numbered and sometimes it is only
// available on one term sometimes all"). Everything is sent in one call,
// add_fee_item(), which creates the fee, sets its fund and terms and sends
// its prices for the usual approval by the principal and the college
// secretary. A fee whose category is locked (tuition, activity, technology,
// medical, exam) has a price per year group (per term when it is charged in
// chosen terms); any other fee has one price.

const YEARS = [7, 8, 9, 10, 11, 12];

const step = (n, title, children, help) => (
  <fieldset style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.6rem 0.8rem', margin: '0.6rem 0' }}>
    <legend style={{ fontWeight: 600 }}>{n}. {title}</legend>
    {help && <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.4rem' }}>{help}</p>}
    {children}
  </fieldset>
);

const EMPTY = { name: '', displayName: '', category: '', optional: false, cc: '', when: 'all', termIds: [], prices: {}, single: '', reason: '' };

export default function AddFeeForm({ onDone }) {
  const [terms, setTerms] = useState([]);
  const [centres, setCentres] = useState([]);
  const [approver, setApprover] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    supabase.from('terms').select('term_id, term_name, start_date').order('start_date').then(({ data }) => setTerms(data || []));
    supabase.rpc('is_budget_approver').then(({ data }) => setApprover(!!data));
    supabase.from('cost_centres').select('id, name, kind, active, sort_order').eq('active', true).neq('kind', 'contingency').order('sort_order')
      .then(({ data }) => setCentres(data || []));
  }, []);

  useEffect(() => {
    const c = form.category.trim();
    if (!c) { setLocked(false); return undefined; }
    const t = setTimeout(() => {
      supabase.rpc('fee_category_is_locked', { p_category: c }).then(({ data }) => setLocked(!!data));
    }, 250);
    return () => clearTimeout(t);
  }, [form.category]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const priceRows = form.when === 'all' ? [{ key: 'all', label: 'Every term' }]
    : terms.filter((t) => form.termIds.includes(t.term_id)).map((t) => ({ key: String(t.term_id), label: t.term_name }));

  function setPrice(row, yg, v) {
    set({ prices: { ...form.prices, [row]: { ...(form.prices[row] || {}), [yg]: v } } });
  }

  function toggleTerm(id) {
    set({ termIds: form.termIds.includes(id) ? form.termIds.filter((x) => x !== id) : [...form.termIds, id] });
  }

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (form.when === 'some' && form.termIds.length === 0) { setMsg({ error: true, text: 'Step 3: tick at least one term.' }); return; }
    let prices;
    if (locked) {
      prices = {};
      for (const r of priceRows) {
        const p = {};
        for (const yg of YEARS) {
          const v = String(form.prices[r.key]?.[yg] ?? '').trim();
          if (v === '') continue;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) { setMsg({ error: true, text: `Step 4: ${r.label}, Year ${yg}: give an amount of 0 or more.` }); return; }
          p[yg] = n;
        }
        prices[r.key] = p;
      }
    } else {
      const n = Number(form.single);
      if (String(form.single).trim() === '' || !Number.isFinite(n) || n < 0) { setMsg({ error: true, text: 'Step 4: give the price.' }); return; }
      prices = { single: n };
    }
    setSaving(true);
    const { error } = await supabase.rpc('add_fee_item', {
      p_name: form.name, p_display_name: form.displayName, p_category: form.category, p_is_optional: form.optional,
      p_cost_centre_id: form.cc ? Number(form.cc) : null,
      p_term_ids: form.when === 'some' ? form.termIds : null,
      p_prices: prices, p_reason: form.reason,
    });
    setSaving(false);
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setForm(EMPTY);
    onDone?.(`${form.name.trim()} added. Its prices are waiting for approval by the principal and the college secretary at 2. Approve; it can be charged once both have approved.`);
  }

  return (
    <form onSubmit={submit}>
      {step(1, 'What is the fee?', (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>Name<br /><input value={form.name} onChange={(e) => set({ name: e.target.value })} required placeholder="e.g. WAEC Exam Fee 2027" /></label>
          <label>Shown to parents as<br /><input value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder="Same as the name" /></label>
          <label>Category<br />
            <input value={form.category} onChange={(e) => set({ category: e.target.value })} list="fee-categories" style={{ width: '9rem' }} />
            <datalist id="fee-categories">
              {['tuition', 'activity', 'technology', 'medical', 'exam', 'damages', 'trip'].map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={form.optional} onChange={(e) => set({ optional: e.target.checked })} /> Optional (only some students pay it)
          </label>
        </div>
      ))}

      {step(2, 'Which fund does it pay into?', approver && centres.length > 0 ? (
        <select value={form.cc} onChange={(e) => set({ cc: e.target.value })}>
          <option value="">Choose later</option>
          {centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : (
        <p style={{ margin: 0, fontSize: '0.9rem' }}>The principal or the college secretary chooses the fund afterwards, at Budget → 1 Funds.</p>
      ), 'Tuition goes to the general fund; direct charges such as swimming, medical, ICT and exam entries to their own ring-fenced fund.')}

      {step(3, 'Which terms is it charged in?', (
        <div>
          <label style={{ marginRight: '1rem' }}><input type="radio" checked={form.when === 'all'} onChange={() => set({ when: 'all' })} /> Every term</label>
          <label><input type="radio" checked={form.when === 'some'} onChange={() => set({ when: 'some' })} /> Only in the terms I tick</label>
          {form.when === 'some' && (
            <div style={{ marginTop: '0.4rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {terms.map((t) => (
                <label key={t.term_id}><input type="checkbox" checked={form.termIds.includes(t.term_id)} onChange={() => toggleTerm(t.term_id)} /> {t.term_name}</label>
              ))}
            </div>
          )}
        </div>
      ), 'An exam fee such as WAEC is usually charged in one term; tuition every term. It can’t be charged in any other term.')}

      {step(4, locked ? 'Price for each year group' : 'Price', locked ? (
        <div className="table-scroll">
          <table>
            <thead><tr><th></th>{YEARS.map((y) => <th key={y}>Y{y}</th>)}</tr></thead>
            <tbody>
              {priceRows.map((r) => (
                <tr key={r.key}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.label}</td>
                  {YEARS.map((yg) => (
                    <td key={yg}>
                      <input type="number" min="0" value={form.prices[r.key]?.[yg] ?? ''} placeholder="Not charged" style={{ width: '7.5rem' }}
                        onChange={(e) => setPrice(r.key, yg, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
              {priceRows.length === 0 && <tr><td colSpan={YEARS.length + 1} style={{ color: '#666' }}>Tick the terms in step 3 first.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <label>₦ <input type="number" min="0" value={form.single} onChange={(e) => set({ single: e.target.value })} style={{ width: '9rem' }} /></label>
      ), locked
        ? 'This category is charged only at its approved price for the student’s year. Leave a year blank if that year doesn’t pay it (for example, WAEC: Year 12 only).'
        : 'One price for everyone. The bursar can type a different amount for a student when charging.')}

      {step(5, 'Send for approval', (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>Reason (optional)<br /><input value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="New fee" style={{ width: '16rem' }} /></label>
          <button type="submit" disabled={saving}>{saving ? 'Sending…' : 'Add the fee and send its prices for approval'}</button>
        </div>
      ), 'The principal and the college secretary both approve the prices at 2. Approve. Until then the fee can’t be charged.')}
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d' }}>{msg.text}</p>}
    </form>
  );
}
