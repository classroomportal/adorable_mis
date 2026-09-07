'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

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
      <p>Periods that started more than 15 minutes ago with no register submitted, within the last 3 hours.</p>

      <div className="card">
        {loading ? <p>Loading...</p> : rows.length === 0 ? <p>All registers are up to date.</p> : (
          <div className="table-scroll"><table>
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Class</th>
                <th>Period</th>
                <th>Started</th>
                <th>Minutes late</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slot_id}>
                  <td>{r.teacher_name}</td>
                  <td>{r.class_code}</td>
                  <td>{r.period_number}</td>
                  <td>{r.start_time}</td>
                  <td>{Math.round(r.minutes_since_start)}</td>
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
  return <RequireAuth><RegistersNotDoneInner /></RequireAuth>;
}
