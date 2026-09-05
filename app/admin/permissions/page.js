'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function PermissionsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [roles, setRoles] = useState([]);
  const [resources, setResources] = useState([]);
  const [grants, setGrants] = useState({}); // role_name -> Set of resource_key
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

  if (!isAdmin) return <p>Only admin can manage permissions.</p>;

  const sections = [...new Set(resources.map((r) => r.section))];
  const selectedGrants = grants[selectedRole] || new Set();

  return (
    <div>
      <h1>Permissions</h1>
      <p>Choose a role, then tick which tiles/pages it can access. Changes save instantly.</p>

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

      {status && <p>{status}</p>}
    </div>
  );
}

export default function PermissionsPage() {
  return <RequireAuth><PermissionsInner /></RequireAuth>;
}
