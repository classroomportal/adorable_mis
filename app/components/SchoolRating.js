'use client';

// "Rate the School" on a student's portal (migration 394), while a rating
// round is open: each area from 1 to 5, plus one thing the school does well
// and one it could do better. Anonymous to staff: the DSL and the principal
// see only totals (school_rating_summary()), never who said what. Every rule
// is in give_school_rating().

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';

// The open round for this student: { round_id, round_name, closes_on, done }
// or null. reload() after rating.
export function useSchoolRating(studentId) {
  const [round, setRound] = useState(null);
  async function reload() {
    if (!studentId) return;
    const { data } = await supabase.rpc('my_school_rating');
    setRound((data || [])[0] || null);
  }
  useEffect(() => { reload(); }, [studentId]);
  return [round, reload];
}

export default function SchoolRating({ round, onDone }) {
  const [areas, setAreas] = useState([]);
  const [scores, setScores] = useState({});
  const [well, setWell] = useState('');
  const [better, setBetter] = useState('');
  const [error, setError] = useState(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('school_rating_areas').select('*').eq('active', true).order('position')
      .then(({ data }) => setAreas(data || []));
  }, []);

  if (!round) return <p>The school rating isn&apos;t open just now.</p>;
  if (round.done) return <p>Thank you for rating the school. Your answers will help us decide what to improve.</p>;

  async function send() {
    if (areas.some((a) => scores[a.area_id] === undefined)) { setError('Please rate everything. The two comment boxes are optional.'); return; }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const payload = Object.fromEntries(areas.map((a) => [String(a.area_id), scores[a.area_id]]));
    const { error: e } = await supabase.rpc('give_school_rating', {
      p_scores: payload, p_does_well: well.trim() || null, p_could_improve: better.trim() || null,
    });
    busyRef.current = false;
    setBusy(false);
    if (e) { setError(e.message); return; }
    onDone();
  }

  return (
    <div>
      <p>
        Tell us what you think of the school, from 1 (very poor) to 5 (excellent). Your name isn&apos;t shown with
        your answers: staff see only the totals. Open until the end of {formatUKDate(round.closes_on, { weekday: true })}.
      </p>
      <p style={{ fontSize: '0.9rem' }}>
        If something is worrying you, please use the <a href="/portal#worries">Worry Box</a> instead, so someone can help.
      </p>
      {areas.map((a, i) => (
        <div key={a.area_id} className="wellbeing-question">
          <div style={{ fontWeight: 600 }}>{i + 1}. {a.area}</div>
          {a.description && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{a.description}</div>}
          <div className="wellbeing-scale">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                className={scores[a.area_id] === v ? 'chosen' : ''}
                aria-pressed={scores[a.area_id] === v}
                onClick={() => setScores({ ...scores, [a.area_id]: v })}
              >{v}</button>
            ))}
          </div>
          <div className="wellbeing-scale-labels"><span>1 = very poor</span><span>5 = excellent</span></div>
        </div>
      ))}
      <label style={{ display: 'block', marginTop: '0.75rem' }}>
        One thing the school does well (optional)
        <textarea rows={2} maxLength={1000} value={well} onChange={(e) => setWell(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <label style={{ display: 'block', marginTop: '0.5rem' }}>
        One thing the school could do better (optional)
        <textarea rows={2} maxLength={1000} value={better} onChange={(e) => setBetter(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      {error && <p style={{ color: '#a3232c' }}>{error}</p>}
      <div style={{ marginTop: '0.75rem' }}>
        <button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  );
}
