'use client';
import { useEffect, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import TermTestScoresDownload from '../components/TermTestScoresDownload';
import PublishedDocuments from '../components/PublishedDocuments';
import KeyStageTranscriptDownload from '../components/KeyStageTranscriptDownload';
import SubjectsTwoColumn from '../components/SubjectsTwoColumn';
import { visibleTargets } from '../../lib/gradeCompare';
import { formatUKDate } from '../../lib/formatDate';
import { generateInvoicePdfForStudent } from '../../lib/generateInvoicePdf';
import { schoolToday, schoolWeekdayShort } from '../../lib/schoolTime';
import {
  AttendanceScopeCards,
  AttendanceTodayTable,
  AttendanceRecentTable,
  attendanceTodayLessons,
  formatLateness,
} from '../components/AttendanceSummary';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function ParentPortalInner() {
  const { profile } = useAuth();
  const [resolvedParentId, setResolvedParentId] = useState(profile?.parent_id || null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [activeView, setActiveView] = useState(null); // null = dashboard grid

  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [enrolledSubjectIds, setEnrolledSubjectIds] = useState(null); // null = enrolment not loaded yet
  const [behaviour, setBehaviour] = useState([]);
  const [feeTerm, setFeeTerm] = useState(null);
  const [feeLineItems, setFeeLineItems] = useState([]);
  const [feePayments, setFeePayments] = useState([]);
  const [gradePoints, setGradePoints] = useState({});

  const [periods, setPeriods] = useState([]);
  const [timetableClasses, setTimetableClasses] = useState([]);
  const [timetableLoading, setTimetableLoading] = useState(true);

  const [attendance, setAttendance] = useState([]); // most recent marks, newest first
  const [attendanceToday, setAttendanceToday] = useState([]); // today's marks, lesson by lesson
  const [attendanceSummary, setAttendanceSummary] = useState([]); // today / week / year, counted in the DB
  const [tuckshopBalance, setTuckshopBalance] = useState(null);

  // A parent login already has profile.parent_id set. A staff member who is
  // also a parent doesn't — fall back to matching their login email against
  // the parents table so the same "My Children" view works for both.
  useEffect(() => {
    async function resolveParent() {
      if (profile?.parent_id) { setResolvedParentId(profile.parent_id); return; }
      if (!profile?.email) return;
      const { data } = await supabase
        .from('parents')
        .select('parent_id')
        .eq('email', profile.email)
        .maybeSingle();
      setResolvedParentId(data?.parent_id || null);
    }
    resolveParent();
  }, [profile]);

  const parentId = resolvedParentId;

  useEffect(() => {
    async function loadChildren() {
      if (!parentId) return;
      const { data } = await supabase
        .from('student_parent')
        .select('students(student_id, first_name, last_name, year_group, form_class, photo_base64)')
        .eq('parent_id', parentId);
      const list = (data || []).map((row) => row.students).filter(Boolean);
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
      const { data: r } = await supabase.from('results').select('*, subjects(subject_name, display_name)').eq('student_id', selectedId).order('week_start_date', { ascending: false });
      setResults(r || []);
      // Fetched together with the targets and set in the same tick: the target
      // table filters on this, and setting it a render later would briefly show
      // targets for subjects this child doesn't take.
      const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', selectedId);
      const { data: enrolled } = await supabase.from('student_class').select('classes(subject_id)').eq('student_id', selectedId);
      setTargets(tg || []);
      setEnrolledSubjectIds(new Set((enrolled || []).map((l) => l.classes?.subject_id).filter(Boolean)));
      const { data: b } = await supabase.from('behaviour_events').select('*').eq('student_id', selectedId).order('event_date', { ascending: false });
      setBehaviour(b || []);
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
        .select('classes(class_id, room, class_code, subjects(subject_name, display_name), staff(first_name, last_name), timetable_slots(day_of_week, period_number, start_time, end_time))')
        .eq('student_id', selectedId);
      setTimetableClasses((tt || []).map((row) => row.classes).filter(Boolean));
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
        room: c.room,
        teacher: c.staff ? `${c.staff.first_name} ${c.staff.last_name}` : null,
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
  });

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
      <h1>My Children</h1>

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

                <a href="/parent-portal/tuckshop" className="dashboard-tile" style={{ textDecoration: 'none' }}>
                  <span className="dashboard-tile-label">Tuckshop</span>
                  <span className="dashboard-tile-icon">🛒</span>
                  <span className="dashboard-tile-sub">{tuckshopBalance === null ? 'No data yet' : `₦${Number(tuckshopBalance).toLocaleString()} balance`}</span>
                </a>

                <a href="/inbox" className="dashboard-tile" style={{ textDecoration: 'none' }}>
                  <span className="dashboard-tile-label">Messages</span>
                  <span className="dashboard-tile-icon">📬</span>
                  <span className="dashboard-tile-sub">View inbox</span>
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

          {activeView === 'assessment' && (
            <div className="card">
              <h2>Results vs Target</h2>
              <TermTestScoresDownload studentId={selectedId} />
              <KeyStageTranscriptDownload studentId={selectedId} />
              <PublishedDocuments studentId={selectedId} />
              {shownTargets.length === 0 ? <p>No target grades set yet.</p> : (
                <SubjectsTwoColumn targets={targets} results={results} gradePoints={gradePoints} enrolledSubjectIds={enrolledSubjectIds} />
              )}
            </div>
          )}

          {activeView === 'conduct' && (
            <div className="card">
              <h2>Behaviour</h2>
              {behaviour.length === 0 ? <p>No events logged.</p> : (
                <div className="table-scroll table-compact"><table>
                  <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th></tr></thead>
                  <tbody>
                    {behaviour.map((b) => (
                      <tr key={b.event_id}>
                        <td>{b.event_date}</td>
                        <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                        <td>{b.category}</td>
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
