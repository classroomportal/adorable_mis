'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { formatTimeRange } from '../../lib/formatTime';
import { OH_DAY_NAMES, loadOtherHalfSlots, loadCurrentOtherHalfTermId, staffByActivity, staffNames } from '../../lib/otherHalf';

const STATUS_COLOUR = { present: '#1a7f37', late: '#b08800', absent: '#c62828' };

// A parent's read-only view of one child's Other Half: the activity chosen
// for each day this term, and recent Other Half registers. Parents can read
// their own children's choices and attendance under RLS (migration 156);
// the choosing itself is done by the student from their own login.
export default function ChildOtherHalf({ studentId, yearGroup, firstName }) {
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState(null);
  const [windowRow, setWindowRow] = useState(null);
  const [slots, setSlots] = useState({ days: [], byDay: {}, periodNumber: null });
  const [activities, setActivities] = useState([]);
  const [staffMap, setStaffMap] = useState({});
  const [chosen, setChosen] = useState({}); // day_of_week -> activity_id
  const [marks, setMarks] = useState([]);

  useEffect(() => {
    async function load() {
      if (!studentId) return;
      setLoading(true);
      const [s, termId] = await Promise.all([loadOtherHalfSlots(), loadCurrentOtherHalfTermId()]);
      setSlots(s);
      if (!termId) { setLoading(false); return; }
      const [{ data: t }, { data: w }, { data: acts }, { data: ch }] = await Promise.all([
        supabase.from('terms').select('*').eq('term_id', termId).single(),
        supabase.from('other_half_terms').select('*').eq('term_id', termId).maybeSingle(),
        supabase.from('other_half_activities').select('*').eq('term_id', termId).order('activity_name'),
        supabase.from('other_half_choices').select('day_of_week, activity_id').eq('student_id', studentId).eq('term_id', termId),
      ]);
      setTerm(t || null);
      setWindowRow(w || null);
      setActivities(acts || []);
      setChosen(Object.fromEntries((ch || []).map((c) => [c.day_of_week, c.activity_id])));
      const ids = (acts || []).map((a) => a.activity_id);
      if (ids.length) {
        const { data: st } = await supabase
          .from('other_half_activity_staff')
          .select('activity_id, staff_id, staff(staff_id, first_name, last_name)')
          .in('activity_id', ids);
        setStaffMap(staffByActivity(st));
      }
      if (s.periodNumber && t) {
        const { data: m } = await supabase
          .from('attendance')
          .select('attend_date, code, status, minutes_late, other_half_activities(activity_name), attendance_codes(description)')
          .eq('student_id', studentId)
          .eq('period_number', s.periodNumber)
          .gte('attend_date', t.start_date)
          .order('attend_date', { ascending: false })
          .limit(20);
        setMarks(m || []);
      }
      setLoading(false);
    }
    load();
  }, [studentId]);

  if (loading) return <p>Loading…</p>;
  if (!term) return <p>No term is set up yet.</p>;

  const open = !!windowRow?.choices_open && (!windowRow.choices_close_at || new Date(windowRow.choices_close_at) > new Date());
  const activityById = Object.fromEntries(activities.map((a) => [a.activity_id, a]));
  // Only days that have something for this child's year (or a choice already made).
  const days = slots.days.filter((d) => chosen[d]
    || activities.some((a) => a.is_active && a.day_of_week === d && a.year_groups.includes(yearGroup)));

  return (
    <>
      <p style={{ color: '#666', marginTop: 0 }}>
        {term.term_name} · {formatUKDate(term.start_date)} – {formatUKDate(term.end_date)}
      </p>
      <p>
        {open
          ? `Choices are open — ${firstName} picks an activity for each day from their own Formwork login.`
          : 'Choices are closed for this term. Please contact the school if a change is needed.'}
      </p>

      {days.length === 0 ? (
        <p>No Other Half activities have been set up for Year {yearGroup} yet.</p>
      ) : (
        <div className="table-scroll"><table>
          <thead><tr><th>Day</th><th>Activity</th><th>Where</th><th>With</th><th>Time</th></tr></thead>
          <tbody>
            {days.map((d) => {
              const a = activityById[chosen[d]];
              const slot = slots.byDay[d];
              return (
                <tr key={d}>
                  <td>{OH_DAY_NAMES[d]}</td>
                  {a ? (
                    <>
                      <td>
                        <strong>{a.activity_name}</strong>
                        {a.description && <div style={{ fontSize: '0.85em', color: '#666' }}>{a.description}</div>}
                      </td>
                      <td>{a.room || '—'}</td>
                      <td>{staffNames(staffMap[a.activity_id]) || '—'}</td>
                    </>
                  ) : (
                    <td colSpan={3} style={{ color: '#b45309', fontWeight: 600 }}>Not chosen yet</td>
                  )}
                  <td>{slot ? formatTimeRange(slot.start_time, slot.end_time) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}

      <h3 style={{ marginTop: '1.5rem' }}>Other Half attendance this term</h3>
      {marks.length === 0 ? (
        <p>No Other Half registers recorded yet this term.</p>
      ) : (
        <div className="table-scroll"><table>
          <thead><tr><th>Date</th><th>Activity</th><th>Mark</th></tr></thead>
          <tbody>
            {marks.map((m) => (
              <tr key={m.attend_date}>
                <td>{formatUKDate(m.attend_date, { weekday: true })}</td>
                <td>{m.other_half_activities?.activity_name || 'Other Half'}</td>
                <td style={{ color: STATUS_COLOUR[m.status] || '#6b6b6b', fontWeight: 600 }}>
                  {m.attendance_codes?.description || m.code}
                  {m.minutes_late ? ` (${m.minutes_late} min)` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
