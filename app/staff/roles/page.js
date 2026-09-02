'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

const ROLE_LABELS = {
  sysadmin: 'Sysadmin',
  smt: 'SMT',
  houseparent: 'Houseparent',
  head_of_department: 'Head of Department',
  assessment_manager: 'Assessment Manager',
  class_teacher: 'Class Teacher',
};
const ALL_ROLES = Object.keys(ROLE_LABELS);

function StaffRolesInner() {
  const [staff, setStaff] = useState([]);
  const [roleMap, setRoleMap] = useState({}); // staff_id -> Set of role_name
  const [status, setStatus] = useState(null);

  async function load() {
    const { data: s } = await supabase.from('staff').select('*').order('last_name');
    setStaff(s || []);
    const { data: r } = await supabase.from('staff_roles').select('*');
    const map = {};
    (r || []).forEach((row) => {
      if (!map[row.staff_id]) map[row.staff_id] = new Set();
      map[row.staff_id].add(row.role_name);
    });
    setRoleMap(map);
  }

  useEffect(() => { load(); }, []);

  async function toggleRole(staffId, roleName, checked) {
    if (checked) {
      const { error } = await supabase.from('staff_roles').insert({ staff_id: staffId, role_name: roleName });
      if (error) { setStatus(`Error: ${error.message}`); return; }
    } else {
      const { error } = await supabase.from('staff_roles').delete().eq('staff_id', staffId).eq('role_name', roleName);
      if (error) { setStatus(`Error: ${error.message}`); return; }
    }
    setRoleMap((prev) => {
      const next = { ...prev };
      const set = new Set(next[staffId] || []);
      if (checked) set.add(roleName); else set.delete(roleName);
      next[staffId] = set;
      return next;
    });
    setStatus(null);
  }

  async function updateEmail(staffId, email) {
    setStaff((prev) => prev.map((s) => (s.staff_id === staffId ? { ...s, email } : s)));
  }

  async function saveEmail(staffId, email) {
    const { error } = await supabase.from('staff').update({ email }).eq('staff_id', staffId);
    setStatus(error ? `Error: ${error.message}` : 'Saved.');
  }

  return (
    <div>
      <h1>Staff &amp; Roles</h1>
      <p>Assign roles to control what each staff member can see and do. Everyone defaults to Class Teacher.</p>
      {status && <p>{status}</p>}
      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            {ALL_ROLES.map((r) => <th key={r}>{ROLE_LABELS[r]}</th>)}
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.staff_id}>
              <td>{s.first_name} {s.last_name}</td>
              <td>
                <input
                  type="email"
                  value={s.email || ''}
                  placeholder="name@abc.sch.ng"
                  onChange={(e) => updateEmail(s.staff_id, e.target.value)}
                  onBlur={(e) => saveEmail(s.staff_id, e.target.value)}
                  style={{ width: '14rem' }}
                />
              </td>
              {ALL_ROLES.map((r) => (
                <td key={r} style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={roleMap[s.staff_id]?.has(r) || false}
                    onChange={(e) => toggleRole(s.staff_id, r, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function StaffRolesPage() {
  return <RequireAuth><StaffRolesInner /></RequireAuth>;
}
