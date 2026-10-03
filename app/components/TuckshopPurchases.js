'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';

// A student's tuckshop purchases with what was in each one, for the parent
// and student tuckshop pages. Parents used to see only a date and a total.
// Line items are readable by the student's own family (RLS on
// tuckshop_purchase_items, can_view_student_tuckshop()).

const PAGE = 15;

function naira(n) {
  return `₦${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

export default function TuckshopPurchases({ studentId }) {
  const [purchases, setPurchases] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => { setLimit(PAGE); }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    let stale = false;
    supabase
      .from('tuckshop_purchases')
      .select('id, purchase_date, total_amount, created_at, tuckshop_purchase_items(id, quantity, unit_price, line_total, tuckshop_items(name))')
      .eq('student_id', studentId)
      .order('purchase_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit + 1)
      .then(({ data }) => {
        if (stale) return;
        const rows = data || [];
        setHasMore(rows.length > limit);
        setPurchases(rows.slice(0, limit));
      });
    return () => { stale = true; };
  }, [studentId, limit]);

  if (purchases === null) return <p>Loading purchases…</p>;
  if (purchases.length === 0) return <p>No purchases yet.</p>;

  return (
    <>
      <h3 style={{ marginTop: '1rem' }}>What was bought</h3>
      <div className="table-scroll">
        <table style={{ minWidth: 0 }}>
          <thead><tr><th>Date</th><th>Items</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {purchases.map((p) => {
              const lines = [...(p.tuckshop_purchase_items || [])]
                .sort((a, b) => (a.tuckshop_items?.name || '').localeCompare(b.tuckshop_items?.name || ''));
              return (
                <tr key={p.id} style={{ verticalAlign: 'top' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(p.purchase_date, { weekday: true })}</td>
                  <td>
                    {lines.length === 0 ? <span style={{ color: '#888' }}>—</span> : lines.map((l) => (
                      <div key={l.id}>
                        {l.quantity} × {l.tuckshop_items?.name || 'Item'}
                        <span style={{ color: '#888', fontSize: '0.85em' }}> {naira(l.line_total)}</span>
                      </div>
                    ))}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{naira(p.total_amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button type="button" className="secondary" onClick={() => setLimit((n) => n + PAGE)} style={{ marginTop: '0.5rem', width: 'fit-content' }}>
          Show earlier purchases
        </button>
      )}
    </>
  );
}
