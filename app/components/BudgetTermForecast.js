'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatMoney, errorText } from '../../lib/admissions';

// The term forecast on /finance/budget (migration 339): what each fee item
// should bring in for a term, from the number of students paying it in each
// year group x its approved price, totalled by fund. The numbers start from
// the live headcount (compulsory items: everyone; tuition: everyone on the
// highest-priced item; optional items: none) and the principal or the
// college secretary can change any of them for that term. A blank box goes
// back to the headcount default. The database does the sums
// (budget_term_forecast()); this only draws them.

const YEARS = [7, 8, 9, 10, 11, 12];

function money(v) {
  return formatMoney(Number(v || 0));
}

function termLabel(t) {
  const d = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${t.term_name} (${d(t.start_date)} – ${d(t.end_date)})`;
}

export default function BudgetTermForecast({ canEdit, centres }) {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    supabase.from('terms').select('term_id, term_name, start_date, end_date').order('start_date').then(({ data }) => {
      const list = data || [];
      setTerms(list);
      // Default to the next term to start (the budget begins in Term 2).
      const today = new Date().toISOString().slice(0, 10);
      const next = list.find((t) => t.start_date > today) || list[list.length - 1];
      if (next) setTermId(String(next.term_id));
    });
  }, []);

  useEffect(() => { if (termId) load(); }, [termId]);

  async function load() {
    const { data, error: err } = await supabase.rpc('budget_term_forecast', { p_term_id: Number(termId) });
    if (err) { setError(errorText(err)); setRows([]); return; }
    setError(null);
    setRows(data || []);
  }

  async function save(row, value) {
    const text = String(value).trim();
    const students = text === '' ? null : Number(text);
    if (students !== null && (!Number.isInteger(students) || students < 0)) {
      setError('Give a whole number of students, or leave it blank for the headcount.');
      return;
    }
    if (students === (row.entered ? row.students : null)) return;
    const key = `${row.fee_item_id}-${row.year_group}`;
    setSavingKey(key);
    const { error: err } = await supabase.rpc('set_budget_forecast_count', {
      p_term_id: Number(termId), p_fee_item_id: row.fee_item_id, p_year_group: row.year_group, p_students: students,
    });
    setSavingKey(null);
    if (err) { setError(errorText(err)); return; }
    await load();
  }

  if (rows === null) return <p>Loading the forecast…</p>;

  const centreName = Object.fromEntries((centres || []).map((c) => [c.id, c.name]));
  const centreOrder = Object.fromEntries((centres || []).map((c) => [c.id, c.sort_order]));
  const headcount = {};
  rows.forEach((r) => { headcount[r.year_group] = r.headcount; });

  // Rows: one per fee item (the discount line separately), cells per year.
  const items = {};
  rows.forEach((r) => {
    const k = r.name === 'Discounts (forecast)' ? 'discount' : String(r.fee_item_id);
    (items[k] ||= { key: k, name: r.name, cc: r.cost_centre_id, price: r.price, discount: k === 'discount', cells: {} }).cells[r.year_group] = r;
  });
  const byFund = {};
  Object.values(items).forEach((it) => { (byFund[it.cc ?? 'none'] ||= []).push(it); });
  const funds = Object.keys(byFund).sort((a, b) => (centreOrder[a] ?? 999) - (centreOrder[b] ?? 999));
  const sum = (list) => list.reduce((s, r) => s + Number(r.amount || 0), 0);
  const itemTotal = (it) => sum(Object.values(it.cells));
  const total = sum(rows);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Amount available for the term (forecast)</h2>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Students paying each fee in each year group × its approved price. The numbers start from today&apos;s
        headcount: compulsory fees for every student, tuition for every student on {' '}
        the highest-priced school fee, optional activities for nobody.
        {canEdit ? ' Change any number for this term; leave a box blank to go back to the headcount.' : ''}
      </p>
      <label>Term{' '}
        <select value={termId} onChange={(e) => setTermId(e.target.value)}>
          {terms.map((t) => <option key={t.term_id} value={t.term_id}>{termLabel(t)}</option>)}
        </select>
      </label>
      {error && <p style={{ color: '#a3232c' }}>{error}</p>}

      <div className="stat-card-row" style={{ margin: '0.8rem 0' }}>
        <div className="stat-card"><div><div className="stat-card-value">{money(total)}</div><div className="stat-card-label">Forecast for the term</div></div></div>
        {funds.map((f) => (
          <div key={f} className="stat-card"><div>
            <div className="stat-card-value">{money(byFund[f].reduce((s, it) => s + itemTotal(it), 0))}</div>
            <div className="stat-card-label">{centreName[f] || 'No fund yet'}</div>
          </div></div>
        ))}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Fee</th><th style={{ textAlign: 'right' }}>Price</th>
              {YEARS.map((y) => <th key={y} style={{ textAlign: 'center' }}>Y{y}<div style={{ fontWeight: 400, fontSize: '0.75rem', color: '#666' }}>{headcount[y] ?? 0} students</div></th>)}
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => (
              <Fragment key={f}>
                <tr><td colSpan={YEARS.length + 3} style={{ background: '#f4f4f4', fontWeight: 600 }}>{centreName[f] || 'No fund yet'}</td></tr>
                {byFund[f].map((it) => (
                  <tr key={it.key}>
                    <td>{it.name}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{it.discount ? '' : money(it.price)}</td>
                    {YEARS.map((y) => {
                      const c = it.cells[y];
                      if (!c) return <td key={y} />;
                      const key = `${c.fee_item_id}-${y}`;
                      return (
                        <td key={y} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {canEdit && !it.discount ? (
                            <input
                              key={`${termId}-${key}-${c.students}-${c.entered}`}
                              type="number" min="0" step="1"
                              defaultValue={c.entered ? c.students : ''}
                              placeholder={String(c.students)}
                              disabled={savingKey === key}
                              onBlur={(e) => save(c, e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              style={{ width: '4.2rem', textAlign: 'center', background: c.entered ? '#fff1cc' : undefined }}
                              title={c.entered ? 'Entered for this term' : 'From the headcount'}
                            />
                          ) : (
                            <span>{c.students}</span>
                          )}
                          <div style={{ fontSize: '0.75rem', color: Number(c.amount) < 0 ? '#a3232c' : '#555' }}>{money(c.amount)}</div>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{money(itemTotal(it))}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#666', fontSize: '0.85rem' }}>
        Shaded boxes were entered for this term; the rest follow the headcount, so they change as students join or leave.
        Discounts are every current open-ended discount, taken off the highest school fee. Once the term is invoiced,
        the charged and collected figures below replace this forecast.
      </p>
    </div>
  );
}
