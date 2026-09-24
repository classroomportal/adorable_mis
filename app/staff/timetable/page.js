'use client';
import { useEffect, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatTimeRange } from '../../../lib/formatTime';
import { schoolToday } from '../../../lib/schoolTime';
import { loadOtherHalfSlots, loadCurrentOtherHalfTermId } from '../../../lib/otherHalf';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function StaffTimetable() {
  const { profile } = useAuth();
  const router = useRouter();
  const [staffList, setStaffList] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [classes, setClasses] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [otherHalf, setOtherHalf] = useState([]); // OH activities this person runs, current term
  const [ohSlots, setOhSlots] = useState({ byDay: {} });
  const [loading, setLoading] = useState(true);
  const [myMissingCount, setMyMissingCount] = useState(0);

  useEffect(() => {
    async function loadStatic() {
      const { data: pr } = await supabase.from('periods').select('*').order('period_number');
      setPeriods(pr || []);
      const { data: st } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name')
        .order('last_name');
      setStaffList(st || []);
      setOhSlots(await loadOtherHalfSlots());
    }
    loadStatic();
  }, []);

  // Default to the logged-in staff member's own timetable once profile loads.
  useEffect(() => {
    if (profile?.staff_id && selectedStaffId === null) {
      setSelectedStaffId(profile.staff_id);
    }
  }, [profile, selectedStaffId]);

  useEffect(() => {
    async function loadTimetable() {
      if (!selectedStaffId) { setClasses([]); setCommitments([]); setOtherHalf([]); setLoading(false); return; }
      setLoading(true);
      const ohTermId = await loadCurrentOtherHalfTermId();
      const [{ data: classData }, { data: commitmentData }, { data: ohData }] = await Promise.all([
        supabase
          .from('classes')
          .select('class_id, room, class_code, subjects(subject_name, display_name), timetable_slots(day_of_week, period_number, start_time, end_time)')
          .eq('staff_id', selectedStaffId),
        supabase
          .from('staff_commitments')
          .select('day_of_week, period_number, label')
          .eq('staff_id', selectedStaffId),
        supabase
          .from('other_half_activity_staff')
          .select('other_half_activities!inner(activity_id, activity_name, room, day_of_week, term_id, is_active)')
          .eq('staff_id', selectedStaffId)
          .eq('other_half_activities.term_id', ohTermId ?? -1)
          .eq('other_half_activities.is_active', true),
      ]);
      setClasses(classData || []);
      setCommitments(commitmentData || []);
      setOtherHalf((ohData || []).map((r) => r.other_half_activities).filter(Boolean));
      setLoading(false);
    }
    loadTimetable();
  }, [selectedStaffId]);

  const cellMap = {};
  classes.forEach((c) => {
    (c.timetable_slots || []).forEach((slot) => {
      const key = `${slot.day_of_week}-${slot.period_number}`;
      // A staff member could conceivably have two classes in the same slot
      // (block clash / data issue) — keep both rather than silently
      // overwriting, since that's worth surfacing rather than hiding.
      const entry = {
        classId: c.class_id,
        subject: c.subjects?.display_name || c.subjects?.subject_name,
        room: c.room,
        classCode: c.class_code,
        time: formatTimeRange(slot.start_time, slot.end_time),
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
  });
  // Commitments (Nova-T NCLASS.DAT — meetings, part-time non-working periods,
  // etc.) have no class or roster, so they're just a label blocking the slot
  // out — not clickable like a real class entry.
  commitments.forEach((cm) => {
    const key = `${cm.day_of_week}-${cm.period_number}`;
    const entry = { commitment: true, label: cm.label?.trim() };
    cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
  });

  // Other Half activities (migration 156) sit in the OH slot and open the OH
  // register rather than a class register.
  otherHalf.forEach((a) => {
    const slot = ohSlots.byDay[a.day_of_week];
    if (!slot) return;
    const key = `${a.day_of_week}-${slot.period_number}`;
    const entry = {
      otherHalfActivityId: a.activity_id,
      subject: a.activity_name,
      room: a.room,
      classCode: 'Other Half',
      time: formatTimeRange(slot.start_time, slot.end_time),
    };
    cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
  });

  const DAY_TO_WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
  function toLocalISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function dateForDay(dayLabel) {
    const target = DAY_TO_WEEKDAY[dayLabel];
    // The school's today, not the device's: a laptop in another zone, or the
    // hour either side of midnight, would otherwise open the register on the
    // wrong date. Parsed at local midnight so getDay() reads that calendar day.
    //
    // This school week's day, never next week's: jumping forward (a Mon click
    // on a Wednesday used to open next Monday) saved whole registers on a
    // future date. At the weekend, "this week" is the one just finished.
    const today = new Date(`${schoolToday()}T00:00:00`);
    const todayWeekday = today.getDay() === 0 ? 7 : today.getDay();
    const diff = target - todayWeekday;
    const d = new Date(today);
    d.setDate(today.getDate() + diff);
    return toLocalISO(d);
  }

  function goToRegister(entry, dayLabel, periodNumber) {
    const date = dateForDay(dayLabel);
    if (entry.otherHalfActivityId) {
      router.push(`/other-half/register?activityId=${entry.otherHalfActivityId}&date=${date}`);
      return;
    }
    router.push(`/attendance?classId=${entry.classId}&period=${periodNumber}&date=${date}`);
  }

  const isOwnTimetable = profile?.staff_id && selectedStaffId === profile.staff_id;

  useEffect(() => {
    async function loadMyMissing() {
      if (!isOwnTimetable) { setMyMissingCount(0); return; }
      const { data } = await supabase
        .from('registers_not_done')
        .select('slot_id, other_half_activity_id')
        // staff_ids, not staff_id: an Other Half activity can have several
        // staff, and its row belongs to all of them (migration 157).
        .contains('staff_ids', [profile.staff_id]);
      setMyMissingCount((data || []).length);
    }
    loadMyMissing();
    const interval = setInterval(loadMyMissing, 60000);
    return () => clearInterval(interval);
  }, [isOwnTimetable, profile?.staff_id]);

  return (
    <div>
      <h1>Timetable</h1>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', marginBottom: '0.4rem' }}>
          Viewing timetable for:
        </label>
        <select
          value={selectedStaffId ?? ''}
          onChange={(e) => setSelectedStaffId(e.target.value ? Number(e.target.value) : null)}
          style={{ width: '100%', marginBottom: '0.4rem' }}
        >
          {staffList.map((s) => (
            <option key={s.staff_id} value={s.staff_id}>
              {s.first_name} {s.last_name}
              {profile?.staff_id === s.staff_id ? ' (me)' : ''}
            </option>
          ))}
        </select>
        {profile?.staff_id && !isOwnTimetable && (
          <button onClick={() => setSelectedStaffId(profile.staff_id)}>
            ← Back to my timetable
          </button>
        )}
      </div>

      {isOwnTimetable && myMissingCount > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: '#c0392b' }}>
          <strong>{myMissingCount} of your registers {myMissingCount === 1 ? 'is' : 'are'} overdue</strong> — tap the class below to take it.
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="table-scroll">
          <div className="timetable-grid">
            <div className="tt-head"></div>
            {DAYS.map((d) => <div key={d} className="tt-head">{d}</div>)}
            {periods.map((p) => (
              <Fragment key={p.period_number}>
                <div className="tt-cell tt-period-label">{p.period_name}</div>
                {DAYS.map((d) => {
                  const entries = cellMap[`${d}-${p.period_number}`];
                  return (
                    <div
                      key={`${d}-${p.period_number}`}
                      className={`tt-cell ${entries ? 'tt-filled' : ''}`}
                      style={entries ? { cursor: 'pointer' } : undefined}
                    >
                      {entries
                        ? entries.map((e, i) =>
                            e.commitment ? (
                              <div
                                key={i}
                                style={{ marginBottom: entries.length > 1 ? '0.3rem' : 0, fontStyle: 'italic', opacity: 0.75 }}
                              >
                                {e.label}
                              </div>
                            ) : (
                              <div
                                key={i}
                                onClick={() => goToRegister(e, d, p.period_number)}
                                style={{ marginBottom: entries.length > 1 ? '0.3rem' : 0 }}
                                title="Open register for this class"
                              >
                                {e.classCode ? <><strong>{e.classCode}</strong><br /></> : ''}
                                {e.subject}<br /><span style={{ opacity: 0.6 }}>{e.room}</span><br />
                                <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{e.time}</span>
                              </div>
                            )
                          )
                        : ''}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth><RequireResource resourceKey="/staff/timetable">
      <StaffTimetable />
    </RequireResource></RequireAuth>
  );
}
