'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { STUDENT_CORE_FIELDS } from '../../../lib/studentFields';

function PermissionsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [roles, setRoles] = useState([]);
  const [resources, setResources] = useState([]);
  const [grants, setGrants] = useState({}); // role_name -> Set of resource_key
  const [fieldGrants, setFieldGrants] = useState({}); // role_name -> Set of student field the role can edit
  const [selectedRole, setSelectedRole] = useState('');
  const [status, setStatus] = useState(null);

  async function load() {
    const { data: r } = await supabase.from('roles').select('*').order('role_name');
    const { data: res } = await supabase.from('resources').select('*').order('sort_order');
    const { data: rp } = await supabase.from('role_permissions').select('*');
    setRoles(r || []);
    setResources(res || []);
    const map = {};
    (rp || []).forEach((row) => {
      if (!map[row.role_name]) map[row.role_name] = new Set();
      map[row.role_name].add(row.resource_key);
    });
    setGrants(map);
    const { data: sfp } = await supabase.from('student_field_permissions').select('*');
    const fieldMap = {};
    (sfp || []).forEach((row) => {
      if (!fieldMap[row.role_name]) fieldMap[row.role_name] = new Set();
      fieldMap[row.role_name].add(row.field_name);
    });
    setFieldGrants(fieldMap);
    if (r && r.length > 0 && !selectedRole) setSelectedRole(r[0].role_name);
  }

  useEffect(() => { load(); }, []);

  async function toggleGrant(resourceKey, checked) {
    if (checked) {
      const { error } = await supabase.from('role_permissions').insert({ role_name: selectedRole, resource_key: resourceKey });
      if (error) { setStatus(`Error: ${error.message}`); return; }
    } else {
      const { error } = await supabase.from('role_permissions').delete().eq('role_name', selectedRole).eq('resource_key', resourceKey);
      if (error) { setStatus(`Error: ${error.message}`); return; }
    }
    setGrants((prev) => {
      const next = { ...prev };
      const set = new Set(next[selectedRole] || []);
      if (checked) set.add(resourceKey); else set.delete(resourceKey);
      next[selectedRole] = set;
      return next;
    });
  }

  // Grant or remove Edit on some student Core Data fields for the selected
  // role. No row means Read only; migration 151 enforces it on save.
  async function setFieldAccess(fieldKeys, canEdit) {
    const current = fieldGrants[selectedRole] || new Set();
    const keys = fieldKeys.filter((k) => current.has(k) !== canEdit);
    if (keys.length === 0) return;
    const { error } = canEdit
      ? await supabase.from('student_field_permissions').insert(keys.map((k) => ({ role_name: selectedRole, field_name: k })))
      : await supabase.from('student_field_permissions').delete().eq('role_name', selectedRole).in('field_name', keys);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setFieldGrants((prev) => {
      const set = new Set(prev[selectedRole] || []);
      keys.forEach((k) => (canEdit ? set.add(k) : set.delete(k)));
      return { ...prev, [selectedRole]: set };
    });
  }

  if (!isAdmin) return <p>Only admin can manage permissions.</p>;

  const sections = [...new Set(resources.map((r) => r.section))];
  const selectedGrants = grants[selectedRole] || new Set();
  const selectedFieldGrants = fieldGrants[selectedRole] || new Set();

  return (
    <div>
      <h1>Permissions</h1>
      <p>Choose a role, then tick which tiles/pages it can access. Changes save instantly.</p>
      <p style={{ color: '#5a6b8c', fontSize: '0.9rem' }}>
        The tiles control which pages a role can <em>see</em>. Whether a role can edit the data behind a
        tile is a separate, database-level rule — see <code>sql/RLS_ACCESS_SUMMARY.md</code> in the repo.
        The exception is student Core Data, whose Read/Edit access is set field by field at the bottom of this page.
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        {roles.map((r) => (
          <button
            key={r.role_name}
            onClick={() => setSelectedRole(r.role_name)}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '999px',
              border: selectedRole === r.role_name ? '2px solid #e34430' : '1px solid #ddd0b8',
              background: selectedRole === r.role_name ? '#e34430' : 'transparent',
              color: selectedRole === r.role_name ? '#fdf6ea' : '#333',
              fontWeight: selectedRole === r.role_name ? 700 : 400,
            }}
          >
            {r.role_name} <span style={{ opacity: 0.7 }}>({(grants[r.role_name] || new Set()).size})</span>
          </button>
        ))}
      </div>

      {selectedRole && roles.find((r) => r.role_name === selectedRole)?.description && (
        <p style={{ color: '#5a6b8c', fontStyle: 'italic' }}>
          {roles.find((r) => r.role_name === selectedRole).description}
        </p>
      )}

      {sections.map((section) => (
        <div className="card" key={section} style={{ marginBottom: '1rem' }}>
          <h2>{section}</h2>
          {resources.filter((r) => r.section === section).map((r) => (
            <label key={r.resource_key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0' }}>
              <input
                type="checkbox"
                checked={selectedGrants.has(r.resource_key)}
                onChange={(e) => toggleGrant(r.resource_key, e.target.checked)}
              />
              {r.label}
              <span style={{ color: '#aaa', fontSize: '0.8rem' }}>{r.resource_key}</span>
            </label>
          ))}
        </div>
      ))}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Student Core Data fields</h2>
        {selectedRole === 'admin' ? (
          <p>Admin can always edit every field.</p>
        ) : (
          <>
            <p style={{ color: '#5a6b8c', fontSize: '0.9rem' }}>
              Choose which fields on a student&apos;s Core Data this role can change. Read means they can see the
              field but not change it. Changes save instantly.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button className="secondary" onClick={() => setFieldAccess(STUDENT_CORE_FIELDS.map((f) => f.key), false)}>All Read</button>
              <button className="secondary" onClick={() => setFieldAccess(STUDENT_CORE_FIELDS.map((f) => f.key), true)}>All Edit</button>
              <span style={{ alignSelf: 'center', color: '#5a6b8c', fontSize: '0.9rem' }}>
                {selectedFieldGrants.size} of {STUDENT_CORE_FIELDS.length} editable
              </span>
            </div>
            <table>
              <thead>
                <tr><th>Field</th><th>Access</th></tr>
              </thead>
              <tbody>
                {STUDENT_CORE_FIELDS.map((f) => (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    <td>
                      <select
                        value={selectedFieldGrants.has(f.key) ? 'edit' : 'read'}
                        onChange={(e) => setFieldAccess([f.key], e.target.value === 'edit')}
                      >
                        <option value="read">Read</option>
                        <option value="edit">Edit</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {status && <p>{status}</p>}
    </div>
  );
}

export default function PermissionsPage() {
  return <RequireAuth><RequireResource resourceKey="/admin/permissions"><PermissionsInner /></RequireResource></RequireAuth>;
}
