'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

const KEY_STAGES = ['KS3', 'KS4', 'KS5'];

function ImportInner() {
  const [subjects, setSubjects] = useState([]);
  const [subjectsWithTargets, setSubjectsWithTargets] = useState(new Set());
  const [keyStagesBySubject, setKeyStagesBySubject] = useState({}); // subject_id -> Set of key stages
  const [aliasesBySubject, setAliasesBySubject] = useState({}); // subject_id -> array of alias names
  const [aliasInput, setAliasInput] = useState({}); // subject_id -> current text field value
  const [status, setStatus] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('subjects')
      .select('subject_id, subject_name, display_name, target_fallback_subject_id')
      .order('subject_name');
    setSubjects(data || []);

    const { data: ksRows } = await supabase
      .from('subject_key_stages')
      .select('subject_id, key_stage');
    const ksMap = {};
    (ksRows || []).forEach((r) => {
      if (!ksMap[r.subject_id]) ksMap[r.subject_id] = new Set();
      ksMap[r.subject_id].add(r.key_stage);
    });
    setKeyStagesBySubject(ksMap);

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
    const { data: aliasRows } = await supabase.from('subject_aliases').select('alias_name, subject_id');
    const aliasMap = {};
    (aliasRows || []).forEach((a) => {
      if (!aliasMap[a.subject_id]) aliasMap[a.subject_id] = [];
      aliasMap[a.subject_id].push(a.alias_name);
    });
    setAliasesBySubject(aliasMap);

    setSubjectsWithTargets(ids);
  }

  async function saveAlias(subjectId) {
    const raw = (aliasInput[subjectId] || '').trim();
    if (!raw) return;
    const { error } = await supabase.from('subject_aliases').upsert([{ alias_name: raw, subject_id: subjectId }]);
    if (error) { setStatus(`Error saving alias "${raw}": ${error.message}`); return; }
    setAliasesBySubject((prev) => ({ ...prev, [subjectId]: [...(prev[subjectId] || []), raw] }));
    setAliasInput((prev) => ({ ...prev, [subjectId]: '' }));
    setStatus(`Alias "${raw}" now maps to this subject.`);
  }

  async function removeAlias(subjectId, aliasName) {
    await supabase.from('subject_aliases').delete().eq('alias_name', aliasName);
    setAliasesBySubject((prev) => ({ ...prev, [subjectId]: (prev[subjectId] || []).filter((a) => a !== aliasName) }));
  }
  async function toggleKeyStage(subjectId, keyStage) {
    const current = keyStagesBySubject[subjectId] || new Set();
    const has = current.has(keyStage);
    if (has) {
      await supabase.from('subject_key_stages').delete().eq('subject_id', subjectId).eq('key_stage', keyStage);
    } else {
      await supabase.from('subject_key_stages').insert([{ subject_id: subjectId, key_stage: keyStage }]);
    }
    setKeyStagesBySubject((prev) => {
      const next = { ...prev };
      const set = new Set(next[subjectId] || []);
      if (has) set.delete(keyStage); else set.add(keyStage);
      next[subjectId] = set;
      return next;
    });
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
        <p>
          <strong>Key stages</strong> controls which subjects appear on a student's transcript, based on
          their year group (KS3 = Years 7–9, KS4 = Years 10–11, KS5 = Year 12). A subject can belong to more
          than one key stage. Untagged subjects show at every key stage by default.
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
              <tr><th>Subject (source)</th><th>Display name</th><th>Use targets from</th><th>Key stages</th><th>Aliases</th><th></th></tr>
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
                  <td>
                    {KEY_STAGES.map((ks) => (
                      <label key={ks} style={{ marginRight: '0.6rem', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={(keyStagesBySubject[s.subject_id] || new Set()).has(ks)}
                          onChange={() => toggleKeyStage(s.subject_id, ks)}
                        />{' '}{ks}
                      </label>
                    ))}
                  </td>
                  <td>
                    {(aliasesBySubject[s.subject_id] || []).map((a) => (
                      <span key={a} style={{ display: 'inline-block', marginRight: '0.4rem', whiteSpace: 'nowrap' }}>
                        {a} <button className="secondary" onClick={() => removeAlias(s.subject_id, a)} style={{ padding: '0 0.3rem' }}>×</button>
                      </span>
                    ))}
                    <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem' }}>
                      <input
                        type="text"
                        placeholder="Add alias (e.g. Business Studies)"
                        value={aliasInput[s.subject_id] || ''}
                        onChange={(e) => setAliasInput((prev) => ({ ...prev, [s.subject_id]: e.target.value }))}
                        style={{ width: '10rem' }}
                      />
                      <button className="secondary" onClick={() => saveAlias(s.subject_id)}>+</button>
                    </div>
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
