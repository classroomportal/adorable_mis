'use client';

// Reward Orders (migration 370; on the Rewards card since migration 371). Students spend merit points on
// rewards from their portal; the points are held as soon as they buy. Here the
// reward's approvers (set per reward on /rewards/items: mufti — pastoral and
// head of boarding; tuckshop visit — tuckshop; assistant for a day — SMT;
// admins for any) approve or decline, cancel an approved one if the day falls
// through, and mark it used once it has happened. Declined and cancelled
// requests give the points back. Every check is in the database
// (decide_reward(), cancel_reward(), mark_reward_used()); the buttons shown
// here only follow the same rule.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { schoolToday } from '../../lib/schoolTime';
import { formatUKDate } from '../../lib/formatDate';
import { REWARD_STATUS_STAFF, rewardDay } from '../../lib/rewards';

const soft = { fontSize: '0.85em', color: 'var(--ink-soft)' };

const VIEWS = {
  todo: { label: 'To do', statuses: ['requested', 'approved'] },
  requested: { label: 'Waiting to be accepted', statuses: ['requested'] },
  approved: { label: 'Accepted', statuses: ['approved'] },
  done: { label: 'Used', statuses: ['used'] },
  closed: { label: 'Declined or cancelled', statuses: ['declined', 'cancelled'] },
  all: { label: 'Everything', statuses: null },
};

function personName(p) {
  return p ? `${p.first_name} ${p.last_name}` : '';
}

function RewardsInner() {
  const { profile, staffRoles } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [staff, setStaff] = useState([]);
  const [view, setView] = useState('todo');
  const [itemFilter, setItemFilter] = useState('');
  const [mineOnly, setMineOnly] = useState(true);
  const [dayList, setDayList] = useState(schoolToday());
  const [approving, setApproving] = useState(null); // purchase_id needing a member of staff
  const [chosenStaff, setChosenStaff] = useState('');
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [{ data, error }, { data: it }, { data: st }] = await Promise.all([
      supabase
        .from('reward_purchases')
        .select('*, students(first_name, last_name, preferred_name, year_group), reward_items(name, icon, approver_roles, needs_staff), assigned:staff!reward_purchases_assigned_staff_id_fkey(first_name, last_name), decider:staff!reward_purchases_decided_by_fkey(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase.from('reward_items').select('item_id, name, icon, approver_roles').order('position'),
      supabase.from('staff').select('staff_id, first_name, last_name, staff_code').order('last_name'),
    ]);
    if (error) setStatus(`Error: ${error.message}`);
    setRows(data || []);
    setItems(it || []);
    setStaff(st || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // The same rule as can_decide_reward(): one of the reward's approver roles,
  // or admin. (The database also refuses a request for the decider's own child.)
  function canDecide(item) {
    if (isAdmin) return true;
    return (item?.approver_roles || []).some((r) => staffRoles.includes(r));
  }

  const mineExists = items.some((i) => canDecide(i));

  const shown = useMemo(() => {
    const statuses = VIEWS[view].statuses;
    return rows.filter((r) => (!statuses || statuses.includes(r.status))
      && (!itemFilter || String(r.item_id) === itemFilter)
      && (!mineOnly || !mineExists || canDecide(r.reward_items)));
  }, [rows, view, itemFilter, mineOnly, mineExists, staffRoles, isAdmin]);

  const forDay = rows.filter((r) => r.for_date === dayList && ['approved', 'used'].includes(r.status));
  const forDayByItem = items
    .map((i) => ({ item: i, list: forDay.filter((r) => r.item_id === i.item_id) }))
    .filter((g) => g.list.length > 0);

  async function run(purchaseId, rpc, args, done) {
    setBusy(purchaseId);
    setStatus(null);
    const { error } = await supabase.rpc(rpc, args);
    setBusy(null);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setStatus(done);
    setApproving(null);
    setChosenStaff('');
    load();
  }

  function approve(r) {
    if (r.reward_items?.needs_staff) {
      setApproving(r.purchase_id);
      setChosenStaff('');
      return;
    }
    run(r.purchase_id, 'decide_reward', { p_purchase_id: r.purchase_id, p_approve: true }, 'Accepted. The student has been told.');
  }

  function approveWithStaff(r) {
    if (!chosenStaff) { setStatus('Choose the member of staff the student will help.'); return; }
    run(r.purchase_id, 'decide_reward', { p_purchase_id: r.purchase_id, p_approve: true, p_staff_id: Number(chosenStaff) },
      'Accepted. The student and the member of staff have been told.');
  }

  function decline(r) {
    const reason = window.prompt(`Decline ${r.reward_items?.name} for ${personName(r.students)}? Their ${r.cost} points come back.\n\nReason (the student sees this):`);
    if (reason == null) return;
    run(r.purchase_id, 'decide_reward', { p_purchase_id: r.purchase_id, p_approve: false, p_reason: reason }, 'Declined. The points are back and the student has been told.');
  }

  function cancel(r) {
    const reason = window.prompt(`Cancel ${r.reward_items?.name} for ${personName(r.students)}? Their ${r.cost} points come back.\n\nReason (the student sees this):`);
    if (reason == null) return;
    run(r.purchase_id, 'cancel_reward', { p_purchase_id: r.purchase_id, p_reason: reason }, 'Cancelled. The points are back and the student has been told.');
  }

  function markUsed(r) {
    run(r.purchase_id, 'mark_reward_used', { p_purchase_id: r.purchase_id }, 'Marked as used.');
  }

  const today = schoolToday();

  return (
    <div>
      <div className="no-print">
        <h1>Reward Orders</h1>
        <p style={soft}>
          Students spend merit points here; their merit total for certificates and reports doesn't change.
          Points are held when a student orders and come back if the order is declined or cancelled.
          Rewards, prices and who approves each one are on <a href="/rewards/items">Rewards &amp; Prices</a>.
        </p>

        <div className="card">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
            <label style={{ flex: 'none' }}>
              Show
              <select value={view} onChange={(e) => setView(e.target.value)}>
                {Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label style={{ flex: 'none' }}>
              Reward
              <select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
                <option value="">All rewards</option>
                {items.map((i) => <option key={i.item_id} value={i.item_id}>{i.icon} {i.name}</option>)}
              </select>
            </label>
            {mineExists && (
              <label style={{ flex: 'none', flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                Only rewards I accept
              </label>
            )}
          </div>

          {status && <p>{status}</p>}

          {loading ? <p>Loading…</p> : shown.length === 0 ? (
            <p style={{ marginTop: '0.75rem' }}>Nothing here.</p>
          ) : (
            <div className="table-scroll" style={{ marginTop: '0.75rem' }}><table>
              <thead><tr><th>Student</th><th>Reward</th><th>Day</th><th>Points</th><th>Bought</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const mine = canDecide(r.reward_items);
                  const isBusy = busy === r.purchase_id;
                  return (
                    <tr key={r.purchase_id}>
                      <td>
                        <a href={`/students/${r.student_id}`}>{personName(r.students)}</a>
                        <div style={soft}>Year {r.students?.year_group}</div>
                      </td>
                      <td>{r.reward_items?.icon} {r.reward_items?.name}</td>
                      <td>{r.for_date ? rewardDay(r.for_date) : '—'}</td>
                      <td>{r.cost}</td>
                      <td>{formatUKDate(r.created_at.slice(0, 10))}</td>
                      <td>
                        {REWARD_STATUS_STAFF[r.status]}
                        {r.assigned && <div style={soft}>Helping {personName(r.assigned)}</div>}
                        {r.decider && r.status !== 'requested' && <div style={soft}>By {personName(r.decider)}</div>}
                        {r.decline_reason && <div style={soft}>{r.decline_reason}</div>}
                      </td>
                      <td>
                        {!mine ? null : approving === r.purchase_id ? (
                          <div className="appeal-form">
                            <label>
                              Helping
                              <select value={chosenStaff} onChange={(e) => setChosenStaff(e.target.value)}>
                                <option value="">Choose…</option>
                                {staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.first_name} {s.last_name}{s.staff_code ? ` (${s.staff_code})` : ''}</option>)}
                              </select>
                            </label>
                            <div className="appeal-form-buttons">
                              <button onClick={() => approveWithStaff(r)} disabled={isBusy}>Accept</button>
                              <button className="secondary" onClick={() => setApproving(null)}>Back</button>
                            </div>
                          </div>
                        ) : r.status === 'requested' ? (
                          <div className="appeal-form-buttons">
                            <button onClick={() => approve(r)} disabled={isBusy}>Accept</button>
                            <button className="secondary" onClick={() => decline(r)} disabled={isBusy}>Decline</button>
                          </div>
                        ) : r.status === 'approved' ? (
                          <div className="appeal-form-buttons">
                            {(!r.for_date || r.for_date <= today) && (
                              <button onClick={() => markUsed(r)} disabled={isBusy}>Mark used</button>
                            )}
                            <button className="secondary" onClick={() => cancel(r)} disabled={isBusy}>Cancel</button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <h2 style={{ margin: 0, flex: '1 1 auto' }}>Day list</h2>
          <label style={{ flex: 'none' }}>
            Day
            <input type="date" value={dayList} onChange={(e) => setDayList(e.target.value)} />
          </label>
          <button onClick={() => window.print()} disabled={forDay.length === 0}>Print</button>
        </div>
        <h2 className="print-only">Rewards on {rewardDay(dayList)}</h2>
        <p className="no-print" style={soft}>Approved rewards on {rewardDay(dayList)}, e.g. who is in mufti, for mentors and duty staff.</p>
        {forDayByItem.length === 0 ? <p>No approved rewards on that day.</p> : forDayByItem.map(({ item, list }) => (
          <div key={item.item_id} style={{ marginTop: '0.75rem' }}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{item.icon} {item.name}: {list.length} student{list.length === 1 ? '' : 's'}</h3>
            <div className="table-scroll"><table>
              <thead><tr><th>Student</th><th>Year</th>{list.some((x) => x.assigned) && <th>Helping</th>}</tr></thead>
              <tbody>
                {[...list].sort((a, b) => (a.students?.year_group - b.students?.year_group) || personName(a.students).localeCompare(personName(b.students))).map((r) => (
                  <tr key={r.purchase_id}>
                    <td>{personName(r.students)}</td>
                    <td>{r.students?.year_group}</td>
                    {list.some((x) => x.assigned) && <td>{personName(r.assigned)}</td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RewardsPage() {
  return <RequireAuth><RequireResource resourceKey="/rewards"><RewardsInner /></RequireResource></RequireAuth>;
}
