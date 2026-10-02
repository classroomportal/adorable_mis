'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { STUDENT_CORE_FIELDS } from '../../../lib/studentFields';
import { abilitiesForRole, ACTIONS } from '../../../lib/roleAbilities';
import { describeTable, AREA_ORDER } from '../../../lib/dataAreas';

// /admin/permissions: three views of the same roles.
//   Pages            — tick which pages a role can open (role_permissions).
//   What they can do — view / add / edit / delete per kind of record, worked
//                      out from the live database rules (lib/roleAbilities.js,
//                      migration 327), plus student Core Data fields.
//   Compare roles    — every page against every role, read-only.

const ROLE_NAMES = { smt: 'SMT', hr: 'HR', other_half: 'Other Half' };

function roleTitle(roleName) {
  if (ROLE_NAMES[roleName]) return ROLE_NAMES[roleName];
  const words = roleName.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const ABILITY_STYLE = {
  yes: { label: 'Yes', bg: '#dcf5e3', color: '#1a7a3d', mark: '✓' },
  some: { label: 'Own only', bg: 'var(--yellow-100)', color: '#7a5a00', mark: '◐' },
  no: { label: 'No', bg: 'transparent', color: '#9aa3b0', mark: '—' },
};
const ACTION_TITLES = { view: 'View', add: 'Add', edit: 'Edit', delete: 'Delete' };

function AbilityBadge({ value }) {
  const s = ABILITY_STYLE[value] || ABILITY_STYLE.no;
  return (
    <span
      className="badge"
      style={{ background: s.bg, color: s.color, fontWeight: value === 'no' ? 400 : 600, whiteSpace: 'nowrap' }}
    >
      {s.mark} {s.label}
    </span>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={active ? undefined : 'secondary'}
      style={{ borderRadius: '999px', padding: '0.4rem 1rem' }}
    >
      {children}
    </button>
  );
}

function PermissionsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [roles, setRoles] = useState([]);
  const [resources, setResources] = useState([]);
  const [grants, setGrants] = useState({}); // role_name -> Set of resource_key
  const [fieldGrants, setFieldGrants] = useState({}); // role_name -> Set of student field the role can edit
  const [policies, setPolicies] = useState(null);
  const [tables, setTables] = useState(null);
  const [rulesError, setRulesError] = useState(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [tab, setTab] = useState('pages');
  const [search, setSearch] = useState('');
  const [hideNone, setHideNone] = useState(true);
  const [openRow, setOpenRow] = useState(null);
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

    const [{ data: pol, error: polErr }, { data: tbl, error: tblErr }] = await Promise.all([
      supabase.rpc('role_access_policies'),
      supabase.rpc('role_access_tables'),
    ]);
    if (polErr || tblErr) setRulesError((polErr || tblErr).message);
    setPolicies(pol || []);
    setTables(tbl || []);
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
    setStatus(null);
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
    setStatus(null);
    setFieldGrants((prev) => {
      const set = new Set(prev[selectedRole] || []);
      keys.forEach((k) => (canEdit ? set.add(k) : set.delete(k)));
      return { ...prev, [selectedRole]: set };
    });
  }

  const selectedGrants = grants[selectedRole] || new Set();
  const selectedFieldGrants = fieldGrants[selectedRole] || new Set();

  // What the chosen role can do, grouped by area for display.
  const abilityAreas = useMemo(() => {
    if (!selectedRole || !policies || !tables) return [];
    const usable = tables.filter((t) => t.can_select || t.can_insert || t.can_update || t.can_delete);
    const abilities = abilitiesForRole({
      role: selectedRole,
      resources: selectedGrants,
      editableFieldCount: selectedFieldGrants.size,
      policies,
      tables: usable,
    });
    const areas = {};
    usable.forEach((t) => {
      const { area, label } = describeTable(t.table_name);
      (areas[area] = areas[area] || []).push({ table: t.table_name, label, ...abilities[t.table_name] });
    });
    return AREA_ORDER.filter((a) => areas[a]).map((area) => ({
      area,
      rows: areas[area].sort((x, y) => x.label.localeCompare(y.label)),
    }));
  }, [selectedRole, policies, tables, selectedGrants, selectedFieldGrants]);

  if (!isAdmin) return <p>Only admin can manage permissions.</p>;

  const sections = [...new Set(resources.map((r) => r.section))];
  const role = roles.find((r) => r.role_name === selectedRole);
  const q = search.trim().toLowerCase();
  const matches = (r) => !q || r.label.toLowerCase().includes(q) || r.resource_key.toLowerCase().includes(q);

  const changeCount = abilityAreas.reduce(
    (n, a) => n + a.rows.filter((r) => r.add !== 'no' || r.edit !== 'no' || r.delete !== 'no').length, 0,
  );

  return (
    <div>
      <h1>Permissions</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
        Choose a role. <strong>Pages</strong> sets which pages it can open; <strong>What they can do</strong> shows
        what it can view, add, edit and delete, read from the database&apos;s own rules.
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 1 260px', minWidth: 200 }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '0.25rem' }}>Role</div>
          <select value={selectedRole} onChange={(e) => { setSelectedRole(e.target.value); setOpenRow(null); }}>
            {roles.map((r) => (
              <option key={r.role_name} value={r.role_name}>
                {roleTitle(r.role_name)} — {(grants[r.role_name] || new Set()).size} pages
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          {role && (
            <>
              <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                {roleTitle(role.role_name)}{' '}
                <code style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{role.role_name}</code>
              </div>
              {role.description && <div style={{ color: 'var(--ink-soft)', marginTop: '0.2rem' }}>{role.description}</div>}
              <div style={{ marginTop: '0.4rem', fontSize: '0.9rem' }}>
                Opens <strong>{selectedRole === 'admin' ? 'every' : selectedGrants.size}</strong> of {resources.length} pages
                {policies && tables && <> · can change <strong>{changeCount}</strong> kinds of record</>}
                {selectedRole !== 'admin' && <> · edits <strong>{selectedFieldGrants.size}</strong> of {STUDENT_CORE_FIELDS.length} Core Data fields</>}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <TabButton active={tab === 'pages'} onClick={() => setTab('pages')}>Pages</TabButton>
        <TabButton active={tab === 'abilities'} onClick={() => setTab('abilities')}>What they can do</TabButton>
        <TabButton active={tab === 'compare'} onClick={() => setTab('compare')}>Compare roles</TabButton>
      </div>

      {status && <p style={{ color: '#a3232c' }}>{status}</p>}

      {tab === 'pages' && (
        <>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            Tick the pages {role ? roleTitle(role.role_name) : 'this role'} can open. Changes save instantly.
            {selectedRole === 'admin' && ' Admin can open every page whatever is ticked here.'}
          </p>
          <input
            type="search"
            placeholder="Find a page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 320, marginBottom: '1rem' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', alignItems: 'start' }}>
            {sections.map((section) => {
              const items = resources.filter((r) => r.section === section);
              const shown = items.filter(matches);
              if (shown.length === 0) return null;
              const ticked = items.filter((r) => selectedGrants.has(r.resource_key)).length;
              return (
                <div className="card" key={section} style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                    <h2 style={{ margin: 0 }}>{section}</h2>
                    <span style={{ fontSize: '0.8rem', color: ticked ? 'var(--brand-700)' : 'var(--ink-soft)', fontWeight: 600 }}>
                      {ticked} of {items.length}
                    </span>
                  </div>
                  {shown.map((r) => (
                    <div key={r.resource_key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.3rem 0', borderTop: '1px solid var(--slate-100)' }}>
                      <input
                        type="checkbox"
                        id={`res-${r.resource_key}`}
                        checked={selectedGrants.has(r.resource_key)}
                        onChange={(e) => toggleGrant(r.resource_key, e.target.checked)}
                        style={{ marginTop: '0.2rem' }}
                      />
                      <label htmlFor={`res-${r.resource_key}`} style={{ display: 'block', flex: 1, color: 'var(--ink)', fontSize: '0.9rem', cursor: 'pointer' }}>
                        {r.label}
                        <span style={{ display: 'block', color: '#9aa3b0', fontSize: '0.75rem' }}>{r.resource_key}</span>
                      </label>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'abilities' && (
        <>
          <div className="card" style={{ fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <span><AbilityBadge value="yes" /> any record</span>
              <span><AbilityBadge value="some" /> only records tied to them (their classes, events they logged…)</span>
              <span><AbilityBadge value="no" /> not at all</span>
            </div>
            <div style={{ color: 'var(--ink-soft)' }}>
              Worked out from the database&apos;s own rules for someone holding only this role, so it changes as soon
              as a page is ticked above or a rule changes. Click a row to see which rules allow it. Some actions
              (approving fee prices, admissions decisions, planned absences, …) go through checked steps of their own
              rather than direct editing, so they show as View only here even for the people who can do them; and some
              changes are refused by further checks on save (a locked fee price, a negative event released to parents
              without review), which a Yes here doesn't override.
            </div>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem', marginTop: '0.6rem', color: 'var(--ink)' }}>
              <input type="checkbox" checked={hideNone} onChange={(e) => setHideNone(e.target.checked)} />
              Hide records this role can&apos;t see or change
            </label>
          </div>

          {rulesError && <p style={{ color: '#a3232c' }}>Couldn&apos;t read the database rules: {rulesError}</p>}
          {!policies && !rulesError && <p>Reading the database rules…</p>}

          {abilityAreas.map(({ area, rows }) => {
            const shown = hideNone ? rows.filter((r) => ACTIONS.some((a) => r[a] !== 'no')) : rows;
            if (shown.length === 0) return null;
            return (
              <div className="card" key={area}>
                <h2 style={{ marginTop: 0 }}>{area}</h2>
                <div className="table-scroll" style={{ marginTop: 0, boxShadow: 'none' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Record</th>
                        {ACTIONS.map((a) => <th key={a} style={{ width: '7rem' }}>{ACTION_TITLES[a]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => {
                        const key = `${area}:${r.table}`;
                        const open = openRow === key;
                        return [
                          <tr key={key} onClick={() => setOpenRow(open ? null : key)} style={{ cursor: 'pointer' }}>
                            <td>{r.label}</td>
                            {ACTIONS.map((a) => <td key={a}><AbilityBadge value={r[a]} /></td>)}
                          </tr>,
                          open && (
                            <tr key={`${key}:rules`}>
                              <td colSpan={5} style={{ background: 'white', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
                                <div>Table <code>{r.table}</code></div>
                                {ACTIONS.map((a) => (
                                  <div key={a}>
                                    <strong>{ACTION_TITLES[a]}:</strong>{' '}
                                    {r[`${a}Rules`] && r[`${a}Rules`].length > 0 ? r[`${a}Rules`].join(' · ') : 'no rule allows it'}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
                {area === 'Students & families' && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
                    Editing a student is further limited field by field — see Student Core Data fields below.
                  </p>
                )}
              </div>
            );
          })}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Student Core Data fields</h2>
            {selectedRole === 'admin' ? (
              <p>Admin can always edit every field.</p>
            ) : (
              <>
                <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
                  Choose which fields on a student&apos;s Core Data this role can change. Read means they can see the
                  field but not change it. Changes save instantly.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="secondary" onClick={() => setFieldAccess(STUDENT_CORE_FIELDS.map((f) => f.key), false)}>All Read</button>
                  <button className="secondary" onClick={() => setFieldAccess(STUDENT_CORE_FIELDS.map((f) => f.key), true)}>All Edit</button>
                  <span style={{ alignSelf: 'center', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
                    {selectedFieldGrants.size} of {STUDENT_CORE_FIELDS.length} editable
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.25rem 1rem' }}>
                  {STUDENT_CORE_FIELDS.map((f) => (
                    <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0', borderBottom: '1px solid var(--slate-100)' }}>
                      <span style={{ fontSize: '0.9rem' }}>{f.label}</span>
                      <select
                        value={selectedFieldGrants.has(f.key) ? 'edit' : 'read'}
                        onChange={(e) => setFieldAccess([f.key], e.target.value === 'edit')}
                        style={{ width: 'auto' }}
                      >
                        <option value="read">Read</option>
                        <option value="edit">Edit</option>
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {tab === 'compare' && (
        <>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            Every page against every role (read-only; use Pages to change). Click a role&apos;s heading to open it.
          </p>
          <input
            type="search"
            placeholder="Find a page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <div className="table-scroll" style={{ maxHeight: '75vh', overflow: 'auto' }}>
            <table style={{ minWidth: 300 + roles.length * 44 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, minWidth: 220 }}>Page</th>
                  {roles.map((r) => (
                    <th
                      key={r.role_name}
                      title={r.description || r.role_name}
                      onClick={() => { setSelectedRole(r.role_name); setTab('pages'); }}
                      style={{
                        position: 'sticky', top: 0, zIndex: 2, cursor: 'pointer', padding: '0.4rem 0.2rem',
                        writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 170, verticalAlign: 'bottom', textTransform: 'none',
                        textAlign: 'left', background: r.role_name === selectedRole ? 'var(--brand-100)' : undefined,
                      }}
                    >
                      {roleTitle(r.role_name)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => {
                  const items = resources.filter((r) => r.section === section && matches(r));
                  if (items.length === 0) return null;
                  return [
                    <tr key={section}>
                      <td colSpan={roles.length + 1} style={{ background: 'var(--slate-100)', fontWeight: 700, position: 'sticky', left: 0 }}>
                        {section}
                      </td>
                    </tr>,
                    ...items.map((res) => (
                      <tr key={res.resource_key}>
                        <td style={{ position: 'sticky', left: 0, background: 'white', zIndex: 1 }} title={res.resource_key}>{res.label}</td>
                        {roles.map((r) => {
                          const has = r.role_name === 'admin' || (grants[r.role_name] || new Set()).has(res.resource_key);
                          return (
                            <td key={r.role_name} style={{ textAlign: 'center', padding: '0.3rem 0', background: r.role_name === selectedRole ? 'var(--brand-050)' : 'white' }}>
                              {has ? <span style={{ color: '#1a7a3d', fontWeight: 700 }}>✓</span> : ''}
                            </td>
                          );
                        })}
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function PermissionsPage() {
  return <RequireAuth><RequireResource resourceKey="/admin/permissions"><PermissionsInner /></RequireResource></RequireAuth>;
}
