'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function LookupList({ title, table, idField }) {
  const [items, setItems] = useState([]);
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase.from(table).select('*').order('name');
    setItems(data || []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    const { error } = await supabase.from(table).insert({ name });
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(null); setNewName(''); load(); }
  }

  async function remove(id) {
    if (!window.confirm('Remove this from the list? Existing students keep whatever value they already have.')) return;
    const { error } = await supabase.from(table).delete().eq(idField, id);
    if (error) setStatus(`Error: ${error.message}`);
    else load();
  }

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h2>{title}</h2>
      {status && <p style={{ color: 'red' }}>{status}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
        {items.map((item) => (
          <li key={item[idField]} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid var(--slate-200)' }}>
            {item.name}
            <button className="secondary" onClick={() => remove(item[idField])} style={{ fontSize: '0.8rem' }}>Remove</button>
          </li>
        ))}
        {items.length === 0 && <li style={{ color: '#999' }}>None yet.</li>}
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New name" />
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}

function LookupsInner() {
  return (
    <div>
      <h1>Lookups</h1>
      <p>Manage the fixed lists used for student core data and behaviour groups. Add new houses here as they're created — they'll show up everywhere a boarding or sports house is selected.</p>
      <LookupList title="Boarding houses" table="boarding_houses" idField="house_id" />
      <LookupList title="Sports houses" table="sports_houses" idField="house_id" />
    </div>
  );
}

export default function LookupsPage() {
  return <RequireAuth><LookupsInner /></RequireAuth>;
}
