'use client';
import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import { buildWeekColumns } from '../../../lib/generateTranscript';
import RequireAuth from '../../RequireAuth';

// Columns that are NOT subject score columns in the weekly gradebook export.
const METADATA_COLUMNS = new Set([
  'First name', 'Last name', 'ID number', 'Institution', 'Department',
  'Email address', 'Last downloaded from this course',
]);

const BATCH_SIZE = 50;

// "Quiz: Business Studies Exam (Real)" -> "Business Studies"
function parseSubjectName(header) {
  let name = header.trim();
  name = name.replace(/^Quiz:\s*/i, '');
  name = name.replace(/\s*Exam\s*\(Real\)\s*$/i, '');
  name = name.replace(/\s*\(Real\)\s*$/i, '');
  // Moodle exports append the year group as a trailing number, e.g.
  // "Spanish 6" or "Civics 6" — that's not part of the subject name, so
  // strip it before matching against existing subjects.
  name = name.replace(/\s+\d+$/, '');
  return name.trim();
}

// Type is read from the raw header BEFORE parseSubjectName strips the
// "Exam"/"Quiz" wording, since that wording is the only signal we have.
function parseResultType(header) {
  return /exam/i.test(header) ? 'Exam' : 'ReLP';
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function ImportInner() {
  const [rows, setRows] = useState([]);
  const [subjectColumns, setSubjectColumns] = useState([]); // raw header names
  const [subjectNames, setSubjectNames] = useState({}); // raw header -> parsed name (display only)
  const [allSubjects, setAllSubjects] = useState([]); // {subject_id, subject_name}
  const [resolution, setResolution] = useState({}); // header -> { mode: 'existing'|'new'|'unresolved', subjectId, auto }
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState([]);

  useEffect(() => {
    async function loadSubjectsAndAliases() {
      const { data: subs } = await supabase.from('subjects').select('subject_id, subject_name').order('subject_name');
      setAllSubjects(subs || []);
    }
    loadSubjectsAndAliases();
  }, []);

  useEffect(() => {
    async function loadTerms() {
      const { data } = await supabase
        .from('terms')
        .select('term_id, term_name, start_date, end_date')
        .order('start_date', { ascending: false });
      setTerms(data || []);
      const today = new Date().toISOString().slice(0, 10);
      const current = (data || []).find((t) => t.start_date <= today && t.end_date >= today);
      if (current) setTermId(current.term_id);
      else if (data && data.length > 0) setTermId(data[0].term_id);
    }
    loadTerms();
  }, []);

  const selectedTerm = terms.find((t) => t.term_id === termId);
  const weekOptions = selectedTerm ? buildWeekColumns(selectedTerm) : [];
  const weekStart = weekOptions.find((w) => w.label === weekLabel)?.date || '';

  useEffect(() => {
    if (weekOptions.length > 0 && !weekOptions.find((w) => w.label === weekLabel)) {
      setWeekLabel(weekOptions[0].label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId, terms]);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data;
        setRows(data);
        setPreview(data.slice(0, 8));
        setStatus(null);
        setErrors([]);

        const headers = data.length ? Object.keys(data[0]) : [];
        const subjCols = headers.filter((h) => !METADATA_COLUMNS.has(h.trim()));
        setSubjectColumns(subjCols);

        const names = {};
        subjCols.forEach((h) => { names[h] = parseSubjectName(h); });
        setSubjectNames(names);

        // Resolve each column against aliases, then exact subject name match.
        // Anything left over is NOT auto-created — it needs a person to pair
        // it to an existing subject or explicitly confirm a new one, since a
        // typo'd or shorthand header should never silently spawn an orphan
        // subject with no class behind it.
        const { data: aliasRows } = await supabase.from('subject_aliases').select('alias_name, subject_id');
        const aliasByName = {};
        (aliasRows || []).forEach((a) => { aliasByName[a.alias_name] = a.subject_id; });

        const res = {};
        for (const h of subjCols) {
          const name = names[h];
          if (aliasByName[name]) {
            res[h] = { mode: 'existing', subjectId: aliasByName[name], auto: true };
            continue;
          }
          const match = allSubjects.find((s) => s.subject_name === name);
          if (match) {
            res[h] = { mode: 'existing', subjectId: match.subject_id, auto: true };
          } else {
            res[h] = { mode: 'unresolved', subjectId: null, auto: false };
          }
        }
        setResolution(res);
      },
    });
  }

  function setResolutionMode(header, mode, subjectId = null) {
    setResolution((prev) => ({ ...prev, [header]: { mode, subjectId, auto: false } }));
  }

  const unresolvedCount = subjectColumns.filter((h) => resolution[h]?.mode === 'unresolved').length;

  async function handleImport() {
    if (!weekStart) {
      setStatus('Please choose a term and week first.');
      return;
    }
    if (unresolvedCount > 0) {
      setStatus(`${unresolvedCount} column(s) still need to be paired to a subject before importing.`);
      return;
    }
    setStatus('Importing...');
    const problems = [];
    let successCount = 0;

    // Cache grade boundaries per subject+year_group to avoid a query per row.
    const boundaryCache = new Map();
    async function lookupGrade(subjectId, yearGroup, score) {
      const key = `${subjectId}:${yearGroup}`;
      if (!boundaryCache.has(key)) {
        const { data } = await supabase
          .from('subject_grade_boundaries')
          .select('grade, min_score, max_score')
          .eq('subject_id', subjectId)
          .eq('year_group', yearGroup);
        boundaryCache.set(key, data || []);
      }
      const rows = boundaryCache.get(key);
      const match = rows.find((r) => score >= r.min_score && score <= r.max_score);
      return match ? match.grade : null;
    }

    // 1. Resolve subject_id for each column from the confirmed pairing —
    // no silent creation here. "existing" reuses the chosen subject and,
    // if the header text differs from that subject's stored name, saves a
    // permanent alias so the same header auto-resolves next time. "new"
    // creates a subject only because a person explicitly confirmed it.
    const subjectIdByHeader = {};
    for (const header of subjectColumns) {
      const r = resolution[header];
      const name = subjectNames[header];
      if (!r || r.mode === 'unresolved') { problems.push(`Column "${header}": not paired to a subject, skipped.`); continue; }

      if (r.mode === 'existing') {
        subjectIdByHeader[header] = r.subjectId;
        if (!r.auto) {
          const existingSubject = allSubjects.find((s) => s.subject_id === r.subjectId);
          if (existingSubject && existingSubject.subject_name !== name) {
            await supabase.from('subject_aliases').upsert([{ alias_name: name, subject_id: r.subjectId }]);
          }
        }
      } else if (r.mode === 'new') {
        const { data: created, error: createErr } = await supabase
          .from('subjects')
          .insert([{ subject_name: name }])
          .select('subject_id')
          .single();
        if (createErr) { problems.push(`Could not create subject "${name}": ${createErr.message}`); continue; }
        subjectIdByHeader[header] = created.subject_id;
      }
    }

    // 2. Build result rows: one per student per subject column with a real score
    const toUpsert = [];
    for (const [i, row] of rows.entries()) {
      const upn = (row['ID number'] || '').trim();
      if (!upn) { problems.push(`Row ${i + 2}: missing ID number, skipped.`); continue; }

      const { data: student, error: sErr } = await supabase
        .from('students')
        .select('student_id, year_group')
        .eq('upn', upn)
        .maybeSingle();

      if (sErr || !student) { problems.push(`Row ${i + 2}: no student found with ID "${upn}".`); continue; }

      for (const header of subjectColumns) {
        const subjectId = subjectIdByHeader[header];
        if (!subjectId) continue;
        const raw = (row[header] || '').trim();
        if (raw === '' || raw === '-') continue; // no result this week for this subject

        const score = Number(raw);
        if (Number.isNaN(score)) { problems.push(`Row ${i + 2}, "${header}": "${raw}" is not a number, skipped.`); continue; }

        const grade = await lookupGrade(subjectId, student.year_group, score);

        toUpsert.push({
          student_id: student.student_id,
          subject_id: subjectId,
          week_start_date: weekStart,
          score,
          max_score: 100,
          grade,
          result_type: parseResultType(header),
        });
      }
    }

    // 3. Write in batches
    const batches = chunk(toUpsert, BATCH_SIZE);
    for (const [i, batch] of batches.entries()) {
      setStatus(`Importing batch ${i + 1} of ${batches.length} (${successCount} of ${toUpsert.length} results written so far)...`);
      const { error: upErr } = await supabase
        .from('results')
        .upsert(batch, { onConflict: 'student_id,subject_id,week_start_date' });
      if (upErr) problems.push(`Batch write failed: ${upErr.message}`);
      else successCount += batch.length;
    }

    setErrors(problems);
    setStatus(`Imported ${successCount} of ${toUpsert.length} results for week ${weekStart}.${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  return (
    <div>
      <h1>Import Weekly Gradebook (CSV)</h1>

      <div className="card">
        <p>Upload the raw weekly export. Any number of subject/quiz columns is fine — they're detected automatically. Students are matched by <code>ID number</code> against each student's UPN.</p>
        <input type="file" accept=".csv" onChange={handleFile} />
      </div>

      {rows.length > 0 && (
        <div className="card">
          <h2>Week</h2>
          <label>
            Term:{' '}
            <select value={termId} onChange={(e) => setTermId(Number(e.target.value))}>
              {terms.map((t) => (
                <option key={t.term_id} value={t.term_id}>{t.term_name}</option>
              ))}
            </select>
          </label>
          {'  '}
          <label>
            Week:{' '}
            <select value={weekLabel} onChange={(e) => setWeekLabel(e.target.value)}>
              {weekOptions.map((w) => (
                <option key={w.label} value={w.label}>{w.label} ({w.date})</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {subjectColumns.length > 0 && (
        <div className="card">
          <h2>Detected subjects ({subjectColumns.length})</h2>
          <p>
            Columns that already match an existing subject are paired automatically. Anything unmatched
            needs to be paired to an existing subject or explicitly confirmed as new — nothing is created
            silently.
          </p>
          {unresolvedCount > 0 && (
            <p style={{ color: '#a33', fontWeight: 600 }}>
              {unresolvedCount} column(s) need pairing before you can import.
            </p>
          )}
          <table>
            <thead><tr><th>CSV column</th><th>Parsed name</th><th>Pairing</th></tr></thead>
            <tbody>
              {subjectColumns.map((h) => {
                const r = resolution[h] || { mode: 'unresolved' };
                return (
                  <tr key={h} style={r.mode === 'unresolved' ? { background: '#fdeaea' } : undefined}>
                    <td><code>{h}</code></td>
                    <td>{subjectNames[h]}</td>
                    <td>
                      {r.mode === 'existing' && r.auto && (
                        <span>
                          ✓ matches <strong>{allSubjects.find((s) => s.subject_id === r.subjectId)?.subject_name}</strong>
                          {' '}
                          <button className="secondary" onClick={() => setResolutionMode(h, 'unresolved')}>change</button>
                        </span>
                      )}
                      {r.mode !== 'existing' || !r.auto ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            value={r.mode === 'existing' ? r.subjectId : ''}
                            onChange={(e) => e.target.value && setResolutionMode(h, 'existing', Number(e.target.value))}
                          >
                            <option value="">-- pair to existing subject --</option>
                            {allSubjects.map((s) => (
                              <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>
                            ))}
                          </select>
                          <button
                            className="secondary"
                            onClick={() => setResolutionMode(h, 'new')}
                            style={r.mode === 'new' ? { fontWeight: 700 } : undefined}
                          >
                            {r.mode === 'new' ? '✓ ' : ''}Create new subject "{subjectNames[h]}"
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview (first 8 students)</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>{Object.keys(preview[0]).map((k) => <th key={k}>{k}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>{rows.length} students, {subjectColumns.length} subject columns detected. Written in batches of {BATCH_SIZE}.</p>
          <button onClick={handleImport} disabled={unresolvedCount > 0}>
            Import results for {selectedTerm?.term_name || '(choose term)'} — {weekLabel || '(choose week)'}
          </button>
        </div>
      )}

      {status && <p>{status}</p>}

      {errors.length > 0 && (
        <div className="card">
          <h2>Issues ({errors.length})</h2>
          <ul>
            {errors.map((e, i) => <li key={i} style={{ color: '#a3232c' }}>{e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ImportGradebookPage() {
  return <RequireAuth><ImportInner /></RequireAuth>;
}
