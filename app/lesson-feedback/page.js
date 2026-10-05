'use client';

// Lesson feedback (migration 365). Students give feedback on a lesson from
// their timetable; staff see it here as a summary per class, never with
// names (the principal, 5 Oct 2026). Teachers see the lessons they taught,
// Heads of Department their department, SMT every class, all through
// lesson_feedback_summary(), which holds back a class's figures until it has
// at least 3 responses in the dates chosen. Only SMT also get the named
// responses (the table's own select policy), so someone can follow up a
// student who was red.

import { Fragment, useEffect, useState } from 'react';
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

// Question counts keyed by question id, from a summary row's questions list.
function questionCounts(questions) {
  return new Map((questions || []).map((q) => [q.question_id, q]));
}

// Adds up classes for a teacher or department row: responses, the three
// colours, and Yes/No per question. Only classes whose figures are shown
// (3 or more responses) count, so a total never reveals a smaller class.
function addUp(rows) {
  const stats = { responses: 0, green: 0, amber: 0, red: 0, questions: new Map() };
  for (const r of rows) {
    stats.responses += r.responses;
    stats.green += r.green || 0;
    stats.amber += r.amber || 0;
    stats.red += r.red || 0;
    for (const q of r.questions || []) {
      const t = stats.questions.get(q.question_id) || { ...q, yes: 0, no: 0 };
      t.yes += q.yes;
      t.no += q.no;
      stats.questions.set(q.question_id, t);
    }
  }
  return stats;
}

function SummaryRow({ level, label, sub, stats, columns, open, onToggle }) {
  return (
    <tr className={`lf-row-${level}`} onClick={onToggle} aria-expanded={open}>
      <td>
        <span className="lf-caret">{open ? '▾' : '▸'}</span> <strong>{label}</strong>
        <div style={soft}>{sub}</div>
      </td>
      <td>{stats.responses}</td>
      <td><RagBar green={stats.green} amber={stats.amber} red={stats.red} /></td>
      {columns.map((q) => <QuestionCell key={q.question_id} q={stats.questions.get(q.question_id)} />)}
    </tr>
  );
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
  const [deptByClass, setDeptByClass] = useState({}); // class_id -> department name
  const [openKeys, setOpenKeys] = useState(new Set());

  useEffect(() => {
    loadFeedbackQuestions({ includeRetired: true }).then(({ questions: q }) => setQuestions(q));
  }, []);

  async function load() {
    setLoading(true);
    setStatus(null);
    const { data, error } = await supabase.rpc('lesson_feedback_summary', { p_from: from, p_to: to });
    if (error) setStatus(`Error: ${error.message}`);
    setRows(data || []);
    const classIds = [...new Set((data || []).map((r) => r.class_id))];
    if (classIds.length) {
      const { data: cls } = await supabase.from('classes').select('class_id, subjects(department_name)').in('class_id', classIds);
      const map = {};
      (cls || []).forEach((c) => { map[c.class_id] = c.subjects?.department_name || 'No department'; });
      setDeptByClass(map);
    }
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

  // Named list (SMT): by default only students who were red.
  const needsFollowUp = (f) => f.understanding === 'red';
  const namedShown = followUpOnly ? named.filter(needsFollowUp) : named;

  const shown = rows.filter((r) => r.responses >= MIN_RESPONSES);
  const held = rows.filter((r) => r.responses < MIN_RESPONSES);
  const thisWeek = weekStartOf(today);

  // Department → teacher → class. Held-back classes are listed under their
  // teacher by name and count only.
  const deptMap = new Map();
  for (const r of rows) {
    const dName = deptByClass[r.class_id] || 'No department';
    if (!deptMap.has(dName)) deptMap.set(dName, new Map());
    const tKey = String(r.staff_id ?? 'none');
    const teachers = deptMap.get(dName);
    if (!teachers.has(tKey)) teachers.set(tKey, { key: `t:${dName}:${tKey}`, name: r.teacher_name || 'No teacher', classes: [], held: [] });
    const t = teachers.get(tKey);
    (r.responses >= MIN_RESPONSES ? t.classes : t.held).push(r);
  }
  const groups = [...deptMap.entries()]
    .map(([name, teachers]) => {
      const ts = [...teachers.values()]
        .filter((t) => t.classes.length > 0 || t.held.length > 0)
        .map((t) => ({ ...t, stats: addUp(t.classes) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { key: `d:${name}`, name, teachers: ts, stats: addUp(ts.flatMap((t) => t.classes)) };
    })
    .sort((a, b) => (a.name === 'No department') - (b.name === 'No department') || a.name.localeCompare(b.name));
  const allKeys = groups.flatMap((d) => [d.key, ...d.teachers.map((t) => t.key)]);
  // A teacher (one department, one teacher) sees everything open; with more
  // groups they start closed, so the department totals show first.
  const groupShape = groups.map((d) => `${d.key}:${d.teachers.length}`).join('|');
  useEffect(() => {
    if (groups.length === 1) {
      const d = groups[0];
      setOpenKeys(new Set(d.teachers.length === 1 ? [d.key, d.teachers[0].key] : [d.key]));
    } else {
      setOpenKeys(new Set());
    }
  }, [groupShape]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

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
        <h3 style={{ marginTop: 0 }}>By department, teacher and class</h3>
        <p style={{ ...soft, marginTop: 0 }}>
          Understanding is green · amber · red. Each question shows the share who answered Yes, in green where most gave the
          good answer and red where most didn&apos;t (for &ldquo;too easy&rdquo;, &ldquo;too hard&rdquo; and &ldquo;bored&rdquo;, No is the good answer).
          Tap a department or teacher to open or close it; their rows add up the classes beneath. Hover over a figure for the counts.
        </p>
        {!loading && shown.length > 0 && (
          <>
            <ol className="lf-key">
              {columns.map((q) => (
                <li key={q.question_id}>
                  {q.question}{' '}
                  <span style={soft}>({q.good_answer == null ? 'neither' : q.good_answer ? 'Yes is good' : 'No is good'}{q.active ? '' : ', retired'})</span>
                </li>
              ))}
            </ol>
            {groups.length > 1 && (
              <p style={{ margin: '0 0 0.5rem' }}>
                <button type="button" className="secondary" onClick={() => setOpenKeys(new Set(allKeys))}>Open all</button>{' '}
                <button type="button" className="secondary" onClick={() => setOpenKeys(new Set())}>Close all</button>
              </p>
            )}
          </>
        )}
        {loading ? <p>Loading…</p> : shown.length === 0 ? (
          <p>No class has {MIN_RESPONSES} or more responses in these dates yet.</p>
        ) : (
          <div className="lf-table-wrap">
            <table className="lf-table">
              <colgroup>
                <col className="lf-col-name" />
                <col className="lf-col-n" />
                <col className="lf-col-bar" />
                {columns.map((q) => <col key={q.question_id} className="lf-col-q" />)}
              </colgroup>
              <thead>
                <tr>
                  <th>Department / teacher / class</th>
                  <th title="Responses">No.</th>
                  <th title="Understanding: green · amber · red">Understood</th>
                  {columns.map((q, i) => <th key={q.question_id} title={q.question}>Q{i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.map((d) => {
                  const dOpen = openKeys.has(d.key);
                  return (
                    <Fragment key={d.key}>
                      <SummaryRow level="dept" label={d.name} sub={`${d.teachers.length} teacher${d.teachers.length === 1 ? '' : 's'}`}
                        stats={d.stats} columns={columns} open={dOpen} onToggle={() => toggle(d.key)} />
                      {dOpen && d.teachers.map((t) => {
                        const tOpen = openKeys.has(t.key);
                        return (
                          <Fragment key={t.key}>
                            <SummaryRow level="teacher" label={t.name} sub={`${t.classes.length} class${t.classes.length === 1 ? '' : 'es'}`}
                              stats={t.stats} columns={columns} open={tOpen} onToggle={() => toggle(t.key)} />
                            {tOpen && t.classes.map((r) => {
                              const byQ = questionCounts(r.questions);
                              return (
                                <tr key={`${r.class_id}-${r.staff_id}`} className="lf-row-class">
                                  <td><strong>{r.class_code}</strong><div style={soft}>{r.subject_name}</div></td>
                                  <td>{r.responses}</td>
                                  <td><RagBar green={r.green} amber={r.amber} red={r.red} /></td>
                                  {columns.map((q) => <QuestionCell key={q.question_id} q={byQ.get(q.question_id)} />)}
                                </tr>
                              );
                            })}
                            {tOpen && t.held.length > 0 && (
                              <tr className="lf-row-class">
                                <td colSpan={3 + columns.length} style={soft}>
                                  Not enough responses yet: {t.held.map((r) => `${r.class_code} (${r.responses})`).join(', ')}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && shown.length === 0 && held.length > 0 && (
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
            {' '}Only students who were red
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
