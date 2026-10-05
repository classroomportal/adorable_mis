'use client';

// Lesson feedback (migration 365). Students give feedback on a lesson from
// their timetable; staff see it here as a summary per class, never with
// names (the principal, 5 Oct 2026). Teachers see the lessons they taught,
// Heads of Department their department, SMT every class, all through
// lesson_feedback_summary(), which holds back a class's figures until it has
// at least 3 responses in the dates chosen. Only SMT also get the named
// responses (the table's own select policy), so someone can follow up a
// student who was red or asked for extra help.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { schoolToday } from '../../lib/schoolTime';
import { addDays, weekStartOf } from '../../lib/homework';
import { formatUKDate } from '../../lib/formatDate';
import { MIN_RESPONSES, UNDERSTANDING, answerTone, loadFeedbackQuestions } from '../../lib/lessonFeedback';

const soft = { fontSize: '0.85em', color: 'var(--ink-soft)' };

function pct(n, total) {
  return total ? Math.round((100 * n) / total) : 0;
}

function RagBar({ green, amber, red }) {
  const total = green + amber + red;
  return (
    <div>
      <div className="lf-bar" title={`Green ${green}, amber ${amber}, red ${red}`}>
        <span className="g" style={{ width: `${pct(green, total)}%` }} />
        <span className="a" style={{ width: `${pct(amber, total)}%` }} />
        <span className="r" style={{ width: `${pct(red, total)}%` }} />
      </div>
      <div style={soft}>{pct(green, total)}% · {pct(amber, total)}% · {pct(red, total)}%</div>
    </div>
  );
}

// "% yes" for a question, coloured by whether yes is the good answer.
function QuestionCell({ q }) {
  if (!q) return <td style={soft}>—</td>;
  const total = q.yes + q.no;
  const p = pct(q.yes, total);
  let cls = 'lf-pct-mid';
  if (q.good_answer != null) {
    const goodShare = q.good_answer ? p : 100 - p;
    cls = goodShare >= 75 ? 'lf-pct-good' : goodShare < 50 ? 'lf-pct-bad' : 'lf-pct-mid';
  }
  return <td className={cls} title={`Yes ${q.yes}, No ${q.no}`}>{p}%</td>;
}

function LessonFeedbackInner() {
  const { staffRoles } = useAuth();
  const isSmt = staffRoles.includes('smt');
  const today = schoolToday();
  const [from, setFrom] = useState(addDays(today, -27));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [named, setNamed] = useState([]);
  const [followUpOnly, setFollowUpOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    loadFeedbackQuestions({ includeRetired: true }).then(({ questions: q }) => setQuestions(q));
  }, []);

  async function load() {
    setLoading(true);
    setStatus(null);
    const { data, error } = await supabase.rpc('lesson_feedback_summary', { p_from: from, p_to: to });
    if (error) setStatus(`Error: ${error.message}`);
    setRows(data || []);
    if (isSmt) {
      const { data: n, error: nErr } = await supabase
        .from('lesson_feedback')
        .select('feedback_id, lesson_date, period_number, understanding, created_at, students(first_name, last_name, year_group), classes(class_code), staff(first_name, last_name), lesson_feedback_answers(question_id, answer)')
        .gte('lesson_date', from)
        .lte('lesson_date', to)
        .order('lesson_date', { ascending: false })
        .order('period_number')
        .limit(1000);
      if (nErr) setStatus(`Error: ${nErr.message}`);
      setNamed(n || []);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [from, to, isSmt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Question columns: the active questions, plus any retired one that still
  // has answers in the dates shown.
  const answered = new Set(rows.flatMap((r) => (r.questions || []).map((q) => q.question_id)));
  const columns = questions.filter((q) => q.active || answered.has(q.question_id));
  const neutralIds = new Set(questions.filter((q) => q.good_answer == null).map((q) => q.question_id));

  // Named list (SMT): red, or Yes to a question that isn't good or bad
  // ("Would you like extra help?").
  const needsFollowUp = (f) => f.understanding === 'red'
    || (f.lesson_feedback_answers || []).some((a) => a.answer && neutralIds.has(a.question_id));
  const namedShown = followUpOnly ? named.filter(needsFollowUp) : named;

  const shown = rows.filter((r) => r.responses >= MIN_RESPONSES);
  const held = rows.filter((r) => r.responses < MIN_RESPONSES);
  const thisWeek = weekStartOf(today);

  return (
    <div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Lesson Feedback</h2>
        <p style={{ marginTop: 0 }}>
          Students give feedback on a lesson from their timetable, from the end of the lesson until the end of the next day.
          This page shows a summary for each class, never students&apos; names. A class&apos;s figures appear once it has at
          least {MIN_RESPONSES} responses in the dates chosen.
          {isSmt ? ' As SMT you also see the named responses below.' : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>From<br /><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label>To<br /><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          <button type="button" className="secondary" onClick={() => { setFrom(thisWeek); setTo(today); }}>This week</button>
          <button type="button" className="secondary" onClick={() => { setFrom(addDays(thisWeek, -7)); setTo(addDays(thisWeek, -1)); }}>Last week</button>
          <button type="button" className="secondary" onClick={() => { setFrom(addDays(today, -27)); setTo(today); }}>Last 4 weeks</button>
        </div>
        {status && <p style={{ color: 'red' }}>{status}</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>By class</h3>
        <p style={{ ...soft, marginTop: 0 }}>
          Understanding is green · amber · red. Each question shows the share who answered Yes, in green where most gave the
          good answer and red where most didn&apos;t (for &ldquo;too easy&rdquo;, &ldquo;too hard&rdquo; and &ldquo;bored&rdquo;, No is the good answer).
          Hover over a figure for the counts.
        </p>
        {!loading && shown.length > 0 && (
          <ol className="lf-key">
            {columns.map((q) => (
              <li key={q.question_id}>
                {q.question}{' '}
                <span style={soft}>({q.good_answer == null ? 'neither' : q.good_answer ? 'Yes is good' : 'No is good'}{q.active ? '' : ', retired'})</span>
              </li>
            ))}
          </ol>
        )}
        {loading ? <p>Loading…</p> : shown.length === 0 ? (
          <p>No class has {MIN_RESPONSES} or more responses in these dates yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Teacher</th>
                  <th>Responses</th>
                  <th>Understanding</th>
                  {columns.map((q, i) => <th key={q.question_id} title={q.question} style={{ textAlign: 'center' }}>Q{i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const byQ = new Map((r.questions || []).map((q) => [q.question_id, q]));
                  return (
                    <tr key={`${r.class_id}-${r.staff_id}`}>
                      <td><strong>{r.class_code}</strong><div style={soft}>{r.subject_name}</div></td>
                      <td>{r.teacher_name || '—'}</td>
                      <td>{r.responses}</td>
                      <td><RagBar green={r.green} amber={r.amber} red={r.red} /></td>
                      {columns.map((q) => <QuestionCell key={q.question_id} q={byQ.get(q.question_id)} />)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && held.length > 0 && (
          <p style={soft}>
            Not enough responses yet to show: {held.map((r) => `${r.class_code} (${r.responses})`).join(', ')}.
          </p>
        )}
      </div>

      {isSmt && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Named responses (SMT only)</h3>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <input type="checkbox" checked={followUpOnly} onChange={(e) => setFollowUpOnly(e.target.checked)} />
            {' '}Only students who were red or asked for extra help
          </label>
          {loading ? <p>Loading…</p> : namedShown.length === 0 ? <p>None in these dates.</p> : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Lesson</th><th>Student</th><th>Class</th><th>Teacher</th><th>Understanding</th><th>Answers</th></tr>
                </thead>
                <tbody>
                  {namedShown.map((f) => {
                    const u = UNDERSTANDING.find((x) => x.key === f.understanding);
                    const byId = new Map(questions.map((q) => [q.question_id, q]));
                    const flagged = (f.lesson_feedback_answers || [])
                      .map((a) => ({ a, q: byId.get(a.question_id) }))
                      .filter(({ a, q }) => q && answerTone(q.good_answer, a.answer) !== 'good' && (q.good_answer != null || a.answer));
                    return (
                      <tr key={f.feedback_id}>
                        <td>{formatUKDate(f.lesson_date, { weekday: true })}<div style={soft}>lesson {f.period_number}</div></td>
                        <td>{f.students ? `${f.students.first_name} ${f.students.last_name}` : '—'}<div style={soft}>Year {f.students?.year_group}</div></td>
                        <td>{f.classes?.class_code}</td>
                        <td>{f.staff ? `${f.staff.first_name} ${f.staff.last_name}` : '—'}</td>
                        <td><span className={`lf-chip lf-${f.understanding}`}>{u?.label}</span></td>
                        <td style={{ fontSize: '0.85em' }}>
                          {flagged.length === 0 ? <span style={soft}>All good answers</span> : flagged.map(({ a, q }) => (
                            <div key={q.question_id}>{q.question} <strong>{a.answer ? 'Yes' : 'No'}</strong></div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LessonFeedbackPage() {
  return <RequireAuth><RequireResource resourceKey="/lesson-feedback"><LessonFeedbackInner /></RequireResource></RequireAuth>;
}
