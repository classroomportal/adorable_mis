'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function TuckshopPurchaseInner() {
  const [items, setItems] = useState([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [balance, setBalance] = useState(null);
  const [cart, setCart] = useState({}); // item_id -> quantity
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('tuckshop_items').select('id, name, price').eq('active', true).order('name');
      setItems(data ?? []);
    })();
  }, []);

  useEffect(() => {
    if (studentQuery.trim().length < 2) {
      setStudentResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, form_class, year_group')
        .eq('status', 'active')
        .or(`first_name.ilike.%${studentQuery}%,last_name.ilike.%${studentQuery}%`)
        .limit(8);
      setStudentResults(data ?? []);
    }, 250);
    return () => clearTimeout(handle);
  }, [studentQuery]);

  async function selectStudent(s) {
    setSelectedStudent(s);
    setStudentQuery(`${s.first_name} ${s.last_name}`);
    setStudentResults([]);
    setCart({});
    await refreshBalance(s.student_id);
    const { data } = await supabase
      .from('tuckshop_purchases')
      .select('id, purchase_date, total_amount')
      .eq('student_id', s.student_id)
      .order('purchase_date', { ascending: false })
      .limit(10);
    setHistory(data ?? []);
  }

  async function refreshBalance(studentId) {
    const { data } = await supabase.rpc('get_tuckshop_balance', { p_student_id: studentId });
    setBalance(data);
  }

  function setQty(itemId, qty) {
    setCart((prev) => {
      const next = { ...prev };
      if (Number(qty) <= 0) delete next[itemId];
      else next[itemId] = Number(qty);
      return next;
    });
  }

  const cartTotal = Object.entries(cart).reduce((sum, [itemId, qty]) => {
    const item = items.find((i) => String(i.id) === itemId);
    return sum + (item ? item.price * qty : 0);
  }, 0);

  async function submitPurchase() {
    if (!selectedStudent || Object.keys(cart).length === 0) return;
    setSubmitting(true);
    setStatus(null);
    const { data: userData } = await supabase.auth.getUser();
    const payload = Object.entries(cart).map(([itemId, qty]) => ({ item_id: Number(itemId), quantity: qty }));
    const { error } = await supabase.rpc('record_tuckshop_purchase', {
      p_student_id: selectedStudent.student_id,
      p_items: payload,
      p_created_by: userData?.user?.id,
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus(`Purchase recorded — ${naira(cartTotal)}`);
      setCart({});
      await refreshBalance(selectedStudent.student_id);
      const { data } = await supabase
        .from('tuckshop_purchases')
        .select('id, purchase_date, total_amount')
        .eq('student_id', selectedStudent.student_id)
        .order('purchase_date', { ascending: false })
        .limit(10);
      setHistory(data ?? []);
    }
    setSubmitting(false);
  }

  return (
    <div>
      <h1>Tuckshop Purchase</h1>

      <div className="card" style={{ position: 'relative' }}>
        <input
          value={studentQuery}
          onChange={(e) => { setStudentQuery(e.target.value); setSelectedStudent(null); }}
          placeholder="Search student name"
          style={{ width: '100%' }}
        />
        {studentResults.length > 0 && (
          <div className="card" style={{ position: 'absolute', zIndex: 10, width: '100%' }}>
            {studentResults.map((s) => (
              <div key={s.student_id} onClick={() => selectStudent(s)} style={{ padding: '0.4rem', cursor: 'pointer' }}>
                {s.first_name} {s.last_name} — Year {s.year_group} {s.form_class}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedStudent && (
        <>
          <div className="card">
            <strong>{selectedStudent.first_name} {selectedStudent.last_name}</strong>
            <div style={{ marginTop: '0.3rem' }}>
              Current balance:{' '}
              <span style={{ fontWeight: 700, color: balance < 0 ? '#a3232c' : '#1a7a3d' }}>
                {balance === null ? '…' : naira(balance)}
              </span>
              {balance < 0 && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: '#a3232c' }}>(owing — will settle later)</span>}
            </div>
          </div>

          <div className="card">
            <strong>Items</strong>
            <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
              <table>
                <thead><tr><th>Item</th><th>Price</th><th>Qty</th></tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{naira(item.price)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={cart[item.id] || ''}
                          onChange={(e) => setQty(item.id, e.target.value)}
                          style={{ width: '5rem' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: '0.5rem', fontWeight: 700 }}>Total: {naira(cartTotal)}</div>
            <button onClick={submitPurchase} disabled={submitting || cartTotal === 0} style={{ marginTop: '0.5rem' }}>
              {submitting ? 'Recording…' : 'Record purchase'}
            </button>
            {status && <p>{status}</p>}
          </div>

          {history.length > 0 && (
            <div className="card">
              <strong>Recent purchases</strong>
              <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
                <table>
                  <thead><tr><th>Date</th><th>Amount</th></tr></thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}><td>{h.purchase_date}</td><td>{naira(h.total_amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function TuckshopPurchasePage() {
  return (
    <RequireAuth>
      <TuckshopPurchaseInner />
    </RequireAuth>
  );
}
