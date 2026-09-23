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

// The school day for each weekday (migration 153): a bell_times row means
// that lesson runs that day, at those times, under that day's name (blank =
// the usual name from the periods table). The nine period numbers are fixed
// — they are Nova-T's nine slots a day — so a day chooses which of them run.
function BellTimesInner() {
  const [periods, setPeriods] = useState([]);
  const [saved, setSaved] = useState({});   // `${day}|${period}` -> { runs, start, end, name, label } as stored
  const [edits, setEdits] = useState({});   // same key -> same shape, being edited
  const [offCounts, setOffCounts] = useState({});
  const [slotCounts, setSlotCounts] = useState({}); // same key -> lessons timetabled then
  const [day, setDay] = useState('Mon');
  const [copyTo, setCopyTo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  async function load() {
    setLoading(true);
    const [{ data: periodRows }, { data: bellRows }, slots] = await Promise.all([
      supabase.from('periods').select('period_number, period_name, short_label').order('period_number'),
      supabase.from('bell_times').select('day_of_week, period_number, start_time, end_time, period_name, short_label'),
      fetchAllSlots(),
    ]);
    const s = {};
    for (const d of DAYS) {
      for (const p of periodRows || []) s[`${d}|${p.period_number}`] = { runs: false, start: '', end: '', name: '', label: '' };
    }
    for (const b of bellRows || []) {
      s[`${b.day_of_week}|${b.period_number}`] = {
        runs: true,
        start: trim(b.start_time),
        end: trim(b.end_time),
        name: b.period_name || '',
        label: b.short_label || '',
      };
    }
    // Slots whose time doesn't match their day's bell time — left alone
    // until someone saves that row.
    const off = {};
    const counts = {};
    for (const t of slots) {
      const key = `${t.day_of_week}|${t.period_number}`;
      counts[key] = (counts[key] || 0) + 1;
      const b = s[key];
      if (b?.runs && (trim(t.start_time) !== b.start || trim(t.end_time) !== b.end)) {
        off[key] = (off[key] || 0) + 1;
      }
    }
    setPeriods(periodRows || []);
    setSaved(s);
    setEdits(s);
    setOffCounts(off);
    setSlotCounts(counts);
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
    if (!a || !b) return false;
    if (a.runs !== b.runs) return true;
    if (!a.runs) return false;
    return a.start !== b.start || a.end !== b.end || a.name.trim() !== b.name || a.label.trim() !== b.label;
  }

  function toggleCopy(d) {
    setCopyTo((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function save() {
    const upserts = [];
    const removals = []; // [day, period_number]
    const problems = [];
    const targetDays = [day, ...copyTo];
    for (const p of periods) {
      const t = edits[`${day}|${p.period_number}`];
      if (t.runs) {
        if (!t.start || !t.end) {
          problems.push(`${t.name.trim() || p.period_name}: set a start and an end.`);
          continue;
        }
        if (t.end <= t.start) {
          problems.push(`${t.name.trim() || p.period_name}: end must be after start.`);
          continue;
        }
      }
      for (const d of targetDays) {
        const key = `${d}|${p.period_number}`;
        // This day: only rows that changed. Copied days: every row, so they
        // end up identical.
        if (d === day && !isChanged(key)) continue;
        if (t.runs) {
          upserts.push({
            day_of_week: d,
            period_number: p.period_number,
            start_time: t.start,
            end_time: t.end,
            // Blank or the usual name = follow the periods table.
            period_name: t.name.trim() && t.name.trim() !== p.period_name ? t.name.trim() : null,
            short_label: t.label.trim() && t.label.trim() !== p.short_label ? t.label.trim() : null,
          });
        } else if (saved[key]?.runs) {
          if (slotCounts[key]) {
            problems.push(
              `${DAY_NAMES[d]} ${saved[key].name || p.period_name}: ${slotCounts[key]} class lesson(s) are timetabled then, so it can't be taken off that day yet.`
            );
            continue;
          }
          removals.push([d, p.period_number]);
        }
      }
    }
    if (problems.length) {
      setStatus(problems.join(' '));
      return;
    }
    if (upserts.length === 0 && removals.length === 0) {
      setStatus('Nothing to save.');
      return;
    }
    setStatus('Saving...');
    if (upserts.length > 0) {
      const { error } = await supabase.from('bell_times').upsert(upserts, { onConflict: 'day_of_week,period_number' });
      if (error) {
        setStatus(`Not saved: ${error.message}`);
        return;
      }
    }
    for (const [d, n] of removals) {
      const { error } = await supabase.from('bell_times').delete().eq('day_of_week', d).eq('period_number', n);
      if (error) {
        setStatus(`Partly saved — ${DAY_NAMES[d]} period ${n} not removed: ${error.message}`);
        await load();
        return;
      }
    }
    const days = targetDays.map((d) => DAY_NAMES[d]).join(', ');
    setCopyTo([]);
    await load();
    setStatus(`Saved ${days}. Every class's lessons on ${targetDays.length === 1 ? 'that day' : 'those days'} now use these times.`);
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
  const lessonsToday = periods.filter((p) => edits[`${day}|${p.period_number}`]?.runs).length;

  return (
    <div>
      <h1>Bell Times</h1>
      <p>
        The school day, day by day: which lessons run, what each is called and when it starts and ends.
        Saving changes the times on every class&apos;s lessons for that day. Leave a name blank to use the
        usual one. A lesson can only be taken off a day once no class is timetabled then.
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
            <h2>{DAY_NAMES[day]} <span style={{ fontSize: '0.7em', fontWeight: 400, color: '#666' }}>{lessonsToday} of {periods.length} run</span></h2>
            <div className="table-scroll"><table>
              <thead><tr><th>Runs</th><th>Name</th><th>Short</th><th>Starts</th><th>Ends</th><th></th></tr></thead>
              <tbody>
                {periods.map((p) => {
                  const key = `${day}|${p.period_number}`;
                  const t = edits[key];
                  const inUse = slotCounts[key] || 0;
                  return (
                    <tr key={p.period_number} style={{ opacity: t.runs ? 1 : 0.55 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={t.runs}
                          disabled={t.runs && inUse > 0}
                          title={t.runs && inUse > 0 ? `${inUse} class lesson(s) are timetabled then` : ''}
                          onChange={(e) => edit(p.period_number, 'runs', e.target.checked)}
                          aria-label={`${p.period_name} runs on ${DAY_NAMES[day]}`}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={t.name}
                          placeholder={p.period_name}
                          disabled={!t.runs}
                          onChange={(e) => edit(p.period_number, 'name', e.target.value)}
                          style={{ width: '10rem' }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={t.label}
                          placeholder={p.short_label}
                          disabled={!t.runs}
                          onChange={(e) => edit(p.period_number, 'label', e.target.value)}
                          style={{ width: '3.5rem' }}
                        />
                      </td>
                      <td>
                        <input type="time" value={t.start} disabled={!t.runs} onChange={(e) => edit(p.period_number, 'start', e.target.value)} />
                      </td>
                      <td>
                        <input type="time" value={t.end} disabled={!t.runs} onChange={(e) => edit(p.period_number, 'end', e.target.value)} />
                      </td>
                      <td style={{ fontSize: '0.9em', color: '#8a5a00' }}>
                        {!t.runs && inUse > 0 && `${inUse} class lesson(s) timetabled here but no bell time.`}
                        {t.runs && offCounts[key] ? (
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
              Also make these days the same:{' '}
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
