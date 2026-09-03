'use client';
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

function ParentsInner() {
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      const { data: p } = await supabase.from('parents').select('parent_id, first_name, last_name, email, phone, relationship_type').order('last_name');
      const { data: profiles } = await supabase.from('profiles').select('parent_id').not('parent_id', 'is', null);
      const linked = new Set((profiles || []).map((pr) => pr.parent_id));
      setParents((p || []).map((row) => ({ ...row, hasLogin: linked.has(row.parent_id) })));
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return parents.filter((p) =>
      `${p.first_name || ''} ${p.last_name || ''} ${p.email || ''}`.toLowerCase().includes(q)
    );
  }, [parents, search]);

  const withLogin = parents.filter((p) => p.hasLogin).length;
  const withEmailNoLogin = parents.filter((p) => p.email && !p.hasLogin).length;
  const noEmail = parents.filter((p) => !p.email).length;

  return (
    <div>
      <h1>Parents</h1>
      <p><a href="/parents/import">→ Bulk import parents from CSV</a></p>

      <div className="card">
        <p><strong>{parents.length}</strong> total &nbsp;·&nbsp; <strong>{withLogin}</strong> have a login &nbsp;·&nbsp; <strong>{withEmailNoLogin}</strong> have an email but no login yet &nbsp;·&nbsp; <strong>{noEmail}</strong> have no email on file</p>
      </div>

      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Search
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" />
        </label>
      </form>

      {loading ? <p>Loading...</p> : (
        <div className="table-scroll"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Relationship</th><th>Login</th></tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.parent_id}>
                <td>{p.first_name} {p.last_name}</td>
                <td>{p.email ?? '—'}</td>
                <td>{p.phone ?? '—'}</td>
                <td>{p.relationship_type ?? '—'}</td>
                <td>{p.hasLogin ? '✅' : p.email ? 'Not created yet' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

export default function ParentsPage() {
  return <RequireAuth><ParentsInner /></RequireAuth>;
}
