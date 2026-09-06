'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function FeeItemsInner() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultAmount, setDefaultAmount] = useState('');
  const [isOptional, setIsOptional] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState(null);

  const [edits, setEdits] = useState({}); // id -> { default_amount, category, is_optional }
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('fee_items').select('id, name, category, is_optional, default_amount').order('name');
    setItems(data ?? []);
    setLoading(false);
  }

  async function addItem(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setStatus(null);
    const { error } = await supabase.from('fee_items').insert({
      name: name.trim(),
      category: category.trim() || null,
      default_amount: defaultAmount ? Number(defaultAmount) : null,
      is_optional: isOptional,
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setName('');
      setCategory('');
      setDefaultAmount('');
      setIsOptional(false);
      setStatus('Added.');
      await load();
    }
    setAdding(false);
  }

  function edit(id, field, value) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function currentValue(item, field) {
    return edits[item.id]?.[field] !== undefined ? edits[item.id][field] : item[field];
  }

  async function saveItem(item) {
    setSavingId(item.id);
    const patch = edits[item.id] || {};
    const { error } = await supabase
      .from('fee_items')
      .update({
        default_amount: patch.default_amount !== undefined ? (patch.default_amount === '' ? null : Number(patch.default_amount)) : item.default_amount,
        category: patch.category !== undefined ? patch.category : item.category,
        is_optional: patch.is_optional !== undefined ? patch.is_optional : item.is_optional,
      })
      .eq('id', item.id);
    if (!error) {
      setEdits((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
      await load();
    }
    setSavingId(null);
  }

  return (
    <div>
      <h1>Fee Items</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        These are the choices available on the "Add a Charge" and "Allocate Same Amount to a Year"
        screens. Add a new one here (e.g. a new term's price for something), or adjust an existing
        default amount.
      </p>

      <form onSubmit={addItem} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <strong>Add a new fee item</strong>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
        </label>
        <label>
          Category (optional, e.g. "Tuition", "Extracurricular")
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          Default amount (₦, optional)
          <input type="number" min="0" value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value)} style={{ width: '10rem' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={isOptional} onChange={(e) => setIsOptional(e.target.checked)} />
          Optional item (e.g. Sports, Swimming — not automatically owed by everyone)
        </label>
        <button type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add item'}</button>
        {status && <p>{status}</p>}
      </form>

      {loading ? <p>Loading…</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Category</th><th>Default amount</th><th>Optional</th><th></th></tr></thead>
            <tbody>
              {items.map((item) => {
                const dirty = !!edits[item.id];
                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>
                      <input
                        value={currentValue(item, 'category') || ''}
                        onChange={(e) => edit(item.id, 'category', e.target.value)}
                        style={{ width: '9rem' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={currentValue(item, 'default_amount') ?? ''}
                        onChange={(e) => edit(item.id, 'default_amount', e.target.value)}
                        style={{ width: '8rem' }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!currentValue(item, 'is_optional')}
                        onChange={(e) => edit(item.id, 'is_optional', e.target.checked)}
                      />
                    </td>
                    <td>
                      {dirty && (
                        <button onClick={() => saveItem(item)} disabled={savingId === item.id}>
                          {savingId === item.id ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </td>
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

export default function FeeItemsPage() {
  return (
    <RequireAuth>
      <FeeItemsInner />
    </RequireAuth>
  );
}
