'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function TopUpInner() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [target, setTarget] = useState('40000');

  const [mode, setMode] = useState('individual'); // individual | group
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [currentBalance, setCurrentBalance] = useState(null);

  const [groupType, setGroupType] = useState('year_group');
  const [groupValue, setGroupValue] = useState('');

  const [status, setStatus] = useState(null);
  const [results, setResults] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false });
      setTerms(data ?? []);
      const current = (data ?? []).find((t) => t.is_current);
      if (current) setTermId(String(current.id));
    })();
  }, []);

  useEffect(() => {
    if (studentQuery.trim().length < 2) {
      setStudentResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, form_class, year_group')
        .eq('status', 'active')
        .or(`first_name.ilike.%${studentQuery}%,last_name.ilike.%${studentQuery}%`)
        .limit(8);
      setStudentResults(data ?? []);
    }, 250);
    return () => clearTimeout(handle);
  }, [studentQuery]);

  async function selectStudent(s) {
    setSelectedStudent(s);
    setStudentQuery(`${s.first_name} ${s.last_name}`);
    setStudentResults([]);
    const { data } = await supabase.rpc('get_tuckshop_balance', { p_student_id: s.student_id });
    setCurrentBalance(data);
  }

  async function submitIndividual() {
    if (!selectedStudent || !termId || !target) return;
    setSubmitting(true);
    setStatus(null);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc('top_up_tuckshop_balance', {
      p_student_id: selectedStudent.student_id,
      p_term_id: termId,
      p_target_balance: Number(target),
      p_created_by: userData?.user?.id,
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else if (Number(data) === 0) {
      setStatus('Already at or above target — nothing charged.');
    } else {
      setStatus(`Charged ${naira(data)} to bring balance up to ${naira(target)}.`);
      const { data: bal } = await supabase.rpc('get_tuckshop_balance', { p_student_id: selectedStudent.student_id });
      setCurrentBalance(bal);
    }
    setSubmitting(false);
  }

  async function submitGroup() {
    if (!groupValue || !termId || !target) return;
    setSubmitting(true);
    setStatus(null);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc('top_up_tuckshop_balance_for_group', {
      p_target_type: groupType,
      p_target_value: groupValue,
      p_term_id: termId,
      p_target_balance: Number(target),
      p_created_by: userData?.user?.id,
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setResults(data || []);
      setStatus(`Processed ${data?.length ?? 0} students.`);
    }
    setSubmitting(false);
  }

  return (
    <div>
      <h1>Top Up Tuckshop Balance</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Only charges "Tuck Shop Recharge" — never "Tuck Shop Balance". The amount charged is the
        target balance minus whatever's left over from before, so it's different for every student.
      </p>

      <div className="card" style={{ display: 'flex', gap: '1rem' }}>
        <label>
          <input type="radio" checked={mode === 'individual'} onChange={() => setMode('individual')} /> One student
        </label>
        <label>
          <input type="radio" checked={mode === 'group'} onChange={() => setMode('group')} /> A group
        </label>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <label>
          Term
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_current ? ' (current)' : ''}</option>)}
          </select>
        </label>
        <label>
          Target balance (₦)
          <input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: '10rem' }} />
        </label>

        {mode === 'individual' ? (
          <>
            <div style={{ position: 'relative' }}>
              <input
                value={studentQuery}
                onChange={(e) => { setStudentQuery(e.target.value); setSelectedStudent(null); }}
                placeholder="Search student name"
                style={{ width: '100%' }}
              />
              {studentResults.length > 0 && (
                <div className="card" style={{ position: 'absolute', zIndex: 10, width: '100%' }}>
                  {studentResults.map((s) => (
                    <div key={s.student_id} onClick={() => selectStudent(s)} style={{ padding: '0.4rem', cursor: 'pointer' }}>
                      {s.first_name} {s.last_name} — Year {s.year_group} {s.form_class}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedStudent && (
              <p>Current balance: <strong>{currentBalance === null ? '…' : naira(currentBalance)}</strong></p>
            )}
            <button onClick={submitIndividual} disabled={!selectedStudent || submitting}>
              {submitting ? 'Charging…' : 'Top up'}
            </button>
          </>
        ) : (
          <>
            <label>
              Group type
              <select value={groupType} onChange={(e) => setGroupType(e.target.value)}>
                <option value="year_group">Year group</option>
                <option value="form_class">Form class</option>
                <option value="all">All students</option>
              </select>
            </label>
            {groupType !== 'all' && (
              <label>
                Value
                <input value={groupValue} onChange={(e) => setGroupValue(e.target.value)} placeholder={groupType === 'year_group' ? 'e.g. 9' : 'e.g. 9A'} />
              </label>
            )}
            <button onClick={submitGroup} disabled={submitting || (groupType !== 'all' && !groupValue)}>
              {submitting ? 'Charging…' : 'Top up group'}
            </button>
            {results.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Student</th><th>Charged</th></tr></thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.student_id}>
                        <td>{r.student_name}</td>
                        <td>{Number(r.topped_up) === 0 ? 'already at target' : naira(r.topped_up)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {status && <p>{status}</p>}
      </div>
    </div>
  );
}

export default function TopUpPage() {
  return (
    <RequireAuth>
      <TopUpInner />
    </RequireAuth>
  );
}
