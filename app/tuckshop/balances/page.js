'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function BalancesInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [formFilter, setFormFilter] = useState('all');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc('get_tuckshop_balances');
    if (error) {
      setError(error.message);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }

  const yearOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.year_group))).sort((a, b) => a - b),
    [rows]
  );
  const formOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.form_class).filter(Boolean))).sort(),
    [rows]
  );

  const filtered = rows.filter((r) => {
    if (yearFilter !== 'all' && String(r.year_group) !== yearFilter) return false;
    if (formFilter !== 'all' && r.form_class !== formFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const name = `${r.first_name} ${r.last_name}`.toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });

  const total = filtered.reduce((sum, r) => sum + Number(r.balance || 0), 0);

  return (
    <div>
      <h1>Tuckshop Balances</h1>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'flex-end' }}>
        <label>
          Search name
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student name" />
        </label>
        <label>
          Year group
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">All years</option>
            {yearOptions.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>
        <label>
          Form class
          <select value={formFilter} onChange={(e) => setFormFilter(e.target.value)}>
            <option value="all">All classes</option>
            {formOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}

      {!error && (
        <>
          <p>
            Showing <strong>{filtered.length}</strong> student{filtered.length === 1 ? '' : 's'} —
            total balance <strong>{naira(total)}</strong>
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Year</th>
                  <th>Form</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.student_id}>
                    <td>{r.first_name} {r.last_name}</td>
                    <td>{r.year_group}</td>
                    <td>{r.form_class}</td>
                    <td style={{ color: Number(r.balance) < 0 ? 'crimson' : undefined }}>
                      {naira(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function BalancesPage() {
  return (
    <RequireAuth>
      <BalancesInner />
    </RequireAuth>
  );
}
