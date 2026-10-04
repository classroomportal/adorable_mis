'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import TuckshopPurchases from '../../components/TuckshopPurchases';
import { closingWarning, loadSpecialSessions, longDate, momentLabel } from '../../../lib/tuckshopSchedule';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

// Limits per tuckshop day, enforced in save_tuckshop_order() (migrations
// 186-187): at most 2 of any one item, and at most 2 snacks and drinks
// (tuckshop_items.is_food) in total. A special session sets its own,
// including a limit on everything else (migration 242).
const NORMAL_LIMITS = { perItem: 2, food: 2, other: null };

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function sameBasket(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] || 0) === (b[k] || 0));
}

// One tuckshop day whose ordering window is open: the student's basket for
// it, which they can place, change or cancel until closesAt.
function OrderEditor({ studentId, forDate, closesAt, items, savedLines, onSaved, sessionName, limits = NORMAL_LIMITS }) {
  const saved = {};
  const names = {};
  savedLines.forEach((l) => {
    saved[l.tuckshop_item_id] = (saved[l.tuckshop_item_id] || 0) + l.quantity;
    names[l.tuckshop_item_id] = l.tuckshop_items?.name;
  });
  const onSale = new Set(items.map((i) => i.id));
  const savedKey = JSON.stringify(saved);

  const [basket, setBasket] = useState({});
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  // Start from what's saved, minus anything no longer on sale.
  useEffect(() => {
    const start = {};
    Object.entries(saved).forEach(([id, q]) => { if (onSale.has(Number(id))) start[id] = q; });
    setBasket(start);
  }, [savedKey, items.length]);

  const noLongerSold = Object.keys(saved).filter((id) => !onSale.has(Number(id))).map((id) => names[id] || 'An item');
  const hasOrder = Object.keys(saved).length > 0;
  const dirty = !sameBasket(basket, saved);
  const foodIds = new Set(items.filter((i) => i.is_food).map((i) => i.id));
  function inBasket(exceptId, food) {
    return Object.entries(basket)
      .filter(([id]) => Number(id) !== exceptId && foodIds.has(Number(id)) === food)
      .reduce((n, [, q]) => n + q, 0);
  }
  const total = items.reduce((s, i) => s + (basket[i.id] || 0) * Number(i.price), 0);
  const day = longDate(forDate);
  const weekday = new Date(`${forDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
  const closes = momentLabel(closesAt);

  function setQty(itemId, qty) {
    setBasket((prev) => {
      const next = { ...prev };
      if (Number(qty) <= 0) delete next[itemId];
      else next[itemId] = Number(qty);
      return next;
    });
  }

  async function save(lines, doneMessage) {
    setSaving(true);
    setStatus(null);
    const payload = Object.entries(lines).map(([itemId, qty]) => ({ item_id: Number(itemId), quantity: qty }));
    const { error } = await supabase.rpc('save_tuckshop_order', {
      p_student_id: studentId,
      p_for_date: forDate,
      p_items: payload,
    });
    setSaving(false);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setStatus(doneMessage);
    onSaved();
  }

  function cancelOrder() {
    if (!window.confirm(`Cancel your tuckshop order for ${day}?`)) return;
    save({}, `Your order for ${day} is cancelled.`);
  }

  return (
    <div style={{ marginBottom: '1.25rem', border: '2px solid #1f3b73', borderRadius: 6, padding: '0.75rem' }}>
      <div style={{ background: '#1f3b73', color: '#fff', margin: '-0.75rem -0.75rem 0.75rem', padding: '0.5rem 0.75rem', borderRadius: '4px 4px 0 0' }}>
        <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {sessionName || 'Tuckshop order'}
        </div>
        <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>For {day}</div>
      </div>
      <p style={{ marginTop: 0 }}>
        Everything you choose in this box is handed out on <strong>{day}</strong>.
        {sessionName && ' This is a special pre-order: only the items below are on sale.'}
      </p>
      <p style={{ color: '#555' }}>
        Ordering closes at <strong>{closes}</strong>. Until then you can change or cancel your order.
        You can order up to {limits.perItem} of each item, and no more than{' '}
        {plural(limits.food, 'snack or drink', 'snacks and drinks')} in total
        {limits.other != null && <>, and no more than {plural(limits.other, 'other item', 'other items')}</>}.
      </p>
      {noLongerSold.length > 0 && (
        <p className="badge badge-negative" style={{ display: 'inline-block' }}>
          {noLongerSold.join(', ')} {noLongerSold.length === 1 ? 'is' : 'are'} no longer sold and will
          be taken off your order when you save.
        </p>
      )}
      <div className="table-scroll">
        <table style={{ minWidth: 0 }}>
          <thead><tr><th>Item</th><th style={{ width: '6rem' }}>Qty</th></tr></thead>
          <tbody>
            {items.map((item) => {
              let left = limits.perItem;
              if (item.is_food) left = Math.min(left, Math.max(0, limits.food - inBasket(item.id, true)));
              else if (limits.other != null) left = Math.min(left, Math.max(0, limits.other - inBasket(item.id, false)));
              return (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    <div style={{ color: '#555', fontSize: '0.85rem' }}>{naira(item.price)}</div>
                  </td>
                  <td>
                    {left === 0 ? (
                      <span style={{ color: '#555' }}>Limit reached</span>
                    ) : (
                      <select value={basket[item.id] || 0} onChange={(e) => setQty(item.id, e.target.value)}>
                        {Array.from({ length: left + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontWeight: 700 }}>Total: {naira(total)}</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {hasOrder ? (
          <>
            <button
              onClick={() => save(basket, `Your order for ${day} is updated.`)}
              disabled={saving || !dirty || Object.keys(basket).length === 0}
            >
              {saving ? 'Saving…' : `Save ${weekday} order`}
            </button>
            <button className="secondary" onClick={cancelOrder} disabled={saving}>Cancel {weekday} order</button>
            {dirty && Object.keys(basket).length > 0 && (
              <span style={{ color: '#a3232c' }}>You have changes that aren&apos;t saved yet.</span>
            )}
            {Object.keys(basket).length === 0 && (
              <span style={{ color: '#555' }}>To remove everything, use Cancel order.</span>
            )}
          </>
        ) : (
          <button
            onClick={() => save(basket, `Order placed for ${day}. You can change or cancel it until ${closes}.`)}
            disabled={saving || Object.keys(basket).length === 0}
          >
            {saving ? 'Placing…' : `Place order for ${weekday}`}
          </button>
        )}
      </div>
      {status && <p>{status}</p>}
    </div>
  );
}

function TuckshopInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;

  const [tuckshopBalance, setTuckshopBalance] = useState(null);
  const [tuckshopItems, setTuckshopItems] = useState([]);
  const [specials, setSpecials] = useState([]);
  const [specialItems, setSpecialItems] = useState([]);
  const [closedUntil, setClosedUntil] = useState(null);
  const [windows, setWindows] = useState(null);
  const [myOrders, setMyOrders] = useState([]);
  const [, setTick] = useState(0);

  async function load() {
    if (!studentId) return;
    const { data: bal } = await supabase.rpc('get_tuckshop_balance', { p_student_id: studentId });
    setTuckshopBalance(bal);
    const { data: items } = await supabase
      .from('tuckshop_items')
      .select('id, name, price, is_food')
      .eq('active', true)
      .order('name');
    setTuckshopItems(items || []);
    // Special pre-order sessions (migration 241) sell only their own list,
    // which may include items switched off for normal ordering.
    const special = await loadSpecialSessions(supabase);
    setSpecials(special);
    const specialIds = [...new Set(special.flatMap((sp) => sp.itemIds))];
    if (specialIds.length > 0) {
      const { data: si } = await supabase
        .from('tuckshop_items')
        .select('id, name, price, is_food')
        .in('id', specialIds)
        .order('name');
      setSpecialItems(si || []);
    } else {
      setSpecialItems([]);
    }
    // Manual closure (holidays etc.) on top of the weekly schedule.
    const { data: settings } = await supabase
      .from('system_settings')
      .select('tuckshop_ordering_closed_until')
      .maybeSingle();
    const until = settings?.tuckshop_ordering_closed_until || null;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    setClosedUntil(until && today < until ? until : null);
    // Ordering windows come from the database (tuckshop_order_schedule), so
    // they don't depend on the phone's clock.
    const { data: w } = await supabase.rpc('tuckshop_order_windows', { p_days: 14 });
    setWindows(w || []);
    const { data: orders } = await supabase
      .from('tuckshop_preorders')
      .select('id, for_date, status, created_at, tuckshop_preorder_items(quantity, tuckshop_item_id, tuckshop_items(name, price))')
      .eq('student_id', studentId)
      .order('for_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);
    setMyOrders(orders || []);
  }

  useEffect(() => { load(); }, [studentId]);
  // Re-check every minute so windows open/close and the warning stays current.
  useEffect(() => {
    const t = setInterval(() => { setTick((n) => n + 1); }, 60000);
    return () => clearInterval(t);
  }, []);

  if (!studentId) {
    return <p>Your account isn&apos;t linked to a student record yet — ask the school office to link it.</p>;
  }

  const now = Date.now();
  const specialFor = (d) => specials.find((sp) => sp.for_date === d);
  // The manual closure stops the weekly rota, not a special session.
  const openWindows = (windows || []).filter(
    (w) => (!closedUntil || specialFor(w.for_date))
      && now >= new Date(w.opens_at).getTime() && now < new Date(w.closes_at).getTime(),
  );
  const itemsFor = (d) => {
    const sp = specialFor(d);
    if (!sp) return tuckshopItems;
    const ids = new Set(sp.itemIds);
    return specialItems.filter((i) => ids.has(i.id));
  };
  const openDates = new Set(openWindows.map((w) => w.for_date));
  const nextWindow = (windows || []).find(
    (w) => (!closedUntil || specialFor(w.for_date)) && new Date(w.opens_at).getTime() > now,
  );
  const warnings = openWindows.map((w) => closingWarning(w.for_date, w.closes_at)).filter(Boolean);
  const pastOrders = myOrders.filter((o) => !(openDates.has(o.for_date) && o.status === 'pending'));

  function statusLabel(o) {
    if (o.status === 'not_collected') return 'not collected';
    if (o.status !== 'pending') return o.status;
    return openDates.has(o.for_date) ? 'open' : 'locked';
  }

  return (
    <div>
      <h1>Tuckshop</h1>

      {warnings.map((text) => (
        <div key={text} className="card" style={{ borderLeft: '5px solid #a3232c', background: '#fff4f4' }}>
          <strong>⏰ {text}</strong>
        </div>
      ))}

      <div className="card">
        <p>
          Balance:{' '}
          <span style={{ fontWeight: 700, color: (tuckshopBalance ?? 0) < 0 ? '#a3232c' : '#1a7a3d' }}>
            {tuckshopBalance === null ? '…' : naira(tuckshopBalance)}
          </span>
        </p>

        {closedUntil && openWindows.length === 0 ? (
          <p className="badge badge-negative" style={{ display: 'inline-block' }}>
            Tuckshop ordering is closed at the moment. It reopens on {longDate(closedUntil)}.
            {nextWindow && (
              <> A special pre-order session for <strong>{longDate(nextWindow.for_date)}</strong> opens at{' '}
                <strong>{momentLabel(nextWindow.opens_at)}</strong>.</>
            )}
          </p>
        ) : windows === null ? (
          <p>Loading…</p>
        ) : openWindows.length === 0 ? (
          <p>
            Tuckshop ordering isn&apos;t open right now.
            {nextWindow && (
              <> Ordering for <strong>{longDate(nextWindow.for_date)}</strong> opens at{' '}
                <strong>{momentLabel(nextWindow.opens_at)}</strong> and closes at{' '}
                {momentLabel(nextWindow.closes_at)}.</>
            )}
          </p>
        ) : (
          <>
            {openWindows.length > 1 && (
              <p style={{ background: '#fff8e1', border: '1px solid #e0c060', borderRadius: 4, padding: '0.5rem' }}>
                <strong>{openWindows.length} separate orders are open:</strong>{' '}
                {openWindows.map((w) => `${longDate(w.for_date)}${specialFor(w.for_date) ? ` (${specialFor(w.for_date).name})` : ''}`).join(' and ')}.
                Each box below is its own order, handed out on its own day. Check you are ordering in the right one.
              </p>
            )}
            {openWindows.map((w) => (
              <OrderEditor
                key={w.for_date}
                studentId={studentId}
                forDate={w.for_date}
                closesAt={w.closes_at}
                items={itemsFor(w.for_date)}
                sessionName={specialFor(w.for_date)?.name}
                limits={specialFor(w.for_date)
                  ? { perItem: specialFor(w.for_date).max_per_item, food: specialFor(w.for_date).max_food, other: specialFor(w.for_date).max_other }
                  : NORMAL_LIMITS}
                savedLines={myOrders
                  .filter((o) => o.for_date === w.for_date && o.status === 'pending')
                  .flatMap((o) => o.tuckshop_preorder_items || [])}
                onSaved={load}
              />
            ))}
          </>
        )}

        {pastOrders.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>My orders</h3>
            <div className="table-scroll">
              <table style={{ minWidth: 0 }}>
                <thead><tr><th>Tuckshop day</th><th>Items</th></tr></thead>
                <tbody>
                  {pastOrders.map((o) => {
                    const lines = o.tuckshop_preorder_items || [];
                    const total = lines.reduce((s, l) => s + l.quantity * Number(l.tuckshop_items?.price || 0), 0);
                    return (
                      <tr key={o.id}>
                        <td>
                          {longDate(o.for_date)}
                          {specialFor(o.for_date) && (
                            <div style={{ color: '#555', fontSize: '0.85rem' }}>{specialFor(o.for_date).name}</div>
                          )}
                          <div>
                            <span className={`badge ${o.status === 'fulfilled' ? 'badge-positive' : 'badge-negative'}`}>
                              {statusLabel(o)}
                            </span>
                          </div>
                        </td>
                        <td>
                          {lines.map((l) => `${l.quantity} × ${l.tuckshop_items?.name || 'item'}`).join(', ') || '—'}
                          <div style={{ color: '#555', fontSize: '0.85rem' }}>{naira(total)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <TuckshopPurchases studentId={studentId} />
      </div>
    </div>
  );
}

export default function TuckshopPage() {
  return <RequireAuth><TuckshopInner /></RequireAuth>;
}
