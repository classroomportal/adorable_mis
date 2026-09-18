'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { publishTermTestScores } from '../../../lib/generateTermTestScores';
import { publishKeyStageTranscript, KEY_STAGE_GROUP_OPTIONS } from '../../../lib/generateKeyStageTranscript';

const DOC_TYPES = [
  { value: 'term_test_scores', label: 'Term Test Scores (this report period’s term)' },
  ...KEY_STAGE_GROUP_OPTIONS.map((o) => ({ value: o.value, label: o.label, isKeyStage: true })),
];

function GenerateReportsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [docType, setDocType] = useState('term_test_scores');
  const [students, setStudents] = useState([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]); // [{ student_id, name, status }]
  const [status, setStatus] = useState(null);

  useEffect(() => {
    supabase.from('report_periods').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setPeriods(data || []));
  }, []);

  const period = periods.find((p) => p.report_period_id === Number(periodId));

  useEffect(() => {
    if (!period) { setStudents([]); return; }
    supabase
      .from('students')
      .select('student_id, first_name, last_name, year_group')
      .eq('status', 'active')
      .eq('is_demo', false)
      .in('year_group', period.year_groups || [])
      .order('last_name')
      .then(({ data }) => setStudents(data || []));
  }, [period]);

  async function generateAndPublish() {
    if (!period) { setStatus('Choose a report period first.'); return; }
    setRunning(true);
    setStatus(null);
    setResults([]);
    for (const s of students) {
      try {
        if (docType === 'term_test_scores') {
          await publishTermTestScores(s.student_id, period.term_id || null);
        } else {
          await publishKeyStageTranscript(s.student_id, docType);
        }
        setResults((prev) => [...prev, { student_id: s.student_id, name: `${s.first_name} ${s.last_name}`, status: 'ok' }]);
      } catch (e) {
        setResults((prev) => [...prev, { student_id: s.student_id, name: `${s.first_name} ${s.last_name}`, status: `Error: ${e.message}` }]);
      }
    }
    setRunning(false);
    setStatus('Done.');
  }

  if (!isAdmin) {
    return <p>Only admins can generate reports.</p>;
  }

  return (
    <div>
      <h1>Generate Reports</h1>
      <p>
        Builds the chosen document for every active student in a report period&apos;s year groups and publishes it —
        parents and students will see it as an available document to download, without needing to regenerate it
        themselves.
      </p>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          Document type
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>

        <label>
          Report period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Select...</option>
            {periods.map((p) => (
              <option key={p.report_period_id} value={p.report_period_id}>{p.name}</option>
            ))}
          </select>
        </label>

        {period && (
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            Years {(period.year_groups || []).join(', ')} — {students.length} active student{students.length === 1 ? '' : 's'}.
          </p>
        )}

        <button onClick={generateAndPublish} disabled={running || !period || students.length === 0} style={{ width: 'fit-content' }}>
          {running ? `Generating (${results.length}/${students.length})...` : `Generate & Publish for ${students.length} student${students.length === 1 ? '' : 's'}`}
        </button>
        {status && <p>{status}</p>}
      </div>

      {results.length > 0 && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <h2>Results</h2>
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Status</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.student_id}>
                  <td>{r.name}</td>
                  <td style={{ color: r.status === 'ok' ? 'green' : 'red' }}>{r.status === 'ok' ? 'Published' : r.status}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

export default function GenerateReportsPage() {
  return (
    <RequireAuth>
      <GenerateReportsInner />
    </RequireAuth>
  );
}
