'use client';
import { useEffect, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { LESSON_COLUMNS, lessonRoom, lessonTeacher } from '../../lib/lessons';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import ResultsOverview from '../components/ResultsOverview';
import { visibleTargets } from '../../lib/gradeCompare';
import { formatUKDate } from '../../lib/formatDate';
import { findParentIdByEmail } from '../../lib/parentByEmail';
import { generateInvoicePdfForStudent } from '../../lib/generateInvoicePdf';
import { schoolToday, schoolWeekdayShort } from '../../lib/schoolTime';
import { isOtherHalfSubject, mergeOtherHalfIntoCells } from '../../lib/otherHalf';
import ChildOtherHalf from '../components/ChildOtherHalf';
import BehaviourPhoto from '../components/BehaviourPhoto';
import PortalGroups from '../components/PortalGroups';
import { loadPortalGroups } from '../../lib/studentGroups';
import {
  AttendanceScopeCards,
  AttendanceTodayTable,
  AttendanceRecentTable,
  attendanceTodayLessons,
  formatLateness,
} from '../components/AttendanceSummary';


// Which of these events have a picture this viewer may see. Row-level
// security (migration 209) only returns approved pictures on the viewer's own
// visible events, so this asks for ids only — images load when tapped. The
// approved filter is repeated here for staff who are also parents: RLS lets
// them read every picture, but this page must show what a parent would see.
async function loadVisiblePhotoIds(events) {
  const ids = [...new Set((events || []).map((e) => e.photo_id).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from('behaviour_photos').select('photo_id').in('photo_id', ids).eq('status', 'approved');
  return new Set((data || []).map((p) => p.photo_id));
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// viewAsParentId: staff previewing the portal as a given parent sees
// (/parents/view-as). Everything below reads through the staff member's own
// login, so any rule that narrows what a parent sees beyond "their own
// children" must also be applied here in the query, not left to RLS — see
// the behaviour and picture filters.
export function ParentPortalInner({ viewAsParentId = null } = {}) {
  const { profile, session } = useAuth();
  const viewingAs = !!viewAsParentId;
  const [resolvedParentId, setResolvedParentId] = useState(viewAsParentId || profile?.parent_id || null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [activeView, setActiveView] = useState(null); // null = dashboard grid

  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [enrolledSubjectIds, setEnrolledSubjectIds] = useState(null); // null = enrolment not loaded yet
  const [behaviour, setBehaviour] = useState([]);
  const [photoIds, setPhotoIds] = useState(new Set()); // approved pictures this viewer may see
  const [feeTerm, setFeeTerm] = useState(null);
  const [feeLineItems, setFeeLineItems] = useState([]);
  const [feePayments, setFeePayments] = useState([]);
  const [gradePoints, setGradePoints] = useState({});

  const [periods, setPeriods] = useState([]);
  const [timetableClasses, setTimetableClasses] = useState([]);
  const [otherHalf, setOtherHalf] = useState([]); // chosen OH activities (other_half_timetable)
  const [timetableLoading, setTimetableLoading] = useState(true);

  const [attendance, setAttendance] = useState([]); // most recent marks, newest first
  const [attendanceToday, setAttendanceToday] = useState([]); // today's marks, lesson by lesson
  const [attendanceSummary, setAttendanceSummary] = useState([]); // today / week / year, counted in the DB
  const [tuckshopBalance, setTuckshopBalance] = useState(null);
  // Groups shown to parents (migration 300). The database returns the
  // parent's view for staff viewing as a parent too.
  const [groups, setGroups] = useState([]);

  // A parent login already has profile.parent_id set, and so do many staff
  // who are also parents. For those that don't, fall back to matching their
  // sign-in email against the parents table so the same "My Children" view
  // works for both.
  useEffect(() => {
    async function resolveParent() {
      if (viewAsParentId) { setResolvedParentId(viewAsParentId); return; }
      if (profile?.parent_id) { setResolvedParentId(profile.parent_id); return; }
      setResolvedParentId(await findParentIdByEmail(profile?.email || session?.user?.email));
    }
    resolveParent();
  }, [profile, session, viewAsParentId]);

  const parentId = resolvedParentId;

  useEffect(() => {
    async function loadChildren() {
      setSelectedId('');
      setActiveView(null);
      if (!parentId) return;
      const { data } = await supabase
        .from('student_parent')
        .select('students(student_id, first_name, last_name, year_group, form_class, photo_base64, status)')
        .eq('parent_id', parentId);
      // Parents see only children still at the school (migration 255 does
      // this in RLS); the status filter covers staff who are also parents,
      // and staff viewing as a parent, whose staff access reads leavers too.
      const list = (data || []).map((row) => row.students).filter((s) => s && s.status === 'active');
      setChildren(list);
      if (list.length === 1) setSelectedId(list[0].student_id);
    }
    loadChildren();
  }, [parentId]);

  useEffect(() => {
    async function loadPeriods() {
      const { data: pr } = await supabase.from('periods').select('*').order('period_number');
      setPeriods(pr || []);
    }
    loadPeriods();
  }, []);

  useEffect(() => {
    async function loadChildData() {
      if (!selectedId) return;
      setActiveView(null);
      setGroups([]);
      loadPortalGroups(selectedId).then(setGroups);
      const { data: r } = await supabase.from('results').select('*, subjects(subject_name, display_name)').eq('student_id', selectedId).order('week_start_date', { ascending: false });
      setResults(r || []);
      // Fetched together with the targets and set in the same tick: the target
      // table filters on this, and setting it a render later would briefly show
      // targets for subjects this child doesn't take.
      const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', selectedId);
      const { data: enrolled } = await supabase.from('student_class').select('classes(subject_id)').eq('student_id', selectedId);
      setTargets(tg || []);
      setEnrolledSubjectIds(new Set((enrolled || []).map((l) => l.classes?.subject_id).filter(Boolean)));
      // visible_to_parents is enforced by RLS for parent logins, but a member
      // of staff who is also a parent reads through the staff policy, which
      // returns incidents hidden from parents too. Filter here as well so
      // "My Children" shows them exactly what any other parent sees.
      const { data: b } = await supabase.from('behaviour_events').select('*, classes(subjects(subject_name, display_name))').eq('student_id', selectedId).eq('visible_to_parents', true).is('voided_at', null).order('event_date', { ascending: false });
      setBehaviour(b || []);
      setPhotoIds(await loadVisiblePhotoIds(b));
      const { data: gs } = await supabase.from('grade_scale').select('*');
      setGradePoints(Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)])));
      // Counted in Postgres rather than pulled row by row: a full academic year
      // runs to well over a thousand marks per child, past PostgREST's default
      // page size, so totalling here would quietly under-report.
      const { data: attSummary } = await supabase.rpc('student_attendance_summary', { p_student_id: selectedId });
      setAttendanceSummary(attSummary || []);
      const { data: attToday } = await supabase
        .from('attendance')
        .select('attendance_id, period_number, code, status, minutes_late')
        .eq('student_id', selectedId)
        .eq('attend_date', schoolToday())
        .order('period_number');
      setAttendanceToday(attToday || []);
      const { data: att } = await supabase
        .from('attendance')
        .select('attendance_id, attend_date, period_number, status, code, minutes_late')
        .eq('student_id', selectedId)
        .order('attend_date', { ascending: false })
        .order('period_number', { ascending: true })
        .limit(60);
      setAttendance(att || []);
      const { data: bal } = await supabase.rpc('get_tuckshop_balance', { p_student_id: selectedId });
      setTuckshopBalance(bal);

      setTimetableLoading(true);
      const { data: tt } = await supabase
        .from('student_class')
        .select(`classes(class_id, room, class_code, subjects(subject_name, display_name, subject_code), staff(first_name, last_name), timetable_slots(${LESSON_COLUMNS}))`)
        .eq('student_id', selectedId);
      setTimetableClasses((tt || []).map((row) => row.classes).filter(Boolean));
      const { data: oh } = await supabase.from('other_half_timetable').select('*').eq('student_id', selectedId);
      setOtherHalf(oh || []);
      setTimetableLoading(false);

      const { data: term } = await supabase.from('fee_terms').select('id, name, is_current, published_to_parents').eq('is_current', true).maybeSingle();
      const visibleTerm = term?.published_to_parents ? term : null;
      setFeeTerm(visibleTerm);
      if (visibleTerm) {
        const { data: invoice } = await supabase
          .from('student_invoices')
          .select('id, status')
          .eq('student_id', selectedId)
          .eq('term_id', term.id)
          .maybeSingle();
        if (invoice) {
          const [{ data: items }, { data: pays }] = await Promise.all([
            supabase
              .from('invoice_line_items')
              .select('id, description, amount, fee_items(name, display_name)')
              .eq('invoice_id', invoice.id)
              .order('created_at'),
            supabase
              .from('fee_payments')
              .select('id, amount, method, paid_date')
              .eq('invoice_id', invoice.id)
              .order('paid_date', { ascending: false }),
          ]);
          setFeeLineItems((items || []).map((li) => ({ ...li, status: invoice.status })));
          setFeePayments(pays || []);
        } else {
          setFeeLineItems([]);
          setFeePayments([]);
        }
      }
    }
    loadChildData();
  }, [selectedId]);

  if (!parentId) {
    return <p>Your account isn't linked to a parent record yet — contact the school office.</p>;
  }

  const negativeCount = behaviour.filter((b) => b.type === 'negative').length;
  const positiveCount = behaviour.filter((b) => b.type === 'positive').length;

  // target_grades carries a row for every subject the school offers, not just
  // the ones this child is actually taking, so the tile has to count what the
  // table below will really render — hence the shared helper rather than a
  // second copy of the rule.
  const shownTargets = visibleTargets(targets, results, enrolledSubjectIds);

  const attendanceYear = attendanceSummary.find((r) => r.scope === 'year');
  const attendanceSessions = Number(attendanceYear?.sessions || 0);
  const attendancePct = attendanceSessions > 0
    ? Math.round(((Number(attendanceYear.present) + Number(attendanceYear.late)) / attendanceSessions) * 100)
    : null;
  const attendanceLateMinutes = Number(attendanceYear?.late_minutes || 0);

  const totalDue = feeLineItems.reduce((sum, li) => sum + Number(li.amount), 0);
  const totalPaid = feePayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const nowDue = totalDue - totalPaid;
  const feeStatus = feeLineItems[0]?.status;

  const cellMap = {};
  timetableClasses.forEach((c) => {
    (c.timetable_slots || []).forEach((slot) => {
      const key = `${slot.day_of_week}-${slot.period_number}`;
      const entry = {
        subject: c.subjects?.display_name || c.subjects?.subject_name,
        room: lessonRoom(slot, c),
        teacher: lessonTeacher(slot, c),
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
  }));

  const periodName = (n) => periods.find((p) => p.period_number === n)?.period_name || (n ? `Period ${n}` : '—');

  // A child can be down for more than one class in a period (option blocks are
  // stored per subject), so cellMap holds a list. The register is taken once
  // per period, so name the first and let the timetable view show the rest.
  const todayDayLabel = schoolWeekdayShort();
  const attendanceTodayList = attendanceTodayLessons({
    periods,
    marks: attendanceToday,
    lessonFor: (n) => (cellMap[`${todayDayLabel}-${n}`] || [])[0],
  });

  const selectedChild = children.find((c) => c.student_id === selectedId);
  const BackLink = () => <p className="dashboard-back" onClick={() => setActiveView(null)}>&larr; Back to dashboard</p>;

  return (
    <div>
      {!viewingAs && <h1>My Children</h1>}

      {children.length === 0 ? (
        <p>No linked children found.</p>
      ) : !selectedId ? (
        <div className="dashboard-tiles">
          {children.map((c) => (
            <button
              key={c.student_id}
              type="button"
              className="dashboard-tile child-tile"
              onClick={() => setSelectedId(c.student_id)}
            >
              {c.photo_base64 ? (
                <img className="child-tile-photo" src={`data:image/jpeg;base64,${c.photo_base64}`} alt="" />
              ) : (
                <span className="child-tile-photo child-tile-placeholder">{c.first_name?.[0]}{c.last_name?.[0]}</span>
              )}
              <span className="dashboard-tile-label">{c.first_name} {c.last_name}</span>
              <span className="dashboard-tile-sub">{c.form_class || `Year ${c.year_group}`}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {children.length > 1 && (
            <p className="dashboard-back" onClick={() => { setSelectedId(''); setActiveView(null); }}>&larr; Switch child</p>
          )}

          {activeView === null ? (
            <>
              <div className="dashboard-tiles">
                <button type="button" className="dashboard-tile" onClick={() => setActiveView('timetable')}>
                  <span className="dashboard-tile-label">Timetable</span>
                  <span className="dashboard-tile-icon">🗓️</span>
                  <span className="dashboard-tile-sub">{selectedChild ? `${selectedChild.first_name}'s week` : ''}</span>
                </button>

                <button type="button" className="dashboard-tile" onClick={() => setActiveView('otherhalf')}>
                  <span className="dashboard-tile-label">The Other Half</span>
                  <span className="dashboard-tile-icon">🎭</span>
                  <span className="dashboard-tile-sub">{otherHalf.length === 0 ? 'No activities chosen yet' : `${otherHalf.length} activit${otherHalf.length === 1 ? 'y' : 'ies'} chosen`}</span>
                </button>

                <button type="button" className="dashboard-tile" onClick={() => setActiveView('assessment')}>
                  <span className="dashboard-tile-label">Assessment</span>
                  <span className="dashboard-tile-icon">⭐</span>
                  <span className="dashboard-tile-sub">{shownTargets.length === 0 ? 'No targets set' : `${shownTargets.length} subject${shownTargets.length === 1 ? '' : 's'} tracked`}</span>
                </button>

                <button type="button" className="dashboard-tile" onClick={() => setActiveView('conduct')}>
                  <span className="dashboard-tile-label">Conduct</span>
                  <span className="dashboard-tile-icon">📋</span>
                  <span className="dashboard-tile-sub">{behaviour.length === 0 ? 'No incidents logged' : `${positiveCount} positive, ${negativeCount} negative`}</span>
                </button>

                <button type="button" className="dashboard-tile" onClick={() => setActiveView('attendance')}>
                  <span className="dashboard-tile-label">Attendance</span>
                  <span className="dashboard-tile-icon">📊</span>
                  <span className="dashboard-tile-sub">
                    {attendancePct === null
                      ? 'No data yet'
                      : `${attendancePct}% this year${attendanceLateMinutes > 0 ? ` · ${formatLateness(attendanceLateMinutes)} late` : ''}`}
                  </span>
                </button>

                {feeTerm && (
                  <button type="button" className="dashboard-tile" onClick={() => setActiveView('fees')}>
                    <span className="dashboard-tile-label">Fees</span>
                    <span className="dashboard-tile-icon">💰</span>
                    <span className="dashboard-tile-sub">{feeLineItems.length === 0 ? 'No invoice yet' : feeStatus === 'paid' ? 'Paid in full' : `₦${nowDue.toLocaleString()} due`}</span>
                  </button>
                )}

                {groups.length > 0 && (
                  <button type="button" className="dashboard-tile" onClick={() => setActiveView('groups')}>
                    <span className="dashboard-tile-label">Groups</span>
                    <span className="dashboard-tile-icon">👥</span>
                    <span className="dashboard-tile-sub">{`${groups.length} group${groups.length === 1 ? '' : 's'}`}</span>
                  </button>
                )}

                {/* The school calendar is the same for everyone, so this one
                    stays a link when staff are viewing as a parent. */}
                <a href="/parent-portal/calendar" className="dashboard-tile" style={{ textDecoration: 'none' }}>
                  <span className="dashboard-tile-label">School Calendar</span>
                  <span className="dashboard-tile-icon">📅</span>
                  <span className="dashboard-tile-sub">Term dates and events</span>
                </a>

                {/* These open pages for whoever is signed in, so when staff
                    are viewing as a parent they'd show the staff member's own
                    inbox and tuckshop — show the tiles but don't link them. */}
                <a href={viewingAs ? undefined : '/parent-portal/tuckshop'} className="dashboard-tile" style={{ textDecoration: 'none', cursor: viewingAs ? 'default' : undefined }}>
                  <span className="dashboard-tile-label">Tuckshop</span>
                  <span className="dashboard-tile-icon">🛒</span>
                  <span className="dashboard-tile-sub">{tuckshopBalance === null ? 'No data yet' : `₦${Number(tuckshopBalance).toLocaleString()} balance`}</span>
                </a>

                <a href={viewingAs ? undefined : '/inbox'} className="dashboard-tile" style={{ textDecoration: 'none', cursor: viewingAs ? 'default' : undefined }}>
                  <span className="dashboard-tile-label">Messages</span>
                  <span className="dashboard-tile-icon">📬</span>
                  <span className="dashboard-tile-sub">{viewingAs ? 'Their inbox (not shown here)' : 'View inbox'}</span>
                </a>
              </div>
            </>
          ) : (
        <>
          <BackLink />

          {activeView === 'timetable' && (
            <div className="card">
              <h2>Timetable</h2>
              {timetableLoading ? (
                <p>Loading…</p>
              ) : timetableClasses.length === 0 ? (
                <p>No timetable found yet.</p>
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
                                      {e.subject}<br />
                                      <span style={{ opacity: 0.6 }}>{e.room}{e.teacher ? ` · ${e.teacher}` : ''}</span>
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
          )}

          {activeView === 'otherhalf' && selectedChild && (
            <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <h2>The Other Half</h2>
              <ChildOtherHalf studentId={selectedId} yearGroup={selectedChild.year_group} firstName={selectedChild.first_name} />
            </div>
          )}

          {activeView === 'assessment' && (
            <div className="card">
              <h2>Results vs Target</h2>
              <ResultsOverview
                studentId={selectedId}
                yearGroup={selectedChild?.year_group}
                targets={targets}
                results={results}
                gradePoints={gradePoints}
                enrolledSubjectIds={enrolledSubjectIds}
              />
            </div>
          )}

          {activeView === 'groups' && (
            <div className="card">
              <h2>Groups</h2>
              <PortalGroups groups={groups} firstName={selectedChild?.first_name} />
            </div>
          )}

          {activeView === 'conduct' && (
            <div className="card">
              <h2>Behaviour</h2>
              {behaviour.length === 0 ? <p>No events logged.</p> : (
                <div className="table-scroll table-compact"><table>
                  <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Subject</th><th>Points</th></tr></thead>
                  <tbody>
                    {behaviour.map((b) => (
                      <tr key={b.event_id}>
                        <td>{b.event_date}</td>
                        <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                        <td>
                          {b.category}
                          {photoIds.has(b.photo_id) && <div style={{ marginTop: '0.3rem' }}><BehaviourPhoto photoId={b.photo_id} /></div>}
                        </td>
                        {/* Parents see the subject, not the teacher (students see who gave it). */}
                        <td>{b.classes?.subjects?.display_name || b.classes?.subjects?.subject_name || '—'}</td>
                        <td>{b.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          )}

          {activeView === 'attendance' && (
            <div className="card">
              <h2>Attendance</h2>
              {attendanceSummary.length === 0 && attendance.length === 0 ? <p>No attendance recorded yet.</p> : (
                <>
                  <AttendanceScopeCards summary={attendanceSummary} />

                  <h3 style={{ margin: '0 0 0.4rem' }}>Today, lesson by lesson</h3>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#5b6472' }}>
                    {formatUKDate(schoolToday())}
                    {attendanceTodayList.length === 0 && ' — nothing timetabled and no register taken.'}
                  </p>
                  <AttendanceTodayTable lessons={attendanceTodayList} />

                  <h3 style={{ margin: '1.25rem 0 0.4rem' }}>Recent marks</h3>
                  {attendance.length === 0
                    ? <p>No marks recorded yet.</p>
                    : <AttendanceRecentTable marks={attendance} periodName={periodName} />}
                </>
              )}
            </div>
          )}

          {activeView === 'fees' && feeTerm && (
            <div className="card">
              <h2>Fees{feeTerm ? ` — ${feeTerm.name}` : ''}</h2>
              {feeStatus && (
                <span className={`badge ${feeStatus === 'paid' ? 'badge-positive' : 'badge-negative'}`} style={{ marginBottom: '0.6rem', display: 'inline-block' }}>
                  {feeStatus}
                </span>
              )}

              {feeLineItems.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => generateInvoicePdfForStudent(selectedId, feeTerm.id)}
                    style={{ marginTop: '0.5rem' }}
                  >
                    Download PDF
                  </button>
                </div>
              )}

              {feeLineItems.length === 0 ? (
                <p>No invoice available yet for this term.</p>
              ) : (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead><tr><th>Item</th><th>Amount</th></tr></thead>
                      <tbody>
                        {feeLineItems.map((li) => (
                          <tr key={li.id}>
                            <td>{li.description || li.fee_items?.display_name || li.fee_items?.name}</td>
                            <td>₦{Number(li.amount).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Total</span>
                      <span>₦{totalDue.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Paid</span>
                      <span>₦{totalPaid.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>Now due</span>
                      <span>₦{nowDue.toLocaleString()}</span>
                    </div>
                  </div>

                  {feePayments.length > 0 && (
                    <>
                      <h3 style={{ marginTop: '1rem' }}>Payment history</h3>
                      <div className="table-scroll">
                        <table>
                          <thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
                          <tbody>
                            {feePayments.map((p) => (
                              <tr key={p.id}>
                                <td>{p.paid_date}</td>
                                <td>₦{Number(p.amount).toLocaleString()}</td>
                                <td>{p.method}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
          )}
        </>
      )}
    </div>
  );
}

export default function ParentPortalPage() {
  // Not gated by RequireResource: ParentPortalInner is also rendered directly
  // for profile.role === 'parent' (see app/page.js), and parents themselves
  // never hold a staff role/resource grant — gating this route would lock
  // them out of their own portal if they ever land on it directly.
  return <RequireAuth><ParentPortalInner /></RequireAuth>;
}
