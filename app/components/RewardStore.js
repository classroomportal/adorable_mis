'use client';

// The Reward Store on a student's portal (migration 370). A student spends
// merit points on rewards; their merit total (certificates, reports) never
// changes. Points are held as soon as they buy, and come back if the request
// is declined or cancelled. Every rule is checked by buy_reward() in the
// database; this only shows the store and the student's requests.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { REWARD_STATUS, limitText, rewardDay } from '../../lib/rewards';
import { formatUKDate } from '../../lib/formatDate';

const note = { margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--ink-soft, #5b6472)' };

export function useRewardPoints(studentId) {
  const [points, setPoints] = useState(null);
  async function reload() {
    const { data } = await supabase.rpc('reward_points');
    setPoints((data || [])[0] || null);
  }
  useEffect(() => { if (studentId) reload(); }, [studentId]);
  return [points, reload];
}

export default function RewardStore({ studentId, points, onPointsChange }) {
  const [items, setItems] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [buying, setBuying] = useState(null); // item being bought
  const [dates, setDates] = useState([]);
  const [day, setDay] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: it, error }, { data: pu }] = await Promise.all([
      supabase.rpc('my_reward_store'),
      supabase
        .from('reward_purchases')
        .select('purchase_id, cost, for_date, status, created_at, decline_reason, reward_items(name, icon), assigned:staff!reward_purchases_assigned_staff_id_fkey(first_name, last_name)')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (error) setStatus(error.message);
    setItems(it || []);
    setPurchases(pu || []);
    setLoading(false);
  }

  useEffect(() => { if (studentId) load(); }, [studentId]);

  async function startBuying(item) {
    setStatus(null);
    setBuying(item);
    setDay('');
    setDates([]);
    if (item.date_rule) {
      const { data } = await supabase.rpc('my_reward_dates', { p_item_id: item.item_id });
      setDates((data || []).map((d) => d.day));
    }
  }

  async function buy() {
    if (!buying || busyRef.current) return;
    if (buying.date_rule && !day) { setStatus('Please choose a day.'); return; }
    const what = `${buying.name}${day ? ` on ${rewardDay(day)}` : ''}`;
    if (!window.confirm(`Spend ${buying.cost} points on ${what}?`)) return;
    busyRef.current = true;
    setBusy(true);
    let error;
    try {
      ({ error } = await supabase.rpc('buy_reward', { p_item_id: buying.item_id, p_for_date: day || null }));
    } catch (err) {
      error = err;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (error) { setStatus(error.message); return; }
    setStatus(`Done: ${what}. A member of staff will approve it, and you'll get a message in your inbox.`);
    setBuying(null);
    await Promise.all([load(), onPointsChange?.()]);
  }

  async function cancel(p) {
    if (!window.confirm(`Cancel ${p.reward_items?.name}? Your ${p.cost} points come back.`)) return;
    const { error } = await supabase.rpc('cancel_reward', { p_purchase_id: p.purchase_id });
    if (error) { setStatus(error.message); return; }
    setStatus('Cancelled. Your points are back.');
    await Promise.all([load(), onPointsChange?.()]);
  }

  const balance = points?.balance ?? 0;

  return (
    <div>
      <div className="reward-points">
        <div>
          <div className="reward-points-number">{balance}</div>
          <div>points to spend</div>
        </div>
        <p style={note}>
          Your merit total this year is {points?.merit_total ?? 0}, and spending doesn't change it:
          certificates and reports still count every merit. Points come back if a request is declined or cancelled.
        </p>
      </div>

      {status && <p className="reward-status">{status}</p>}

      {loading ? <p>Loading…</p> : items.length === 0 ? (
        <p>There are no rewards in the store at the moment.</p>
      ) : (
        <div className="reward-grid">
          {items.map((item) => {
            const open = buying?.item_id === item.item_id;
            const limit = limitText(item);
            return (
              <div key={item.item_id} className={`reward-card${item.problem ? ' reward-card-off' : ''}`}>
                <div className="reward-card-head">
                  <span className="reward-icon" aria-hidden="true">{item.icon || '🎁'}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <div className="reward-cost">{item.cost} points</div>
                  </div>
                </div>
                {item.description && <p style={note}>{item.description}</p>}
                {limit && <p style={note}>{limit}.</p>}
                {item.problem ? (
                  <p className="reward-problem">{item.problem}</p>
                ) : open ? (
                  <div className="reward-buy">
                    {item.date_rule && (
                      <label>
                        Which day?
                        <select value={day} onChange={(e) => setDay(e.target.value)}>
                          <option value="">Choose a day</option>
                          {dates.map((d) => <option key={d} value={d}>{rewardDay(d)}</option>)}
                        </select>
                      </label>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button onClick={buy} disabled={busy}>{busy ? 'Buying…' : `Spend ${item.cost} points`}</button>
                      <button className="secondary" onClick={() => setBuying(null)}>Back</button>
                    </div>
                  </div>
                ) : (
                  <button style={{ marginTop: '0.5rem' }} onClick={() => startBuying(item)} disabled={balance < item.cost}>Buy</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {purchases.length > 0 && (
        <>
          <h3 style={{ margin: '1.25rem 0 0.25rem', fontSize: '1rem' }}>My rewards</h3>
          <div className="table-scroll"><table>
            <thead><tr><th>Bought</th><th>Reward</th><th>Day</th><th>Points</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.purchase_id}>
                  <td>{formatUKDate(p.created_at.slice(0, 10))}</td>
                  <td>{p.reward_items?.icon} {p.reward_items?.name}</td>
                  <td>{p.for_date ? rewardDay(p.for_date) : '—'}</td>
                  <td>{['declined', 'cancelled'].includes(p.status) ? <s>{p.cost}</s> : p.cost}</td>
                  <td>
                    {REWARD_STATUS[p.status]}
                    {p.status === 'approved' && p.assigned && <div style={note}>Helping {p.assigned.first_name} {p.assigned.last_name}</div>}
                    {p.decline_reason && <div style={note}>{p.decline_reason}</div>}
                  </td>
                  <td>{p.status === 'requested' && <button className="secondary" onClick={() => cancel(p)}>Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}
