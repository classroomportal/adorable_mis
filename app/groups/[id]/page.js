'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import GroupMarkSheets from '../../components/GroupMarkSheets';
import { GROUP_KINDS, GROUP_VISIBILITY, kindLabel, visibilityLabel, canManageGroups, describeRule } from '../../../lib/studentGroups';

// One student group (migration 284): its students and the staff who run it.
// Only smt, pastoral, the school office and admin can change anything; the
// database refuses everyone else, and this page just hides the buttons.

const fullName = (p) => (p ? `${p.first_name} ${p.last_name}` : '');

function GroupInner() {
  const { id } = useParams();
  const groupId = Number(id);
  const { profile, staffRoles } = useAuth();
  const canManage = canManageGroups(profile, staffRoles);

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [groupStaff, setGroupStaff] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});

  // Adding students: one at a time by name, or a whole year or form.
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const latestSearch = useRef(0);
  const [yearForms, setYearForms] = useState([]);
  const [bulkPick, setBulkPick] = useState('');

  const [allStaff, setAllStaff] = useState([]);
  const [staffPick, setStaffPick] = useState('');

  async function load() {
    const { data: g, error: gErr } = await supabase.from('student_groups').select('*').eq('group_id', groupId).maybeSingle();
    if (gErr) { setError(gErr.message); return; }
    if (!g) { setError('Group not found.'); return; }
    setGroup(g);
    const [{ data: m }, { data: st }] = await Promise.all([
      supabase.from('student_group_members')
        .select('student_id, added_at, students(first_name, last_name, year_group, form_class, status)')
        .eq('group_id', groupId),
      supabase.from('student_group_staff')
        .select('staff_id, staff(first_name, last_name, staff_code)')
        .eq('group_id', groupId),
    ]);
    setMembers((m || []).sort((a, b) =>
      (a.students?.year_group ?? 99) - (b.students?.year_group ?? 99)
      || (a.students?.last_name || '').localeCompare(b.students?.last_name || '')
      || (a.students?.first_name || '').localeCompare(b.students?.first_name || '')));
    setGroupStaff((st || []).sort((a, b) => fullName(a.staff).localeCompare(fullName(b.staff))));
  }

  useEffect(() => { load(); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canManage) return;
    supabase.from('students').select('year_group, form_class').eq('status', 'active').then(({ data }) => setYearForms(data || []));
    supabase.from('staff').select('staff_id, first_name, last_name, staff_code').order('last_name').then(({ data }) => setAllStaff(data || []));
  }, [canManage]);

  // Name search, after a short pause, newest answer only (as on /students).
  useEffect(() => {
    const term = search.replace(/[,()%*\\]/g, '').trim();
    if (term.length < 2) { setMatches([]); return undefined; }
    const timer = setTimeout(async () => {
      const requestId = ++latestSearch.current;
      const { data } = await supabase.from('students')
        .select('student_id, first_name, last_name, year_group, form_class')
        .eq('status', 'active')
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
        .order('last_name').order('first_name')
        .limit(8);
      if (requestId !== latestSearch.current) return;
      setMatches(data || []);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  const memberIds = new Set(members.map((m) => m.student_id));
  const archived = !!group?.archived_at;

  async function run(action, done) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: err } = await action();
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (done) setNotice(done);
    await load();
  }

  function addStudent(s) {
    setSearch('');
    setMatches([]);
    if (memberIds.has(s.student_id)) { setNotice(`${fullName(s)} is already in this group.`); return; }
    run(() => supabase.from('student_group_members').insert({ group_id: groupId, student_id: s.student_id }), `Added ${fullName(s)}.`);
  }

  async function addBulk() {
    if (!bulkPick) return;
    const [kindOf, value] = bulkPick.split(':');
    let q = supabase.from('students').select('student_id').eq('status', 'active');
    q = kindOf === 'year' ? q.eq('year_group', Number(value)) : q.eq('form_class', value);
    const { data, error: err } = await q;
    if (err) { setError(err.message); return; }
    const rows = (data || []).filter((s) => !memberIds.has(s.student_id)).map((s) => ({ group_id: groupId, student_id: s.student_id }));
    const label = kindOf === 'year' ? `Year ${value}` : value;
    if (rows.length === 0) { setNotice(`Everyone in ${label} is already in this group.`); return; }
    if (!window.confirm(`Add ${rows.length} student${rows.length === 1 ? '' : 's'} from ${label}?`)) return;
    setBulkPick('');
    run(() => supabase.from('student_group_members').insert(rows), `Added ${rows.length} from ${label}.`);
  }

  function removeMember(m) {
    if (!window.confirm(`Take ${fullName(m.students)} out of this group?`)) return;
    run(() => supabase.from('student_group_members').delete().eq('group_id', groupId).eq('student_id', m.student_id));
  }

  function addStaff() {
    if (!staffPick) return;
    const staffId = Number(staffPick);
    setStaffPick('');
    run(() => supabase.from('student_group_staff').insert({ group_id: groupId, staff_id: staffId }));
  }

  function removeStaff(s) {
    run(() => supabase.from('student_group_staff').delete().eq('group_id', groupId).eq('staff_id', s.staff_id));
  }

  function saveDetails(e) {
    e.preventDefault();
    run(async () => {
      const res = await supabase.from('student_groups')
        .update({ name: draft.name, description: draft.description, kind: draft.kind, visibility: draft.visibility })
        .eq('group_id', groupId);
      if (!res.error) setEditing(false);
      return res;
    }, 'Saved.');
  }

  function setArchived(on) {
    if (on && !window.confirm('Archive this group? It stays readable but can no longer be messaged or have students added.')) return;
    run(() => supabase.from('student_groups').update({ archived_at: on ? new Date().toISOString() : null }).eq('group_id', groupId));
  }

  if (error && !group) return <p style={{ color: 'red' }}>{error}</p>;
  if (!group) return <p>Loading…</p>;

  const years = [...new Set(yearForms.map((s) => s.year_group).filter((y) => y != null))].sort((a, b) => a - b);
  const forms = [...new Set(yearForms.map((s) => s.form_class).filter(Boolean))].sort();
  const current = members.filter((m) => m.students?.status === 'active');
  const leavers = members.length - current.length;
  const staffIds = new Set(groupStaff.map((s) => s.staff_id));
  // The database decides (can_mark_student_group()); this only shows the controls.
  const canMark = canManage || (profile?.staff_id != null && staffIds.has(profile.staff_id));

  return (
    <div>
      <p><a href="/groups">← Student Groups</a></p>
      <h1>{group.name}</h1>
      <p style={{ color: 'var(--ink-soft)' }}>
        {kindLabel(group.kind)} · {visibilityLabel(group.visibility)}

        {archived && ` · archived ${formatUKDate(group.archived_at.slice(0, 10))}`}
      </p>
      {group.rule_type && (
        <p style={{ background: 'var(--brand-050)', border: '1px solid var(--slate-200)', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
          <strong>Built by the system on {formatUKDate(group.built_on)}:</strong> {describeRule(group.rule_type, group.rule_settings)}.
          {' '}The list doesn&apos;t change by itself; students can still be added or taken out by hand.
        </p>
      )}
      {group.description && <p>{group.description}</p>}
      {group.visibility !== 'staff' && (
        <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
          Students and parents don&apos;t see groups on their portals yet; that comes in a later update.
        </p>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {notice && <p style={{ color: 'var(--brand-700)' }}>{notice}</p>}

      {canManage && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          {!archived && current.length > 0 && <a className="secondary" href={`/comms/compose?group=${groupId}`}>Message this group</a>}
          {group.rule_type && <a className="secondary" href={`/groups/build?from=${groupId}`}>Build again</a>}
          {!editing && (
            <button type="button" className="secondary" onClick={() => {
              setDraft({ name: group.name, description: group.description || '', kind: group.kind, visibility: group.visibility });
              setEditing(true);
            }}>Edit details</button>
          )}
          <button type="button" className="secondary" disabled={busy} onClick={() => setArchived(!archived)}>{archived ? 'Bring back from archive' : 'Archive'}</button>
        </div>
      )}

      {canManage && editing && (
        <form onSubmit={saveDetails}>
          <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={120} /></label>
          <label>Kind
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {GROUP_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label>Who can see it
            {/* A group built from a rule is always staff-only (the principal's decision). */}
            <select value={draft.visibility} disabled={!!group.rule_type} onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}>
              {GROUP_VISIBILITY.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>
          <label style={{ flexBasis: '100%' }}>Description
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} maxLength={2000} />
          </label>
          <button type="submit" disabled={busy || !draft.name.trim()}>Save</button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}

      <h2>Run by</h2>
      {groupStaff.length === 0 ? <p style={{ color: 'var(--ink-soft)' }}>No staff named yet.</p> : (
        <ul>
          {groupStaff.map((s) => (
            <li key={s.staff_id}>
              {fullName(s.staff)}{s.staff?.staff_code ? ` (${s.staff.staff_code})` : ''}
              {canManage && !archived && (
                <button type="button" className="secondary" disabled={busy} onClick={() => removeStaff(s)} style={{ marginLeft: '0.5rem', padding: '0.1rem 0.5rem', fontSize: '0.8rem' }}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && !archived && (
        <div style={{ display: 'flex', gap: '0.5rem', maxWidth: '28rem', marginBottom: '1rem' }}>
          <select value={staffPick} onChange={(e) => setStaffPick(e.target.value)}>
            <option value="">Add a member of staff…</option>
            {allStaff.filter((s) => !staffIds.has(s.staff_id)).map((s) => (
              <option key={s.staff_id} value={s.staff_id}>{fullName(s)}{s.staff_code ? ` (${s.staff_code})` : ''}</option>
            ))}
          </select>
          <button type="button" disabled={busy || !staffPick} onClick={addStaff}>Add</button>
        </div>
      )}

      <h2>Mark sheets</h2>
      <GroupMarkSheets groupId={groupId} canMark={canMark} archived={archived} members={members} />

      <h2>Students ({current.length}{leavers > 0 ? `, and ${leavers} who ha${leavers === 1 ? 's' : 've'} left` : ''})</h2>

      {canManage && !archived && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div style={{ position: 'relative', flex: '1 1 16rem', maxWidth: '24rem' }}>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Add a student: type a name…" autoComplete="off" />
            {matches.length > 0 && (
              // The same blue name buttons as the Students list and Record a Payment.
              <ul style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 20, margin: '0.25rem 0 0', padding: '0.4rem',
                listStyle: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem',
                background: '#fff', border: '1px solid var(--slate-200)', borderRadius: '10px',
                boxShadow: '0 6px 18px rgba(20, 35, 70, 0.12)', width: 'max-content', maxWidth: 'calc(100vw - 2rem)',
              }}>
                {matches.map((s) => (
                  <li key={s.student_id} style={{ maxWidth: '100%' }}>
                    <button type="button" onClick={() => addStudent(s)} style={{ textAlign: 'left', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.first_name} {s.last_name} · {s.form_class || 'No form'} · Year {s.year_group}{memberIds.has(s.student_id) ? ' · already in' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flex: '1 1 16rem', maxWidth: '24rem' }}>
            <select value={bulkPick} onChange={(e) => setBulkPick(e.target.value)}>
              <option value="">Or add a whole year or form…</option>
              <optgroup label="Year group">
                {years.map((y) => <option key={`y${y}`} value={`year:${y}`}>Year {y}</option>)}
              </optgroup>
              <optgroup label="Form">
                {forms.map((f) => <option key={`f${f}`} value={`form:${f}`}>{f}</option>)}
              </optgroup>
            </select>
            <button type="button" disabled={busy || !bulkPick} onClick={addBulk}>Add</button>
          </div>
        </div>
      )}

      {members.length === 0 ? <p style={{ color: 'var(--ink-soft)' }}>No students in this group yet.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Year</th><th>Form</th><th>Added</th>{canManage && !archived && <th></th>}</tr></thead>
            <tbody>
              {members.map((m) => {
                const left = m.students?.status !== 'active';
                return (
                  <tr key={m.student_id} style={left ? { color: 'var(--ink-soft)' } : undefined}>
                    <td><a href={`/students/${m.student_id}`}>{fullName(m.students)}</a>{left && ' (left)'}</td>
                    <td>{left ? '—' : m.students?.year_group}</td>
                    <td>{left ? '—' : m.students?.form_class}</td>
                    <td>{formatUKDate(m.added_at.slice(0, 10))}</td>
                    {canManage && !archived && (
                      <td><button type="button" className="secondary" disabled={busy} onClick={() => removeMember(m)} style={{ padding: '0.1rem 0.5rem', fontSize: '0.8rem' }}>Remove</button></td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GroupPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/groups">
        <GroupInner />
      </RequireResource>
    </RequireAuth>
  );
}
