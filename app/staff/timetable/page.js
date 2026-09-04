'use client';
import { useEffect, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function StaffTimetable() {
  const { profile } = useAuth();
  const router = useRouter();
  const [staffList, setStaffList] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStatic() {
      const { data: pr } = await supabase.from('periods').select('*').order('period_number');
      setPeriods(pr || []);
      const { data: st } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name')
        .order('last_name');
      setStaffList(st || []);
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
      if (!selectedStaffId) { setClasses([]); setLoading(false); return; }
      setLoading(true);
      const { data } = await supabase
        .from('classes')
        .select('class_id, room, class_code, subjects(subject_name, display_name), timetable_slots(day_of_week, period_number, start_time, end_time)')
        .eq('staff_id', selectedStaffId);
      setClasses(data || []);
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
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
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
    const today = new Date();
    let diff = target - today.getDay();
    if (diff < 0) diff += 7;
    const d = new Date(today);
    d.setDate(today.getDate() + diff);
    return toLocalISO(d);
  }

  function goToRegister(entry, dayLabel, periodNumber) {
    const date = dateForDay(dayLabel);
    router.push(`/attendance?classId=${entry.classId}&period=${periodNumber}&date=${date}`);
  }

  const isOwnTimetable = profile?.staff_id && selectedStaffId === profile.staff_id;

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
                        ? entries.map((e, i) => (
                            <div
                              key={i}
                              onClick={() => goToRegister(e, d, p.period_number)}
                              style={{ marginBottom: entries.length > 1 ? '0.3rem' : 0 }}
                              title="Open register for this class"
                            >
                              {e.classCode ? <><strong>{e.classCode}</strong><br /></> : ''}
                              {e.subject}<br /><span style={{ opacity: 0.6 }}>{e.room}</span>
                            </div>
                          ))
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
    <RequireAuth>
      <StaffTimetable />
    </RequireAuth>
  );
}
