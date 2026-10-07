'use client';

// The wellbeing check-in pop-up (migration 392). While a check-in round is
// open (the DSL and the principal set the dates on /wellbeing, about every
// two months) a student who hasn't answered it gets this over any page.
// "Not now" hides it until the next morning (snooze_wellbeing_check_in()),
// but not from the round's must-answer day (migration 393: it must be done by
// the end of the week); once the round closes it stops. Answers go only to the DSL and the
// principal; the student sees "thank you" and nothing back. Every rule is in
// the database (my_wellbeing_check_in(), give_wellbeing_check_in()).

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';

const POLL_MS = 10 * 60000;

export default function WellbeingCheckIn() {
  const { session, profile } = useAuth();
  const pathname = usePathname();
  const isStudent = !!session && !!profile?.student_id;
  const [round, setRound] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isStudent) return undefined;
    let cancelled = false;
    async function check() {
      const { data } = await supabase.rpc('my_wellbeing_prompt');
      const r = (data || [])[0] || null;
      if (cancelled) return;
      setRound(r && r.show_now ? r : null);
      if (r && r.show_now) {
        const { data: q } = await supabase.from('wellbeing_questions').select('*').eq('active', true).order('position');
        if (!cancelled) setQuestions(q || []);
      }
    }
    check();
    const t = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [isStudent]);

  if (!isStudent || pathname === '/login' || hidden) return null;
  if (!round && !done) return null;
  if (!done && questions.length === 0) return null;

  async function notNow() {
    setHidden(true);
    await supabase.rpc('snooze_wellbeing_check_in');
  }

  async function send() {
    if (questions.some((q) => answers[q.question_id] === undefined)) {
      setError('Please answer every question. The comment box is optional.');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const payload = Object.fromEntries(questions.map((q) => [String(q.question_id), answers[q.question_id]]));
    const { error: e } = await supabase.rpc('give_wellbeing_check_in', { p_answers: payload, p_comment: comment.trim() || null });
    busyRef.current = false;
    setBusy(false);
    if (e) { setError(e.message); return; }
    setDone(true);
    setRound(null);
  }

  const answered = questions.filter((q) => answers[q.question_id] !== undefined).length;

  return (
    <div className="wellbeing-overlay" role="dialog" aria-modal="true" aria-labelledby="wellbeing-title">
      <div className="wellbeing-box">
        {done ? (
          <>
            <h2 id="wellbeing-title" style={{ marginTop: 0 }}>Thank you</h2>
            <p>Your answers have gone to the Designated Safeguarding Lead and the Principal only. If anything you said worries them, someone will come and talk to you.</p>
            <p>If you need to talk to someone now, speak to any member of staff, or use the <a href="/portal#worries">Worry Box</a>.</p>
            <button onClick={() => setHidden(true)}>Close</button>
          </>
        ) : (
          <>
            <h2 id="wellbeing-title" style={{ marginTop: 0 }}>How are you doing?</h2>
            <p style={{ marginTop: 0 }}>
              A short check-in, about 3 minutes. There are no right or wrong answers. Only the Designated
              Safeguarding Lead and the Principal see what you say, with your name, so they can help if you need it.
              Nobody else does: not your teachers, not other students, not your parents.
            </p>
            <p style={{ fontSize: '0.9rem', background: '#fff4f4', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
              If you are in danger or don&apos;t feel safe right now, tell any member of staff straight away.
            </p>

            {questions.map((q, i) => (
              <div key={q.question_id} className="wellbeing-question">
                <div style={{ fontWeight: 600 }}>{i + 1}. {q.question}</div>
                {q.kind === 'scale' ? (
                  <div>
                    <div className="wellbeing-scale">
                      {[1, 2, 3, 4, 5].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={answers[q.question_id] === v ? 'chosen' : ''}
                          aria-pressed={answers[q.question_id] === v}
                          onClick={() => setAnswers({ ...answers, [q.question_id]: v })}
                        >{v}</button>
                      ))}
                    </div>
                    <div className="wellbeing-scale-labels"><span>1 = {q.low_label}</span><span>5 = {q.high_label}</span></div>
                  </div>
                ) : (
                  <div className="wellbeing-scale">
                    {[[true, 'Yes'], [false, 'No']].map(([v, label]) => (
                      <button
                        key={label}
                        type="button"
                        className={answers[q.question_id] === v ? 'chosen' : ''}
                        aria-pressed={answers[q.question_id] === v}
                        onClick={() => setAnswers({ ...answers, [q.question_id]: v })}
                        style={{ minWidth: '4.5rem' }}
                      >{label}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <label style={{ display: 'block', marginTop: '0.75rem' }}>
              Is there anything else you&apos;d like to tell us? (optional)
              <textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} style={{ display: 'block', width: '100%' }} />
            </label>

            {error && <p style={{ color: '#a3232c' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.75rem' }}>
              <button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
              {round?.can_snooze
                ? <button type="button" className="secondary" onClick={notNow}>Not now (ask me tomorrow)</button>
                : <span style={{ fontSize: '0.85rem' }}>Please answer now: it closes at the end of {formatUKDate(round?.closes_on, { weekday: true })}.</span>}
              <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{answered} of {questions.length} answered</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
