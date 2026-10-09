'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { ParentPortalInner } from '../../parent-portal/page';

// Lets staff see the parent portal exactly as a chosen parent sees it, rather
// than signing in as a parent or relying on their own "My Children" view.
// It reads through the staff member's own login, so it only shows what that
// member of staff can already read; ParentPortalInner applies the extra
// parent-only filters (hidden incidents, unapproved pictures, unpublished fee
// terms) itself. Opened from /parents, or directly with ?parent=<id>.
function ViewAsInner() {
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [parent, setParent] = useState(null);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('parent'));
    if (id) choose(id);
  }, []);

  async function choose(parentId) {
    const { data } = await supabase
      .from('parents')
      .select('parent_id, first_name, last_name, email')
      .eq('parent_id', parentId)
      .maybeSingle();
    setParent(data || null);
    window.history.replaceState(null, '', data ? `?parent=${data.parent_id}` : window.location.pathname);
  }

  async function runSearch(e) {
    e.preventDefault();
    const term = search.trim().replace(/[,()%]/g, ' ').trim();
    if (!term) return;
    setSearching(true);
    const like = `%${term}%`;
    // Match the parent's own name/email, or the name of one of their children.
    const [{ data: byParent }, { data: kids }] = await Promise.all([
      supabase.from('parents').select('parent_id')
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`).limit(50),
      supabase.from('students').select('student_id')
        .or(`first_name.ilike.${like},last_name.ilike.${like}`).limit(50),
    ]);
    const kidIds = (kids || []).map((k) => k.student_id);
    const { data: kidLinks } = kidIds.length
      ? await supabase.from('student_parent').select('parent_id').in('student_id', kidIds)
      : { data: [] };
    const ids = [...new Set([...(byParent || []), ...(kidLinks || [])].map((r) => r.parent_id))].slice(0, 50);
    if (ids.length === 0) { setMatches([]); setSearching(false); return; }
    const [{ data: ps }, { data: links }] = await Promise.all([
      supabase.from('parents').select('parent_id, first_name, last_name, email').in('parent_id', ids).order('last_name'),
      supabase.from('student_parent').select('parent_id, students(first_name, last_name, year_group)').in('parent_id', ids),
    ]);
    const kidsByParent = {};
    (links || []).forEach((l) => { if (l.students) (kidsByParent[l.parent_id] ||= []).push(l.students); });
    setMatches((ps || []).map((p) => ({ ...p, children: kidsByParent[p.parent_id] || [] })));
    setSearching(false);
  }

  if (parent) {
    return (
      <div>
        <div className="card" style={{ background: '#fff7e6', borderLeft: '4px solid #f0a020' }}>
          <p style={{ margin: 0 }}>
            <strong>Viewing as {parent.first_name} {parent.last_name}</strong>
            {parent.email ? ` (${parent.email})` : ''} — this is what they see when they sign in.
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#5b6472' }}>
            Fees only appear here if you have access to fees yourself. Their inbox isn&apos;t shown.
          </p>
          <p style={{ margin: '0.5rem 0 0' }}>
            <button type="button" className="secondary" onClick={() => { setParent(null); window.history.replaceState(null, '', window.location.pathname); }}>
              Choose another parent
            </button>
          </p>
        </div>
        <ParentPortalInner viewAsParentId={parent.parent_id} />
      </div>
    );
  }

  return (
    <div>
      <h1>View as Parent</h1>
      <p>See the parent portal exactly as a parent sees it. Search by the parent&apos;s name or email, or their child&apos;s name.</p>
      <form onSubmit={runSearch}>
        <label>
          Search
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Parent or child name, or email" />
        </label>
        <button type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </form>

      {matches && (matches.length === 0 ? <p>No parents found.</p> : (
        <div className="table-scroll"><table>
          <thead><tr><th>Parent</th><th>Email</th><th>Children</th><th></th></tr></thead>
          <tbody>
            {matches.map((p) => (
              <tr key={p.parent_id}>
                <td>{p.first_name} {p.last_name}</td>
                <td>{p.email ?? '—'}</td>
                <td>{p.children.map((c) => `${c.first_name} ${c.last_name} (Y${c.year_group})`).join(', ') || '—'}</td>
                <td><button type="button" onClick={() => choose(p.parent_id)}>View as parent</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ))}
    </div>
  );
}

export default function ViewAsParentPage() {
  return <RequireAuth><RequireResource resourceKey="/parents/view-as"><ViewAsInner /></RequireResource></RequireAuth>;
}
