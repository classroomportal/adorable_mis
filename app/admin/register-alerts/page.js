'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function RegisterAlertsInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  async function load() {
    setLoading(true);
    let query = supabase
      .from('register_alerts')
      .select('register_alert_id, period_date, minutes_late, resolved, staff(first_name, last_name)')
      .order('period_date', { ascending: false })
      .order('minutes_late', { ascending: false });
    if (!showResolved) query = query.eq('resolved', false);
    const { data } = await query;
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [showResolved]);

  async function toggleResolved(id, resolved) {
    await supabase.from('register_alerts').update({ resolved }).eq('register_alert_id', id);
    load();
  }

  return (
    <div>
      <h1>Register Alerts</h1>
      <p>Staff who didn't take a register on time, for SRO/HR follow-up. Captured automatically every 15 minutes.</p>

      <div className="card">
        <label>
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          {' '}Show resolved
        </label>
      </div>

      <div className="card">
        {loading ? <p>Loading...</p> : rows.length === 0 ? <p>No outstanding register alerts.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Staff</th><th>Date</th><th>Minutes late</th><th>Resolved</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.register_alert_id}>
                  <td>{r.staff?.first_name} {r.staff?.last_name}</td>
                  <td>{r.period_date}</td>
                  <td>{r.minutes_late}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.resolved}
                      onChange={(e) => toggleResolved(r.register_alert_id, e.target.checked)}
                    />
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

export default function RegisterAlertsPage() {
  return <RequireAuth><RegisterAlertsInner /></RequireAuth>;
}
