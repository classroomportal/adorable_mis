'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { YEAR_GROUPS, loadAcademicYears, errorText } from '../../../lib/admissions';

// The English and Maths entrance paper for each year group (migration 256).
// max_score is what turns a mark into a percentage, so a score can't be
// entered on the Test Days page until its paper is set up here. The pass
// mark (a 50% average of English and Maths) lives on academic_years and is
// set by an admin.

const SUBJECTS = [['english', 'English'], ['maths', 'Maths']];
const key = (yg, subject) => `${yg}-${subject}`;

function PapersInner() {
  const [years, setYears] = useState([]);
  const [yearId, setYearId] = useState(null);
  const [papers, setPapers] = useState({}); // key -> row
  const [edits, setEdits] = useState({}); // key -> { name, max }
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    (async () => {
      const { years: ys, defaultYearId } = await loadAcademicYears();
      setYears(ys);
      setYearId(defaultYearId);
      if (!defaultYearId) setLoading(false);
    })();
  }, []);

  async function load(id) {
    setLoading(true);
    const { data, error } = await supabase
      .from('admission_papers')
      .select('paper_id, year_group, subject, paper_name, max_score')
      .eq('academic_year_id', id);
    if (error) {
      setMessage({ error: true, text: `Could not load the papers: ${errorText(error)}` });
      setLoading(false);
      return;
    }
    const byKey = {};
    const e = {};
    for (const p of data || []) byKey[key(p.year_group, p.subject)] = p;
    for (const yg of YEAR_GROUPS) {
      for (const [subject] of SUBJECTS) {
        const p = byKey[key(yg, subject)];
        e[key(yg, subject)] = { name: p?.paper_name ?? '', max: p?.max_score != null ? String(Number(p.max_score)) : '' };
      }
    }
    setPapers(byKey);
    setEdits(e);
    setLoading(false);
  }

  useEffect(() => { if (yearId) load(yearId); }, [yearId]);

  function edit(k, field, value) {
    setEdits((prev) => ({ ...prev, [k]: { ...prev[k], [field]: value } }));
    setMessage(null);
  }

  function isChanged(k) {
    const p = papers[k];
    const e = edits[k];
    if (!e) return false;
    return e.name.trim() !== (p?.paper_name ?? '')
      || e.max.trim() !== (p?.max_score != null ? String(Number(p.max_score)) : '');
  }

  const changedKeys = Object.keys(edits).filter(isChanged);

  async function save() {
    const rows = [];
    const problems = [];
    for (const k of changedKeys) {
      const [yg, subject] = k.split('-');
      const e = edits[k];
      const label = `Year ${yg} ${subject === 'english' ? 'English' : 'Maths'}`;
      if (e.max.trim() === '') {
        problems.push(`${label}: give the maximum mark (a paper can't be left without one).`);
        continue;
      }
      const max = Number(e.max);
      if (!Number.isFinite(max) || max <= 0) {
        problems.push(`${label}: the maximum mark must be a number above 0.`);
        continue;
      }
      rows.push({
        academic_year_id: yearId,
        year_group: Number(yg),
        subject,
        paper_name: e.name.trim() || null,
        max_score: max,
      });
    }
    if (problems.length) {
      setMessage({ error: true, text: problems.join(' ') });
      return;
    }
    if (!rows.length) return;
    setMessage({ text: 'Saving...' });
    const { error } = await supabase
      .from('admission_papers')
      .upsert(rows, { onConflict: 'academic_year_id,year_group,subject' });
    if (error) {
      setMessage({ error: true, text: `Not saved: ${errorText(error)}` });
      return;
    }
    await load(yearId);
    setMessage({ text: `Saved ${rows.length} paper${rows.length === 1 ? '' : 's'}.` });
  }

  const year = years.find((y) => y.academic_year_id === yearId);

  return (
    <div>
      <h1>Test Papers</h1>
      <p>
        The English and Maths entrance paper for each year group, with its maximum mark. Scores are turned into
        percentages from the maximum mark, so set the papers up before test results are entered.
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
        <label style={{ flex: '0 1 14rem' }}>
          Entry year
          <select value={yearId ?? ''} onChange={(ev) => setYearId(Number(ev.target.value))}>
            {years.map((y) => (
              <option key={y.academic_year_id} value={y.academic_year_id}>
                {y.label}{y.status === 'planning' ? ' (next year)' : y.status === 'current' ? ' (this year)' : ''}
              </option>
            ))}
          </select>
        </label>
        {year && (
          <div style={{ flex: '1 1 18rem' }}>
            <strong>Pass mark: {Number(year.admission_pass_mark)}%</strong>
            <div style={{ color: '#666', fontSize: '0.9em' }}>
              50% average of English and Maths, set by admin.
            </div>
          </div>
        )}
      </div>

      {loading ? <p>Loading...</p> : !yearId ? <p>No academic years have been set up.</p> : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Year group</th>
                  {SUBJECTS.map(([s, label]) => (
                    <th key={s} colSpan={2}>{label}</th>
                  ))}
                </tr>
                <tr>
                  <th />
                  {SUBJECTS.map(([s]) => [
                    <th key={`${s}-n`} style={{ fontWeight: 400 }}>Paper name</th>,
                    <th key={`${s}-m`} style={{ fontWeight: 400 }}>Max mark</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {YEAR_GROUPS.map((yg) => (
                  <tr key={yg}>
                    <td><strong>Year {yg}</strong></td>
                    {SUBJECTS.map(([s, label]) => {
                      const k = key(yg, s);
                      const e = edits[k] || { name: '', max: '' };
                      const changed = isChanged(k);
                      return [
                        <td key={`${k}-n`} style={changed ? { background: '#fffbe6' } : undefined}>
                          <input
                            value={e.name}
                            onChange={(ev) => edit(k, 'name', ev.target.value)}
                            placeholder={`Year ${yg} ${label}`}
                            aria-label={`Year ${yg} ${label} paper name`}
                            style={{ minWidth: '10rem' }}
                          />
                        </td>,
                        <td key={`${k}-m`} style={changed ? { background: '#fffbe6' } : undefined}>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={e.max}
                            onChange={(ev) => edit(k, 'max', ev.target.value)}
                            placeholder="Not set"
                            aria-label={`Year ${yg} ${label} maximum mark`}
                            style={{ width: '6rem' }}
                          />
                        </td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>
            <button onClick={save} disabled={!changedKeys.length}>
              Save{changedKeys.length ? ` (${changedKeys.length} changed)` : ''}
            </button>
            {message && (
              <span style={{ marginLeft: '0.75rem', color: message.error ? '#a3232c' : undefined }}>{message.text}</span>
            )}
          </p>
          <p style={{ color: '#666', fontSize: '0.9em' }}>
            Changing a maximum mark after scores are in changes those applicants&apos; percentages, and whether they
            reach the pass mark, so check nobody has already scored more than a lowered maximum.
          </p>
        </>
      )}
    </div>
  );
}

export default function AdmissionPapersPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admissions/papers">
        <PapersInner />
      </RequireResource>
    </RequireAuth>
  );
}
