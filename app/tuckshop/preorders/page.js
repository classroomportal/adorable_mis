'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function PreordersInner() {
  const [preorders, setPreorders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fulfillingId, setFulfillingId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('tuckshop_preorders')
      .select('id, for_date, status, student_id, students(first_name, last_name, form_class)')
      .order('for_date', { ascending: true });

    const ids = (rows || []).map((r) => r.id);
    let itemsByPreorder = new Map();
    if (ids.length > 0) {
      const { data: items } = await supabase
        .from('tuckshop_preorder_items')
        .select('preorder_id, quantity, tuckshop_items(name, price)')
        .in('preorder_id', ids);
      (items || []).forEach((it) => {
        if (!itemsByPreorder.has(it.preorder_id)) itemsByPreorder.set(it.preorder_id, []);
        itemsByPreorder.get(it.preorder_id).push(it);
      });
    }

    setPreorders((rows || []).map((r) => ({ ...r, items: itemsByPreorder.get(r.id) || [] })));
    setLoading(false);
  }

  async function fulfill(preorderId) {
    setFulfillingId(preorderId);
    const { data: userData } = await supabase.auth.getUser();
    await supabase.rpc('fulfill_tuckshop_preorder', { p_preorder_id: preorderId, p_created_by: userData?.user?.id });
    await load();
    setFulfillingId(null);
  }

  const pending = preorders.filter((p) => p.status === 'pending');
  const past = preorders.filter((p) => p.status !== 'pending');

  return (
    <div>
      <h1>Tuckshop Preorders</h1>

      {loading ? <p>Loading…</p> : (
        <>
          <h2>Pending ({pending.length})</h2>
          {pending.length === 0 ? <p>No pending preorders.</p> : pending.map((p) => {
            const total = p.items.reduce((s, it) => s + it.tuckshop_items.price * it.quantity, 0);
            return (
              <div className="card" key={p.id}>
                <strong>{p.students?.first_name} {p.students?.last_name}</strong> ({p.students?.form_class}) — for {p.for_date}
                <ul>
                  {p.items.map((it, i) => (
                    <li key={i}>{it.quantity} × {it.tuckshop_items.name} ({naira(it.tuckshop_items.price)} each)</li>
                  ))}
                </ul>
                <div style={{ fontWeight: 700 }}>Total: {naira(total)}</div>
                <button onClick={() => fulfill(p.id)} disabled={fulfillingId === p.id}>
                  {fulfillingId === p.id ? 'Fulfilling…' : 'Fulfil (deduct balance)'}
                </button>
              </div>
            );
          })}

          <h2 style={{ marginTop: '1.5rem' }}>Recent history</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>For date</th><th>Status</th></tr></thead>
              <tbody>
                {past.slice(0, 30).map((p) => (
                  <tr key={p.id}>
                    <td>{p.students?.first_name} {p.students?.last_name}</td>
                    <td>{p.for_date}</td>
                    <td><span className={`badge ${p.status === 'fulfilled' ? 'badge-positive' : 'badge-negative'}`}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function PreordersPage() {
  return (
    <RequireAuth>
      <PreordersInner />
    </RequireAuth>
  );
}
