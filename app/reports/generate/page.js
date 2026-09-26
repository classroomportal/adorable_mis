'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { publishTermTestScores } from '../../../lib/generateTermTestScores';
import { publishKeyStageTranscript, KEY_STAGE_GROUP_OPTIONS } from '../../../lib/generateKeyStageTranscript';
import { publishWrittenReport, downloadWrittenReport } from '../../../lib/generateWrittenReport';
import { scopeToReportPeriod, describeReportPeriod } from '../../../lib/reportWriting';
import { formatUKDate } from '../../../lib/formatDate';

const DOC_TYPES = [
  { value: 'written_report', label: 'Written report (grades and approved comments)' },
  { value: 'term_test_scores', label: 'Term Test Scores (this report period’s term)' },
  ...KEY_STAGE_GROUP_OPTIONS.map((o) => ({ value: o.value, label: o.label, isKeyStage: true })),
];

function GenerateReportsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [docType, setDocType] = useState('written_report');
  const [students, setStudents] = useState([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]); // [{ student_id, name, status }]
  const [status, setStatus] = useState(null);
  const [previewId, setPreviewId] = useState('');
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    supabase.from('report_periods').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setPeriods(data || []));
  }, []);

  const period = periods.find((p) => p.report_period_id === Number(periodId));

  useEffect(() => {
    if (!period) { setStudents([]); return; }
    scopeToReportPeriod(
      supabase
        .from('students')
        .select('student_id, first_name, last_name, year_group')
        .eq('status', 'active')
        .eq('is_demo', false)
        .order('last_name'),
      period
    ).then(({ data }) => setStudents(data || []));
  }, [period]);

  async function generateAndPublish() {
    if (!period) { setStatus('Choose a report period first.'); return; }
    setRunning(true);
    setStatus(null);
    setResults([]);
    for (const s of students) {
      try {
        let note = null;
        if (docType === 'written_report') {
          const r = await publishWrittenReport(s.student_id, period);
          if (!r.published) {
            setResults((prev) => [...prev, { student_id: s.student_id, name: `${s.first_name} ${s.last_name}`, status: 'skipped', note: 'No approved comments yet — not published' }]);
            continue;
          }
          if (r.unchecked) note = `${r.unchecked} comment${r.unchecked === 1 ? '' : 's'} not yet approved, left out`;
        } else if (docType === 'term_test_scores') {
          await publishTermTestScores(s.student_id, period.term_id || null);
        } else {
          await publishKeyStageTranscript(s.student_id, docType);
        }
        setResults((prev) => [...prev, { student_id: s.student_id, name: `${s.first_name} ${s.last_name}`, status: 'ok', note }]);
      } catch (e) {
        setResults((prev) => [...prev, { student_id: s.student_id, name: `${s.first_name} ${s.last_name}`, status: `Error: ${e.message}` }]);
      }
    }
    setRunning(false);
    setStatus('Done.');
  }

  async function preview() {
    if (!period || !previewId) return;
    setPreviewing(true);
    setStatus(null);
    try {
      const r = await downloadWrittenReport(Number(previewId), period);
      if (r.unchecked) setStatus(`Preview downloaded. ${r.unchecked} written comment${r.unchecked === 1 ? ' is' : 's are'} not yet approved and ${r.unchecked === 1 ? 'is' : 'are'} left out.`);
    } catch (e) {
      setStatus(`Couldn't build the preview: ${e.message}`);
    } finally {
      setPreviewing(false);
    }
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
            {describeReportPeriod(period, formatUKDate)} — {students.length} active student{students.length === 1 ? '' : 's'}.
          </p>
        )}

        {docType === 'written_report' && period && (
          <>
            <p style={{ color: '#666', fontSize: '0.9rem', margin: 0 }}>
              Each subject&apos;s grades beside its comment — English, then Maths, then the rest alphabetically — then the
              Mentor, Houseparent and SMT comments. Only comments approved on Check Reports are printed; a student with none
              approved yet is skipped.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 240px' }}>
                Preview one student first
                <select value={previewId} onChange={(e) => setPreviewId(e.target.value)}>
                  <option value="">Select a student...</option>
                  {students.map((s) => (
                    <option key={s.student_id} value={s.student_id}>{s.last_name}, {s.first_name} (Year {s.year_group})</option>
                  ))}
                </select>
              </label>
              <button type="button" className="secondary" onClick={preview} disabled={!previewId || previewing} style={{ width: 'fit-content' }}>
                {previewing ? 'Building...' : 'Download preview'}
              </button>
            </div>
          </>
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
                  <td style={{ color: r.status === 'ok' ? 'green' : r.status === 'skipped' ? '#8a6d00' : 'red' }}>
                    {r.status === 'ok' ? 'Published' : r.status === 'skipped' ? 'Skipped' : r.status}
                    {r.note ? <span style={{ color: '#666' }}> — {r.note}</span> : null}
                  </td>
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
    <RequireAuth><RequireResource resourceKey="/reports/generate">
      <GenerateReportsInner />
    </RequireResource></RequireAuth>
  );
}
