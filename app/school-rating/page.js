'use client';

// School Rating (migration 394). Students rate parts of school life from 1 to
// 5 on their portal while a round is open (about once a term). The DSL and
// the principal see only totals here, through school_rating_summary(): never
// names, a year group or house only once 3 students in it have answered, and
// the written comments without names, in a mixed-up order. Rounds are opened
// here too.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { schoolToday } from '../../lib/schoolTime';
import { formatUKDate, formatUKDateTime } from '../../lib/formatDate';

const soft = { fontSize: '0.85em', color: 'var(--ink-soft)' };

function tone(avg) {
  if (avg == null) return undefined;
  const a = Number(avg);
  if (a >= 4) return { background: '#dcf5e3' };
  if (a < 3) return { background: '#fbdede' };
  return { background: '#fdf3d8' };
}

function Avg({ value }) {
  return <span>{value == null ? '—' : Number(value).toFixed(1)}</span>;
}

function Bars({ counts }) {
  const total = counts.reduce((x, y) => x + y, 0) || 1;
  const colours = ['#a3232c', '#e0803a', '#d9b84a', '#7fb77e', '#1a7a3d'];
  return (
    <div title={counts.map((c, i) => `${i + 1}: ${c}`).join(', ')}
      style={{ display: 'flex', height: 12, width: 160, borderRadius: 4, overflow: 'hidden', background: '#eee' }}>
      {counts.map((c, i) => <span key={i} style={{ width: `${(100 * c) / total}%`, background: colours[i] }} />)}
    </div>
  );
}

function RoundForm({ onSaved }) {
  const [label, setLabel] = useState('');
  const [opensOn, setOpensOn] = useState(schoolToday());
  const [opensTime, setOpensTime] = useState('07:00');
  const [closesOn, setClosesOn] = useState(schoolToday());
  const [status, setStatus] = useState(null);

  async function save() {
    const { error } = await supabase.rpc('add_school_rating_round', {
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
      <label>Name<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Autumn 2026" style={{ display: 'block' }} /></label>
      <label>Opens<input type="date" value={opensOn} onChange={(e) => setOpensOn(e.target.value)} style={{ display: 'block' }} /></label>
      <label>at<input type="time" value={opensTime} onChange={(e) => setOpensTime(e.target.value)} style={{ display: 'block' }} /></label>
      <label>Closes at the end of<input type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} style={{ display: 'block' }} /></label>
      <button onClick={save}>Open school rating</button>
      {status && <span style={soft}>{status}</span>}
    </div>
  );
}

function SchoolRatingInner() {
  const [rounds, setRounds] = useState([]);
  const [roundId, setRoundId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [breakdown, setBreakdown] = useState('year');
  const [status, setStatus] = useState(null);

  async function loadRounds() {
    const { data } = await supabase.from('school_rating_rounds').select('*').is('cancelled_at', null).order('opens_at', { ascending: false });
    setRounds(data || []);
    if (data?.length && !data.some((r) => r.round_id === roundId)) setRoundId(data[0].round_id);
  }

  useEffect(() => { loadRounds(); }, []);
  useEffect(() => {
    if (!roundId) return;
    supabase.rpc('school_rating_summary', { p_round_id: roundId }).then(({ data }) => setSummary(data));
  }, [roundId]);

  const round = rounds.find((r) => r.round_id === roundId);
  const groups = (summary?.areas || []).flatMap((a) => (breakdown === 'year' ? a.by_year : a.by_house))
    .map((g) => (breakdown === 'year' ? g.year_group : g.house));
  const columns = [...new Set(groups)].sort((x, y) => (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))));

  async function changeClose(value) {
    const { error } = await supabase.rpc('set_school_rating_round_close', { p_round_id: roundId, p_closes_on: value });
    setStatus(error ? error.message : 'Closing date changed.');
    loadRounds();
  }

  async function cancelRound() {
    if (!window.confirm('Cancel this school rating? Only possible before anyone has answered.')) return;
    const { error } = await supabase.rpc('cancel_school_rating_round', { p_round_id: roundId });
    setStatus(error ? error.message : 'Cancelled.');
    setRoundId(null);
    setSummary(null);
    loadRounds();
  }

  return (
    <div>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>School Rating</h1>
        <p style={soft}>
          What students think of the school, from 1 (very poor) to 5 (excellent). Anonymous: you see totals only,
          and a year group or house only once at least 3 of its students have answered. Only the Designated
          Safeguarding Lead and the Principal can see this page.
        </p>
        {rounds.length === 0 ? <p>No school rating has been opened yet. Open the first one below.</p> : (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={roundId || ''} onChange={(e) => setRoundId(Number(e.target.value))}>
              {rounds.map((r) => <option key={r.round_id} value={r.round_id}>{r.name}</option>)}
            </select>
            {round && (
              <span style={soft}>
                Opens {formatUKDateTime(round.opens_at)}, closes at the end of {formatUKDate(round.closes_on)}.{' '}
                {summary ? `${summary.responses} of ${summary.students} students have answered.` : ''}
              </span>
            )}
          </div>
        )}
        {round && round.closes_on >= schoolToday() && (
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={soft}>Change closing date{' '}
              <input type="date" defaultValue={round.closes_on} onChange={(e) => e.target.value && changeClose(e.target.value)} />
            </label>
            {summary?.responses === 0 && <button className="secondary" onClick={cancelRound}>Cancel it</button>}
          </div>
        )}
        {status && <p style={soft}>{status}</p>}
      </div>

      {summary && summary.responses > 0 && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Results</h2>
              <select value={breakdown} onChange={(e) => setBreakdown(e.target.value)}>
                <option value="year">By year group</option>
                <option value="house">By boarding house</option>
              </select>
            </div>
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>Area</th><th>Average</th><th>Spread (1 → 5)</th>
                  {columns.map((c) => <th key={c}>{breakdown === 'year' ? `Y${c}` : c}</th>)}
                </tr>
              </thead>
              <tbody>
                {summary.areas.map((a) => {
                  const list = breakdown === 'year' ? a.by_year : a.by_house;
                  return (
                    <tr key={a.area_id}>
                      <td>{a.area}{a.description && <div style={soft}>{a.description}</div>}</td>
                      <td style={tone(a.average)}><strong><Avg value={a.average} /></strong><div style={soft}>{a.n} answers</div></td>
                      <td><Bars counts={a.counts} /></td>
                      {columns.map((c) => {
                        const g = list.find((x) => (breakdown === 'year' ? x.year_group : x.house) === c);
                        return (
                          <td key={c} style={tone(g?.average)} title={g ? `${g.n} answers` : ''}>
                            {g ? (g.average == null ? <span style={soft}>under 3</span> : <Avg value={g.average} />) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <p style={soft}>Green: 4 or above. Amber: 3 to 4. Red: below 3.</p>
          </div>

          <div className="card">
            <h2>What students wrote</h2>
            {summary.responses < 3 ? <p style={soft}>Comments are shown once at least 3 students have answered.</p>
              : summary.comments.length === 0 ? <p>No comments.</p> : (
                <div className="table-scroll"><table>
                  <thead><tr><th>Does well</th><th>Could do better</th></tr></thead>
                  <tbody>
                    {summary.comments.map((c, i) => (
                      <tr key={i}><td>{c.does_well || ''}</td><td>{c.could_improve || ''}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              )}
          </div>
        </>
      )}

      <div className="card">
        <h2>Open a school rating</h2>
        <p style={soft}>About once a term. Students see a &ldquo;Rate the School&rdquo; tile on their portal from the opening time until the end of the closing day, and can answer once.</p>
        <RoundForm onSaved={loadRounds} />
      </div>
    </div>
  );
}

export default function SchoolRatingPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/school-rating">
        <SchoolRatingInner />
      </RequireResource>
    </RequireAuth>
  );
}
