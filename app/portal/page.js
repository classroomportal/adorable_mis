'use client';
import { useEffect, useRef, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import TermTestScoresDownload from '../components/TermTestScoresDownload';
import PublishedDocuments from '../components/PublishedDocuments';
import KeyStageTranscriptDownload from '../components/KeyStageTranscriptDownload';
import SubjectsTwoColumn from '../components/SubjectsTwoColumn';
import { visibleTargets } from '../../lib/gradeCompare';
import { formatTimeRange } from '../../lib/formatTime';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function PortalInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;
  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
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
  const [timetableLoading, setTimetableLoading] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [enrolledSubjectIds, setEnrolledSubjectIds] = useState(null); // null = enrolment not loaded yet

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
    const { data: b } = await supabase.from('behaviour_events').select('*').eq('student_id', studentId).order('event_date', { ascending: false });
    setBehaviour(b || []);
    const { data: ap } = await supabase.from('behaviour_appeals').select('*').eq('student_id', studentId);
    setAppeals(ap || []);
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
        .select('classes(class_id, room, class_code, subjects(subject_name, display_name), staff(first_name, last_name), timetable_slots(day_of_week, period_number, start_time, end_time))')
        .eq('student_id', studentId);
      setTimetableClasses((data || []).map((row) => row.classes).filter(Boolean));
      setTimetableLoading(false);
    }
    loadTimetable();
  }, [studentId]);

  useEffect(() => {
    async function loadStudentName() {
      if (!studentId) { setStudentName(''); return; }
      const { data } = await supabase.from('students').select('first_name, last_name').eq('student_id', studentId).single();
      setStudentName(data ? `${data.first_name} ${data.last_name}` : '');
    }
    loadStudentName();
  }, [studentId]);

  useEffect(() => { load(); }, [studentId]);

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
        subject: c.subjects?.display_name || c.subjects?.subject_name,
        room: c.room,
        teacher: c.staff ? `${c.staff.first_name} ${c.staff.last_name}` : null,
        time: formatTimeRange(slot.start_time, slot.end_time),
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
  });

  function renderTimetableGrid() {
    return (
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
                          <span style={{ opacity: 0.6 }}>{e.room}{e.teacher ? ` · ${e.teacher}` : ''}</span><br />
                          <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{e.time}</span>
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

  return (
    <div>
      <h1>My Grades & Behaviour</h1>
      <p><a href="/inbox">📬 Inbox</a></p>
      <TermTestScoresDownload studentId={studentId} />
      <KeyStageTranscriptDownload studentId={studentId} />
      <PublishedDocuments studentId={studentId} />

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
          <div className="table-scroll">
            {renderTimetableGrid()}
          </div>
        )}
      </div>

      {timetableClasses.length > 0 && (
        <div className="timetable-print">
          <h2>{studentName}</h2>
          {renderTimetableGrid()}
        </div>
      )}

      <div className="card">
        <h2>Results vs Target</h2>
        {visibleTargets(targets, results, enrolledSubjectIds).length === 0 ? <p>No target grades set yet.</p> : (
          <SubjectsTwoColumn targets={targets} results={results} gradePoints={gradePoints} enrolledSubjectIds={enrolledSubjectIds} />
        )}
        <p style={{ marginTop: '0.75rem' }}>
          <a href="/results/subject-overview">View my subject overview (max &amp; average %) →</a>
        </p>
      </div>

      <div className="card">
        <h2>Behaviour</h2>
        {behaviour.length === 0 ? <p>No events logged.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th><th></th></tr></thead>
            <tbody>
              {behaviour.map((b) => {
                const existingAppeal = appealFor(b.event_id);
                return (
                  <tr key={b.event_id}>
                    <td>{b.event_date}</td>
                    <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                    <td>{b.category}</td>
                    <td>{b.points}</td>
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
    </div>
  );
}

export default function PortalPage() {
  return <RequireAuth><PortalInner /></RequireAuth>;
}
