'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';

function RegisterAlertsInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  // '' = everyone, shown as one line per person (the principal, 7 Oct 2026).
  const [staffId, setStaffId] = useState('');

  async function load() {
    setLoading(true);
    let query = supabase
      .from('register_alerts')
      .select('register_alert_id, staff_id, period_date, minutes_late, resolved, staff(first_name, last_name), other_half_activities(activity_name)')
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

  const staffName = (r) => `${r.staff?.first_name || ''} ${r.staff?.last_name || ''}`.trim() || 'Unknown';
  const people = Object.values(rows.reduce((acc, r) => {
    const p = acc[r.staff_id] || (acc[r.staff_id] = { staffId: r.staff_id, name: staffName(r), count: 0, minutes: 0, last: r.period_date });
    p.count += 1;
    p.minutes += r.minutes_late || 0;
    if (r.period_date > p.last) p.last = r.period_date;
    return acc;
  }, {})).sort((a, b) => a.name.localeCompare(b.name));
  const chosen = people.find((p) => String(p.staffId) === staffId);
  const shown = chosen ? rows.filter((r) => String(r.staff_id) === staffId) : [];

  return (
    <div>
      <h1>Register Alerts</h1>
      <p>Staff who didn't take a register on time, for SRO/HR follow-up. Captured automatically every 15 minutes.</p>

      <div className="card">
        <label>
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          {' '}Show resolved
        </label>
        <label style={{ marginLeft: '1.5rem' }}>
          Staff{' '}
          <select value={chosen ? staffId : ''} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">All staff ({rows.length})</option>
            {people.map((p) => (
              <option key={p.staffId} value={String(p.staffId)}>{p.name} ({p.count})</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        {loading ? <p>Loading...</p> : rows.length === 0 ? <p>No outstanding register alerts.</p> : !chosen ? (
          <div className="table-scroll"><table>
            <thead><tr><th>Staff</th><th>Alerts</th><th>Total minutes late</th><th>Latest</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.staffId}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); setStaffId(String(p.staffId)); }}>{p.name}</a></td>
                  <td>{p.count}</td>
                  <td>{p.minutes}</td>
                  <td>{formatUKDate(p.last)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="table-scroll"><table>
            <thead><tr><th>Staff</th><th>Register</th><th>Date</th><th>Minutes late</th><th>Resolved</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.register_alert_id}>
                  <td>{r.staff?.first_name} {r.staff?.last_name}</td>
                  <td>{r.other_half_activities ? `Other Half: ${r.other_half_activities.activity_name}` : 'Class'}</td>
                  <td>{formatUKDate(r.period_date)}</td>
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
  return <RequireAuth><RequireResource resourceKey="/admin/register-alerts"><RegisterAlertsInner /></RequireResource></RequireAuth>;
}
