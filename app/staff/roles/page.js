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
  const [newStaff, setNewStaff] = useState({ first_name: '', last_name: '', staff_code: '', email: '' });

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

  function updateField(staffId, field, value) {
    setStaff((prev) => prev.map((s) => (s.staff_id === staffId ? { ...s, [field]: value } : s)));
  }

  async function saveField(staffId, field, value) {
    const payload = field === 'staff_code' ? { staff_code: value ? value.toUpperCase() : null } : { [field]: value };
    const { error } = await supabase.from('staff').update(payload).eq('staff_id', staffId);
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus('Saved.');
      if (field === 'staff_code') load(); // re-fetch so the uppercased code shows correctly
    }
  }

  async function addStaff(e) {
    e.preventDefault();
    if (!newStaff.first_name || !newStaff.last_name) {
      setStatus('First and last name are required.');
      return;
    }
    const { error } = await supabase.from('staff').insert({
      first_name: newStaff.first_name,
      last_name: newStaff.last_name,
      staff_code: newStaff.staff_code ? newStaff.staff_code.toUpperCase() : null,
      email: newStaff.email || null,
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus('Staff member added.');
      setNewStaff({ first_name: '', last_name: '', staff_code: '', email: '' });
      load();
    }
  }

  return (
    <div>
      <h1>Staff &amp; Roles</h1>
      <p>Assign roles to control what each staff member can see and do. Everyone defaults to Class Teacher.</p>
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Staff code is just a label (e.g. CBT) — it's safe to edit. Timetable and class links use a
        hidden internal ID that never changes, so renaming a code here won't break anything.
      </p>
      {status && <p>{status}</p>}

      <form onSubmit={addStaff} className="card" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <strong style={{ width: '100%' }}>Add new staff member</strong>
        <input placeholder="First name" value={newStaff.first_name}
          onChange={(e) => setNewStaff((n) => ({ ...n, first_name: e.target.value }))} />
        <input placeholder="Last name" value={newStaff.last_name}
          onChange={(e) => setNewStaff((n) => ({ ...n, last_name: e.target.value }))} />
        <input placeholder="Code e.g. CBT" value={newStaff.staff_code} maxLength={10}
          style={{ width: '8rem', textTransform: 'uppercase' }}
          onChange={(e) => setNewStaff((n) => ({ ...n, staff_code: e.target.value }))} />
        <input type="email" placeholder="name@abc.sch.ng" value={newStaff.email}
          style={{ width: '14rem' }}
          onChange={(e) => setNewStaff((n) => ({ ...n, email: e.target.value }))} />
        <button type="submit">Add</button>
      </form>

      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Code</th>
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
                  value={s.staff_code || ''}
                  placeholder="e.g. CBT"
                  maxLength={10}
                  style={{ width: '6rem', textTransform: 'uppercase' }}
                  onChange={(e) => updateField(s.staff_id, 'staff_code', e.target.value)}
                  onBlur={(e) => saveField(s.staff_id, 'staff_code', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="email"
                  value={s.email || ''}
                  placeholder="name@abc.sch.ng"
                  onChange={(e) => updateField(s.staff_id, 'email', e.target.value)}
                  onBlur={(e) => saveField(s.staff_id, 'email', e.target.value)}
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
