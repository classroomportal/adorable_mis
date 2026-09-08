'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import TranscriptDownload from '../components/TranscriptDownload';

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

function PortalInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;
  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [gradePoints, setGradePoints] = useState({});
  const [appealForm, setAppealForm] = useState(null); // event_id being appealed
  const [appealReason, setAppealReason] = useState('');
  const [status, setStatus] = useState(null);

  const [tuckshopBalance, setTuckshopBalance] = useState(null);
  const [tuckshopHistory, setTuckshopHistory] = useState([]);
  const [tuckshopItems, setTuckshopItems] = useState([]);
  const [preorderCart, setPreorderCart] = useState({});
  const [preorderStatus, setPreorderStatus] = useState(null);
  const [myPreorders, setMyPreorders] = useState([]);

  async function load() {
    if (!studentId) return;
    const { data: r } = await supabase.from('results').select('*, subjects(subject_name, display_name)').eq('student_id', studentId).order('week_start_date', { ascending: false });
    setResults(r || []);
    const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', studentId);
    setTargets(tg || []);
    const { data: gs } = await supabase.from('grade_scale').select('*');
    setGradePoints(Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)])));
    const { data: b } = await supabase.from('behaviour_events').select('*').eq('student_id', studentId).order('event_date', { ascending: false });
    setBehaviour(b || []);
    const { data: ap } = await supabase.from('behaviour_appeals').select('*').eq('student_id', studentId);
    setAppeals(ap || []);

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

  useEffect(() => { load(); }, [studentId]);

  function appealFor(eventId) {
    const existing = appeals.find((a) => a.event_id === eventId);
    return existing;
  }

  async function submitAppeal(eventId) {
    if (!appealReason.trim()) { setStatus('Please explain why you are appealing.'); return; }
    const { error } = await supabase.from('behaviour_appeals').insert({
      event_id: eventId, student_id: studentId, reason: appealReason.trim(),
    });
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus('Appeal submitted — your pastoral manager will review it.'); setAppealForm(null); setAppealReason(''); load(); }
  }

  if (!studentId) {
    return <p>Your account isn't linked to a student record yet — ask the school office to link it.</p>;
  }

  const STATUS_LABEL = { pending: 'Pending review', upheld: 'Appeal upheld', rejected: 'Appeal rejected' };

  return (
    <div>
      <h1>My Grades & Behaviour</h1>
      <p><a href="/inbox">📬 Inbox</a></p>
      <TranscriptDownload studentId={studentId} />

      <div className="card">
        <h2>Results vs Target</h2>
        {targets.length === 0 ? <p>No target grades set yet.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Subject</th><th>Target</th><th>Most recent grade</th></tr></thead>
            <tbody>
              {targets.map((t) => {
                const latest = results.find((r) => r.subject_id === t.subject_id);
                return (
                  <tr key={t.subject_id}>
                    <td>{t.subjects?.display_name || t.subjects?.subject_name}</td>
                    <td>{t.target_grade}</td>
                    <td>{latest?.grade ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Behaviour</h2>
        {behaviour.length === 0 ? <p>No events logged.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th><th></th></tr></thead>
            <tbody>
              {behaviour.map((b) => {
                const existingAppeal = appealFor(b.event_id);
                return (
                  <tr key={b.event_id}>
                    <td>{b.event_date}</td>
                    <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                    <td>{b.category}</td>
                    <td>{b.points}</td>
                    <td>
                      {b.type !== 'negative' ? '' : existingAppeal ? (
                        <span style={{ fontSize: '0.85rem' }}>{STATUS_LABEL[existingAppeal.status]}</span>
                      ) : appealForm === b.event_id ? (
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            placeholder="Why are you appealing?"
                            value={appealReason}
                            onChange={(e) => setAppealReason(e.target.value)}
                            style={{ width: '12rem' }}
                          />
                          <button onClick={() => submitAppeal(b.event_id)}>Submit</button>
                          <button className="secondary" onClick={() => { setAppealForm(null); setAppealReason(''); }}>Cancel</button>
                        </div>
                      ) : (
                        <button className="secondary" onClick={() => setAppealForm(b.event_id)}>Appeal</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {status && <p>{status}</p>}
      </div>

      <div className="card">
        <h2>Tuckshop</h2>
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

export default function PortalPage() {
  return <RequireAuth><PortalInner /></RequireAuth>;
}
