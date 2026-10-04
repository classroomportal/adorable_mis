'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { DAY_KEYS, addDays } from '../../../lib/homework';
import { formatUKDate } from '../../../lib/formatDate';
import { schoolToday } from '../../../lib/schoolTime';
import { prepEveningMinutes, minutesLabel } from '../../../lib/prep';

// Prep Times (migration 352): evening prep for each year group, the fixed
// activity that isn't homework time (KS3's review of the day's work) and
// whether timetabled private study counts. These numbers limit how much
// homework teachers can put on an evening: the database checks every
// homework against them (homework_prep_time_check()).

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

function PrepRow({ row, privateStudy, onSaved }) {
  const [v, setV] = useState({
    prep_starts: hhmm(row.prep_starts),
    prep_ends: hhmm(row.prep_ends),
    prep_days: row.prep_days || [],
    fixed_activity: row.fixed_activity || '',
    fixed_minutes: String(row.fixed_minutes ?? 0),
    counts_private_study: !!row.counts_private_study,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, val) => setV((o) => ({ ...o, [k]: val }));
  const evening = prepEveningMinutes({ ...v, fixed_minutes: Number(v.fixed_minutes) || 0 });
  const weekly = evening * v.prep_days.length + (v.counts_private_study ? privateStudy : 0);
  const changed = JSON.stringify(v) !== JSON.stringify({
    prep_starts: hhmm(row.prep_starts), prep_ends: hhmm(row.prep_ends), prep_days: row.prep_days || [],
    fixed_activity: row.fixed_activity || '', fixed_minutes: String(row.fixed_minutes ?? 0),
    counts_private_study: !!row.counts_private_study,
  });

  async function save() {
    setError(null);
    if (!v.prep_starts || !v.prep_ends || v.prep_ends <= v.prep_starts) { setError('Prep must end after it starts.'); return; }
    if (evening < 0) { setError('The fixed activity is longer than prep.'); return; }
    setSaving(true);
    const { error: e } = await supabase.from('prep_settings').update({
      prep_starts: v.prep_starts,
      prep_ends: v.prep_ends,
      prep_days: DAY_KEYS.filter((d) => v.prep_days.includes(d)),
      fixed_activity: v.fixed_activity.trim() || null,
      fixed_minutes: Number(v.fixed_minutes) || 0,
      counts_private_study: v.counts_private_study,
    }).eq('year_group', row.year_group);
    setSaving(false);
    if (e) setError(e.message);
    else onSaved();
  }

  const field = { display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.85rem', color: 'var(--ink-soft)', flex: '0 0 auto' };
  return (
    <div style={{ borderTop: '1px solid var(--slate-200)', padding: '0.9rem 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <strong style={{ fontSize: '1.05rem' }}>Year {row.year_group}</strong>
        <span><strong>{minutesLabel(Math.max(evening, 0))}</strong> of homework a prep evening</span>
        <span style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{minutesLabel(Math.max(weekly, 0))} a week</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem', alignItems: 'flex-end' }}>
        <label style={field}>
          Prep
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input type="time" value={v.prep_starts} onChange={(e) => set('prep_starts', e.target.value)} style={{ width: '8.5rem' }} />
            to
            <input type="time" value={v.prep_ends} onChange={(e) => set('prep_ends', e.target.value)} style={{ width: '8.5rem' }} />
          </span>
        </label>
        <div style={{ ...field, flex: '0 1 auto', minWidth: 0 }}>
          Days
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.1rem 0.5rem', color: 'var(--ink)' }}>
            {DAY_KEYS.map((d) => (
              <label key={d} style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '0.2rem', whiteSpace: 'nowrap', margin: 0, flex: '0 0 auto' }}>
                <input
                  type="checkbox" checked={v.prep_days.includes(d)}
                  onChange={(e) => set('prep_days', e.target.checked ? [...v.prep_days, d] : v.prep_days.filter((x) => x !== d))}
                />
                {d}
              </label>
            ))}
          </span>
        </div>
        <label style={{ ...field, flex: '1 1 12rem' }}>
          Fixed activity (not homework time)
          <input value={v.fixed_activity} onChange={(e) => set('fixed_activity', e.target.value)} placeholder="None" />
        </label>
        <label style={field}>
          Its minutes
          <input type="number" min="0" step="5" value={v.fixed_minutes} onChange={(e) => set('fixed_minutes', e.target.value)} style={{ width: '6rem' }} />
        </label>
        <label style={{ ...field, flex: '1 1 14rem', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: '0.4rem', color: 'var(--ink)' }}>
          <input type="checkbox" checked={v.counts_private_study} onChange={(e) => set('counts_private_study', e.target.checked)} />
          Private study counts ({privateStudy ? `${minutesLabel(privateStudy)} a week on the timetable` : 'none on the timetable'})
        </label>
        {changed && <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}
      </div>
      {error && <div style={{ color: '#a3232c', fontSize: '0.85rem', marginTop: '0.4rem' }}>{error}</div>}
    </div>
  );
}

// Days with no homework for a year group (migration 353), such as mock
// exams: nothing can be due that day and its evening has no homework time.
// Homework already set isn't moved. Blocks from today on are listed.
function PrepBlocks() {
  const [blocks, setBlocks] = useState([]);
  const [years, setYears] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    const { data } = await supabase.from('prep_blocks').select('id, year_group, block_on, reason')
      .gte('block_on', schoolToday()).order('block_on').order('year_group');
    setBlocks(data || []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setError(null);
    if (!years.length) { setError('Tick at least one year group.'); return; }
    if (!from) { setError('Choose the first day.'); return; }
    const last = to || from;
    if (last < from) { setError('The last day is before the first.'); return; }
    if (!reason.trim()) { setError('Say why (for example, Mock exams).'); return; }
    const days = [];
    for (let d = from; d <= last && days.length < 60; d = addDays(d, 1)) days.push(d);
    const rows = years.flatMap((y) => days.map((d) => ({ year_group: y, block_on: d, reason: reason.trim() })))
      .filter((r) => !blocks.some((b) => b.year_group === r.year_group && b.block_on === r.block_on));
    setBusy(true);
    const { error: e } = rows.length ? await supabase.from('prep_blocks').insert(rows) : { error: null };
    setBusy(false);
    if (e) { setError(e.message); return; }
    setYears([]); setFrom(''); setTo(''); setReason('');
    load();
  }

  async function remove(b) {
    setError(null);
    const { error: e } = await supabase.from('prep_blocks').delete().eq('id', b.id);
    if (e) setError(e.message);
    load();
  }

  const field = { display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.85rem', color: 'var(--ink-soft)', flex: '0 0 auto' };
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Days with no homework</h2>
      <p style={{ marginTop: 0 }}>
        For mock exams, trips and the like. On a blocked day nothing can be due for that year, and its evening
        has no homework time, so homework goes on the prep evening before. Homework already set isn&apos;t moved.
      </p>
      {blocks.length === 0 ? <p style={{ color: 'var(--ink-soft)' }}>No days blocked from today on.</p> : (
        <div className="table-scroll"><table>
          <thead><tr><th>Day</th><th>Year</th><th>Why</th><th></th></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(b.block_on, { weekday: true })}</td>
                <td>Year {b.year_group}</td>
                <td>{b.reason}</td>
                <td><button type="button" className="secondary" style={{ padding: '0.25rem 0.6rem' }} onClick={() => remove(b)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem', alignItems: 'flex-end', marginTop: '0.75rem' }}>
        <div style={{ ...field, flex: '0 1 auto', minWidth: 0 }}>
          Years
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.1rem 0.6rem', color: 'var(--ink)' }}>
            {[7, 8, 9, 10, 11, 12].map((y) => (
              <label key={y} style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '0.2rem', margin: 0, flex: '0 0 auto' }}>
                <input type="checkbox" checked={years.includes(y)} onChange={(e) => setYears(e.target.checked ? [...years, y] : years.filter((x) => x !== y))} />
                {y}
              </label>
            ))}
          </span>
        </div>
        <label style={field}>First day<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: '10rem' }} /></label>
        <label style={field}>Last day (if more than one)<input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '10rem' }} /></label>
        <label style={{ ...field, flex: '1 1 12rem' }}>Why<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Mock exams" /></label>
        <button type="button" onClick={add} disabled={busy}>{busy ? 'Saving…' : 'Block'}</button>
      </div>
      {error && <p style={{ color: '#a3232c', margin: '0.5rem 0 0' }}>{error}</p>}
    </div>
  );
}

function PrepInner() {
  const [rows, setRows] = useState([]);
  const [privateStudy, setPrivateStudy] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(0);

  async function load() {
    const [{ data, error: e }, { data: ps }] = await Promise.all([
      supabase.from('prep_settings').select('*').order('year_group'),
      // Timetabled private study (Nova-T's Personal Study, code Ps): one
      // class's lessons per year is a week's worth for its students.
      supabase.from('classes')
        .select('class_id, year_group, subjects!inner(subject_code), timetable_slots(start_time, end_time)')
        .eq('subjects.subject_code', 'Ps'),
    ]);
    if (e) setError(e.message);
    setRows(data || []);
    const perYear = {};
    for (const c of ps || []) {
      const mins = (c.timetable_slots || []).reduce((sum, s) => {
        if (!s.start_time || !s.end_time) return sum;
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm));
      }, 0);
      perYear[c.year_group] = Math.max(perYear[c.year_group] || 0, mins);
    }
    setPrivateStudy(perYear);
    setLoading(false);
  }

  useEffect(() => { load(); }, [saved]);

  return (
    <div>
      <h1>Prep Times</h1>
      <p>
        Evening prep for each year group. The homework time on a prep evening is the length of prep
        less any fixed activity (Years 7–9 spend the first hour reviewing the day&apos;s work). Where a
        year&apos;s private study is ticked (for a future Year 13), its timetabled Personal Study lessons
        count as homework time on the days they fall.
      </p>
      <p>
        Teachers say how long each homework takes. It is done in prep on the evening before its deadline
        (Sunday for a Monday deadline), and Formwork won&apos;t let an evening hold more homework than the
        time here, for any student in the class. Changing these times doesn&apos;t move homework already set.
      </p>

      <div className="card">
        {loading ? <p>Loading…</p> : error ? <p style={{ color: '#a3232c' }}>{error}</p> : (
          <div>
            {rows.map((r) => (
              <PrepRow key={`${r.year_group}-${r.updated_at}`} row={r} privateStudy={privateStudy[r.year_group] || 0} onSaved={() => setSaved((n) => n + 1)} />
            ))}
          </div>
        )}
      </div>

      <PrepBlocks />
    </div>
  );
}

export default function PrepPage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/prep"><PrepInner /></RequireResource></RequireAuth>;
}
