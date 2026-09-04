'use client';
import { useEffect, useState, Fragment } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function StaffTimetable() {
  const { profile } = useAuth();
  const [staffList, setStaffList] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [search, setSearch] = useState('');
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
        subject: c.subjects?.display_name || c.subjects?.subject_name,
        room: c.room,
        classCode: c.class_code,
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
  });

  const filteredStaff = staffList.filter((s) => {
    const name = `${s.first_name} ${s.last_name}`.toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const selectedStaff = staffList.find((s) => s.staff_id === selectedStaffId);
  const isOwnTimetable = profile?.staff_id && selectedStaffId === profile.staff_id;

  return (
    <div>
      <h1>Timetable</h1>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', marginBottom: '0.4rem' }}>
          Viewing: <strong>{selectedStaff ? `${selectedStaff.first_name} ${selectedStaff.last_name}` : '—'}</strong>
          {isOwnTimetable && <span style={{ opacity: 0.6 }}> (you)</span>}
        </label>
        {profile?.staff_id && !isOwnTimetable && (
          <button onClick={() => setSelectedStaffId(profile.staff_id)} style={{ marginBottom: '0.6rem' }}>
            ← Back to my timetable
          </button>
        )}
        <input
          type="text"
          placeholder="Search staff by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', marginBottom: '0.4rem' }}
        />
        {search && (
          <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '6px' }}>
            {filteredStaff.length === 0 && <div style={{ padding: '0.5rem' }}>No staff match.</div>}
            {filteredStaff.map((s) => (
              <div
                key={s.staff_id}
                onClick={() => { setSelectedStaffId(s.staff_id); setSearch(''); }}
                style={{ padding: '0.5rem', cursor: 'pointer', borderBottom: '1px solid #eee' }}
              >
                {s.first_name} {s.last_name}
              </div>
            ))}
          </div>
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
                    <div key={`${d}-${p.period_number}`} className={`tt-cell ${entries ? 'tt-filled' : ''}`}>
                      {entries
                        ? entries.map((e, i) => (
                            <div key={i} style={{ marginBottom: entries.length > 1 ? '0.3rem' : 0 }}>
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
