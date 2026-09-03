'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

const THRESHOLD = 10;

function saturdayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToSat = (day - 6 + 7) % 7; // days since the most recent Saturday (0 if today is Saturday)
  d.setDate(d.getDate() - diffToSat);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

function DetentionInner() {
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = previous, etc.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const baseSat = saturdayOf(new Date());
  const start = addDays(baseSat, weekOffset * 7);
  const end = addDays(start, 6); // Friday

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: events } = await supabase
        .from('behaviour_events')
        .select('student_id, points, type, event_date, category, students(first_name, last_name, year_group, form_class)')
        .eq('type', 'negative')
        .gte('event_date', fmt(start))
        .lte('event_date', fmt(end));

      const totals = {};
      (events || []).forEach((e) => {
        const pts = Math.abs(e.points || 0);
        if (!totals[e.student_id]) totals[e.student_id] = { student: e.students, total: 0, events: [] };
        totals[e.student_id].total += pts;
        totals[e.student_id].events.push(e);
      });
      const list = Object.values(totals).filter((t) => t.total >= THRESHOLD).sort((a, b) => b.total - a.total);
      setRows(list);
      setLoading(false);
    }
    load();
  }, [weekOffset]);

  return (
    <div>
      <div className="no-print">
        <h1>Friday Detention List</h1>
        <p>Students with {THRESHOLD}+ negative behaviour points, Saturday through Friday.</p>
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
            <thead><tr><th>Student</th><th>Year</th><th>Form</th><th>Total negative points</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.student?.first_name} {r.student?.last_name}</td>
                  <td>{r.student?.year_group}</td>
                  <td>{r.student?.form_class}</td>
                  <td>{r.total}</td>
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
  return <RequireAuth><DetentionInner /></RequireAuth>;
}
