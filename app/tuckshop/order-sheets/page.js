'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { generateOrderSheetsPdf } from '../../../lib/generateOrderSheetsPdf';

// Printable tuckshop order sheets: one page per restaurant listing each
// student's order, with the total of each item, plus a whole-school
// summary for the stock room. Orders for a Saturday lock at 11pm on the
// Friday before (migration 160) — the sheet is live, so printing before
// then shows a warning that it can still change.

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Lagos is UTC+1 all year. Mirrors tuckshop_preorder_cutoff().
function isLocked(forDate) {
  return Date.now() >= new Date(`${dayBefore(forDate)}T23:00:00+01:00`).getTime();
}

function restaurantLabel(r) {
  if (!r) return 'No restaurant set';
  return /^\d+$/.test(r) ? `Restaurant ${r}` : r;
}

// Sum item lines into [{ name, price, qty }] sorted by name.
function itemTotals(lines) {
  const byName = new Map();
  lines.forEach((l) => {
    const cur = byName.get(l.name) || { name: l.name, price: l.price, qty: 0 };
    cur.qty += l.qty;
    byName.set(l.name, cur);
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function ItemTotalsTable({ totals }) {
  const qty = totals.reduce((s, t) => s + t.qty, 0);
  const value = totals.reduce((s, t) => s + t.qty * t.price, 0);
  return (
    <table className="order-sheet-table">
      <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
      <tbody>
        {totals.map((t) => (
          <tr key={t.name}>
            <td>{t.name}</td>
            <td style={{ textAlign: 'right' }}>{t.qty}</td>
            <td style={{ textAlign: 'right' }}>{naira(t.qty * t.price)}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700 }}>
          <td>Total</td>
          <td style={{ textAlign: 'right' }}>{qty}</td>
          <td style={{ textAlign: 'right' }}>{naira(value)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function OrderSheetsInner() {
  const [dates, setDates] = useState([]);
  const [forDate, setForDate] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { loadDates(); }, []);
  useEffect(() => { if (forDate) loadSheet(forDate); }, [forDate]);

  async function loadDates() {
    const { data, error: err } = await supabase
      .from('tuckshop_preorders')
      .select('for_date')
      .neq('status', 'cancelled')
      .order('for_date', { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    const list = [...new Set((data || []).map((r) => r.for_date))];
    // The next order date is always offered, even before anyone has ordered.
    const { data: next } = await supabase.rpc('tuckshop_next_order_date');
    if (next && !list.includes(next)) list.unshift(next);
    list.sort().reverse();
    setDates(list);
    // Default to the most recent Saturday whose orders are locked and
    // today-or-later (the one the shop is about to serve); otherwise the
    // next one open for ordering.
    const today = new Date().toLocaleDateString('en-CA');
    const upcoming = list.filter((d) => d >= today).sort();
    setForDate(upcoming.find(isLocked) || upcoming[0] || list[0] || '');
    if (list.length === 0) setLoading(false);
  }

  async function loadSheet(date) {
    setLoading(true);
    setError(null);
    const { data: orders, error: err } = await supabase
      .from('tuckshop_preorders')
      .select('id, status, student_id, students(first_name, last_name, form_class, year_group, restaurant)')
      .eq('for_date', date)
      .neq('status', 'cancelled');
    if (err) { setError(err.message); setLoading(false); return; }
    const ids = (orders || []).map((o) => o.id);
    let items = [];
    if (ids.length > 0) {
      const { data, error: itemErr } = await supabase
        .from('tuckshop_preorder_items')
        .select('preorder_id, quantity, tuckshop_items(name, price)')
        .in('preorder_id', ids);
      if (itemErr) { setError(itemErr.message); setLoading(false); return; }
      items = data || [];
    }
    const orderById = new Map((orders || []).map((o) => [o.id, o]));
    setRows(items.map((it) => {
      const o = orderById.get(it.preorder_id);
      return {
        studentId: o.student_id,
        student: o.students,
        status: o.status,
        name: it.tuckshop_items?.name || 'Unknown item',
        price: Number(it.tuckshop_items?.price || 0),
        qty: it.quantity,
      };
    }));
    setLoading(false);
  }

  // Restaurant -> students -> item lines. A student can place more than one
  // order for the same Saturday; they're combined into one line here.
  const restaurants = useMemo(() => {
    const byRest = new Map();
    rows.forEach((r) => {
      const key = r.student?.restaurant || '';
      if (!byRest.has(key)) byRest.set(key, new Map());
      const students = byRest.get(key);
      if (!students.has(r.studentId)) students.set(r.studentId, { student: r.student, lines: [], fulfilled: true });
      const s = students.get(r.studentId);
      s.lines.push(r);
      if (r.status !== 'fulfilled') s.fulfilled = false;
    });
    return [...byRest.entries()]
      .sort(([a], [b]) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b, undefined, { numeric: true });
      })
      .map(([key, students]) => ({
        key,
        label: restaurantLabel(key),
        students: [...students.values()]
          .map((s) => ({ ...s, items: itemTotals(s.lines) }))
          .sort((a, b) => `${a.student?.last_name} ${a.student?.first_name}`
            .localeCompare(`${b.student?.last_name} ${b.student?.first_name}`)),
        totals: itemTotals([...students.values()].flatMap((s) => s.lines)),
      }));
  }, [rows]);

  const locked = forDate ? isLocked(forDate) : false;
  const allTotals = useMemo(() => itemTotals(rows), [rows]);
  const studentCount = restaurants.reduce((n, r) => n + r.students.length, 0);

  return (
    <div>
      <div className="no-print">
        <h1>Tuckshop Order Sheets</h1>
        <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>
            Orders for<br />
            <select value={forDate} onChange={(e) => setForDate(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>{longDate(d)}{isLocked(d) ? '' : ' (still open)'}</option>
              ))}
            </select>
          </label>
          <button
            onClick={async () => {
              setDownloading(true);
              try {
                await generateOrderSheetsPdf({ forDate, locked, restaurants, allTotals, studentCount });
              } catch (e) {
                setError(`Couldn't make the PDF: ${e.message}`);
              }
              setDownloading(false);
            }}
            disabled={loading || downloading || rows.length === 0}
          >
            {downloading ? 'Making PDF…' : 'Download PDF'}
          </button>
          <button onClick={() => window.print()} disabled={loading || rows.length === 0}>Print</button>
        </div>
        {forDate && !locked && (
          <p className="badge badge-negative" style={{ display: 'inline-block' }}>
            Students can still order for this Saturday until 11pm on {longDate(dayBefore(forDate))} —
            this sheet may still change. Print after 11pm Friday for the final list.
          </p>
        )}
        {error && <p style={{ color: '#a3232c' }}>Error: {error}</p>}
      </div>

      {loading ? <p>Loading…</p> : rows.length === 0 ? (
        <p>No orders for {forDate ? longDate(forDate) : 'this date'}.</p>
      ) : (
        <>
          <section className="order-sheet-page">
            <h2>Tuckshop orders — {longDate(forDate)}</h2>
            <p className="order-sheet-meta">
              All restaurants · {studentCount} student{studentCount === 1 ? '' : 's'} ·{' '}
              {locked ? 'Final (orders locked 11pm Friday)' : 'PROVISIONAL — ordering still open'} ·
              printed {new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <table className="order-sheet-table">
              <thead><tr><th>Restaurant</th><th style={{ textAlign: 'right' }}>Students</th><th style={{ textAlign: 'right' }}>Items</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
              <tbody>
                {restaurants.map((r) => (
                  <tr key={r.key || 'none'}>
                    <td>{r.label}</td>
                    <td style={{ textAlign: 'right' }}>{r.students.length}</td>
                    <td style={{ textAlign: 'right' }}>{r.totals.reduce((s, t) => s + t.qty, 0)}</td>
                    <td style={{ textAlign: 'right' }}>{naira(r.totals.reduce((s, t) => s + t.qty * t.price, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Item totals, all restaurants</h3>
            <ItemTotalsTable totals={allTotals} />
          </section>

          {restaurants.map((r) => (
            <section className="order-sheet-page" key={r.key || 'none'}>
              <h2>{r.label} — {longDate(forDate)}</h2>
              <p className="order-sheet-meta">
                {r.students.length} student{r.students.length === 1 ? '' : 's'}
                {locked ? '' : ' · PROVISIONAL — ordering still open'}
              </p>
              <table className="order-sheet-table">
                <thead>
                  <tr><th>Student</th><th>Form</th><th>Order</th><th style={{ textAlign: 'right' }}>Amount</th><th className="order-sheet-tick">Given</th></tr>
                </thead>
                <tbody>
                  {r.students.map((s, i) => (
                    <tr key={i}>
                      <td>{s.student?.last_name}, {s.student?.first_name}</td>
                      <td>{s.student?.form_class || s.student?.year_group || ''}</td>
                      <td>{s.items.map((it) => `${it.qty} × ${it.name}`).join(', ')}</td>
                      <td style={{ textAlign: 'right' }}>{naira(s.items.reduce((n, it) => n + it.qty * it.price, 0))}</td>
                      <td className="order-sheet-tick">{s.fulfilled ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Item totals, {r.label}</h3>
              <ItemTotalsTable totals={r.totals} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}

export default function OrderSheetsPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/tuckshop/order-sheets">
      <OrderSheetsInner />
    </RequireResource></RequireAuth>
  );
}
