'use client';
import { useEffect, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import TranscriptDownload from '../components/TranscriptDownload';
import SubjectsTwoColumn from '../components/SubjectsTwoColumn';
import { generateInvoicePdfForStudent } from '../../lib/generateInvoicePdf';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ATTENDANCE_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', authorized_absence: 'Authorised absence' };

function ParentPortalInner() {
  const { profile } = useAuth();
  const [resolvedParentId, setResolvedParentId] = useState(profile?.parent_id || null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [activeView, setActiveView] = useState(null); // null = dashboard grid

  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [feeTerm, setFeeTerm] = useState(null);
  const [feeLineItems, setFeeLineItems] = useState([]);
  const [feePayments, setFeePayments] = useState([]);
  const [gradePoints, setGradePoints] = useState({});

  const [periods, setPeriods] = useState([]);
  const [timetableClasses, setTimetableClasses] = useState([]);
  const [timetableLoading, setTimetableLoading] = useState(true);

  const [attendance, setAttendance] = useState([]);

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
        .select('students(student_id, first_name, last_name, year_group, form_class)')
        .eq('parent_id', parentId);
      const list = (data || []).map((row) => row.students).filter(Boolean);
      setChildren(list);
      if (list.length > 0) setSelectedId(list[0].student_id);
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
      const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', selectedId);
      setTargets(tg || []);
      const { data: b } = await supabase.from('behaviour_events').select('*').eq('student_id', selectedId).order('event_date', { ascending: false });
      setBehaviour(b || []);
      const { data: gs } = await supabase.from('grade_scale').select('*');
      setGradePoints(Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)])));
      const { data: att } = await supabase.from('attendance').select('attend_date, status, code').eq('student_id', selectedId).order('attend_date', { ascending: false });
      setAttendance(att || []);

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

  const presentLike = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;
  const attendancePct = attendance.length > 0 ? Math.round((presentLike / attendance.length) * 100) : null;
  const attendanceCounts = attendance.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});

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

  const selectedChild = children.find((c) => c.student_id === selectedId);
  const BackLink = () => <p className="dashboard-back" onClick={() => setActiveView(null)}>&larr; Back to dashboard</p>;

  return (
    <div>
      <h1>My Children</h1>

      {children.length > 1 && (
        <div className="card">
          <label>
            Child
            <select value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))}>
              {children.map((c) => (
                <option key={c.student_id} value={c.student_id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {children.length === 0 ? <p>No linked children found.</p> : activeView === null ? (
        <>
          <div className="card">
            <TranscriptDownload studentId={selectedId} />
          </div>

          <div className="dashboard-tiles">
            <button type="button" className="dashboard-tile" onClick={() => setActiveView('timetable')}>
              <span className="dashboard-tile-label">Timetable</span>
              <span className="dashboard-tile-icon">🗓️</span>
              <span className="dashboard-tile-sub">{selectedChild ? `${selectedChild.first_name}'s week` : ''}</span>
            </button>

            <button type="button" className="dashboard-tile" onClick={() => setActiveView('assessment')}>
              <span className="dashboard-tile-label">Assessment</span>
              <span className="dashboard-tile-icon">⭐</span>
              <span className="dashboard-tile-sub">{targets.length === 0 ? 'No targets set' : `${targets.length} subject${targets.length === 1 ? '' : 's'} tracked`}</span>
            </button>

            <button type="button" className="dashboard-tile" onClick={() => setActiveView('conduct')}>
              <span className="dashboard-tile-label">Conduct</span>
              <span className="dashboard-tile-icon">📋</span>
              <span className="dashboard-tile-sub">{behaviour.length === 0 ? 'No incidents logged' : `${positiveCount} positive, ${negativeCount} negative`}</span>
            </button>

            <button type="button" className="dashboard-tile" onClick={() => setActiveView('attendance')}>
              <span className="dashboard-tile-label">Attendance</span>
              <span className="dashboard-tile-icon">📊</span>
              <span className="dashboard-tile-sub">{attendancePct === null ? 'No data yet' : `${attendancePct}% present`}</span>
            </button>

            {feeTerm && (
              <button type="button" className="dashboard-tile" onClick={() => setActiveView('fees')}>
                <span className="dashboard-tile-label">Fees</span>
                <span className="dashboard-tile-icon">💰</span>
                <span className="dashboard-tile-sub">{feeLineItems.length === 0 ? 'No invoice yet' : feeStatus === 'paid' ? 'Paid in full' : `₦${nowDue.toLocaleString()} due`}</span>
              </button>
            )}

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
              {targets.length === 0 ? <p>No target grades set yet.</p> : (
                <SubjectsTwoColumn targets={targets} results={results} gradePoints={gradePoints} />
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
              {attendance.length === 0 ? <p>No attendance recorded yet.</p> : (
                <>
                  <p><strong>{attendancePct}%</strong> present or late overall ({attendance.length} session{attendance.length === 1 ? '' : 's'} recorded)</p>
                  <div className="table-scroll table-compact"><table>
                    <thead><tr><th>Status</th><th>Count</th></tr></thead>
                    <tbody>
                      {Object.entries(attendanceCounts).map(([status, count]) => (
                        <tr key={status}><td>{ATTENDANCE_LABEL[status] || status}</td><td>{count}</td></tr>
                      ))}
                    </tbody>
                  </table></div>
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
    </div>
  );
}

export default function ParentPortalPage() {
  return <RequireAuth><ParentPortalInner /></RequireAuth>;
}
