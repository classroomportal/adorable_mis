'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { schoolClock } from '../../../lib/schoolTime';
import { formatLateness } from '../../components/AttendanceSummary';

function RegistersNotDoneInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('registers_not_done')
      .select('*')
      .order('minutes_since_start', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h1>Registers Not Done</h1>
      <p>
        Every register still outstanding today: periods that started more than 15 minutes ago
        with nothing submitted. They stay listed until the register is taken, rather than ageing
        off the list unnoticed.
      </p>
      {/* School time, stated plainly: the figures are Lagos wall-clock, and a
          laptop set to another zone would otherwise make them look wrong. */}
      <p style={{ color: '#5b6472', fontSize: '0.85rem' }}>
        School time now: <strong>{schoolClock()}</strong> (Lagos)
      </p>

      <div className="card">
        {loading ? <p>Loading...</p> : rows.length === 0 ? <p>All registers are up to date.</p> : (
          <div className="table-scroll"><table>
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Class</th>
                <th>Period</th>
                <th>Started</th>
                <th>Outstanding for</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slot_id}>
                  <td>{r.teacher_name}</td>
                  <td>{r.class_code}</td>
                  {/* The school's period names are offset from period_number —
                      number 3 is "Period 2" — so printing the number made the
                      start time look wrong against it. Show what staff call it. */}
                  <td>{r.period_name || `Period ${r.period_number}`}</td>
                  <td>{(r.start_time || '').slice(0, 5)}</td>
                  <td>{formatLateness(Math.round(r.minutes_since_start))}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function RegistersNotDonePage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/registers-not-done"><RegistersNotDoneInner /></RequireResource></RequireAuth>;
}
