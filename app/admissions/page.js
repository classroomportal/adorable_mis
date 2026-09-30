'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { formatUKDate } from '../../lib/formatDate';
import {
  STATUS_ORDER, STATUS_LABELS, YEAR_GROUPS, statusBadgeStyle, applicantName,
  loadAcademicYears, errorText,
} from '../../lib/admissions';

// applicant_test_summary has no entry year of its own, so it is read for
// this year's applicants by id, in chunks to keep the URL short.
async function loadSummaries(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase
      .from('applicant_test_summary')
      .select('applicant_id, average_pct, pass_mark, passed')
      .in('applicant_id', ids.slice(i, i + 150));
    (data || []).forEach((r) => { out[r.applicant_id] = r; });
  }
  return out;
}

function ApplicantsInner() {
  const router = useRouter();
  const [years, setYears] = useState([]);
  const [yearId, setYearId] = useState(null);
  const [yearGroup, setYearGroup] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [applicants, setApplicants] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAcademicYears().then(({ years: ys, defaultYearId }) => {
      setYears(ys);
      setYearId(defaultYearId);
      if (!defaultYearId) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!yearId) return;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('applicants')
        .select('applicant_id, first_name, middle_name, last_name, preferred_name, entry_year_group, status, application_date, previous_schools(name, town)')
        .eq('entry_academic_year_id', yearId)
        .order('last_name')
        .order('first_name');
      if (err) { setError(errorText(err)); setApplicants([]); setLoading(false); return; }
      setApplicants(data || []);
      setSummaries(await loadSummaries((data || []).map((a) => a.applicant_id)));
      setLoading(false);
    }
    load();
  }, [yearId]);

  const inYearGroup = applicants.filter((a) => !yearGroup || a.entry_year_group === Number(yearGroup));
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, inYearGroup.filter((a) => a.status === s).length]));
  const q = search.trim().toLowerCase();
  const shown = inYearGroup.filter((a) =>
    (!statusFilter || a.status === statusFilter)
    && (!q || `${a.first_name} ${a.middle_name || ''} ${a.last_name} ${a.preferred_name || ''}`.toLowerCase().includes(q)));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Applicants</h1>
        <button type="button" onClick={() => router.push('/admissions/new')}>New application</button>
      </div>
      <p style={{ color: '#666', marginTop: '0.4rem' }}>
        <a href="/admissions/projections">Next year's numbers</a>{' · '}
        <a href="/admissions/sessions">Test days</a>{' · '}
        <a href="/admissions/papers">Test papers</a>{' · '}
        <a href="/admissions/letters">Standard letters</a>{' · '}
        <a href="/admissions/schools">Previous schools</a>
      </p>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '0 0 auto' }}>
            Entry year
            <select value={yearId ?? ''} onChange={(e) => setYearId(Number(e.target.value))}>
              {years.map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.label}{y.status === 'planning' ? ' (planning)' : y.status === 'current' ? ' (current)' : ''}</option>)}
            </select>
          </label>
          <label style={{ flex: '0 0 auto' }}>
            Year group
            <select value={yearGroup} onChange={(e) => setYearGroup(e.target.value)}>
              <option value="">All</option>
              {YEAR_GROUPS.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </label>
          <label style={{ flex: '0 0 auto' }}>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label style={{ flex: '1 1 12rem' }}>
            Name
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
          {STATUS_ORDER.map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                className="secondary"
                onClick={() => setStatusFilter(active ? '' : s)}
                title={active ? 'Show every status' : `Show only ${STATUS_LABELS[s].toLowerCase()}`}
                style={{
                  ...statusBadgeStyle(s),
                  border: active ? '2px solid currentColor' : '1px solid transparent',
                  borderRadius: 8,
                  padding: '0.3rem 0.6rem',
                  opacity: counts[s] ? 1 : 0.55,
                }}
              >
                {STATUS_LABELS[s]} <strong>{counts[s]}</strong>
              </button>
            );
          })}
        </div>
      </div>

      {error && <p style={{ color: '#a3232c' }}><strong>{error}</strong></p>}

      <div className="card">
        {loading ? <p>Loading...</p> : shown.length === 0 ? (
          <p style={{ color: '#666', margin: 0 }}>
            {applicants.length === 0 ? 'No applications for this entry year yet.' : 'No applicants match these filters.'}
          </p>
        ) : (
          <div className="table-scroll"><table>
            <thead>
              <tr><th>Name</th><th>Year</th><th>Previous school</th><th>Status</th><th>Test average</th><th>Applied</th></tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const s = summaries[a.applicant_id];
                return (
                  <tr key={a.applicant_id}>
                    <td><a href={`/admissions/${a.applicant_id}`}>{applicantName(a)}</a></td>
                    <td>Year {a.entry_year_group}</td>
                    <td>{a.previous_schools?.name || '—'}</td>
                    <td><span className="badge" style={statusBadgeStyle(a.status)}>{STATUS_LABELS[a.status] || a.status}</span></td>
                    <td>
                      {s?.average_pct == null ? <span style={{ color: '#888' }}>—</span> : (
                        <span
                          style={{ color: s.passed ? '#1a7a3d' : '#a3232c', fontWeight: 600 }}
                          title={s.passed ? `At or above the pass mark (${Number(s.pass_mark)}%)` : `Below the pass mark (${Number(s.pass_mark)}%)`}
                        >
                          {Number(s.average_pct)}%
                        </span>
                      )}
                    </td>
                    <td>{formatUKDate(a.application_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {!loading && shown.length > 0 && (
          <p style={{ color: '#666', marginBottom: 0, fontSize: '0.85em' }}>{shown.length} applicant{shown.length === 1 ? '' : 's'}.</p>
        )}
      </div>
    </div>
  );
}

export default function AdmissionsPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/admissions">
      <ApplicantsInner />
    </RequireResource></RequireAuth>
  );
}
