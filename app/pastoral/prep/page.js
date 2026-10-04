'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { DAY_KEYS } from '../../../lib/homework';
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

  return (
    <tr>
      <td><strong>Year {row.year_group}</strong></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <input type="time" value={v.prep_starts} onChange={(e) => set('prep_starts', e.target.value)} style={{ width: '7rem' }} />
        {' – '}
        <input type="time" value={v.prep_ends} onChange={(e) => set('prep_ends', e.target.value)} style={{ width: '7rem' }} />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {DAY_KEYS.map((d) => (
          <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem', marginRight: '0.35rem', fontSize: '0.85rem' }}>
            <input
              type="checkbox" checked={v.prep_days.includes(d)}
              onChange={(e) => set('prep_days', e.target.checked ? [...v.prep_days, d] : v.prep_days.filter((x) => x !== d))}
            />
            {d}
          </label>
        ))}
      </td>
      <td>
        <input value={v.fixed_activity} onChange={(e) => set('fixed_activity', e.target.value)} placeholder="None" style={{ minWidth: '10rem' }} />
      </td>
      <td>
        <input type="number" min="0" step="5" value={v.fixed_minutes} onChange={(e) => set('fixed_minutes', e.target.value)} style={{ width: '5rem' }} />
      </td>
      <td>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <input type="checkbox" checked={v.counts_private_study} onChange={(e) => set('counts_private_study', e.target.checked)} />
          {privateStudy ? minutesLabel(privateStudy) : 'none on timetable'}
        </label>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <strong>{minutesLabel(Math.max(evening, 0))}</strong> an evening
        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{minutesLabel(Math.max(weekly, 0))} a week</div>
      </td>
      <td>
        {changed && <button type="button" onClick={save} disabled={saving} style={{ padding: '0.3rem 0.6rem' }}>{saving ? 'Saving…' : 'Save'}</button>}
        {error && <div style={{ color: '#a3232c', fontSize: '0.85rem' }}>{error}</div>}
      </td>
    </tr>
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
          <div className="table-scroll"><table>
            <thead>
              <tr>
                <th>Year</th>
                <th>Prep</th>
                <th>Days</th>
                <th>Fixed activity</th>
                <th>Minutes</th>
                <th>Private study counts</th>
                <th>Homework time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PrepRow key={`${r.year_group}-${r.updated_at}`} row={r} privateStudy={privateStudy[r.year_group] || 0} onSaved={() => setSaved((n) => n + 1)} />
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function PrepPage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/prep"><PrepInner /></RequireResource></RequireAuth>;
}
