'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { clearanceStatus, lengthOfService, initials } from '../../../lib/staffHr';

function StaffRecordsInner() {
  const [staff, setStaff] = useState([]);
  const [hrMap, setHrMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => {
    async function load() {
      // The photo is left out on purpose — 60-odd base64 photos is megabytes
      // for a list that only needs initials.
      const [{ data: s }, { data: hr }] = await Promise.all([
        supabase.from('staff').select('staff_id, first_name, last_name, staff_code, email').order('last_name'),
        supabase
          .from('staff_hr_profiles')
          .select('staff_id, job_title, department, date_of_appointment, leaving_date, police_clearance_date, police_clearance_renewal_date'),
      ]);
      setStaff(s || []);
      const map = {};
      (hr || []).forEach((h) => { map[h.staff_id] = h; });
      setHrMap(map);
      setLoading(false);
    }
    load();
  }, []);

  const q = filter.trim().toLowerCase();
  const rows = staff
    .map((s) => ({ ...s, hr: hrMap[s.staff_id], clearance: clearanceStatus(hrMap[s.staff_id]) }))
    .filter((s) => !q || `${s.first_name} ${s.last_name} ${s.staff_code || ''} ${s.hr?.job_title || ''} ${s.hr?.department || ''}`.toLowerCase().includes(q))
    .filter((s) => !onlyProblems || s.clearance.tone !== 'ok');

  const clearanceProblems = staff.filter((s) => clearanceStatus(hrMap[s.staff_id]).tone !== 'ok').length;

  return (
    <div>
      <h1>Staff Records</h1>
      <p style={{ color: 'var(--ink-soft)' }}>
        Open a member of staff for their full record — appointment, police clearance, training,
        warnings, days off and lateness, and timetable.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
        <input
          placeholder="Search name, code, job title..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: '20rem' }}
        />
        <label style={{ flexDirection: 'row', alignItems: 'center', flex: '0 0 auto', gap: '0.4rem' }}>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} style={{ width: 'auto' }} />
          Police clearance missing, expired or due ({clearanceProblems})
        </label>
      </div>

      {loading ? <p>Loading...</p> : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Job title</th>
                <th>Appointed</th>
                <th>Police clearance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.staff_id}>
                  <td>
                    <a href={`/staff/records/${s.staff_id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="staff-avatar-sm">{initials(s)}</span>
                      {s.first_name} {s.last_name}
                    </a>
                    {s.hr?.leaving_date && <span className="badge hr-tone-warn" style={{ marginLeft: '0.4rem' }}>Leaving {formatUKDate(s.hr.leaving_date)}</span>}
                  </td>
                  <td>{s.staff_code || '—'}</td>
                  <td>{s.hr?.job_title || '—'}{s.hr?.department ? <span style={{ color: 'var(--ink-soft)' }}> · {s.hr.department}</span> : ''}</td>
                  <td>
                    {s.hr?.date_of_appointment ? (
                      <>
                        {formatUKDate(s.hr.date_of_appointment)}
                        <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>{lengthOfService(s.hr.date_of_appointment)}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td>
                    <span className={`badge hr-tone-${s.clearance.tone}`}>{s.clearance.label}</span>
                    {s.hr?.police_clearance_date && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: '0.15rem' }}>
                        {formatUKDate(s.hr.police_clearance_date)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--ink-soft)' }}>No staff match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function StaffRecordsPage() {
  return <RequireAuth><RequireResource resourceKey="/staff/records"><StaffRecordsInner /></RequireResource></RequireAuth>;
}
