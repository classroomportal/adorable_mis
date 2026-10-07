'use client';

// Wellbeing check-ins (migration 392). Students get a pop-up while a round is
// open; only the DSL and the principal read the answers, with names, here
// (can_read_worries(), on the roles themselves, so admins get nothing).
// Check-ins with an alert answer or a comment are flagged; the DSL or the
// principal marks each one followed up. Rounds (about every two months) are
// added here too. Every write is a database function.
//
// Too many are flagged for two people to see everyone (130 of 134 in the
// first round), so each flagged check-in gets a priority (red, amber, green)
// and is grouped by issue (migration 397, lib/wellbeing.js). The DSL and the
// principal pick an issue, download its list and ask someone to discuss it;
// what they pass on is their decision.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { schoolToday } from '../../lib/schoolTime';
import { formatUKDate, formatUKDateTime } from '../../lib/formatDate';
import { ISSUES, TIERS, checkInTier, checkInIssues, byTier } from '../../lib/wellbeing';

const soft = { fontSize: '0.85em', color: 'var(--ink-soft)' };

function name(s) {
  return s ? `${s.preferred_name || s.first_name} ${s.last_name}` : '';
}

function answerText(q, a) {
  if (!a) return '—';
  if (q.kind === 'scale') return `${a.score} (${a.score === 1 ? q.low_label : a.score === 5 ? q.high_label : `1 ${q.low_label} – 5 ${q.high_label}`})`;
  return a.answer ? 'Yes' : 'No';
}

function TierBadge({ tier }) {
  if (!tier) return null;
  const t = TIERS[tier];
  return <span className="badge" style={{ background: t.bg, color: t.fg }} title={t.help}>{t.label}</span>;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function addMonths(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function RoundForm({ lastRound, onSaved }) {
  const start = lastRound ? addMonths(lastRound.closes_on, 2) : schoolToday();
  const [label, setLabel] = useState('');
  const [opensOn, setOpensOn] = useState(start);
  const [opensTime, setOpensTime] = useState('07:00');
  const [closesOn, setClosesOn] = useState(start);
  const [status, setStatus] = useState(null);

  async function save() {
    const { error } = await supabase.rpc('add_wellbeing_round', {
      p_name: label.trim() || null,
      p_opens_at: `${opensOn}T${opensTime}:00+01:00`,
      p_closes_on: closesOn,
    });
    if (error) { setStatus(error.message); return; }
    setLabel('');
    setStatus('Saved.');
    onSaved();
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label>Name<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. December 2026" style={{ display: 'block' }} /></label>
      <label>Opens<input type="date" value={opensOn} onChange={(e) => setOpensOn(e.target.value)} style={{ display: 'block' }} /></label>
      <label>at<input type="time" value={opensTime} onChange={(e) => setOpensTime(e.target.value)} style={{ display: 'block' }} /></label>
      <label>Closes at the end of<input type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} style={{ display: 'block' }} /></label>
      <button onClick={save}>Add check-in</button>
      {status && <span style={soft}>{status}</span>}
    </div>
  );
}

function WellbeingInner() {
  const [rounds, setRounds] = useState([]);
  const [roundId, setRoundId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [studentCount, setStudentCount] = useState(null);
  const [show, setShow] = useState('flagged');
  const [issue, setIssue] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState(null);

  async function loadRounds() {
    const [{ data: r }, { data: q }, { count }] = await Promise.all([
      supabase.from('wellbeing_rounds').select('*').is('cancelled_at', null).order('opens_at', { ascending: false }),
      supabase.from('wellbeing_questions').select('*').order('position'),
      supabase.from('students').select('student_id', { count: 'exact', head: true }).eq('status', 'active'),
    ]);
    setRounds(r || []);
    setQuestions(q || []);
    setStudentCount(count ?? null);
    if (!roundId && r?.length) setRoundId(r[0].round_id);
  }

  async function loadRound(id) {
    if (!id) return;
    const { data: c } = await supabase.from('wellbeing_check_ins')
      .select('*, students(first_name, last_name, preferred_name)')
      .eq('round_id', id).order('created_at', { ascending: false });
    const ids = (c || []).map((x) => x.check_in_id);
    let a = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from('wellbeing_answers').select('*').in('check_in_id', ids.slice(i, i + 200));
      a = a.concat(data || []);
    }
    setCheckIns(c || []);
    setAnswers(a);
  }

  useEffect(() => { loadRounds(); }, []);
  useEffect(() => { loadRound(roundId); }, [roundId]);

  const byCheckIn = useMemo(() => {
    const m = new Map();
    for (const a of answers) {
      if (!m.has(a.check_in_id)) m.set(a.check_in_id, new Map());
      m.get(a.check_in_id).set(a.question_id, a);
    }
    return m;
  }, [answers]);

  const usedQuestions = useMemo(() => {
    const used = new Set(answers.map((a) => a.question_id));
    return questions.filter((q) => used.has(q.question_id) || q.active);
  }, [questions, answers]);

  // Priority and issues for each check-in (migration 397).
  const sorted = useMemo(() => {
    const m = new Map();
    for (const c of checkIns) {
      const mine = byCheckIn.get(c.check_in_id) || new Map();
      m.set(c.check_in_id, { tier: checkInTier(c, mine, usedQuestions), issues: checkInIssues(c, mine, usedQuestions) });
    }
    return m;
  }, [checkIns, byCheckIn, usedQuestions]);

  const round = rounds.find((r) => r.round_id === roundId);
  const flagged = checkIns.filter((c) => c.flagged);
  const toFollow = flagged.filter((c) => !c.followed_up_at);
  const base = show === 'flagged' ? toFollow : show === 'followed' ? flagged.filter((c) => c.followed_up_at) : checkIns;
  const listed = base
    .filter((c) => !tierFilter || sorted.get(c.check_in_id)?.tier === tierFilter)
    .filter((c) => !issue || sorted.get(c.check_in_id)?.issues.includes(issue))
    .sort((a, b) => byTier(sorted.get(a.check_in_id)?.tier, sorted.get(b.check_in_id)?.tier));

  const tierCount = (t) => toFollow.filter((c) => sorted.get(c.check_in_id)?.tier === t).length;
  const houses = [...new Set(toFollow.map((c) => c.boarding_house || 'No house'))].sort();

  // The answers needing a look that belong to the chosen issue (all of them
  // when no issue is chosen).
  function issueAnswers(c) {
    const mine = byCheckIn.get(c.check_in_id) || new Map();
    return usedQuestions
      .filter((q) => mine.get(q.question_id)?.alert && (!issue || q.issue === issue))
      .map((q) => `${q.question} ${answerText(q, mine.get(q.question_id))}`);
  }

  function download(withAnswers) {
    const issueLabel = ISSUES.find((i) => i.key === issue)?.label || 'All issues';
    const head = ['Student', 'Year', 'House', 'Priority', 'Issues'];
    if (withAnswers) head.push('Answers needing a look', 'Comment');
    const rows = listed.map((c) => {
      const info = sorted.get(c.check_in_id) || {};
      const r = [name(c.students), c.year_group, c.boarding_house, TIERS[info.tier]?.label || '',
        (info.issues || []).map((k) => ISSUES.find((i) => i.key === k)?.label).join('; ')];
      if (withAnswers) r.push(issueAnswers(c).join('; '), (!issue || issue === 'comment') ? (c.comment || '') : '');
      return r;
    });
    downloadCsv(`Wellbeing ${round?.name || ''} - ${issueLabel}${tierFilter ? ` - ${TIERS[tierFilter].label}` : ''}.csv`, [head, ...rows]);
  }

  async function followUp(id) {
    const { error } = await supabase.rpc('mark_wellbeing_followed_up', { p_check_in_id: id, p_note: note });
    if (error) { setStatus(error.message); return; }
    setNote('');
    setOpen(null);
    loadRound(roundId);
  }

  async function changeMustAnswer(dateValue) {
    const { error } = await supabase.rpc('set_wellbeing_round_must_answer', { p_round_id: roundId, p_must_answer_from: dateValue });
    setStatus(error ? error.message : 'Saved.');
    loadRounds();
  }

  async function changeClose(dateValue) {
    const { error } = await supabase.rpc('set_wellbeing_round_close', { p_round_id: roundId, p_closes_on: dateValue });
    setStatus(error ? error.message : 'Closing date changed.');
    loadRounds();
  }

  return (
    <div>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Wellbeing Check-ins</h1>
        <p style={soft}>Only the Designated Safeguarding Lead and the Principal can see these answers.</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={roundId || ''} onChange={(e) => setRoundId(Number(e.target.value))}>
            {rounds.map((r) => <option key={r.round_id} value={r.round_id}>{r.name}</option>)}
          </select>
          {round && (
            <span style={soft}>
              Opened {formatUKDateTime(round.opens_at)}, closes at the end of {formatUKDate(round.closes_on)}
              {round.must_answer_from ? `, must be answered from ${formatUKDate(round.must_answer_from)}` : ''}.{' '}
              {checkIns.length} of {studentCount ?? '…'} students answered; {flagged.length} flagged, {toFollow.length} to follow up.
            </span>
          )}
        </div>
        {round && round.closes_on >= schoolToday() && (
          <div style={{ marginTop: '0.5rem' }}>
            <label style={soft}>Change closing date{' '}
              <input type="date" defaultValue={round.closes_on} onChange={(e) => e.target.value && changeClose(e.target.value)} />
            </label>{' '}
            <label style={soft}>Must be answered from (no &ldquo;Not now&rdquo;){' '}
              <input type="date" defaultValue={round.must_answer_from || ''} onChange={(e) => changeMustAnswer(e.target.value || null)} />
            </label>
          </div>
        )}
        {status && <p style={soft}>{status}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>To follow up, by priority and issue</h2>
        <p style={soft}>
          Red: you or the DSL see the student (doesn&apos;t feel safe, or feels 1 out of 5). Amber: a conversation with
          someone you choose (wants to talk, no adult to talk to, feels 2 out of 5, many low answers, or a comment).
          Green: no one-to-one follow-up; it counts towards the school-wide picture. Click an issue or a priority
          to list those students, then download the list for the person you ask to discuss it.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.5rem 0' }}>
          {['red', 'amber', 'green'].map((t) => (
            <button key={t} type="button" onClick={() => { setShow('flagged'); setTierFilter(tierFilter === t ? '' : t); }}
              style={{ background: TIERS[t].bg, color: TIERS[t].fg, border: tierFilter === t ? `2px solid ${TIERS[t].fg}` : '2px solid transparent' }}>
              {TIERS[t].label}: {tierCount(t)}
            </button>
          ))}
        </div>
        <div className="table-scroll"><table>
          <thead>
            <tr>
              <th>Issue</th><th>Students</th><th>Red</th><th>Amber</th><th>Green</th>
              {houses.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {ISSUES.map((i) => {
              const these = toFollow.filter((c) => sorted.get(c.check_in_id)?.issues.includes(i.key));
              const n = (t) => these.filter((c) => sorted.get(c.check_in_id)?.tier === t).length;
              return (
                <tr key={i.key} onClick={() => { setShow('flagged'); setIssue(issue === i.key ? '' : i.key); }}
                  style={{ cursor: 'pointer', fontWeight: issue === i.key ? 600 : undefined, background: issue === i.key ? '#eef4fb' : undefined }}>
                  <td>{i.label}<div style={soft}>{i.help}</div></td>
                  <td><strong>{these.length}</strong></td>
                  <td>{n('red') || ''}</td><td>{n('amber') || ''}</td><td>{n('green') || ''}</td>
                  {houses.map((h) => <td key={h}>{these.filter((c) => (c.boarding_house || 'No house') === h).length || ''}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p style={soft}>A student with several issues is counted under each of them.</p>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {[['flagged', `To follow up (${toFollow.length})`], ['followed', 'Followed up'], ['all', `Everyone (${checkIns.length})`]].map(([k, label]) => (
            <button key={k} className={show === k ? '' : 'secondary'} onClick={() => setShow(k)}>{label}</button>
          ))}
          <select value={issue} onChange={(e) => setIssue(e.target.value)}>
            <option value="">Every issue</option>
            {ISSUES.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
            <option value="">Every priority</option>
            {['red', 'amber', 'green'].map((t) => <option key={t} value={t}>{TIERS[t].label}</option>)}
          </select>
          {listed.length > 0 && (
            <>
              <button className="secondary" onClick={() => download(false)} title="Name, year, house, priority and issues">Download names ({listed.length})</button>
              <button className="secondary" onClick={() => download(true)} title="Also the answers needing a look in this issue">Download with answers</button>
            </>
          )}
        </div>
        {(issue || tierFilter) && (
          <p style={soft}>
            Showing {listed.length}{issue ? ` with ${ISSUES.find((i) => i.key === issue)?.label.toLowerCase()}` : ''}
            {tierFilter ? `, ${TIERS[tierFilter].label.toLowerCase()} priority` : ''}.{' '}
            <button type="button" className="secondary" onClick={() => { setIssue(''); setTierFilter(''); }}>Show all</button>
          </p>
        )}
        {listed.length === 0 ? <p>None.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Priority</th><th>Student</th><th>Year</th><th>House</th><th>Answered</th><th>Needs a look</th><th></th></tr></thead>
            <tbody>
              {listed.map((c) => {
                const mine = byCheckIn.get(c.check_in_id) || new Map();
                const alerts = usedQuestions.filter((q) => mine.get(q.question_id)?.alert && (!issue || q.issue === issue));
                return (
                  <Fragment key={c.check_in_id}>
                    <tr>
                      <td><TierBadge tier={sorted.get(c.check_in_id)?.tier} /></td>
                      <td><a href={`/students/${c.student_id}`}>{name(c.students)}</a></td>
                      <td>{c.year_group}</td>
                      <td>{c.boarding_house}</td>
                      <td>{formatUKDateTime(c.created_at)}</td>
                      <td>
                        {alerts.map((q) => <div key={q.question_id}>{q.question} <strong>{answerText(q, mine.get(q.question_id))}</strong></div>)}
                        {c.comment && (!issue || issue === 'comment') && <div><em>Comment:</em> {c.comment}</div>}
                        {c.followed_up_at && <div style={soft}>Followed up {formatUKDateTime(c.followed_up_at)}{c.follow_up_note ? `: ${c.follow_up_note}` : ''}</div>}
                      </td>
                      <td><button className="secondary" onClick={() => setOpen(open === c.check_in_id ? null : c.check_in_id)}>{open === c.check_in_id ? 'Hide' : 'All answers'}</button></td>
                    </tr>
                    {open === c.check_in_id && (
                      <tr>
                        <td colSpan={7}>
                          <table>
                            <tbody>
                              {usedQuestions.map((q) => {
                                const a = mine.get(q.question_id);
                                return (
                                  <tr key={q.question_id} style={a?.alert ? { background: '#fff4f4' } : undefined}>
                                    <td>{q.question}</td><td>{answerText(q, a)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {c.flagged && !c.followed_up_at && (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                              <input placeholder="What was done (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 280 }} />
                              <button onClick={() => followUp(c.check_in_id)}>Mark followed up</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Answers across the school</h2>
        <div className="table-scroll"><table>
          <thead><tr><th>Question</th><th>Answers</th></tr></thead>
          <tbody>
            {usedQuestions.map((q) => {
              const as = answers.filter((a) => a.question_id === q.question_id);
              const counts = q.kind === 'scale'
                ? [1, 2, 3, 4, 5].map((v) => `${v}: ${as.filter((a) => a.score === v).length}`).join(' · ')
                : `Yes ${as.filter((a) => a.answer).length} · No ${as.filter((a) => a.answer === false).length}`;
              return (
                <tr key={q.question_id}>
                  <td>{q.question}{q.kind === 'scale' && <div style={soft}>1 = {q.low_label}, 5 = {q.high_label}</div>}</td>
                  <td>{counts}<div style={soft}>{as.filter((a) => a.alert).length} needing a look</div></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <h2>Next check-in</h2>
        <p style={soft}>About every two months. Students get the pop-up from the opening time until the end of the closing day; &ldquo;Not now&rdquo; hides it until the next morning, until the must-answer day (set it on the check-in above once it is added).</p>
        <RoundForm lastRound={rounds[0]} onSaved={loadRounds} />
      </div>
    </div>
  );
}

export default function WellbeingPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/wellbeing">
        <WellbeingInner />
      </RequireResource>
    </RequireAuth>
  );
}
