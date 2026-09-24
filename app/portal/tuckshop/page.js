'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// Orders for a Saturday lock at 11pm Lagos time on the Friday before —
// same rule as tuckshop_preorder_cutoff() (migration 160). Lagos is UTC+1
// all year, so the offset can be written in.
function dayBefore(forDate) {
  const d = new Date(`${forDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function cutoffFor(forDate) {
  return new Date(`${dayBefore(forDate)}T23:00:00+01:00`);
}

function isLocked(forDate) {
  return Date.now() >= cutoffFor(forDate).getTime();
}

function TuckshopInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;

  const [tuckshopBalance, setTuckshopBalance] = useState(null);
  const [tuckshopHistory, setTuckshopHistory] = useState([]);
  const [tuckshopItems, setTuckshopItems] = useState([]);
  const [preorderCart, setPreorderCart] = useState({});
  const [preorderStatus, setPreorderStatus] = useState(null);
  const [myPreorders, setMyPreorders] = useState([]);
  const [closedUntil, setClosedUntil] = useState(null);
  const [orderDate, setOrderDate] = useState(null);

  async function load() {
    if (!studentId) return;
    const { data: bal } = await supabase.rpc('get_tuckshop_balance', { p_student_id: studentId });
    setTuckshopBalance(bal);
    const { data: hist } = await supabase
      .from('tuckshop_purchases')
      .select('id, purchase_date, total_amount')
      .eq('student_id', studentId)
      .order('purchase_date', { ascending: false })
      .limit(10);
    setTuckshopHistory(hist || []);
    const { data: items } = await supabase.from('tuckshop_items').select('id, name, price').eq('active', true).order('name');
    setTuckshopItems(items || []);
    // system_settings is a single row, readable by any authenticated user.
    // Ordering is shut while today is before tuckshop_ordering_closed_until;
    // the same rule is enforced in submit_tuckshop_preorder, this is just so
    // students see why before filling a basket.
    const { data: settings } = await supabase
      .from('system_settings')
      .select('tuckshop_ordering_closed_until')
      .maybeSingle();
    const until = settings?.tuckshop_ordering_closed_until || null;
    // Local date, not toISOString() — that is UTC, which is an hour behind
    // Lagos and would keep the notice up past the reopen time.
    const today = new Date().toLocaleDateString('en-CA');
    setClosedUntil(until && today < until ? until : null);
    // Which Saturday is open for ordering comes from the database, so the
    // Friday 11pm cutoff doesn't depend on the phone's clock.
    const { data: next } = await supabase.rpc('tuckshop_next_order_date');
    setOrderDate(next || null);
    const { data: pre } = await supabase
      .from('tuckshop_preorders')
      .select('id, for_date, status')
      .eq('student_id', studentId)
      .order('for_date', { ascending: false })
      .limit(5);
    setMyPreorders(pre || []);
  }

  useEffect(() => { load(); }, [studentId]);

  function setPreorderQty(itemId, qty) {
    setPreorderCart((prev) => {
      const next = { ...prev };
      if (Number(qty) <= 0) delete next[itemId];
      else next[itemId] = Number(qty);
      return next;
    });
  }

  async function submitPreorder() {
    if (closedUntil || !orderDate) return;
    if (Object.keys(preorderCart).length === 0) return;
    setPreorderStatus('Submitting…');
    const payload = Object.entries(preorderCart).map(([itemId, qty]) => ({ item_id: Number(itemId), quantity: qty }));
    const { error } = await supabase.rpc('submit_tuckshop_preorder', {
      p_student_id: studentId,
      p_for_date: orderDate,
      p_items: payload,
    });
    if (error) {
      setPreorderStatus(`Error: ${error.message}`);
    } else {
      setPreorderStatus(`Preorder submitted for ${longDate(orderDate)}.`);
      setPreorderCart({});
      await load();
    }
  }

  if (!studentId) {
    return <p>Your account isn't linked to a student record yet — ask the school office to link it.</p>;
  }

  return (
    <div>
      <h1>Tuckshop</h1>
      <div className="card">
        <p>
          Balance:{' '}
          <span style={{ fontWeight: 700, color: (tuckshopBalance ?? 0) < 0 ? '#a3232c' : '#1a7a3d' }}>
            {tuckshopBalance === null ? '…' : naira(tuckshopBalance)}
          </span>
        </p>

        <h3>Preorder for {orderDate ? longDate(orderDate) : 'Saturday'}</h3>
        {closedUntil ? (
          <p className="badge badge-negative" style={{ display: 'inline-block' }}>
            Tuckshop ordering is closed at the moment. It reopens on {longDate(closedUntil)}.
          </p>
        ) : (
        <>
        {orderDate && (
          <p style={{ color: '#555' }}>
            Orders close at 11pm on {longDate(dayBefore(orderDate))}.
            After that they&apos;re locked and go to the tuckshop.
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Price</th><th>Qty</th></tr></thead>
            <tbody>
              {tuckshopItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{naira(item.price)}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={preorderCart[item.id] || ''}
                      onChange={(e) => setPreorderQty(item.id, e.target.value)}
                      style={{ width: '4rem' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={submitPreorder} disabled={!orderDate || Object.keys(preorderCart).length === 0} style={{ marginTop: '0.5rem' }}>
          Submit preorder
        </button>
        {preorderStatus && <p>{preorderStatus}</p>}
        </>
        )}

        {myPreorders.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>My preorders</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>For date</th><th>Status</th></tr></thead>
                <tbody>
                  {myPreorders.map((p) => {
                    const label = p.status === 'pending' && isLocked(p.for_date) ? 'locked' : p.status;
                    return (
                      <tr key={p.id}>
                        <td>{p.for_date}</td>
                        <td><span className={`badge ${p.status === 'fulfilled' ? 'badge-positive' : 'badge-negative'}`}>{label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tuckshopHistory.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>Recent purchases</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Date</th><th>Amount</th></tr></thead>
                <tbody>
                  {tuckshopHistory.map((h) => (
                    <tr key={h.id}><td>{h.purchase_date}</td><td>{naira(h.total_amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function TuckshopPage() {
  return <RequireAuth><TuckshopInner /></RequireAuth>;
}
