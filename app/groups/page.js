'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { GROUP_KINDS, GROUP_VISIBILITY, kindLabel, canManageGroups, describeRule } from '../../lib/studentGroups';
import { formatUKDate } from '../../lib/formatDate';

// Student groups (migration 284): a trip, a club, the prefects, an
// intervention list. smt, pastoral and the school office make and change them;
// other staff with this page can look them up. The database decides both.

function GroupsInner() {
  const { profile, staffRoles } = useAuth();
  const canManage = canManageGroups(profile, staffRoles);

  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [kindFilter, setKindFilter] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('activity');
  const [visibility, setVisibility] = useState('staff');
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data, error: err } = await supabase
      .from('student_groups')
      .select('group_id, name, description, kind, visibility, archived_at, created_at, rule_type, rule_settings, built_on, student_group_members(count), student_group_staff(staff_id, staff(first_name, last_name))')
      .order('name');
    if (err) { setError(err.message); return; }
    setGroups(data || []);
  }
  useEffect(() => { load(); }, []);

  async function createGroup(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('student_groups')
      .insert({ name, description, kind, visibility })
      .select('group_id')
      .single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    window.location.href = `/groups/${data.group_id}`;
  }

  const term = search.trim().toLowerCase();
  const shown = (groups || []).filter((g) =>
    (showArchived ? g.archived_at : !g.archived_at)
    && (!kindFilter || g.kind === kindFilter)
    && (!mineOnly || (g.student_group_staff || []).some((s) => s.staff_id === profile?.staff_id))
    && (!term || `${g.name} ${g.description || ''}`.toLowerCase().includes(term)));

  return (
    <div>
      <h1>Student Groups</h1>
      <p style={{ color: 'var(--ink-soft)' }}>
        Groups of students for activities, marks and messages.
        {canManage ? ' You can create groups and change who is in them.' : ' Groups are made by SMT, pastoral staff and the school office.'}
      </p>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {canManage && (creating ? (
        <form onSubmit={createGroup}>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. Prefects 2026/27" /></label>
          <label>Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {GROUP_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label>Who can see it
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              {GROUP_VISIBILITY.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>
          <label style={{ flexBasis: '100%' }}>Description (optional)
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
          </label>
          <button type="submit" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create group'}</button>
          <button type="button" className="secondary" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      ) : (
        <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button onClick={() => setCreating(true)}>+ New group</button>
          <a className="secondary" href="/groups/build">Build a group from a rule</a>
        </p>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', margin: '0.5rem 0 1rem' }}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search groups…" style={{ maxWidth: '16rem' }} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ maxWidth: '12rem' }}>
          <option value="">All kinds</option>
          {GROUP_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <label className="checkbox-row" style={{ flex: '0 0 auto', margin: 0 }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Groups I run
        </label>
        <label className="checkbox-row" style={{ flex: '0 0 auto', margin: 0 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
        </label>
      </div>

      {groups === null ? <p>Loading…</p> : shown.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)' }}>{groups.length === 0 ? 'No groups yet.' : 'No groups match.'}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Group</th><th>Kind</th><th>Students</th><th>Run by</th></tr></thead>
            <tbody>
              {shown.map((g) => (
                <tr key={g.group_id} className="student-link" onClick={() => { window.location.href = `/groups/${g.group_id}`; }}>
                  <td>
                    <a href={`/groups/${g.group_id}`} onClick={(e) => e.stopPropagation()}>{g.name}</a>
                    {g.rule_type && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{describeRule(g.rule_type, g.rule_settings)} · built {formatUKDate(g.built_on)}</div>}
                    {g.description && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{g.description}</div>}
                  </td>
                  <td>{kindLabel(g.kind)}</td>
                  <td>{g.student_group_members?.[0]?.count ?? 0}</td>
                  <td>{(g.student_group_staff || []).map((s) => s.staff ? `${s.staff.first_name} ${s.staff.last_name}` : '').filter(Boolean).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GroupsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/groups">
        <GroupsInner />
      </RequireResource>
    </RequireAuth>
  );
}
