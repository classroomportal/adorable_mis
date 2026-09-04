'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import { generateTranscript } from '../../lib/generateTranscript';

function ParentPortalInner() {
  const { profile } = useAuth();
  const parentId = profile?.parent_id;
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [behaviour, setBehaviour] = useState([]);

  useEffect(() => {
    async function loadChildren() {
      if (!parentId) return;
      const { data } = await supabase
        .from('student_parent')
        .select('students(student_id, first_name, last_name, year_group, form_class)')
        .eq('parent_id', parentId);
      const list = (data || []).map((row) => row.students).filter(Boolean);
      setChildren(list);
      if (list.length > 0) setSelectedId(list[0].student_id);
    }
    loadChildren();
  }, [parentId]);

  useEffect(() => {
    async function loadChildData() {
      if (!selectedId) return;
      const { data: r } = await supabase.from('results').select('*, subjects(subject_name, display_name)').eq('student_id', selectedId).order('week_start_date', { ascending: false });
      setResults(r || []);
      const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', selectedId);
      setTargets(tg || []);
      const { data: b } = await supabase.from('behaviour_events').select('*').eq('student_id', selectedId).order('event_date', { ascending: false });
      setBehaviour(b || []);
    }
    loadChildData();
  }, [selectedId]);

  if (!parentId) {
    return <p>Your account isn't linked to a parent record yet — contact the school office.</p>;
  }

  return (
    <div>
      <h1>My Children</h1>

      {children.length > 1 && (
        <div className="card">
          <label>
            Child
            <select value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))}>
              {children.map((c) => (
                <option key={c.student_id} value={c.student_id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {children.length === 0 ? <p>No linked children found.</p> : (
        <>
          <div className="card">
            <button onClick={() => generateTranscript(selectedId)}>📄 Download Transcript</button>
          </div>

          <div className="card">
            <h2>Results vs Target</h2>
            {targets.length === 0 ? <p>No target grades set yet.</p> : (
              <div className="table-scroll"><table>
                <thead><tr><th>Subject</th><th>Target</th><th>Most recent grade</th></tr></thead>
                <tbody>
                  {targets.map((t) => {
                    const latest = results.find((r) => r.subject_id === t.subject_id);
                    return (
                      <tr key={t.subject_id}>
                        <td>{t.subjects?.display_name || t.subjects?.subject_name}</td>
                        <td>{t.target_grade}</td>
                        <td>{latest?.grade ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card">
            <h2>Behaviour</h2>
            {behaviour.length === 0 ? <p>No events logged.</p> : (
              <div className="table-scroll"><table>
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th></tr></thead>
                <tbody>
                  {behaviour.map((b) => (
                    <tr key={b.event_id}>
                      <td>{b.event_date}</td>
                      <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                      <td>{b.category}</td>
                      <td>{b.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function ParentPortalPage() {
  return <RequireAuth><ParentPortalInner /></RequireAuth>;
}
