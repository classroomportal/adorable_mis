'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

const BANDS = ['A', 'B', 'C', 'Scholarship'];
const YEAR_GROUPS = [7, 8, 9, 10, 11, 12];

function FeeBandsInner() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkBand, setBulkBand] = useState({}); // year_group -> band
  const [bulkStatus, setBulkStatus] = useState(null);
  const [filterYear, setFilterYear] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('students')
      .select('student_id, first_name, last_name, year_group, form_class, fee_band')
      .eq('status', 'active')
      .order('year_group')
      .order('last_name');
    setStudents(data ?? []);
    setLoading(false);
  }

  async function applyBulk(yg) {
    const band = bulkBand[yg];
    if (!band) return;
    setBulkStatus(`Applying to Year ${yg}…`);
    const { data, error } = await supabase.rpc('set_fee_band_by_year_group', { p_year_group: yg, p_band: band });
    setBulkStatus(error ? `Error: ${error.message}` : `Set ${data} students in Year ${yg} to Band ${band}.`);
    await load();
  }

  async function overrideStudent(studentId, band) {
    await supabase.rpc('set_student_fee_band', { p_student_id: studentId, p_band: band });
    await load();
  }

  const filtered = useMemo(() => {
    let list = students;
    if (filterYear) list = list.filter((s) => String(s.year_group) === filterYear);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q));
    }
    return list;
  }, [students, filterYear, query]);

  return (
    <div>
      <h1>Fee Bands</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Every student's band (A / B / C / Scholarship) decides their fee amount when you use
        "Allocate by Band". Start by bulk-setting a band per year group, then override individuals below.
      </p>

      <div className="card">
        <strong>Bulk-set by year group</strong>
        <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
          <table>
            <thead><tr><th>Year</th><th>Band</th><th></th></tr></thead>
            <tbody>
              {YEAR_GROUPS.map((yg) => (
                <tr key={yg}>
                  <td>Year {yg}</td>
                  <td>
                    <select value={bulkBand[yg] || ''} onChange={(e) => setBulkBand((p) => ({ ...p, [yg]: e.target.value }))}>
                      <option value="">-- choose --</option>
                      {BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td>
                    <button onClick={() => applyBulk(yg)} disabled={!bulkBand[yg]}>Apply</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bulkStatus && <p>{bulkStatus}</p>}
      </div>

      <div className="card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <label>
          Filter year
          <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
            <option value="">All</option>
            {YEAR_GROUPS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Search name
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {loading ? <p>Loading…</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Student</th><th>Year</th><th>Form</th><th>Band</th></tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.student_id}>
                  <td>{s.first_name} {s.last_name}</td>
                  <td>{s.year_group}</td>
                  <td>{s.form_class}</td>
                  <td>
                    <select value={s.fee_band || ''} onChange={(e) => overrideStudent(s.student_id, e.target.value)}>
                      <option value="">-- none --</option>
                      {BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
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

export default function FeeBandsPage() {
  return (
    <RequireAuth>
      <FeeBandsInner />
    </RequireAuth>
  );
}
