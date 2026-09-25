'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function TuckshopItemsInner() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [isFood, setIsFood] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('tuckshop_items').select('id, name, price, active, is_food').order('name');
    setItems(data ?? []);
    setLoading(false);
  }

  async function addItem(e) {
    e.preventDefault();
    if (!name.trim() || !price) return;
    setAdding(true);
    await supabase.from('tuckshop_items').insert({ name: name.trim(), price: Number(price), is_food: isFood });
    setName('');
    setPrice('');
    setIsFood(true);
    await load();
    setAdding(false);
  }

  async function toggleActive(item) {
    await supabase.from('tuckshop_items').update({ active: !item.active }).eq('id', item.id);
    await load();
  }

  async function toggleFood(item) {
    await supabase.from('tuckshop_items').update({ is_food: !item.is_food }).eq('id', item.id);
    await load();
  }

  async function updatePrice(item, newPrice) {
    await supabase.from('tuckshop_items').update({ price: Number(newPrice) }).eq('id', item.id);
    await load();
  }

  return (
    <div>
      <h1>Tuckshop Items</h1>

      <form onSubmit={addItem} className="card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Price (₦)<br /><input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '7rem' }} required /></label>
        <label style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={isFood} onChange={(e) => setIsFood(e.target.checked)} /> Food / drink
        </label>
        <button type="submit" disabled={adding}>Add</button>
      </form>
      <p style={{ color: '#555', fontSize: '0.9rem' }}>
        Students can preorder at most 2 of each item, and at most 2 items ticked
        &ldquo;Food&rdquo; (snacks and drinks) in total, for a Saturday.
      </p>

      {loading ? <p>Loading…</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Price</th><th>Food</th><th>Active</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      defaultValue={item.price}
                      onBlur={(e) => { if (Number(e.target.value) !== item.price) updatePrice(item, e.target.value); }}
                      style={{ width: '7rem' }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={item.is_food} onChange={() => toggleFood(item)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={item.active} onChange={() => toggleActive(item)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TuckshopItemsPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/tuckshop/items">
      <TuckshopItemsInner />
    </RequireResource></RequireAuth>
  );
}
