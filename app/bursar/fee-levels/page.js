'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function FeeLevelsInner() {
  const [levels, setLevels] = useState([]);
  const [newLevelName, setNewLevelName] = useState('');
  const [addingLevel, setAddingLevel] = useState(false);

  const [selectedLevel, setSelectedLevel] = useState('');
  const [students, setStudents] = useState([]);
  const [ticked, setTicked] = useState(new Set());
  const [originallyIn, setOriginallyIn] = useState(new Set());
  const [filterYear, setFilterYear] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    loadLevels();
    (async () => {
      const { data } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, year_group, form_class, fee_band')
        .eq('status', 'active')
        .order('year_group')
        .order('last_name');
      setStudents(data ?? []);
      setLoading(false);
    })();
  }, []);

  async function loadLevels() {
    const { data } = await supabase.from('fee_levels').select('id, name').order('name');
    setLevels(data ?? []);
  }

  async function addLevel(e) {
    e.preventDefault();
    if (!newLevelName.trim()) return;
    setAddingLevel(true);
    const { error } = await supabase.from('fee_levels').insert({ name: newLevelName.trim() });
    if (!error) {
      setNewLevelName('');
      await loadLevels();
    }
    setAddingLevel(false);
  }

  async function deleteLevel(id, name) {
    const stillUsed = students.some((s) => s.fee_band === name);
    if (stillUsed) {
      setStatus(`Can't delete "${name}" — some students are still assigned to it.`);
      return;
    }
    await supabase.from('fee_levels').delete().eq('id', id);
    await loadLevels();
  }

  useEffect(() => {
    if (!selectedLevel) {
      setTicked(new Set());
      setOriginallyIn(new Set());
      return;
    }
    const inLevel = new Set(students.filter((s) => s.fee_band === selectedLevel).map((s) => s.student_id));
    setTicked(inLevel);
    setOriginallyIn(inLevel);
  }, [selectedLevel, students]);

  const filtered = useMemo(() => {
    let list = students;
    if (filterYear) list = list.filter((s) => String(s.year_group) === filterYear);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q));
    }
    return list;
  }, [students, filterYear, query]);

  const yearGroups = useMemo(() => Array.from(new Set(students.map((s) => s.year_group))).sort((a, b) => a - b), [students]);

  function toggle(studentId) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function saveRoster() {
    if (!selectedLevel) return;
    setSaving(true);
    setStatus(null);

    const toAdd = Array.from(ticked).filter((id) => !originallyIn.has(id));
    const toRemove = Array.from(originallyIn).filter((id) => !ticked.has(id));

    if (toAdd.length > 0) {
      await supabase.rpc('set_fee_level_for_students', { p_student_ids: toAdd, p_level: selectedLevel });
    }
    if (toRemove.length > 0) {
      await supabase.rpc('clear_fee_level_for_students', { p_student_ids: toRemove });
    }

    setStatus(`Saved — ${ticked.size} student${ticked.size === 1 ? '' : 's'} now in "${selectedLevel}".`);
    const { data } = await supabase
      .from('students')
      .select('student_id, first_name, last_name, year_group, form_class, fee_band')
      .eq('status', 'active')
      .order('year_group')
      .order('last_name');
    setStudents(data ?? []);
    setSaving(false);
  }

  return (
    <div>
      <h1>Fee Levels</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Create named levels of your own choosing (e.g. "Full Fee", "Staff Discount Rate",
        "Scholarship") and tick which students belong to each. This is just a label for grouping —
        actual charging still happens through the Charge Checklist, where you filter to a group and
        type the amount.
      </p>

      <div className="card">
        <strong>Levels</strong>
        <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
          <table>
            <thead><tr><th>Name</th><th></th></tr></thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td><button onClick={() => deleteLevel(l.id, l.name)} style={{ color: '#a3232c' }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addLevel} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input value={newLevelName} onChange={(e) => setNewLevelName(e.target.value)} placeholder="e.g. Full Fee" />
          <button type="submit" disabled={addingLevel}>Add level</button>
        </form>
      </div>

      <div className="card">
        <label>
          Choose a level to assign students to
          <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}>
            <option value="">-- choose --</option>
            {levels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </label>
      </div>

      {selectedLevel && (
        <>
          <div className="card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>
              Filter year
              <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
                <option value="">All</option>
                {yearGroups.map((y) => <option key={y} value={y}>{y}</option>)}
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
                <thead><tr><th></th><th>Student</th><th>Year</th><th>Form</th><th>Current level</th></tr></thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.student_id}>
                      <td><input type="checkbox" checked={ticked.has(s.student_id)} onChange={() => toggle(s.student_id)} /></td>
                      <td>{s.first_name} {s.last_name}</td>
                      <td>{s.year_group}</td>
                      <td>{s.form_class}</td>
                      <td>{s.fee_band || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <strong>{ticked.size}</strong> ticked for "{selectedLevel}"
            <button onClick={saveRoster} disabled={saving} style={{ marginLeft: '0.75rem' }}>
              {saving ? 'Saving…' : 'Save roster'}
            </button>
            {status && <p>{status}</p>}
          </div>
        </>
      )}
    </div>
  );
}

export default function FeeLevelsPage() {
  return (
    <RequireAuth>
      <FeeLevelsInner />
    </RequireAuth>
  );
}
