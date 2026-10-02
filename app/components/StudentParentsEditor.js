'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

// Edit form for the Parents / Guardians section of a student's record.
// Writes straight to parents and student_parent: RLS already lets admin and
// school_office insert/update parents and fully manage student_parent, so the
// caller only renders this for those roles.
//
// A parents row is shared by every child it's linked to, so editing a name or
// phone number here changes it for siblings too — which is what you want, and
// the form says so. "Remove" only unlinks the parent from this student; the
// parents row (and any parent-portal login attached to it) is left alone.
//
// Relationship belongs to the link, not the parent (student_parent.relationship,
// migration 272): the same person can be one child's Mother and "Other" to a
// child they only follow through the portal. Links marked Other never make
// children siblings. parents.relationship_type is only the fallback shown for a
// link with none of its own, and is set when a new parent is added.
//
// A new parent's email is checked against existing parents as it's typed. On
// 1 Oct 2026 a mother who already had a portal login was entered again as a new
// parent with the same email; her login stayed on the old record, the children
// moved to the new one, and she signed in to an empty portal. So a match is
// shown with a "Link this parent instead" button, and saving a second parent
// with the same email needs a deliberate tick.

const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Other'];
const EMPTY_NEW = { first_name: '', last_name: '', relationship_type: '', phone: '', email: '', address: '', is_primary_contact: false };

function trimOrNull(v) {
  const t = (v || '').trim();
  return t === '' ? null : t;
}

// For .ilike(): match the email exactly, ignoring case, with LIKE's wildcards escaped.
function exactLike(v) {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function parentFields(p) {
  return {
    first_name: trimOrNull(p.first_name),
    last_name: trimOrNull(p.last_name),
    phone: trimOrNull(p.phone),
    email: trimOrNull(p.email),
    address: trimOrNull(p.address),
  };
}

export default function StudentParentsEditor({ studentId, links, onDone, onCancel }) {
  // links: student_parent rows with parents(...) embedded, as loaded by the page
  const [rows, setRows] = useState(() => links.map((l) => ({
    parent_id: l.parent_id,
    is_primary_contact: !!l.is_primary_contact,
    remove: false,
    ...Object.fromEntries(Object.entries(l.parents || {}).map(([k, v]) => [k, v ?? ''])),
    relationship: l.relationship || l.parents?.relationship_type || '',
  })));
  const [sharedCounts, setSharedCounts] = useState({}); // parent_id -> other children linked
  const [newParent, setNewParent] = useState(null);
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [toLink, setToLink] = useState([]); // existing parents rows to link on save
  const [emailMatches, setEmailMatches] = useState([]); // existing parents with the new parent's email
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ids = links.map((l) => l.parent_id);
    if (ids.length === 0) return;
    supabase.from('student_parent').select('parent_id, student_id').in('parent_id', ids).then(({ data }) => {
      const counts = {};
      (data || []).forEach((r) => {
        if (r.student_id !== Number(studentId)) counts[r.parent_id] = (counts[r.parent_id] || 0) + 1;
      });
      setSharedCounts(counts);
    });
  }, [links, studentId]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setMatches([]); return; }
    const t = setTimeout(async () => {
      const like = `%${q.replace(/[%_,()]/g, ' ')}%`;
      const { data } = await supabase
        .from('parents')
        .select('parent_id, first_name, last_name, phone, email, relationship_type')
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
        .order('last_name')
        .limit(10);
      const taken = new Set([...rows.map((r) => r.parent_id), ...toLink.map((p) => p.parent_id)]);
      setMatches((data || []).filter((p) => !taken.has(p.parent_id)));
    }, 250);
    return () => clearTimeout(t);
  }, [search, rows, toLink]);

  const newEmail = trimOrNull(newParent?.email);
  useEffect(() => {
    setAllowDuplicate(false);
    if (!newEmail || !newEmail.includes('@')) { setEmailMatches([]); return; }
    let stale = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('parents')
        .select('parent_id, first_name, last_name, phone, email, relationship_type, student_parent(students(first_name, last_name, status))')
        .ilike('email', exactLike(newEmail))
        .limit(5);
      if (!stale) setEmailMatches(data || []);
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [newEmail]);

  function linkInstead(p) {
    if (!rows.some((r) => r.parent_id === p.parent_id) && !toLink.some((x) => x.parent_id === p.parent_id)) {
      const { student_parent: _children, ...parent } = p;
      setToLink((ls) => [...ls, {
        ...parent,
        is_primary_contact: !!newParent?.is_primary_contact,
        relationship: newParent?.relationship_type || p.relationship_type || '',
      }]);
    }
    setNewParent(null);
    setEmailMatches([]);
  }

  function setRow(i, patch) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function save(e) {
    e.preventDefault();
    if (newParent && !trimOrNull(newParent.first_name) && !trimOrNull(newParent.last_name)) {
      setStatus('Error: the new parent needs at least a first or last name.');
      return;
    }
    if (newParent && emailMatches.length > 0 && !allowDuplicate) {
      setStatus('Error: a parent with this email is already on record. Link them instead, or tick "Add as a separate parent anyway".');
      return;
    }
    setSaving(true);
    setStatus('Saving...');
    const original = Object.fromEntries(links.map((l) => [l.parent_id, l]));

    for (const r of rows) {
      if (r.remove) {
        const { error } = await supabase.from('student_parent').delete()
          .eq('student_id', studentId).eq('parent_id', r.parent_id);
        if (error) { setStatus(`Error: ${error.message}`); setSaving(false); return; }
        continue;
      }
      const before = original[r.parent_id];
      const fields = parentFields(r);
      const changed = Object.entries(fields).some(([k, v]) => (before.parents?.[k] ?? null) !== v);
      if (changed) {
        const { error } = await supabase.from('parents').update(fields).eq('parent_id', r.parent_id);
        if (error) { setStatus(`Error: ${error.message}`); setSaving(false); return; }
      }
      const beforeRel = before.relationship || before.parents?.relationship_type || null;
      const linkChanges = {};
      if (!!before.is_primary_contact !== r.is_primary_contact) linkChanges.is_primary_contact = r.is_primary_contact;
      if (beforeRel !== trimOrNull(r.relationship)) linkChanges.relationship = trimOrNull(r.relationship);
      if (Object.keys(linkChanges).length > 0) {
        const { error } = await supabase.from('student_parent').update(linkChanges)
          .eq('student_id', studentId).eq('parent_id', r.parent_id);
        if (error) { setStatus(`Error: ${error.message}`); setSaving(false); return; }
      }
    }

    for (const p of toLink) {
      const { error } = await supabase.from('student_parent')
        .insert({ student_id: Number(studentId), parent_id: p.parent_id, is_primary_contact: !!p.is_primary_contact, relationship: trimOrNull(p.relationship) });
      if (error) { setStatus(`Error: ${error.message}`); setSaving(false); return; }
    }

    if (newParent) {
      const { data: created, error } = await supabase.from('parents')
        .insert({ ...parentFields(newParent), relationship_type: trimOrNull(newParent.relationship_type) }).select('parent_id').single();
      if (error) { setStatus(`Error: ${error.message}`); setSaving(false); return; }
      const { error: linkErr } = await supabase.from('student_parent')
        .insert({ student_id: Number(studentId), parent_id: created.parent_id, is_primary_contact: newParent.is_primary_contact, relationship: trimOrNull(newParent.relationship_type) });
      if (linkErr) { setStatus(`Error: ${linkErr.message}`); setSaving(false); return; }
    }

    setSaving(false);
    setStatus(null);
    onDone();
  }

  const input = (value, onChange, props = {}) => (
    <input value={value || ''} onChange={(e) => onChange(e.target.value)} {...props} />
  );

  function relationshipSelect(value, onChange) {
    const opts = value && !RELATIONSHIPS.includes(value) ? [value, ...RELATIONSHIPS] : RELATIONSHIPS;
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <form onSubmit={save}>
      {rows.length === 0 && <p>None on record.</p>}
      {rows.map((r, i) => (
        <fieldset key={r.parent_id} disabled={saving} style={{ marginBottom: '1rem', opacity: r.remove ? 0.5 : 1 }}>
          <legend>{r.first_name || r.last_name ? `${r.first_name} ${r.last_name}`.trim() : 'Parent'}</legend>
          {sharedCounts[r.parent_id] > 0 && (
            <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
              Also linked to {sharedCounts[r.parent_id]} other {sharedCounts[r.parent_id] === 1 ? 'child' : 'children'} — changes to name and contact details apply there too; the relationship is for this student only.
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
            <label>First name{input(r.first_name, (v) => setRow(i, { first_name: v }), { disabled: r.remove })}</label>
            <label>Last name{input(r.last_name, (v) => setRow(i, { last_name: v }), { disabled: r.remove })}</label>
            <label>Relationship to this student{relationshipSelect(r.relationship, (v) => setRow(i, { relationship: v }))}</label>
            <label>Phone{input(r.phone, (v) => setRow(i, { phone: v }), { type: 'tel', disabled: r.remove })}</label>
            <label>Email{input(r.email, (v) => setRow(i, { email: v }), { type: 'email', disabled: r.remove })}</label>
            <label>Address{input(r.address, (v) => setRow(i, { address: v }), { disabled: r.remove })}</label>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={r.is_primary_contact} disabled={r.remove} onChange={(e) => setRow(i, { is_primary_contact: e.target.checked })} style={{ width: 'auto' }} />
              Primary contact
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={r.remove} onChange={(e) => setRow(i, { remove: e.target.checked })} style={{ width: 'auto' }} />
              Remove from this student
            </label>
          </div>
        </fieldset>
      ))}
      <p style={{ fontSize: '0.85rem' }}>
        Changing an email here doesn&apos;t change the address a parent already uses to sign in to the parent portal.
      </p>

      {toLink.map((p, i) => (
        <p key={p.parent_id}>
          Will link <strong>{p.first_name} {p.last_name}</strong> as{' '}
          <span style={{ display: 'inline-block', width: '10rem' }}>
            {relationshipSelect(p.relationship, (v) => setToLink((ls) => ls.map((x, j) => (j === i ? { ...x, relationship: v } : x))))}
          </span>
          {' '}<label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!!p.is_primary_contact}
              onChange={(e) => setToLink((ls) => ls.map((x, j) => (j === i ? { ...x, is_primary_contact: e.target.checked } : x)))} />
            Primary
          </label>
          {' '}<button type="button" className="secondary" onClick={() => setToLink((ls) => ls.filter((_, j) => j !== i))}>Undo</button>
        </p>
      ))}

      {newParent ? (
        <fieldset disabled={saving} style={{ marginBottom: '1rem' }}>
          <legend>New parent / guardian</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
            <label>First name{input(newParent.first_name, (v) => setNewParent({ ...newParent, first_name: v }))}</label>
            <label>Last name{input(newParent.last_name, (v) => setNewParent({ ...newParent, last_name: v }))}</label>
            <label>Relationship{relationshipSelect(newParent.relationship_type, (v) => setNewParent({ ...newParent, relationship_type: v }))}</label>
            <label>Phone{input(newParent.phone, (v) => setNewParent({ ...newParent, phone: v }), { type: 'tel' })}</label>
            <label>Email{input(newParent.email, (v) => setNewParent({ ...newParent, email: v }), { type: 'email' })}</label>
            <label>Address{input(newParent.address, (v) => setNewParent({ ...newParent, address: v }))}</label>
          </div>
          {emailMatches.length > 0 && (
            <div style={{ border: '1px solid #d97706', background: '#fffbeb', color: '#78350f', borderRadius: 6, padding: '0.6rem 0.8rem', marginTop: '0.5rem' }}>
              <strong>This email is already on record.</strong> If this is the same person, link the existing parent so their portal login sees this child too.
              <ul style={{ margin: '0.4rem 0', paddingLeft: '1.2rem' }}>
                {emailMatches.map((p) => {
                  const children = (p.student_parent || []).map((l) => l.students).filter(Boolean);
                  return (
                    <li key={p.parent_id} style={{ margin: '0.25rem 0' }}>
                      {p.first_name} {p.last_name}{p.phone ? ` · ${p.phone}` : ''}
                      {' · '}{children.length === 0 ? 'no children linked'
                        : `linked to ${children.map((c) => `${c.first_name} ${c.last_name}${c.status === 'active' ? '' : ' (left)'}`).join(', ')}`}
                      {' '}<button type="button" onClick={() => linkInstead(p)}>Link this parent instead</button>
                    </li>
                  );
                })}
              </ul>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} style={{ width: 'auto' }} />
                Add as a separate parent anyway (a different person sharing this email)
              </label>
            </div>
          )}
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={newParent.is_primary_contact} onChange={(e) => setNewParent({ ...newParent, is_primary_contact: e.target.checked })} style={{ width: 'auto' }} />
              Primary contact
            </label>
            <button type="button" className="secondary" onClick={() => setNewParent(null)}>Discard</button>
          </div>
        </fieldset>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Link an existing parent (e.g. a sibling&apos;s)
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or phone" disabled={saving} />
          </label>
          {matches.length > 0 && (
            <ul style={{ margin: '0.25rem 0', paddingLeft: '1.2rem' }}>
              {matches.map((p) => (
                <li key={p.parent_id} style={{ margin: '0.25rem 0' }}>
                  {p.first_name} {p.last_name}
                  {p.relationship_type ? ` (${p.relationship_type})` : ''}
                  {p.email ? ` · ${p.email}` : ''}{p.phone ? ` · ${p.phone}` : ''}
                  {' '}<button type="button" className="secondary" onClick={() => { setToLink((ls) => [...ls, { ...p, is_primary_contact: false, relationship: p.relationship_type || '' }]); setSearch(''); }}>Link</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="secondary" style={{ marginTop: '0.5rem' }} onClick={() => setNewParent({ ...EMPTY_NEW })}>+ Add a new parent / guardian</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving}>Save</button>
        <button type="button" className="secondary" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
      {status && <p>{status}</p>}
    </form>
  );
}
