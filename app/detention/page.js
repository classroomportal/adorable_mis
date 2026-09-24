'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { schoolToday } from '../../lib/schoolTime';

const STATUS_OPTIONS = ['scheduled', 'attended', 'missed', 'cancelled'];

// All week arithmetic is done on UTC-midnight dates built from the school's
// own calendar day (schoolToday). Mixing local-midnight Dates with
// toISOString() shifted every date back a day in Lagos (UTC+1), so the page
// asked for Thursday's detentions and never found the Friday rows.
function saturdayOf(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToSat = (day - 6 + 7) % 7; // days since the most recent Saturday (0 if today is Saturday)
  d.setUTCDate(d.getUTCDate() - diffToSat);
  return d;
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c; }

function DetentionInner() {
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = previous, etc.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const baseSat = saturdayOf(new Date(`${schoolToday()}T00:00:00Z`));
  const start = addDays(baseSat, weekOffset * 7);
  const end = addDays(start, 6); // Friday — detentions are always dated to this Friday

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('detentions')
      .select('detention_id, student_id, behaviour_event_id, status, students(first_name, last_name, year_group, form_class), behaviour_events(category, points, description)')
      .eq('detention_date', fmt(end));

    // A student can be flagged by both a serious single event and the weekly
    // total in the same week — group into one row with combined reasons so
    // the list (and the status control) reads as one detention per student.
    const grouped = {};
    (data || []).forEach((row) => {
      if (!grouped[row.student_id]) {
        grouped[row.student_id] = {
          student_id: row.student_id,
          student: row.students,
          status: row.status,
          detentionIds: [],
          reasons: [],
        };
      }
      const g = grouped[row.student_id];
      g.detentionIds.push(row.detention_id);
      g.reasons.push(
        row.behaviour_event_id
          ? `Serious event — ${row.behaviour_events?.category || 'negative event'} (${row.behaviour_events?.points ?? '?'} pts)`
          : 'Weekly total reached 10+ points'
      );
    });
    const list = Object.values(grouped).sort((a, b) =>
      (a.student?.last_name || '').localeCompare(b.student?.last_name || '')
    );
    setRows(list);
    setLoading(false);
  }

  useEffect(() => { load(); }, [weekOffset]);

  async function updateStatus(detentionIds, newStatus) {
    await supabase.from('detentions').update({ status: newStatus }).in('detention_id', detentionIds);
    load();
  }

  return (
    <div>
      <div className="no-print">
        <h1>Friday Detention List</h1>
        <p>Students flagged by a serious single event or 10+ negative points, Saturday through Friday.</p>
        <div className="card" style={{ alignItems: 'center' }}>
          <button className="secondary" onClick={() => setWeekOffset((w) => w - 1)}>← Previous week</button>
          <strong>{fmt(start)} to {fmt(end)}</strong>
          <button className="secondary" onClick={() => setWeekOffset((w) => w + 1)} disabled={weekOffset >= 0}>Next week →</button>
          {weekOffset !== 0 && <button className="secondary" onClick={() => setWeekOffset(0)}>This week</button>}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{rows.length} student{rows.length === 1 ? '' : 's'} for detention</h2>
          <button className="no-print" onClick={() => window.print()}>Print list</button>
        </div>
        {loading ? <p>Loading...</p> : rows.length === 0 ? <p>Nobody has reached the threshold this week.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Year</th><th>Form</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <td>{r.student?.first_name} {r.student?.last_name}</td>
                  <td>{r.student?.year_group}</td>
                  <td>{r.student?.form_class}</td>
                  <td>{r.reasons.join('; ')}</td>
                  <td>
                    <select value={r.status} onChange={(e) => updateStatus(r.detentionIds, e.target.value)}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function DetentionPage() {
  return <RequireAuth><RequireResource resourceKey="/detention"><DetentionInner /></RequireResource></RequireAuth>;
}
