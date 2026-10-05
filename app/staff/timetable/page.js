'use client';
import { useEffect, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { loadStaffLessons, lessonRoom } from '../../../lib/lessons';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatTimeRange } from '../../../lib/formatTime';
import { schoolToday } from '../../../lib/schoolTime';
import { loadOtherHalfSlots, loadCurrentOtherHalfTermId } from '../../../lib/otherHalf';
import GroupFreeTimes from '../../components/GroupFreeTimes';
import CoverPanel from '../../components/CoverPanel';

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
  const [mode, setMode] = useState('person'); // 'person' | 'group'
  const [canCover, setCanCover] = useState(false); // SMT: may arrange cover (migration 374)
  const [covers, setCovers] = useState([]); // live covers this person gives or receives, this week on
  const [coverReload, setCoverReload] = useState(0);
  // Opened from Cover on the dashboard's Timetable card (/staff/timetable?cover=1):
  // start with no teacher chosen and the cover panel open.
  const [coverMode, setCoverMode] = useState(null); // null until the URL is read
  useEffect(() => {
    setCoverMode(new URLSearchParams(window.location.search).get('cover') === '1');
  }, []);

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
      const { data: cc } = await supabase.rpc('can_arrange_cover');
      setCanCover(!!cc);
    }
    loadStatic();
  }, []);

  // Default to the logged-in staff member's own timetable once profile loads.
  useEffect(() => {
    if (profile?.staff_id && selectedStaffId === null && coverMode === false) {
      setSelectedStaffId(profile.staff_id);
    }
  }, [profile, selectedStaffId, coverMode]);

  useEffect(() => {
    async function loadTimetable() {
      if (!selectedStaffId) { setClasses([]); setCommitments([]); setOtherHalf([]); setLoading(false); return; }
      setLoading(true);
      const ohTermId = await loadCurrentOtherHalfTermId();
      const [{ classes: classData }, { data: commitmentData }, { data: ohData }] = await Promise.all([
        loadStaffLessons(selectedStaffId),
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

  // Covers (migration 374): lessons this person covers for someone, and their
  // own lessons someone else covers, from the start of this school week on.
  useEffect(() => {
    if (!selectedStaffId) { setCovers([]); return; }
    const from = [dateForDay('Mon'), schoolToday()].sort()[0];
    supabase
      .from('lesson_covers')
      .select('cover_id, cover_date, period_number, class_id, note, cover_staff_id, absent_staff_id, '
        + 'classes(class_code, room, subjects(subject_name, display_name)), timetable_slots(room, start_time, end_time), '
        + 'absent:staff!lesson_covers_absent_staff_id_fkey(first_name, last_name), '
        + 'cover:staff!lesson_covers_cover_staff_id_fkey(first_name, last_name)')
      .or(`cover_staff_id.eq.${selectedStaffId},absent_staff_id.eq.${selectedStaffId}`)
      .is('cancelled_at', null)
      .gte('cover_date', from)
      .order('cover_date')
      .order('period_number')
      .then(({ data }) => setCovers(data || []));
    // dateForDay only reads the school's today
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStaffId, coverReload]);

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
        room: lessonRoom(slot, c),
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

  // This week's covers on the grid. A lesson this person covers is added to
  // the cell (for that date only, with an apology); one of their own lessons
  // that someone else covers says who.
  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const personName = (p) => (p ? `${p.first_name} ${p.last_name}` : '');
  covers.forEach((cv) => {
    const day = WEEKDAY_LABELS[new Date(`${cv.cover_date}T00:00:00`).getDay()];
    if (!DAYS.includes(day) || cv.cover_date !== dateForDay(day)) return;
    const key = `${day}-${cv.period_number}`;
    if (cv.cover_staff_id === selectedStaffId) {
      const entry = {
        cover: true,
        classId: cv.class_id,
        classCode: cv.classes?.class_code,
        subject: cv.classes?.subjects?.display_name || cv.classes?.subjects?.subject_name,
        room: lessonRoom(cv.timetable_slots, cv.classes),
        time: cv.timetable_slots ? formatTimeRange(cv.timetable_slots.start_time, cv.timetable_slots.end_time) : '',
        coverFor: personName(cv.absent),
        note: cv.note,
        date: cv.cover_date,
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    } else {
      (cellMap[key] || []).forEach((e) => {
        if (e.classId === cv.class_id && !e.cover) e.coveredBy = personName(cv.cover);
      });
    }
  });
  const upcomingCovers = covers.filter((cv) => cv.cover_staff_id === selectedStaffId && cv.cover_date >= schoolToday());

  function goToRegister(entry, dayLabel, periodNumber) {
    const date = entry.date || dateForDay(dayLabel);
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
      // A count for the signed-in teacher only (migration 315). Reading the
      // registers_not_done view here, once a minute on every open timetable,
      // was the database's heaviest load and slowed every page at 08:00.
      const { data } = await supabase.rpc('my_overdue_registers_count');
      setMyMissingCount(data || 0);
    }
    loadMyMissing();
    const interval = setInterval(loadMyMissing, 60000);
    return () => clearInterval(interval);
  }, [isOwnTimetable, profile?.staff_id]);

  return (
    <div>
      <h1>Timetable</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button className={mode === 'person' ? undefined : 'secondary'} onClick={() => setMode('person')}>One person</button>
        <button className={mode === 'group' ? undefined : 'secondary'} onClick={() => setMode('group')}>When is a group free?</button>
      </div>

      {mode === 'group' ? <GroupFreeTimes staffList={staffList} periods={periods} /> : <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', marginBottom: '0.4rem' }}>
          {coverMode && canCover ? 'Teacher who is absent:' : 'Viewing timetable for:'}
        </label>
        <select
          value={selectedStaffId ?? ''}
          onChange={(e) => setSelectedStaffId(e.target.value ? Number(e.target.value) : null)}
          style={{ width: '100%', marginBottom: '0.4rem' }}
        >
          {selectedStaffId == null && <option value="">Choose a member of staff…</option>}
          {staffList.map((s) => (
            <option key={s.staff_id} value={s.staff_id}>
              {s.first_name} {s.last_name}
              {profile?.staff_id === s.staff_id ? ' (me)' : ''}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {profile?.staff_id && !isOwnTimetable && (
            <button onClick={() => { setSelectedStaffId(profile.staff_id); setCoverMode(false); }}>
              ← Back to my timetable
            </button>
          )}
          {canCover && selectedStaffId && !isOwnTimetable && !coverMode && (
            <button className="secondary" onClick={() => setCoverMode(true)}>Arrange cover</button>
          )}
        </div>
      </div>

      {canCover && coverMode && selectedStaffId && !isOwnTimetable && (
        <CoverPanel
          staffName={personName(staffList.find((s) => s.staff_id === selectedStaffId))}
          classes={classes}
          periods={periods}
          onChanged={() => setCoverReload((r) => r + 1)}
        />
      )}

      {upcomingCovers.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--brand-600)', background: 'var(--brand-050)' }}>
          <strong>{isOwnTimetable ? 'Cover you have been asked to do' : 'Cover this person has been asked to do'}</strong>
          <ul style={{ margin: '0.4rem 0', paddingLeft: '1.2rem' }}>
            {upcomingCovers.map((cv) => (
              <li key={cv.cover_id}>
                {new Date(`${cv.cover_date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                {', '}{periods.find((p) => p.period_number === cv.period_number)?.period_name}
                {': '}<strong>{cv.classes?.class_code}</strong> for {personName(cv.absent)}
                {lessonRoom(cv.timetable_slots, cv.classes) ? ` in ${lessonRoom(cv.timetable_slots, cv.classes)}` : ''}
                {cv.note ? <span style={{ opacity: 0.75 }}> · {cv.note}</span> : null}
              </li>
            ))}
          </ul>
          {isOwnTimetable && (
            <div style={{ fontStyle: 'italic' }}>Sorry for the extra work, and thank you for helping.</div>
          )}
        </div>
      )}

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
                                style={{
                                  marginBottom: entries.length > 1 ? '0.3rem' : 0,
                                  ...(e.cover ? { background: 'var(--brand-100)', borderLeft: '3px solid var(--brand-700)', padding: '0.2rem 0.3rem' } : {}),
                                }}
                                title="Open register for this class"
                              >
                                {e.cover && <div style={{ fontWeight: 700, color: 'var(--brand-800)' }}>COVER for {e.coverFor}</div>}
                                {e.classCode ? <><strong>{e.classCode}</strong><br /></> : ''}
                                {e.subject}<br /><span style={{ opacity: 0.6 }}>{e.room}</span><br />
                                <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{e.time}</span>
                                {e.cover && (
                                  <div style={{ fontStyle: 'italic', fontSize: '0.85em', marginTop: '0.2rem' }}>
                                    {e.note ? <>{e.note}<br /></> : null}
                                    Sorry for the extra work, and thank you.
                                  </div>
                                )}
                                {e.coveredBy && (
                                  <div style={{ fontWeight: 600, color: 'var(--brand-800)', fontSize: '0.85em' }}>Covered by {e.coveredBy}</div>
                                )}
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
      </>}
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
