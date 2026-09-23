'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };

const trim = (t) => (t ? t.slice(0, 5) : '');

// timetable_slots is ~1000 rows, right at Supabase's silent 1000-row cap on
// an unranged select, so page through it (same approach as import-classes).
async function fetchAllSlots() {
  const pageSize = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('timetable_slots')
      .select('day_of_week, period_number, start_time, end_time')
      .order('slot_id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function BellTimesInner() {
  const [periods, setPeriods] = useState([]);
  const [saved, setSaved] = useState({});   // `${day}|${period}` -> { start, end } as stored
  const [edits, setEdits] = useState({});   // same key -> { start, end } being edited
  const [offCounts, setOffCounts] = useState({});
  const [day, setDay] = useState('Mon');
  const [copyTo, setCopyTo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  async function load() {
    setLoading(true);
    const [{ data: periodRows }, { data: bellRows }, slots] = await Promise.all([
      supabase.from('periods').select('period_number, period_name, short_label').order('period_number'),
      supabase.from('bell_times').select('day_of_week, period_number, start_time, end_time'),
      fetchAllSlots(),
    ]);
    const s = {};
    for (const b of bellRows || []) {
      s[`${b.day_of_week}|${b.period_number}`] = { start: trim(b.start_time), end: trim(b.end_time) };
    }
    // Slots whose time doesn't match their day's bell time — left alone
    // until someone saves that row.
    const off = {};
    for (const t of slots) {
      const key = `${t.day_of_week}|${t.period_number}`;
      const b = s[key];
      if (b && (trim(t.start_time) !== b.start || trim(t.end_time) !== b.end)) {
        off[key] = (off[key] || 0) + 1;
      }
    }
    setPeriods(periodRows || []);
    setSaved(s);
    setEdits(s);
    setOffCounts(off);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function edit(periodNumber, field, value) {
    const key = `${day}|${periodNumber}`;
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  function isChanged(key) {
    const a = edits[key];
    const b = saved[key];
    return !b || a?.start !== b.start || a?.end !== b.end;
  }

  function toggleCopy(d) {
    setCopyTo((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function save() {
    const rows = [];
    const problems = [];
    for (const p of periods) {
      const key = `${day}|${p.period_number}`;
      const t = edits[key];
      if (!t?.start || !t?.end) continue;
      if (t.end <= t.start) {
        problems.push(`${p.period_name}: end must be after start.`);
        continue;
      }
      // This day: only rows that changed. Copied days: every row, so they
      // end up identical.
      if (isChanged(key)) {
        rows.push({ day_of_week: day, period_number: p.period_number, start_time: t.start, end_time: t.end });
      }
      for (const d of copyTo) {
        rows.push({ day_of_week: d, period_number: p.period_number, start_time: t.start, end_time: t.end });
      }
    }
    if (problems.length) {
      setStatus(problems.join(' '));
      return;
    }
    if (rows.length === 0) {
      setStatus('Nothing to save.');
      return;
    }
    setStatus('Saving...');
    const { error } = await supabase.from('bell_times').upsert(rows, { onConflict: 'day_of_week,period_number' });
    if (error) {
      setStatus(`Not saved: ${error.message}`);
      return;
    }
    const days = [day, ...copyTo].map((d) => DAY_NAMES[d]).join(', ');
    setCopyTo([]);
    await load();
    setStatus(`Saved. Every class's lessons on ${days} now use these times.`);
  }

  // Move the classes still on an odd time for one period onto its bell time,
  // without touching anything else.
  async function matchRow(periodNumber) {
    const b = saved[`${day}|${periodNumber}`];
    setStatus('Saving...');
    const { error } = await supabase
      .from('bell_times')
      .update({ start_time: b.start, end_time: b.end })
      .eq('day_of_week', day)
      .eq('period_number', periodNumber);
    if (error) {
      setStatus(`Not saved: ${error.message}`);
      return;
    }
    await load();
    setStatus(`Moved those classes to ${b.start}–${b.end}.`);
  }

  const dirty = periods.some((p) => isChanged(`${day}|${p.period_number}`)) || copyTo.length > 0;

  return (
    <div>
      <h1>Bell Times</h1>
      <p>
        The start and end of each period, day by day. Saving changes the times on every
        class&apos;s lessons for that day and period. Staff timetables and Registers Not Done use these times.
      </p>

      <div className="card">
        {DAYS.map((d) => (
          <button
            key={d}
            onClick={() => { setDay(d); setCopyTo([]); setStatus(null); }}
            className={d === day ? '' : 'secondary'}
            style={{ marginRight: '0.5rem', marginBottom: '0.5rem', fontWeight: d === day ? 700 : 400 }}
            aria-pressed={d === day}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? <p>Loading...</p> : (
          <>
            <h2>{DAY_NAMES[day]}</h2>
            <div className="table-scroll"><table>
              <thead><tr><th>Period</th><th>Starts</th><th>Ends</th><th></th></tr></thead>
              <tbody>
                {periods.map((p) => {
                  const key = `${day}|${p.period_number}`;
                  const t = edits[key] || { start: '', end: '' };
                  return (
                    <tr key={p.period_number}>
                      <td>{p.period_name} <span style={{ color: '#666' }}>({p.short_label})</span></td>
                      <td>
                        <input type="time" value={t.start} onChange={(e) => edit(p.period_number, 'start', e.target.value)} />
                      </td>
                      <td>
                        <input type="time" value={t.end} onChange={(e) => edit(p.period_number, 'end', e.target.value)} />
                      </td>
                      <td style={{ fontSize: '0.9em', color: '#8a5a00' }}>
                        {offCounts[key] ? (
                          <>
                            {offCounts[key]} class{offCounts[key] === 1 ? ' is' : 'es are'} on a different time.{' '}
                            <button className="secondary" onClick={() => matchRow(p.period_number)} disabled={isChanged(key)}>
                              Move to {saved[key].start}–{saved[key].end}
                            </button>
                          </>
                        ) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>

            <p style={{ marginTop: '1rem' }}>
              Also use these times for:{' '}
              {DAYS.filter((d) => d !== day).map((d) => (
                <label key={d} style={{ marginRight: '1rem', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={copyTo.includes(d)} onChange={() => toggleCopy(d)} />
                  {' '}{DAY_NAMES[d]}
                </label>
              ))}
            </p>

            <button onClick={save} disabled={!dirty}>
              Save {DAY_NAMES[day]}{copyTo.length ? ` + ${copyTo.length} more day${copyTo.length === 1 ? '' : 's'}` : ''}
            </button>
          </>
        )}
        {status && <p>{status}</p>}
      </div>
    </div>
  );
}

export default function BellTimesPage() {
  return <RequireAuth><RequireResource resourceKey="/admin/bell-times"><BellTimesInner /></RequireResource></RequireAuth>;
}
