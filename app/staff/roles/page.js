'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

const ROLE_LABELS = {
  admin: 'Admin',
  smt: 'SMT',
  hr: 'HR',
  pastoral: 'Pastoral',
  houseparent: 'House Parent',
  assessment_manager: 'Assessment Manager',
  assessment_user: 'Assessment User',
  teacher: 'Teacher',
  bursar: 'Bursar',
  school_office: 'School Office',
  admissions: 'Admissions',
  tuckshop: 'Tuckshop',
  head_of_department: 'Head of Dept',
  mentor: 'Mentor',
};
const ALL_ROLES = Object.keys(ROLE_LABELS);

function StaffRolesInner() {
  const [staff, setStaff] = useState([]);
  const [roleMap, setRoleMap] = useState({}); // staff_id -> Set of role_name
  const [deptScopeMap, setDeptScopeMap] = useState({}); // staff_id -> department_name (for head_of_department)
  const [houseScopeMap, setHouseScopeMap] = useState({}); // staff_id -> boarding_house name (for houseparent)
  const [departments, setDepartments] = useState([]);
  const [houses, setHouses] = useState([]);
  const [status, setStatus] = useState(null);
  const [newStaff, setNewStaff] = useState({ first_name: '', last_name: '', staff_code: '', email: '' });
  const [nameFilter, setNameFilter] = useState('');

  async function load() {
    const { data: s } = await supabase.from('staff').select('*').order('last_name');
    setStaff(s || []);
    const { data: r } = await supabase.from('staff_roles').select('*');
    const map = {};
    const deptScopes = {};
    const houseScopes = {};
    (r || []).forEach((row) => {
      if (!map[row.staff_id]) map[row.staff_id] = new Set();
      map[row.staff_id].add(row.role_name);
      if (row.role_name === 'head_of_department' && row.scope_value) {
        deptScopes[row.staff_id] = row.scope_value;
      }
      if (row.role_name === 'houseparent' && row.scope_value) {
        houseScopes[row.staff_id] = row.scope_value;
      }
    });
    setRoleMap(map);
    setDeptScopeMap(deptScopes);
    setHouseScopeMap(houseScopes);
    const { data: d } = await supabase.from('departments').select('department_name').order('department_name');
    setDepartments((d || []).map((x) => x.department_name));
    const { data: h } = await supabase.from('boarding_houses').select('name').order('name');
    setHouses((h || []).map((x) => x.name));
  }

  useEffect(() => { load(); }, []);

  async function setDepartmentScope(staffId, departmentName) {
    const { error } = await supabase
      .from('staff_roles')
      .update({ scope_type: 'department', scope_value: departmentName })
      .eq('staff_id', staffId)
      .eq('role_name', 'head_of_department');
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setDeptScopeMap((prev) => ({ ...prev, [staffId]: departmentName }));
  }

  async function setHouseScope(staffId, houseName) {
    const { error } = await supabase
      .from('staff_roles')
      .update({ scope_type: 'house', scope_value: houseName })
      .eq('staff_id', staffId)
      .eq('role_name', 'houseparent');
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setHouseScopeMap((prev) => ({ ...prev, [staffId]: houseName }));
  }

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

  // Adding the Houseparent role writes the role row on its own — the house is
  // only stored once someone picks one from the House dropdown. A houseparent
  // with no house is scoped to nothing, so /students and /behaviour show them
  // the whole school and they never get the Houseparent view. Surface that
  // rather than letting it sit unnoticed.
  const houseparentsMissingHouse = staff.filter(
    (s) => roleMap[s.staff_id]?.has('houseparent') && !houseScopeMap[s.staff_id]
  );

  return (
    <div>
      <h1>Staff &amp; Roles</h1>
      <p>Assign roles to control what each staff member can see and do. Everyone defaults to Class Teacher.</p>
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Staff code is just a label (e.g. CBT) — it's safe to edit. Timetable and class links use a
        hidden internal ID that never changes, so renaming a code here won't break anything.
      </p>
      {status && <p>{status}</p>}

      {houseparentsMissingHouse.length > 0 && (
        <p style={{ background: '#fde2e2', border: '1px solid #e0a0a0', padding: '0.5rem 0.7rem', borderRadius: '4px' }}>
          <strong>Houseparent with no house set:</strong>{' '}
          {houseparentsMissingHouse.map((s) => `${s.first_name.trim()} ${s.last_name}`).join(', ')}.{' '}
          Until a house is chosen they are not scoped to one at all — Students and Behaviour show
          them the whole school rather than the Houseparent view. Pick a house below.
        </p>
      )}

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

      <input
        placeholder="Filter by name..."
        value={nameFilter}
        onChange={(e) => setNameFilter(e.target.value)}
        style={{ marginBottom: '0.75rem', maxWidth: '20rem' }}
      />

      <table className="roles-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Code</th>
            <th>Email</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {staff
            .filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(nameFilter.toLowerCase()))
            .map((s) => {
              const assigned = [...(roleMap[s.staff_id] || [])];
              const unassigned = ALL_ROLES.filter((r) => !assigned.includes(r));
              return (
            <tr key={s.staff_id}>
              <td>
                <input
                  value={s.first_name}
                  style={{ width: '100%', boxSizing: 'border-box', display: 'block' }}
                  onChange={(e) => updateField(s.staff_id, 'first_name', e.target.value)}
                  onBlur={(e) => saveField(s.staff_id, 'first_name', e.target.value)}
                />
                <input
                  value={s.last_name}
                  style={{ width: '100%', boxSizing: 'border-box', display: 'block', marginTop: '0.3rem' }}
                  onChange={(e) => updateField(s.staff_id, 'last_name', e.target.value)}
                  onBlur={(e) => saveField(s.staff_id, 'last_name', e.target.value)}
                />
              </td>
              <td>
                <input
                  value={s.staff_code || ''}
                  placeholder="e.g. CBT"
                  maxLength={10}
                  style={{ width: '100%', boxSizing: 'border-box', textTransform: 'uppercase' }}
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
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </td>
              <td style={{ minWidth: '16rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.4rem' }}>
                  {assigned.length === 0 && <span style={{ color: '#999', fontSize: '0.85rem' }}>Class Teacher (default)</span>}
                  {assigned.map((r) => (
                    <span key={r} className="role-chip" style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      background: '#eef1fb', border: '1px solid #d3d9f0', borderRadius: '999px',
                      padding: '0.15rem 0.5rem', fontSize: '0.8rem',
                    }}>
                      {ROLE_LABELS[r]}
                      <button
                        type="button"
                        onClick={() => toggleRole(s.staff_id, r, false)}
                        title={`Remove ${ROLE_LABELS[r]}`}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: '#667' }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                {assigned.includes('head_of_department') && (
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
                    Department:{' '}
                    <select
                      value={deptScopeMap[s.staff_id] || ''}
                      onChange={(e) => setDepartmentScope(s.staff_id, e.target.value)}
                    >
                      <option value="">-- department --</option>
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                )}
                {assigned.includes('houseparent') && (
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
                    House:{' '}
                    <select
                      value={houseScopeMap[s.staff_id] || ''}
                      onChange={(e) => setHouseScope(s.staff_id, e.target.value)}
                      style={houseScopeMap[s.staff_id] ? undefined : { border: '2px solid #c00', background: '#fde2e2' }}
                    >
                      <option value="">-- house --</option>
                      {houses.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    {!houseScopeMap[s.staff_id] && (
                      <span style={{ color: '#c00', marginLeft: '0.4rem' }}>not scoped — sees the whole school</span>
                    )}
                  </label>
                )}

                {unassigned.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) toggleRole(s.staff_id, e.target.value, true); }}
                    style={{ fontSize: '0.8rem' }}
                  >
                    <option value="">+ Add role...</option>
                    {unassigned.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
              </td>
            </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export default function StaffRolesPage() {
  return <RequireAuth><RequireResource resourceKey="/staff/roles"><StaffRolesInner /></RequireResource></RequireAuth>;
}
