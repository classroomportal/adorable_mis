'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function ImportInner() {
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState('');
  const [yearGroup, setYearGroup] = useState(12);
  const [boundaries, setBoundaries] = useState([]);
  const [status, setStatus] = useState(null);

  const YEAR_GROUPS = [7, 8, 9, 10, 11, 12];

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('subjects')
        .select('subject_id, subject_name')
        .order('subject_name');
      setSubjects(data || []);
      if (data && data.length) setSubjectId(data[0].subject_id);
    })();
  }, []);

  useEffect(() => {
    if (!subjectId) return;
    loadBoundaries(subjectId, yearGroup);
  }, [subjectId, yearGroup]);

  async function loadBoundaries(id, year) {
    setStatus(null);
    const { data } = await supabase
      .from('subject_grade_boundaries')
      .select('id, grade, min_score, max_score')
      .eq('subject_id', id)
      .eq('year_group', year)
      .order('min_score', { ascending: false });
    setBoundaries(data || []);
  }

  function updateRow(id, field, value) {
    setBoundaries((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  function addRow() {
    setBoundaries((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, grade: '', min_score: '', max_score: '', _new: true },
    ]);
  }

  async function removeRow(row) {
    if (!row._new) {
      await supabase.from('subject_grade_boundaries').delete().eq('id', row.id);
    }
    setBoundaries((prev) => prev.filter((r) => r.id !== row.id));
  }

  async function saveAll() {
    setStatus('Saving...');
    const problems = [];
    for (const row of boundaries) {
      if (!row.grade || row.min_score === '' || row.max_score === '') {
        problems.push(`Row with grade "${row.grade || '(blank)'}" is missing a value, skipped.`);
        continue;
      }
      const payload = {
        subject_id: subjectId,
        year_group: yearGroup,
        grade: row.grade.trim(),
        min_score: Number(row.min_score),
        max_score: Number(row.max_score),
      };
      if (row._new) {
        const { error } = await supabase.from('subject_grade_boundaries').insert([payload]);
        if (error) problems.push(`"${row.grade}": ${error.message}`);
      } else {
        const { error } = await supabase
          .from('subject_grade_boundaries')
          .update(payload)
          .eq('id', row.id);
        if (error) problems.push(`"${row.grade}": ${error.message}`);
      }
    }
    await loadBoundaries(subjectId, yearGroup);
    setStatus(problems.length ? `Saved with issues: ${problems.join(' ')}` : 'Saved.');
  }

  const currentSubjectName = subjects.find((s) => s.subject_id === subjectId)?.subject_name || '';

  return (
    <div>
      <h1>Grade Boundaries</h1>
      <div className="card">
        <p>Grade cutoffs are set per subject and used to compute a result's grade from its score. Every subject was seeded with the WAEC 9-point scale as a starting guess — review and adjust per subject below.</p>
        <label>
          Subject:{' '}
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>
            ))}
          </select>
        </label>
        {'  '}
        <label>
          Year group:{' '}
          <select value={yearGroup} onChange={(e) => setYearGroup(Number(e.target.value))}>
            {YEAR_GROUPS.map((y) => (
              <option key={y} value={y}>Year {y}</option>
            ))}
          </select>
        </label>
      </div>

      {subjectId && (
        <div className="card">
          <h2>{currentSubjectName} — Year {yearGroup}</h2>
          <table>
            <thead>
              <tr><th>Grade</th><th>Min score</th><th>Max score</th><th></th></tr>
            </thead>
            <tbody>
              {boundaries.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="text"
                      value={row.grade}
                      onChange={(e) => updateRow(row.id, 'grade', e.target.value)}
                      style={{ width: '5rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.min_score}
                      onChange={(e) => updateRow(row.id, 'min_score', e.target.value)}
                      style={{ width: '5rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.max_score}
                      onChange={(e) => updateRow(row.id, 'max_score', e.target.value)}
                      style={{ width: '5rem' }}
                    />
                  </td>
                  <td>
                    <button onClick={() => removeRow(row)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addRow} style={{ marginRight: '1rem' }}>Add grade</button>
          <button onClick={saveAll}>Save changes</button>
        </div>
      )}

      {status && <p>{status}</p>}
    </div>
  );
}

export default function GradeBoundariesPage() {
  return <RequireAuth><ImportInner /></RequireAuth>;
}
