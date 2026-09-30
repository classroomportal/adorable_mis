'use client';
import { useEffect, useRef, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { LESSON_COLUMNS, lessonRoom, lessonTeacher } from '../../lib/lessons';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import ResultsOverview from '../components/ResultsOverview';
import { visibleTargets } from '../../lib/gradeCompare';
import { formatTimeRange } from '../../lib/formatTime';
import { isOtherHalfSubject, mergeOtherHalfIntoCells } from '../../lib/otherHalf';
import { useHashView, DashboardTile, DashboardBack } from '../components/Dashboard';
import { closingWarning } from '../../lib/tuckshopSchedule';
import BehaviourPhoto from '../components/BehaviourPhoto';
import { HomeworkChip, HomeworkDetail } from '../components/HomeworkChip';
import { useTileOrder, sortTiles } from '../../lib/tileOrder';
import { schoolToday } from '../../lib/schoolTime';
import {
  addDays, weekStartOf, defaultWeekStart, shortDate, loadMyHomework,
  placeHomeworkInCells, groupHomeworkByDay, homeworkStatus,
} from '../../lib/homework';


// Which of these events have a picture this viewer may see. Row-level
// security (migration 209) only returns approved pictures on the viewer's own
// visible events, so this asks for ids only — images load when tapped.
async function loadVisiblePhotoIds(events) {
  const ids = [...new Set((events || []).map((e) => e.photo_id).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from('behaviour_photos').select('photo_id').in('photo_id', ids);
  return new Set((data || []).map((p) => p.photo_id));
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Previous / this / next week, shared by the timetable and the Homework grid.
function WeekPicker({ weekStart, onChange }) {
  const thisWeek = defaultWeekStart();
  return (
    <div className="hw-week-picker no-print">
      <button type="button" className="secondary" onClick={() => onChange(addDays(weekStart, -7))} aria-label="Previous week">←</button>
      <span>Week of {shortDate(weekStart)}</span>
      <button type="button" className="secondary" onClick={() => onChange(addDays(weekStart, 7))} aria-label="Next week">→</button>
      {weekStart !== thisWeek && (
        <button type="button" className="secondary" onClick={() => onChange(thisWeek)}>This week</button>
      )}
    </div>
  );
}

// One homework as a card on the Homework grid or in its lists.
function HomeworkCard({ hw, selected, onSelect, showDate }) {
  const status = homeworkStatus(hw);
  return (
    <button
      type="button"
      className={`hw-card hw-${status.key}${selected ? ' hw-card-selected' : ''}`}
      onClick={() => onSelect(selected ? null : hw.homework_id)}
      aria-expanded={selected}
    >
      <span className="hw-card-subject">{hw.subject_name}</span>
      <span className="hw-card-title">{hw.title}</span>
      <span className="hw-card-meta">
        {showDate ? `${shortDate(hw.due_on)} · ` : ''}
        {hw.due_period != null ? `Lesson ${hw.due_period}` : 'End of day'}
      </span>
      <span className={`hw-status hw-${status.key}`}>{status.label}</span>
    </button>
  );
}

function PortalInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;
  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [photoIds, setPhotoIds] = useState(new Set()); // approved pictures this viewer may see
  const [appeals, setAppeals] = useState([]);
  const [gradePoints, setGradePoints] = useState({});
  const [appealForm, setAppealForm] = useState(null); // event_id being appealed
  const [appealReason, setAppealReason] = useState('');
  // Same slow-network double tap as the behaviour form: one student ended up
  // with 27 copies of one appeal. The ref stops a second submit before React
  // re-renders; the state disables the button.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  const [periods, setPeriods] = useState([]);
  const [timetableClasses, setTimetableClasses] = useState([]);
  const [otherHalf, setOtherHalf] = useState([]); // chosen OH activities (other_half_timetable)
  const [timetableLoading, setTimetableLoading] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [yearGroup, setYearGroup] = useState(null);
  const [enrolledSubjectIds, setEnrolledSubjectIds] = useState(null); // null = enrolment not loaded yet
  const [tuckshopBalance, setTuckshopBalance] = useState(null);
  // Warning in the last hours before a tuckshop ordering window closes.
  const [tuckshopWarning, setTuckshopWarning] = useState(null);
  const [view, openView] = useHashView();

  // Homework (migration 278): only shown once one of the student's classes
  // has it switched on (homework_classes), so nothing changes for anyone else.
  const [homeworkOn, setHomeworkOn] = useState(false);
  const [weekStart, setWeekStart] = useState(defaultWeekStart());
  const [weekHomework, setWeekHomework] = useState([]);
  const [recentHomework, setRecentHomework] = useState([]); // last four weeks up to the end of this week
  const [selectedHw, setSelectedHw] = useState(null);
  const tileOrder = useTileOrder('student');

  async function load() {
    if (!studentId) return;
    const { data: r } = await supabase.from('results').select('*, subjects(subject_name, display_name)').eq('student_id', studentId).order('week_start_date', { ascending: false });
    setResults(r || []);
    // Fetched together with the targets and set in the same tick: the target
    // table filters on this, and setting it a render later would briefly show
    // targets for subjects this student doesn't take.
    const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', studentId);
    const { data: enrolled } = await supabase.from('student_class').select('classes(subject_id)').eq('student_id', studentId);
    setTargets(tg || []);
    setEnrolledSubjectIds(new Set((enrolled || []).map((l) => l.classes?.subject_id).filter(Boolean)));
    const { data: gs } = await supabase.from('grade_scale').select('*');
    setGradePoints(Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)])));
    const { data: b } = await supabase.from('behaviour_events').select('*, staff!behaviour_events_staff_id_fkey(first_name, last_name)').eq('student_id', studentId).is('voided_at', null).order('event_date', { ascending: false });
    setBehaviour(b || []);
    setPhotoIds(await loadVisiblePhotoIds(b));
    const { data: ap } = await supabase.from('behaviour_appeals').select('*').eq('student_id', studentId);
    setAppeals(ap || []);
    const { data: bal } = await supabase.rpc('get_tuckshop_balance', { p_student_id: studentId });
    setTuckshopBalance(bal ?? null);
    const { data: settings } = await supabase.from('system_settings').select('tuckshop_ordering_closed_until').maybeSingle();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    const closed = settings?.tuckshop_ordering_closed_until && today < settings.tuckshop_ordering_closed_until;
    const { data: allWindows } = await supabase.rpc('tuckshop_order_windows', { p_days: 7 });
    // The manual closure doesn't stop a special session (migration 241).
    const { data: specials } = closed
      ? await supabase.from('tuckshop_special_sessions').select('for_date')
      : { data: null };
    const specialDates = new Set((specials || []).map((s) => s.for_date));
    const windows = closed ? (allWindows || []).filter((w) => specialDates.has(w.for_date)) : allWindows;
    const closing = (windows || []).find((w) => w.is_open && closingWarning(w.for_date, w.closes_at));
    const warning = closing ? closingWarning(closing.for_date, closing.closes_at) : null;
    if (warning) {
      const { count } = await supabase
        .from('tuckshop_preorders')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .eq('for_date', closing.for_date)
        .eq('status', 'pending');
      setTuckshopWarning({ text: warning, hasOrder: (count || 0) > 0 });
    } else {
      setTuckshopWarning(null);
    }
  }

  useEffect(() => {
    async function loadPeriods() {
      const { data: pr } = await supabase.from('periods').select('*').order('period_number');
      setPeriods(pr || []);
    }
    loadPeriods();
  }, []);

  useEffect(() => {
    async function loadTimetable() {
      if (!studentId) { setTimetableClasses([]); setTimetableLoading(false); return; }
      setTimetableLoading(true);
      const { data } = await supabase
        .from('student_class')
        .select(`classes(class_id, room, class_code, subjects(subject_name, display_name, subject_code), staff(first_name, last_name), timetable_slots(${LESSON_COLUMNS}))`)
        .eq('student_id', studentId);
      const classes = (data || []).map((row) => row.classes).filter(Boolean);
      setTimetableClasses(classes);
      const classIds = classes.map((c) => c.class_id);
      const { data: hwClasses } = classIds.length
        ? await supabase.from('homework_classes').select('class_id').in('class_id', classIds)
        : { data: [] };
      setHomeworkOn((hwClasses || []).length > 0);
      const { data: oh } = await supabase.from('other_half_timetable').select('*').eq('student_id', studentId);
      setOtherHalf(oh || []);
      setTimetableLoading(false);
    }
    loadTimetable();
  }, [studentId]);

  useEffect(() => {
    async function loadStudentName() {
      if (!studentId) { setStudentName(''); return; }
      const { data } = await supabase.from('students').select('first_name, last_name, year_group').eq('student_id', studentId).single();
      setStudentName(data ? `${data.first_name} ${data.last_name}` : '');
      setYearGroup(data?.year_group ?? null);
    }
    loadStudentName();
  }, [studentId]);

  useEffect(() => { load(); }, [studentId]);

  useEffect(() => {
    if (!homeworkOn) return;
    loadMyHomework(weekStart, addDays(weekStart, 6)).then(({ homework }) => setWeekHomework(homework));
  }, [homeworkOn, weekStart]);

  useEffect(() => {
    if (!homeworkOn) return;
    const today = schoolToday();
    loadMyHomework(addDays(today, -28), addDays(weekStartOf(today), 6)).then(({ homework }) => setRecentHomework(homework));
  }, [homeworkOn]);

  function appealFor(eventId) {
    const existing = appeals.find((a) => a.event_id === eventId);
    return existing;
  }

  async function submitAppeal(eventId) {
    if (!appealReason.trim()) { setStatus('Please explain why you are appealing.'); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    let error;
    try {
      ({ error } = await supabase.from('behaviour_appeals').insert({
        event_id: eventId, student_id: studentId, reason: appealReason.trim(),
      }));
    } catch (err) {
      error = err;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    // 23505 = the one-appeal-per-event unique index (migration 136): an earlier
    // submit already got through, so reload and show that one instead.
    if (error?.code === '23505') { setStatus('This event has already been appealed.'); setAppealForm(null); setAppealReason(''); load(); }
    else if (error) setStatus(`Error: ${error.message}`);
    else { setStatus('Appeal submitted — your pastoral manager will review it.'); setAppealForm(null); setAppealReason(''); load(); }
  }

  if (!studentId) {
    return <p>Your account isn't linked to a student record yet — ask the school office to link it.</p>;
  }

  const STATUS_LABEL = { pending: 'Pending review', upheld: 'Appeal upheld', rejected: 'Appeal rejected' };

  const cellMap = {};
  timetableClasses.forEach((c) => {
    (c.timetable_slots || []).forEach((slot) => {
      const key = `${slot.day_of_week}-${slot.period_number}`;
      const entry = {
        classId: c.class_id,
        subject: c.subjects?.display_name || c.subjects?.subject_name,
        room: lessonRoom(slot, c),
        teacher: lessonTeacher(slot, c),
        time: formatTimeRange(slot.start_time, slot.end_time),
        isOtherHalfClass: isOtherHalfSubject(c.subjects),
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
  });
  // The activity chosen for each Other Half day replaces Nova-T's whole-year OH group.
  mergeOtherHalfIntoCells(cellMap, otherHalf, (r) => ({
    subject: r.activity_name,
    room: r.room,
    teacher: r.staff_names,
    time: formatTimeRange(r.start_time, r.end_time),
  }));

  // Homework goes on the lesson it's due in; homework whose class has no lesson
  // that day is listed under the day's heading.
  const unplacedHomework = homeworkOn ? placeHomeworkInCells(cellMap, weekHomework, periods) : {};
  const selectedHomework = [...weekHomework, ...recentHomework].find((h) => h.homework_id === selectedHw) || null;

  function renderTimetableGrid({ forPrint = false } = {}) {
    const withHomework = homeworkOn && !forPrint;
    return (
      <div className="timetable-grid">
        <div className="tt-head"></div>
        {DAYS.map((d, i) => (
          <div key={d} className="tt-head">
            {withHomework ? shortDate(addDays(weekStart, i)) : d}
            {withHomework && (unplacedHomework[d] || []).map((hw) => (
              <div key={hw.homework_id} style={{ marginTop: '0.25rem' }}>
                <HomeworkChip hw={hw} selected={selectedHw === hw.homework_id} onSelect={setSelectedHw} />
              </div>
            ))}
          </div>
        ))}
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
                          {e.subject}<br />
                          <span style={{ opacity: 0.6 }}>{e.room}{e.teacher ? ` · ${e.teacher}` : ''}</span><br />
                          <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{e.time}</span>
                          {withHomework && (e.homework || []).map((hw) => (
                            <div key={hw.homework_id} style={{ marginTop: '0.25rem' }}>
                              <HomeworkChip hw={hw} selected={selectedHw === hw.homework_id} onSelect={setSelectedHw} />
                            </div>
                          ))}
                        </div>
                      ))
                    : ''}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    );
  }

  const shownTargetCount = visibleTargets(targets, results, enrolledSubjectIds).length;
  const positiveCount = behaviour.filter((b) => b.type === 'positive').length;
  const negativeCount = behaviour.filter((b) => b.type === 'negative').length;
  const firstName = studentName.split(' ')[0];

  // Sections that open on this page; the other tiles link to their own pages.
  const VIEWS = ['timetable', 'homework', 'assessment', 'behaviour'];

  // Homework tile badge and lists.
  const today = schoolToday();
  const thisWeekEnd = addDays(weekStartOf(today), 6);
  const dueThisWeek = recentHomework.filter((h) => !h.marked && h.due_on >= today && h.due_on <= thisWeekEnd).length;
  const overdueEarlier = recentHomework.filter((h) => !h.marked && h.due_on < today && h.due_on < weekStart);
  const recentlyGraded = recentHomework.filter((h) => h.marked).sort((a, b) => b.due_on.localeCompare(a.due_on));
  const homeworkByDay = groupHomeworkByDay(weekHomework, weekStart);
  const weekendHomework = [...homeworkByDay[addDays(weekStart, 5)], ...homeworkByDay[addDays(weekStart, 6)]];
  const gridDays = DAYS.map((d, i) => ({ key: d, date: addDays(weekStart, i), items: homeworkByDay[addDays(weekStart, i)] }));
  if (weekendHomework.length) gridDays.push({ key: 'Weekend', date: addDays(weekStart, 5), items: weekendHomework, weekend: true });
  const activeView = VIEWS.includes(view) ? view : null;

  return (
    <div className="dashboard-red">
      <div className="profile-hero no-print">
        <span className="profile-hero-photo">{studentName.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
        <div>
          <h1>{firstName ? `Hello, ${firstName}` : 'My Portal'}</h1>
          <div className="profile-hero-sub">Your timetable, grades and behaviour</div>
        </div>
      </div>

      {activeView === null && tuckshopWarning && (
        <a href="/portal/tuckshop" className="card no-print" style={{ display: 'block', borderLeft: '5px solid #a3232c', background: '#fff4f4', color: 'inherit', textDecoration: 'none' }}>
          <strong>⏰ {tuckshopWarning.text}</strong>
          <div style={{ marginTop: '0.25rem' }}>
            {tuckshopWarning.hasOrder
              ? 'Check your order now if you want to change or cancel it →'
              : 'You haven\'t ordered yet — order now →'}
          </div>
        </a>
      )}

      {activeView === null ? (
        <div className="dashboard-tiles">
          {/* The order is set school-wide at /admin/tile-order (migration 280). */}
          {sortTiles([
            { key: 'timetable', el: <DashboardTile key="timetable" label="Timetable" icon="🗓️" sub="My week" onClick={() => openView('timetable')} /> },
            homeworkOn && { key: 'homework', el: (
              <DashboardTile
                key="homework" label="Homework" icon="📘" onClick={() => openView('homework')}
                sub={dueThisWeek === 0 ? 'Nothing due this week' : `${dueThisWeek} due this week`}
              />
            ) },
            { key: 'other_half', el: (
              <DashboardTile
                key="other_half" label="The Other Half" icon="🎭" href="/portal/other-half"
                sub={otherHalf.length === 0 ? 'Choose activities' : `${otherHalf.length} activit${otherHalf.length === 1 ? 'y' : 'ies'} chosen`}
              />
            ) },
            { key: 'assessment', el: (
              <DashboardTile
                key="assessment" label="Assessment" icon="⭐" onClick={() => openView('assessment')}
                sub={shownTargetCount === 0 ? 'No targets set' : `${shownTargetCount} subject${shownTargetCount === 1 ? '' : 's'} tracked`}
              />
            ) },
            { key: 'behaviour', el: (
              <DashboardTile
                key="behaviour" label="Behaviour" icon="📋" onClick={() => openView('behaviour')}
                sub={behaviour.length === 0 ? 'No events logged' : `${positiveCount} positive, ${negativeCount} negative`}
              />
            ) },
            { key: 'tuckshop', el: (
              <DashboardTile
                key="tuckshop" label="Tuckshop" icon="🛒" href="/portal/tuckshop"
                sub={tuckshopBalance === null ? 'Balance & orders' : `₦${Number(tuckshopBalance).toLocaleString()} balance`}
              />
            ) },
            { key: 'messages', el: <DashboardTile key="messages" label="Messages" icon="📬" sub="View inbox" href="/inbox" /> },
          ].filter(Boolean), tileOrder).map((t) => t.el)}
        </div>
      ) : (
        <DashboardBack onClick={() => openView(null)}>Back to my portal</DashboardBack>
      )}

      {activeView === 'timetable' && (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>My Timetable</h2>
          {timetableClasses.length > 0 && (
            <button className="secondary no-print" onClick={() => window.print()}>Print</button>
          )}
        </div>
        {timetableLoading ? (
          <p>Loading…</p>
        ) : timetableClasses.length === 0 ? (
          <p>No timetable found yet.</p>
        ) : (
          <>
            {homeworkOn && <WeekPicker weekStart={weekStart} onChange={(w) => { setWeekStart(w); setSelectedHw(null); }} />}
            <div className="table-scroll">
              {renderTimetableGrid()}
            </div>
            {homeworkOn && <HomeworkDetail hw={selectedHomework} onClose={() => setSelectedHw(null)} />}
          </>
        )}
      </div>
      )}

      {activeView === 'homework' && (
      <div className="card">
        <h2 style={{ margin: 0 }}>My Homework</h2>
        <WeekPicker weekStart={weekStart} onChange={(w) => { setWeekStart(w); setSelectedHw(null); }} />
        <div className={`hw-grid${gridDays.length > 5 ? ' hw-grid-6' : ''}`}>
          {gridDays.map((d) => (
            <div key={d.key} className={`hw-day${!d.weekend && d.date === today ? ' hw-today' : ''}`}>
              <div className="hw-day-head">{d.weekend ? 'Weekend' : shortDate(d.date)}</div>
              {d.items.length === 0 ? (
                <div className="hw-nothing">Nothing due</div>
              ) : d.items.map((hw) => (
                <HomeworkCard key={hw.homework_id} hw={hw} selected={selectedHw === hw.homework_id} onSelect={setSelectedHw} showDate={d.weekend} />
              ))}
            </div>
          ))}
        </div>
        <HomeworkDetail hw={selectedHomework} onClose={() => setSelectedHw(null)} />

        {overdueEarlier.length > 0 && (
          <>
            <h3>Overdue from earlier weeks</h3>
            <div className="hw-list">
              {overdueEarlier.map((hw) => (
                <HomeworkCard key={hw.homework_id} hw={hw} selected={selectedHw === hw.homework_id} onSelect={setSelectedHw} showDate />
              ))}
            </div>
          </>
        )}
        <h3>Recently graded</h3>
        {recentlyGraded.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)' }}>No grades from the last four weeks yet.</p>
        ) : (
          <div className="hw-list">
            {recentlyGraded.map((hw) => (
              <HomeworkCard key={hw.homework_id} hw={hw} selected={selectedHw === hw.homework_id} onSelect={setSelectedHw} showDate />
            ))}
          </div>
        )}
      </div>
      )}

      {timetableClasses.length > 0 && (
        <div className="timetable-print">
          <h2>{studentName}</h2>
          {renderTimetableGrid({ forPrint: true })}
        </div>
      )}

      {activeView === 'assessment' && (
      <div className="card">
        <h2>Results vs Target</h2>
        <ResultsOverview
          studentId={studentId}
          yearGroup={yearGroup}
          targets={targets}
          results={results}
          gradePoints={gradePoints}
          enrolledSubjectIds={enrolledSubjectIds}
          forStudent
        />
        <p style={{ marginTop: '0.75rem' }}>
          <a href="/results/subject-overview">View my subject overview (max &amp; average %) →</a>
        </p>
      </div>
      )}

      {activeView === 'behaviour' && (
      <div className="card">
        <h2>Behaviour</h2>
        {behaviour.length === 0 ? <p>No events logged.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th><th>Given by</th><th></th></tr></thead>
            <tbody>
              {behaviour.map((b) => {
                const existingAppeal = appealFor(b.event_id);
                return (
                  <tr key={b.event_id}>
                    <td>{b.event_date}</td>
                    <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                    <td>
                      {b.category}
                      {photoIds.has(b.photo_id) && <div style={{ marginTop: '0.3rem' }}><BehaviourPhoto photoId={b.photo_id} /></div>}
                    </td>
                    <td>{b.points}</td>
                    {/* Recorded automatically since migration 138; older events have no staff member. */}
                    <td>{b.staff ? `${b.staff.first_name} ${b.staff.last_name}` : '—'}</td>
                    <td>
                      {b.type !== 'negative' ? '' : existingAppeal ? (
                        <span style={{ fontSize: '0.85rem' }}>{STATUS_LABEL[existingAppeal.status]}</span>
                      ) : appealForm === b.event_id ? (
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            placeholder="Why are you appealing?"
                            value={appealReason}
                            onChange={(e) => setAppealReason(e.target.value)}
                            style={{ width: '12rem' }}
                          />
                          <button onClick={() => submitAppeal(b.event_id)} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</button>
                          <button className="secondary" onClick={() => { setAppealForm(null); setAppealReason(''); }}>Cancel</button>
                        </div>
                      ) : (
                        <button className="secondary" onClick={() => setAppealForm(b.event_id)}>Appeal</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {status && <p>{status}</p>}
      </div>
      )}
    </div>
  );
}

export default function PortalPage() {
  return <RequireAuth><PortalInner /></RequireAuth>;
}
