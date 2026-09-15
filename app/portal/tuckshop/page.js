'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function nextSaturday() {
  const d = new Date();
  const day = d.getDay();
  const add = (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
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
    if (Object.keys(preorderCart).length === 0) return;
    setPreorderStatus('Submitting…');
    const payload = Object.entries(preorderCart).map(([itemId, qty]) => ({ item_id: Number(itemId), quantity: qty }));
    const { error } = await supabase.rpc('submit_tuckshop_preorder', {
      p_student_id: studentId,
      p_for_date: nextSaturday(),
      p_items: payload,
    });
    if (error) {
      setPreorderStatus(`Error: ${error.message}`);
    } else {
      setPreorderStatus('Preorder submitted for Saturday.');
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

        <h3>Preorder for Saturday</h3>
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
        <button onClick={submitPreorder} disabled={Object.keys(preorderCart).length === 0} style={{ marginTop: '0.5rem' }}>
          Submit preorder
        </button>
        {preorderStatus && <p>{preorderStatus}</p>}

        {myPreorders.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>My preorders</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>For date</th><th>Status</th></tr></thead>
                <tbody>
                  {myPreorders.map((p) => (
                    <tr key={p.id}>
                      <td>{p.for_date}</td>
                      <td><span className={`badge ${p.status === 'fulfilled' ? 'badge-positive' : 'badge-negative'}`}>{p.status}</span></td>
                    </tr>
                  ))}
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
