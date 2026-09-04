'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function ImportInner() {
  const [subjects, setSubjects] = useState([]);
  const [subjectsWithTargets, setSubjectsWithTargets] = useState(new Set());
  const [status, setStatus] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('subjects')
      .select('subject_id, subject_name, display_name, target_fallback_subject_id')
      .order('subject_name');
    setSubjects(data || []);

    // Only subjects that actually have target_grades rows are useful as a
    // fallback source. Page through target_grades (can exceed 1000 rows)
    // and collect the distinct subject_ids.
    const ids = new Set();
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data: page, error } = await supabase
        .from('target_grades')
        .select('subject_id')
        .range(from, from + PAGE - 1);
      if (error) { console.error('target_grades fetch:', error.message); break; }
      (page || []).forEach((r) => ids.add(r.subject_id));
      if (!page || page.length < PAGE) break;
      from += PAGE;
    }
    setSubjectsWithTargets(ids);
  }

  function updateField(id, field, value) {
    setSubjects((prev) => prev.map((s) => (s.subject_id === id ? { ...s, [field]: value } : s)));
  }

  async function saveRow(row) {
    const { error } = await supabase
      .from('subjects')
      .update({
        display_name: row.display_name || null,
        target_fallback_subject_id: row.target_fallback_subject_id || null,
      })
      .eq('subject_id', row.subject_id);
    setStatus(error ? `Error saving ${row.subject_name}: ${error.message}` : `Saved ${row.subject_name}.`);
  }

  const filtered = subjects.filter((s) =>
    !filter || s.subject_name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <h1>Subject Settings</h1>
      <div className="card">
        <p>
          <strong>Display name</strong> overrides how a subject appears in the UI without changing the
          underlying Nova-T source name (e.g. "Mu" can display as "Music"). Leave blank to show the raw name.
        </p>
        <p>
          <strong>Use targets from</strong> lets a subject with no target grades of its own borrow another
          subject's targets for progress comparison (e.g. Business can borrow Economics targets).
        </p>
        <input
          type="text"
          placeholder="Filter subjects..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Subject (source)</th><th>Display name</th><th>Use targets from</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.subject_id}>
                  <td>{s.subject_name}</td>
                  <td>
                    <input
                      type="text"
                      placeholder={s.subject_name}
                      value={s.display_name || ''}
                      onChange={(e) => updateField(s.subject_id, 'display_name', e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      value={s.target_fallback_subject_id || ''}
                      onChange={(e) => updateField(s.subject_id, 'target_fallback_subject_id', e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">(none)</option>
                      {subjects
                        .filter((o) => o.subject_id !== s.subject_id && subjectsWithTargets.has(o.subject_id))
                        .map((o) => (
                          <option key={o.subject_id} value={o.subject_id}>{o.subject_name}</option>
                        ))}
                    </select>
                  </td>
                  <td><button onClick={() => saveRow(s)}>Save</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {status && <p>{status}</p>}
    </div>
  );
}

export default function SubjectSettingsPage() {
  return <RequireAuth><ImportInner /></RequireAuth>;
}
