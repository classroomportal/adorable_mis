'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  loadSchedule, loadSpecialSessions, loadClosure, orderingStatus, momentLabel, longDate,
} from '../../lib/tuckshopSchedule';

// Open/closed for student tuck ordering, beside the Tuckshop card's icon on
// the staff dashboard (the principal, 2 Oct 2026: staff couldn't tell). It
// mirrors the database's rules from lib/tuckshopSchedule.js and rechecks
// every minute so it flips when a window opens or closes.
export default function TuckshopOrderingStatus() {
  const [data, setData] = useState(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSchedule(supabase), loadSpecialSessions(supabase), loadClosure(supabase)])
      .then(([schedule, specials, closure]) => { if (!cancelled) setData({ schedule, specials, closure }); });
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  if (!data) return null;
  const s = orderingStatus(data.schedule, data.specials, data.closure);
  const open = !!s?.open;
  const detail = !s ? 'No tuckshop day in the next fortnight'
    : open ? `Closes ${momentLabel(s.closesAt)}`
    : `${longDate(s.forDate)} orders open ${momentLabel(s.opensAt)}`;
  return (
    <a
      href="/tuckshop/ordering"
      style={{ textDecoration: 'none', color: 'inherit', textAlign: 'right', maxWidth: '14rem' }}
      title="Student tuck ordering"
    >
      <div style={{
        display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '999px', fontWeight: 800, fontSize: '0.95rem',
        color: '#fff', background: open ? '#2e7d4f' : '#b3261e',
      }}
      >
        Ordering {open ? 'open' : 'closed'}
      </div>
      <div className="stat-card-label">{detail}</div>
    </a>
  );
}
