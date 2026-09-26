'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { WEEKDAYS, dayName, longDate, momentLabel, timeLabel } from '../../../lib/tuckshopSchedule';

// Weekly tuckshop ordering rota (tuckshop_order_schedule, migration 187):
// one row per tuckshop day, with the weekday + time ordering opens and
// closes before it. Tuckshop, bursar and admin staff can edit it; the RLS
// policy and the table's check constraint back that up.

const blank = { service_dow: '', opens_dow: '', opens_time: '17:00', closes_dow: '', closes_time: '09:00' };

function DaySelect({ value, onChange, required }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} required={required}>
      <option value="">—</option>
      {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
    </select>
  );
}

// The same "opens before it closes" rule as the table's check constraint,
// so staff get a clear message instead of a constraint name.
function problem(row) {
  if (!row.service_dow || !row.opens_dow || !row.closes_dow || !row.opens_time || !row.closes_time) {
    return 'Fill in every day and time.';
  }
  const mins = (dow, t) => {
    const [h, m] = t.split(':').map(Number);
    return ((row.service_dow - dow + 7) % 7) * 1440 - (h * 60 + m);
  };
  if (mins(row.opens_dow, row.opens_time) <= mins(row.closes_dow, row.closes_time)) {
    return `Ordering must open before it closes. A weekday the same as the tuckshop day means that ${dayName(row.service_dow)} itself.`;
  }
  return null;
}

export default function ScheduleEditor() {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(blank);
  const [windows, setWindows] = useState([]);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('tuckshop_order_schedule')
      .select('service_dow, opens_dow, opens_time, closes_dow, closes_time')
      .order('service_dow');
    const list = (data || []).map((r) => ({ ...r, opens_time: r.opens_time.slice(0, 5), closes_time: r.closes_time.slice(0, 5) }));
    setRows(list);
    setDraft(Object.fromEntries(list.map((r) => [r.service_dow, { ...r }])));
    const { data: w } = await supabase.rpc('tuckshop_order_windows', { p_days: 14 });
    setWindows(w || []);
  }

  function edit(dow, field, value) {
    setDraft((prev) => ({ ...prev, [dow]: { ...prev[dow], [field]: value } }));
  }

  async function saveRow(dow) {
    const row = draft[dow];
    const err = problem(row);
    if (err) { setStatus(`${dayName(dow)}: ${err}`); return; }
    setSaving(true);
    const { error } = await supabase
      .from('tuckshop_order_schedule')
      .update({
        opens_dow: row.opens_dow, opens_time: row.opens_time,
        closes_dow: row.closes_dow, closes_time: row.closes_time,
        updated_at: new Date().toISOString(),
      })
      .eq('service_dow', dow);
    setSaving(false);
    setStatus(error ? `Error: ${error.message}` : `${dayName(dow)} tuckshop schedule saved.`);
    await load();
  }

  async function removeRow(dow) {
    if (!window.confirm(`Stop taking orders for ${dayName(dow)} tuckshop? Orders already placed stay as they are.`)) return;
    setSaving(true);
    const { error } = await supabase.from('tuckshop_order_schedule').delete().eq('service_dow', dow);
    setSaving(false);
    setStatus(error ? `Error: ${error.message}` : `${dayName(dow)} tuckshop removed from the schedule.`);
    await load();
  }

  async function addRow(e) {
    e.preventDefault();
    const err = problem(adding);
    if (err) { setStatus(err); return; }
    if (rows.some((r) => r.service_dow === adding.service_dow)) {
      setStatus(`There's already a ${dayName(adding.service_dow)} tuckshop — edit it above.`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('tuckshop_order_schedule').insert(adding);
    setSaving(false);
    setStatus(error ? `Error: ${error.message}` : `${dayName(adding.service_dow)} tuckshop added.`);
    if (!error) setAdding(blank);
    await load();
  }

  const changed = (dow) => {
    const a = rows.find((r) => r.service_dow === dow);
    const b = draft[dow];
    return a && b && ['opens_dow', 'opens_time', 'closes_dow', 'closes_time'].some((k) => a[k] !== b[k]);
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Weekly ordering schedule</h3>
      <p style={{ color: '#555' }}>
        Students can only place, change or cancel orders between the opening and closing times for
        each tuckshop day. It repeats every week — nothing needs switching on or off. Students see a
        warning in the last 12 hours before ordering closes.
      </p>

      <div className="table-scroll">
        <table>
          <thead><tr><th>Tuckshop day</th><th>Ordering opens</th><th>Ordering closes</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = draft[r.service_dow] || r;
              return (
                <tr key={r.service_dow}>
                  <td><strong>{dayName(r.service_dow)}</strong></td>
                  <td>
                    <DaySelect value={d.opens_dow} onChange={(v) => edit(r.service_dow, 'opens_dow', v)} />{' '}
                    <input type="time" value={d.opens_time} onChange={(e) => edit(r.service_dow, 'opens_time', e.target.value)} />
                  </td>
                  <td>
                    <DaySelect value={d.closes_dow} onChange={(v) => edit(r.service_dow, 'closes_dow', v)} />{' '}
                    <input type="time" value={d.closes_time} onChange={(e) => edit(r.service_dow, 'closes_time', e.target.value)} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => saveRow(r.service_dow)} disabled={saving || !changed(r.service_dow)}>Save</button>{' '}
                    <button className="secondary" onClick={() => removeRow(r.service_dow)} disabled={saving}>Remove</button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={4}>No tuckshop days — students can&apos;t order at all until one is added.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={addRow} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '1rem' }}>
        <label>Add a tuckshop day<br />
          <DaySelect value={adding.service_dow} onChange={(v) => setAdding({ ...adding, service_dow: v })} required />
        </label>
        <label>Opens<br />
          <DaySelect value={adding.opens_dow} onChange={(v) => setAdding({ ...adding, opens_dow: v })} required />{' '}
          <input type="time" value={adding.opens_time} onChange={(e) => setAdding({ ...adding, opens_time: e.target.value })} required />
        </label>
        <label>Closes<br />
          <DaySelect value={adding.closes_dow} onChange={(v) => setAdding({ ...adding, closes_dow: v })} required />{' '}
          <input type="time" value={adding.closes_time} onChange={(e) => setAdding({ ...adding, closes_time: e.target.value })} required />
        </label>
        <button type="submit" disabled={saving}>Add</button>
      </form>

      {status && <p>{status}</p>}

      <h4 style={{ marginBottom: '0.4rem' }}>Coming up</h4>
      {windows.length === 0 ? <p>No ordering windows in the next two weeks.</p> : (
        <ul style={{ marginTop: 0 }}>
          {windows.map((w) => (
            <li key={w.for_date}>
              <strong>{longDate(w.for_date)}</strong>: {w.is_open ? 'open now, ' : `opens ${momentLabel(w.opens_at)}, `}
              closes {momentLabel(w.closes_at)}
            </li>
          ))}
        </ul>
      )}
      <p style={{ color: '#555', fontSize: '0.85rem' }}>
        Times are Lagos time. Example: Saturday tuckshop opening Wednesday {timeLabel('19:00')} and
        closing Thursday {timeLabel('23:00')}.
      </p>
    </div>
  );
}
