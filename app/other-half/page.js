'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';
import { formatTimeRange } from '../../lib/formatTime';
import { schoolToday, schoolWeekdayShort } from '../../lib/schoolTime';
import {
  OH_DAY_NAMES, formatYearGroups, loadOtherHalfSlots, loadCurrentOtherHalfTermId, staffByActivity, staffNames,
} from '../../lib/otherHalf';

function OtherHalfHomeInner() {
  const { profile, hasAccess } = useAuth();
  const router = useRouter();
  const [slots, setSlots] = useState({ days: [], byDay: {}, periodNumber: null });
  const [term, setTerm] = useState(null);
  const [activities, setActivities] = useState([]);
  const [staffMap, setStaffMap] = useState({});
  const [rosterCounts, setRosterCounts] = useState({});
  const [markedCounts, setMarkedCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const today = schoolToday();
  const todayDay = schoolWeekdayShort();

  useEffect(() => {
    async function load() {
      const [s, termId] = await Promise.all([loadOtherHalfSlots(), loadCurrentOtherHalfTermId()]);
      setSlots(s);
      if (!termId) { setLoading(false); return; }
      const [{ data: t }, { data: acts }, { data: counts }] = await Promise.all([
        supabase.from('terms').select('*').eq('term_id', termId).single(),
        supabase.from('other_half_activities').select('*').eq('term_id', termId).eq('is_active', true).order('activity_name'),
        supabase.rpc('other_half_places_taken', { p_term_id: termId }),
      ]);
      setTerm(t || null);
      setActivities(acts || []);
      setRosterCounts(Object.fromEntries((counts || []).map((c) => [c.activity_id, c.taken])));
      const ids = (acts || []).map((a) => a.activity_id);
      if (ids.length) {
        const { data: st } = await supabase
          .from('other_half_activity_staff')
          .select('activity_id, staff_id, staff(staff_id, first_name, last_name)')
          .in('activity_id', ids);
        setStaffMap(staffByActivity(st));
      }
      // Today's register status: how many marks each of today's activities has.
      const todays = (acts || []).filter((a) => a.day_of_week === todayDay).map((a) => a.activity_id);
      if (todays.length && s.periodNumber) {
        const { data: marks } = await supabase
          .from('attendance')
          .select('other_half_activity_id')
          .eq('attend_date', today)
          .eq('period_number', s.periodNumber)
          .in('other_half_activity_id', todays);
        const mc = {};
        for (const m of marks || []) mc[m.other_half_activity_id] = (mc[m.other_half_activity_id] || 0) + 1;
        setMarkedCounts(mc);
      }
      setLoading(false);
    }
    load();
  }, [today, todayDay]);

  if (loading) return <p>Loading...</p>;

  const mine = activities.filter((a) => (staffMap[a.activity_id] || []).some((s) => s.staff_id === profile?.staff_id));
  const todays = activities.filter((a) => a.day_of_week === todayDay);
  const todaySlot = slots.byDay[todayDay];

  function registerLink(a) {
    return `/other-half/register?activityId=${a.activity_id}&date=${today}`;
  }

  function registerState(a) {
    const n = rosterCounts[a.activity_id] || 0;
    const m = markedCounts[a.activity_id] || 0;
    if (n === 0) return <span style={{ color: '#888' }}>No students</span>;
    if (m === 0) return <span style={{ color: '#b91c1c', fontWeight: 600 }}>Not taken</span>;
    if (m < n) return <span style={{ color: '#b45309', fontWeight: 600 }}>{m} of {n} marked</span>;
    return <span style={{ color: '#1a7f37', fontWeight: 600 }}>Taken</span>;
  }

  return (
    <div>
      <h1>The Other Half</h1>
      {term ? (
        <p style={{ color: '#666', marginTop: 0 }}>{term.term_name} · {formatUKDate(term.start_date)} – {formatUKDate(term.end_date)}</p>
      ) : (
        <p>No term is set up yet.</p>
      )}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>My activities</h2>
        {mine.length === 0 ? (
          <p>You aren&apos;t down to run any Other Half activities this term.</p>
        ) : (
          <div className="table-scroll"><table>
            <thead><tr><th>Day</th><th>Activity</th><th>Room</th><th>Students</th><th></th></tr></thead>
            <tbody>
              {mine
                .sort((x, y) => slots.days.indexOf(x.day_of_week) - slots.days.indexOf(y.day_of_week))
                .map((a) => (
                  <tr key={a.activity_id} style={a.day_of_week === todayDay ? { background: '#fff7e0' } : undefined}>
                    <td>{OH_DAY_NAMES[a.day_of_week]}{a.day_of_week === todayDay && ' (today)'}</td>
                    <td><strong>{a.activity_name}</strong></td>
                    <td>{a.room || '—'}</td>
                    <td>{rosterCounts[a.activity_id] || 0}{a.capacity != null ? ` / ${a.capacity}` : ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {a.day_of_week === todayDay ? (
                        <button type="button" onClick={() => router.push(registerLink(a))}>Take register</button>
                      ) : (
                        <button type="button" className="secondary" onClick={() => router.push(`/other-half/register?activityId=${a.activity_id}`)}>List &amp; past registers</button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>
          Today{todaySlot ? ` · ${formatTimeRange(todaySlot.start_time, todaySlot.end_time)}` : ''}
        </h2>
        {!todaySlot ? (
          <p>There&apos;s no Other Half today.</p>
        ) : todays.length === 0 ? (
          <p>No activities are set up for {OH_DAY_NAMES[todayDay]}.</p>
        ) : (
          <div className="table-scroll"><table>
            <thead><tr><th>Activity</th><th>Room</th><th>Staff</th><th>Open to</th><th>Register</th><th></th></tr></thead>
            <tbody>
              {todays.map((a) => (
                <tr key={a.activity_id}>
                  <td><strong>{a.activity_name}</strong></td>
                  <td>{a.room || '—'}</td>
                  <td>{staffNames(staffMap[a.activity_id]) || '—'}</td>
                  <td>{formatYearGroups(a.year_groups)}</td>
                  <td>{registerState(a)}</td>
                  <td><button type="button" className="secondary" onClick={() => router.push(registerLink(a))}>Open register</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {(hasAccess('/other-half/activities') || hasAccess('/other-half/choices')) && (
        <p>
          {hasAccess('/other-half/activities') && <a href="/other-half/activities">Activity Programme →</a>}
          {hasAccess('/other-half/activities') && hasAccess('/other-half/choices') && ' · '}
          {hasAccess('/other-half/choices') && <a href="/other-half/choices">Student Choices →</a>}
        </p>
      )}
    </div>
  );
}

export default function OtherHalfPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/other-half">
      <OtherHalfHomeInner />
    </RequireResource></RequireAuth>
  );
}
