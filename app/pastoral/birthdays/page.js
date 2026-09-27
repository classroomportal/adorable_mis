'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Staff and students with a birthday today or in the next 6 days, from
// upcoming_birthdays() (migration 213). Staff dates of birth come off their
// HR record, so the function gives staff a day and month only; students
// get the age they turn on the day.

// Day name for a YYYY-MM-DD date. Built at UTC midnight and read back in
// UTC, so the device's own timezone can't move it to the day before.
function weekdayOf(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

function dayMonthOf(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function BirthdaysInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.rpc('upcoming_birthdays', { p_days: 7 }).then(({ data, error }) => {
      if (error) setError(error.message);
      setRows(data || []);
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <h1>Birthdays</h1>
      <p>
        Staff and students with a birthday today or in the next 6 days. Students show the age
        they turn on the day. Staff birthdays come from their HR record, so a member of staff
        is only listed once HR has entered their date of birth on Staff Records.
      </p>

      <div className="card">
        {loading ? <p>Loading...</p> : error ? <p style={{ color: '#a3232c' }}>{error}</p> : rows.length === 0 ? (
          <p>No birthdays in the next 7 days.</p>
        ) : (
          <div className="table-scroll"><table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Name</th>
                <th>Staff / Student</th>
                <th>Year / Form</th>
                <th>Turning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.person_type}-${r.person_id}`}
                  style={r.days_until === 0 ? { background: '#fff7e0', fontWeight: 600 } : undefined}
                >
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {weekdayOf(r.birthday)} {dayMonthOf(r.birthday)}
                    {r.days_until === 0 && ' 🎂 today'}
                    {r.days_until === 1 && ' (tomorrow)'}
                  </td>
                  <td>{r.first_name} {r.last_name}</td>
                  <td>{r.person_type === 'staff' ? `Staff${r.staff_code ? ` (${r.staff_code})` : ''}` : 'Student'}</td>
                  <td>{r.person_type === 'student' ? `Year ${r.year_group}${r.form_class ? ` · ${r.form_class}` : ''}` : ''}</td>
                  <td>{r.person_type === 'student' ? r.turning_age : ''}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function BirthdaysPage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/birthdays"><BirthdaysInner /></RequireResource></RequireAuth>;
}
