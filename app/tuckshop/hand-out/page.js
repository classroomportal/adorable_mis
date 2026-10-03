'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { canHandOut } from '../../../lib/tuckshopHandout';

// Handing out tuckshop orders at the counter, one restaurant at a time: tap
// a student when their order has been given. That charges their balance,
// exactly as "Fulfil" on /tuckshop/preorders does, and a given order can be
// undone if it was tapped by mistake. Both go through
// set_tuckshop_orders_given() (migration 228). When a restaurant is done,
// Save locks its list for the day; after that only the tuckshop owner can
// unlock it (migration 229). The database enforces the lock, not this page.
// When some items aren't available, Edit gives part of an order and charges
// only what was handed over (give_tuckshop_order_edited(), migration 233);
// the order itself keeps what the student asked for.

function naira(n) {
  return `₦${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function restaurantLabel(r) {
  if (!r) return 'No restaurant set';
  return /^\d+$/.test(r) ? `Restaurant ${r}` : r;
}

function HandOutInner() {
  const [dates, setDates] = useState([]);
  const [forDate, setForDate] = useState('');
  const [orders, setOrders] = useState([]);
  const [restaurant, setRestaurant] = useState(null);
  const [search, setSearch] = useState('');
  const [hideGiven, setHideGiven] = useState(false);
  const [busy, setBusy] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saves, setSaves] = useState(new Map());
  const [isOwner, setIsOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  // The order being edited: { studentId, qty: Map(itemId -> quantity given) }.
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    loadDates();
    supabase.rpc('is_tuckshop_owner').then(({ data }) => setIsOwner(!!data));
  }, []);
  useEffect(() => { if (forDate) loadOrders(forDate); }, [forDate]);

  async function loadDates() {
    const { data, error: err } = await supabase
      .from('tuckshop_preorders')
      .select('for_date')
      .neq('status', 'cancelled')
      .order('for_date', { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    const list = [...new Set((data || []).map((r) => r.for_date))];
    setDates(list);
    // Today if there are orders for today, otherwise the most recent day
    // that has already come, otherwise the next one.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    setForDate(list.find((d) => d <= today) || list[list.length - 1] || '');
    if (list.length === 0) setLoading(false);
  }

  async function loadOrders(date) {
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from('tuckshop_preorders')
      .select('id, status, student_id, purchase_id, students(first_name, last_name, form_class, year_group, restaurant)')
      .eq('for_date', date)
      .neq('status', 'cancelled');
    if (err) { setError(err.message); setLoading(false); return; }
    const ids = (rows || []).map((o) => o.id);
    let items = [];
    if (ids.length > 0) {
      const { data, error: itemErr } = await supabase
        .from('tuckshop_preorder_items')
        .select('preorder_id, quantity, tuckshop_item_id, tuckshop_items(name, price)')
        .in('preorder_id', ids);
      if (itemErr) { setError(itemErr.message); setLoading(false); return; }
      items = data || [];
    }
    const itemsByOrder = new Map();
    items.forEach((it) => {
      if (!itemsByOrder.has(it.preorder_id)) itemsByOrder.set(it.preorder_id, []);
      itemsByOrder.get(it.preorder_id).push(it);
    });
    // What was actually handed over (and charged) for given orders, which
    // is less than the order when some items weren't available.
    const purchaseIds = (rows || []).map((o) => o.purchase_id).filter(Boolean);
    let bought = [];
    if (purchaseIds.length > 0) {
      const { data, error: buyErr } = await supabase
        .from('tuckshop_purchase_items')
        .select('purchase_id, tuckshop_item_id, quantity, line_total')
        .in('purchase_id', purchaseIds);
      if (buyErr) { setError(buyErr.message); setLoading(false); return; }
      bought = data || [];
    }
    const boughtByPurchase = new Map();
    bought.forEach((b) => {
      if (!boughtByPurchase.has(b.purchase_id)) boughtByPurchase.set(b.purchase_id, []);
      boughtByPurchase.get(b.purchase_id).push(b);
    });
    setOrders((rows || []).map((o) => ({
      ...o,
      items: itemsByOrder.get(o.id) || [],
      bought: boughtByPurchase.get(o.purchase_id) || [],
    })));
    // Saved (locked) restaurant lists for this day.
    const { data: saveRows, error: saveErr } = await supabase
      .from('tuckshop_handout_saves')
      .select('restaurant, saved_at, given_count, not_given_count, given_value')
      .eq('for_date', date)
      .is('unlocked_at', null);
    if (saveErr) setError(saveErr.message);
    setSaves(new Map((saveRows || []).map((r) => [r.restaurant, r])));
    setLoading(false);
  }

  // One entry per student (a student can have more than one order for a
  // day, e.g. one already given and one added afterwards by staff).
  const students = useMemo(() => {
    const byStudent = new Map();
    orders.forEach((o) => {
      if (!byStudent.has(o.student_id)) {
        byStudent.set(o.student_id, {
          studentId: o.student_id, student: o.students, lines: new Map(), pending: 0, given: 0, charged: 0,
        });
      }
      const s = byStudent.get(o.student_id);
      if (o.status === 'fulfilled') s.given += 1; else s.pending += 1;
      o.items.forEach((it) => {
        const cur = s.lines.get(it.tuckshop_item_id) || {
          itemId: it.tuckshop_item_id,
          name: it.tuckshop_items?.name || 'Unknown item',
          price: Number(it.tuckshop_items?.price || 0),
          qty: 0,
          givenQty: 0,
        };
        cur.qty += it.quantity;
        s.lines.set(it.tuckshop_item_id, cur);
      });
      o.bought.forEach((b) => {
        s.charged += Number(b.line_total || 0);
        const cur = s.lines.get(b.tuckshop_item_id);
        if (cur) cur.givenQty += b.quantity;
      });
    });
    return [...byStudent.values()]
      .map((s) => {
        const lines = [...s.lines.values()].sort((a, b) => a.name.localeCompare(b.name));
        const done = s.pending === 0;
        const ordered = lines.reduce((n, l) => n + l.qty * l.price, 0);
        return {
          ...s,
          lines,
          ordered,
          // A given order shows what was charged; otherwise what it will cost.
          total: done ? s.charged : ordered,
          // Given, but not everything the student ordered.
          short: done && lines.some((l) => l.givenQty < l.qty),
          done,
          restaurant: s.student?.restaurant || '',
        };
      })
      .sort((a, b) => `${a.student?.last_name} ${a.student?.first_name}`
        .localeCompare(`${b.student?.last_name} ${b.student?.first_name}`));
  }, [orders]);

  const restaurants = useMemo(() => {
    const byRest = new Map();
    students.forEach((s) => {
      const cur = byRest.get(s.restaurant) || { key: s.restaurant, count: 0, given: 0 };
      cur.count += 1;
      if (s.done) cur.given += 1;
      byRest.set(s.restaurant, cur);
    });
    return [...byRest.values()].sort((a, b) => {
      if (!a.key) return 1;
      if (!b.key) return -1;
      return a.key.localeCompare(b.key, undefined, { numeric: true });
    });
  }, [students]);

  // Keep the chosen restaurant if it's still on the list, else the first.
  useEffect(() => {
    if (restaurants.length === 0) return;
    if (restaurant === null || !restaurants.some((r) => r.key === restaurant)) {
      setRestaurant(restaurants[0].key);
    }
  }, [restaurants, restaurant]);

  const inRestaurant = students.filter((s) => s.restaurant === restaurant);
  const q = search.trim().toLowerCase();
  const shown = inRestaurant.filter((s) => {
    if (hideGiven && s.done) return false;
    if (!q) return true;
    return `${s.student?.first_name} ${s.student?.last_name} ${s.student?.form_class || ''}`.toLowerCase().includes(q);
  });
  const outstanding = inRestaurant.filter((s) => !s.done);
  const saved = saves.get(restaurant ?? '');

  async function setGiven(studentIds, given) {
    if (studentIds.length === 0) return;
    setError(null);
    setBusy((b) => new Set([...b, ...studentIds]));
    const { error: err } = await supabase.rpc('set_tuckshop_orders_given', {
      p_student_ids: studentIds, p_for_date: forDate, p_given: given,
    });
    if (err) setError(err.message);
    await loadOrders(forDate);
    setBusy((b) => { const n = new Set(b); studentIds.forEach((id) => n.delete(id)); return n; });
  }

  function tap(s) {
    if (busy.has(s.studentId) || saved) return;
    if (!s.done) { setGiven([s.studentId], true); return; }
    const name = `${s.student?.first_name} ${s.student?.last_name}`;
    if (window.confirm(`Undo ${name}'s order? It goes back to not given and ${naira(s.total)} is put back on their balance.`)) {
      setGiven([s.studentId], false);
    }
  }

  function giveAll() {
    const value = outstanding.reduce((n, s) => n + s.total, 0);
    if (window.confirm(
      `Mark all ${outstanding.length} remaining order${outstanding.length === 1 ? '' : 's'} in ${restaurantLabel(restaurant)} as given? `
      + `${naira(value)} will be taken from their balances.`,
    )) {
      setGiven(outstanding.map((s) => s.studentId), true);
    }
  }

  function startEdit(s) {
    if (busy.has(s.studentId) || saved) return;
    setEditing({
      studentId: s.studentId,
      qty: new Map(s.lines.map((l) => [l.itemId, s.done ? l.givenQty : l.qty])),
    });
  }

  function setEditQty(itemId, qty) {
    setEditing((e) => ({ ...e, qty: new Map(e.qty).set(itemId, qty) }));
  }

  async function giveEdited(s) {
    const items = s.lines.map((l) => ({ item_id: l.itemId, quantity: editing.qty.get(l.itemId) ?? 0 }));
    const value = s.lines.reduce((n, l) => n + (editing.qty.get(l.itemId) ?? 0) * l.price, 0);
    const name = `${s.student?.first_name} ${s.student?.last_name}`;
    const msg = value === 0
      ? `Nothing was available for ${name}? The order is marked given and nothing is charged.`
      : `Give ${name} these items? ${naira(value)} will be taken from their balance`
        + `${s.done ? `, instead of the ${naira(s.total)} charged before` : ''}.`;
    if (!window.confirm(msg)) return;
    setError(null);
    setBusy((b) => new Set([...b, s.studentId]));
    const { error: err } = await supabase.rpc('give_tuckshop_order_edited', {
      p_student_id: s.studentId, p_for_date: forDate, p_items: items,
    });
    if (err) setError(err.message); else setEditing(null);
    await loadOrders(forDate);
    setBusy((b) => { const n = new Set(b); n.delete(s.studentId); return n; });
  }

  async function saveList() {
    const given = inRestaurant.length - outstanding.length;
    const value = inRestaurant.filter((s) => s.done).reduce((n, s) => n + s.total, 0);
    const msg = `Save ${restaurantLabel(restaurant)} for ${longDate(forDate)}?\n\n`
      + `${given} given (${naira(value)}), ${outstanding.length} not given.\n\n`
      + 'Once saved, the list is locked and only the tuckshop owner can unlock it.';
    if (!window.confirm(msg)) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('save_tuckshop_handout', { p_for_date: forDate, p_restaurant: restaurant ?? '' });
    if (err) setError(err.message);
    await loadOrders(forDate);
    setSaving(false);
  }

  async function unlockList() {
    if (!window.confirm(`Unlock ${restaurantLabel(restaurant)} for ${longDate(forDate)}? Tuckshop staff will be able to change it again until it is saved.`)) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('unlock_tuckshop_handout', { p_for_date: forDate, p_restaurant: restaurant ?? '' });
    if (err) setError(err.message);
    await loadOrders(forDate);
    setSaving(false);
  }

  return (
    <div>
      <h1>Hand Out Orders</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Tap a student when their order has been given. This takes the order&apos;s value from their
        tuckshop balance. Tap again to undo. If some items weren&apos;t available, press Edit and
        give only what the student got: they are charged just for that. When a restaurant is
        finished, press Save: the list is then locked and only the tuckshop owner can unlock it.
      </p>

      <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>
          Orders for<br />
          <select value={forDate} onChange={(e) => { setForDate(e.target.value); setRestaurant(null); setEditing(null); }}>
            {dates.map((d) => <option key={d} value={d}>{longDate(d)}</option>)}
          </select>
        </label>
        <label style={{ flex: '1 1 12rem' }}>
          Find a student<br />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or form" style={{ width: '100%' }} />
        </label>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={hideGiven} onChange={(e) => setHideGiven(e.target.checked)} />
          Hide given
        </label>
      </div>

      {error && <p style={{ color: '#a3232c' }}>Error: {error}</p>}

      {loading && orders.length === 0 ? <p>Loading…</p> : students.length === 0 ? (
        <p>No orders for {forDate ? longDate(forDate) : 'this date'}.</p>
      ) : (
        <>
          <div className="handout-restaurants">
            {restaurants.map((r) => (
              <button
                key={r.key || 'none'}
                className={r.key === restaurant ? '' : 'secondary'}
                onClick={() => setRestaurant(r.key)}
              >
                {saves.has(r.key) ? '🔒 ' : ''}{restaurantLabel(r.key)}{' '}
                <span className="handout-count">{r.given}/{r.count}</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', margin: '0.75rem 0' }}>
            <strong>
              {restaurantLabel(restaurant)}: {inRestaurant.length - outstanding.length} of {inRestaurant.length} given
            </strong>
            {!saved && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="secondary" onClick={giveAll} disabled={outstanding.length === 0 || busy.size > 0 || saving}>
                  Mark all {outstanding.length} remaining as given
                </button>
                <button onClick={saveList} disabled={busy.size > 0 || saving}>
                  {saving ? 'Saving…' : 'Save and lock'}
                </button>
              </div>
            )}
          </div>

          {saved && (
            <div className="handout-saved">
              <span>
                🔒 Saved {new Date(saved.saved_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}
                {' '}· {saved.given_count} given ({naira(saved.given_value)}), {saved.not_given_count} not given.
                {' '}{isOwner ? 'You can unlock it as tuckshop owner.' : 'Only the tuckshop owner can unlock it.'}
              </span>
              {isOwner && (
                <button className="secondary" onClick={unlockList} disabled={saving}>
                  {saving ? 'Unlocking…' : 'Unlock'}
                </button>
              )}
            </div>
          )}

          {shown.length === 0 ? (
            <p>{q ? 'No student matches that search here.' : 'Every order here has been given.'}</p>
          ) : (
            <ul className="handout-list">
              {shown.map((s) => (
                <li key={s.studentId} className="handout-item">
                  <div className="handout-line">
                    <button
                      className={`handout-row${s.done ? ' given' : ''}${saved ? ' locked' : ''}`}
                      onClick={() => tap(s)}
                      disabled={busy.has(s.studentId) || !!saved || editing?.studentId === s.studentId}
                    >
                      <span className="handout-tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
                      <span className="handout-main">
                        <span className="handout-name">
                          {s.student?.last_name}, {s.student?.first_name}
                          <span className="handout-form"> {s.student?.form_class || s.student?.year_group || ''}</span>
                        </span>
                        <span className="handout-items">
                          {s.lines.map((l, i) => (
                            <span key={l.itemId}>
                              {i > 0 && ', '}
                              {!s.done || l.givenQty === l.qty ? `${l.qty} × ${l.name}` : l.givenQty === 0 ? (
                                <s className="handout-missing">{l.qty} × {l.name}</s>
                              ) : (
                                <>{l.givenQty} × {l.name} <span className="handout-missing">(ordered {l.qty})</span></>
                              )}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="handout-amount">
                        {naira(s.total)}
                        {s.short && <s className="handout-was">{naira(s.ordered)}</s>}
                        <span className="handout-status">
                          {busy.has(s.studentId) ? 'Saving…'
                            : s.done ? (s.short ? (s.total === 0 ? 'None available' : 'Part given') : 'Given')
                              : s.given > 0 ? 'Part given' : ''}
                        </span>
                      </span>
                    </button>
                    {!saved && editing?.studentId !== s.studentId && (
                      <button
                        className="secondary handout-edit"
                        onClick={() => startEdit(s)}
                        disabled={busy.has(s.studentId)}
                        aria-label={`Edit ${s.student?.first_name} ${s.student?.last_name}'s order`}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {editing?.studentId === s.studentId && !saved && (
                    <div className="handout-editor">
                      <p style={{ margin: '0 0 0.5rem' }}>
                        How many of each item did {s.student?.first_name} get? Set anything that wasn&apos;t available to 0.
                      </p>
                      {s.lines.map((l) => {
                        const q = editing.qty.get(l.itemId) ?? 0;
                        return (
                          <div key={l.itemId} className="handout-edit-line">
                            <span className="handout-edit-name">
                              {l.name}
                              <span className="handout-form"> {naira(l.price)} each · ordered {l.qty}</span>
                            </span>
                            <span className="handout-stepper">
                              <button className="secondary" onClick={() => setEditQty(l.itemId, Math.max(0, q - 1))} disabled={q === 0} aria-label={`One less ${l.name}`}>−</button>
                              <span className={`handout-qty${q < l.qty ? ' short' : ''}`}>{q}</span>
                              <button className="secondary" onClick={() => setEditQty(l.itemId, Math.min(l.qty, q + 1))} disabled={q >= l.qty} aria-label={`One more ${l.name}`}>+</button>
                            </span>
                          </div>
                        );
                      })}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                        <button className="secondary" onClick={() => setEditing(null)} disabled={busy.has(s.studentId)}>Cancel</button>
                        <button onClick={() => giveEdited(s)} disabled={busy.has(s.studentId)}>
                          {busy.has(s.studentId) ? 'Saving…'
                            : `Give these · ${naira(s.lines.reduce((n, l) => n + (editing.qty.get(l.itemId) ?? 0) * l.price, 0))}`}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// Tuckshop staff and the tuckshop owner only. RequireResource alone would
// let every admin in, so the staff roles are checked as well.
function HandOutGate() {
  const { profileLoaded, staffRoles } = useAuth();
  if (!profileLoaded) return <p>Loading...</p>;
  if (!canHandOut(staffRoles)) return <p>Only tuckshop staff and the tuckshop owner can hand out orders.</p>;
  return <HandOutInner />;
}

export default function HandOutPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/tuckshop/hand-out">
      <HandOutGate />
    </RequireResource></RequireAuth>
  );
}
