'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import {
  STATUS_LABELS, statusBadgeStyle, applicantName, loadAcademicYears, errorText,
} from '../../../lib/admissions';

// Admission test days (migration 256). Each day belongs to one entry year.
// Applicants whose form fee the bursar has recorded are booked onto a day
// with book_admission_test(), which also produces the test-date letter.
// Scores go into admission_test_scores (checked against the paper's maximum
// by the database) and admission_cat4; once English, Maths and CAT4 are all
// in, the database moves the applicant to 'tested' by itself.

const CAT4_FIELDS = [
  ['verbal_sas', 'Verbal'],
  ['quantitative_sas', 'Quant.'],
  ['non_verbal_sas', 'Non-verbal'],
  ['spatial_sas', 'Spatial'],
  ['mean_sas', 'Mean'],
];
const EDIT_FIELDS = ['english', 'maths', ...CAT4_FIELDS.map(([f]) => f), 'level'];
const EMPTY_SESSION = { session_id: null, session_date: '', start_time: '', venue: '', notes: '' };

const numText = (v) => (v == null ? '' : String(Number(v)));
const timeText = (t) => (t ? t.slice(0, 5) : '');

function sessionLabel(s) {
  return `${formatUKDate(s.session_date, { weekday: true })}${s.start_time ? `, ${timeText(s.start_time)}` : ''}`;
}

function SessionsInner() {
  const [years, setYears] = useState([]);
  const [yearId, setYearId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [applicants, setApplicants] = useState([]); // everyone for the entry year
  const [papers, setPapers] = useState({}); // `${yg}-${subject}` -> paper
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [sessionForm, setSessionForm] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const [originals, setOriginals] = useState({}); // applicant_id -> field -> text
  const [cat4Rows, setCat4Rows] = useState({}); // applicant_id -> admission_cat4 row
  const [summary, setSummary] = useState({}); // applicant_id -> applicant_test_summary row
  const [edits, setEdits] = useState({});
  const [gridLoading, setGridLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const [toBook, setToBook] = useState({}); // applicant_id -> true
  const [sendEmail, setSendEmail] = useState(true);
  const [booking, setBooking] = useState(false);
  const [bookResults, setBookResults] = useState(null);

  useEffect(() => {
    (async () => {
      const { years: ys, defaultYearId } = await loadAcademicYears();
      setYears(ys);
      setYearId(defaultYearId);
      if (!defaultYearId) setLoading(false);
    })();
  }, []);

  async function loadYear(id) {
    const [s, a, p] = await Promise.all([
      supabase.from('admission_sessions').select('*').eq('academic_year_id', id)
        .order('session_date').order('start_time', { nullsFirst: true }),
      supabase.from('applicants')
        .select('applicant_id, first_name, last_name, preferred_name, entry_year_group, status, session_id')
        .eq('entry_academic_year_id', id)
        .order('entry_year_group').order('last_name').order('first_name'),
      supabase.from('admission_papers').select('paper_id, year_group, subject, paper_name, max_score')
        .eq('academic_year_id', id),
    ]);
    const error = s.error || a.error || p.error;
    if (error) {
      setLoadError(errorText(error));
      setLoading(false);
      return null;
    }
    const byKey = {};
    for (const paper of p.data || []) byKey[`${paper.year_group}-${paper.subject}`] = paper;
    setLoadError(null);
    setSessions(s.data || []);
    setApplicants(a.data || []);
    setPapers(byKey);
    setLoading(false);
    return a.data || [];
  }

  useEffect(() => {
    if (!yearId) return;
    setLoading(true);
    setSelectedId(null);
    setSessionForm(null);
    setSessionStatus(null);
    loadYear(yearId);
  }, [yearId]);

  // The results already entered for everyone booked on the chosen day.
  async function loadGrid(sessionId, allApplicants, paperMap) {
    const ids = allApplicants.filter((a) => a.session_id === sessionId).map((a) => a.applicant_id);
    if (!ids.length) {
      setOriginals({}); setEdits({}); setCat4Rows({}); setSummary({});
      return;
    }
    setGridLoading(true);
    const [sc, c4, sm] = await Promise.all([
      supabase.from('admission_test_scores').select('applicant_id, paper_id, score').in('applicant_id', ids),
      supabase.from('admission_cat4').select('*').in('applicant_id', ids),
      supabase.from('applicant_test_summary').select('*').in('applicant_id', ids),
    ]);
    const error = sc.error || c4.error || sm.error;
    setGridLoading(false);
    if (error) {
      setSaveStatus({ error: true, text: `Could not load the results: ${errorText(error)}` });
      return;
    }
    const cat4 = {};
    for (const r of c4.data || []) cat4[r.applicant_id] = r;
    const sums = {};
    for (const r of sm.data || []) sums[r.applicant_id] = r;
    const orig = {};
    for (const a of allApplicants.filter((x) => ids.includes(x.applicant_id))) {
      const pe = paperMap[`${a.entry_year_group}-english`];
      const pm = paperMap[`${a.entry_year_group}-maths`];
      const scoreFor = (paper) => numText((sc.data || []).find((r) => r.applicant_id === a.applicant_id && paper && r.paper_id === paper.paper_id)?.score);
      const c = cat4[a.applicant_id] || {};
      orig[a.applicant_id] = {
        english: scoreFor(pe),
        maths: scoreFor(pm),
        verbal_sas: numText(c.verbal_sas),
        quantitative_sas: numText(c.quantitative_sas),
        non_verbal_sas: numText(c.non_verbal_sas),
        spatial_sas: numText(c.spatial_sas),
        mean_sas: numText(c.mean_sas),
        level: c.level ?? '',
      };
    }
    setOriginals(orig);
    setEdits(JSON.parse(JSON.stringify(orig)));
    setCat4Rows(cat4);
    setSummary(sums);
  }

  useEffect(() => {
    setSaveStatus(null);
    setBookResults(null);
    setToBook({});
    if (selectedId) loadGrid(selectedId, applicants, papers);
  }, [selectedId]);

  const selected = sessions.find((s) => s.session_id === selectedId);
  const year = years.find((y) => y.academic_year_id === yearId);
  const bookedCount = (id) => applicants.filter((a) => a.session_id === id).length;
  const booked = applicants.filter((a) => selectedId && a.session_id === selectedId);
  const bookable = applicants.filter((a) => a.status === 'form_paid' && !a.session_id);

  // ---- Test days ---------------------------------------------------------

  async function saveSession(ev) {
    ev.preventDefault();
    if (!sessionForm.session_date) {
      setSessionStatus({ error: true, text: 'Give the date of the test day.' });
      return;
    }
    const row = {
      session_date: sessionForm.session_date,
      start_time: sessionForm.start_time || null,
      venue: sessionForm.venue.trim() || null,
      notes: sessionForm.notes.trim() || null,
    };
    setSessionStatus({ text: 'Saving...' });
    const { error } = sessionForm.session_id
      ? await supabase.from('admission_sessions').update(row).eq('session_id', sessionForm.session_id)
      : await supabase.from('admission_sessions').insert({ ...row, academic_year_id: yearId });
    if (error) {
      setSessionStatus({ error: true, text: `Not saved: ${errorText(error)}` });
      return;
    }
    setSessionForm(null);
    setSessionStatus({ text: 'Saved.' });
    await loadYear(yearId);
  }

  async function deleteSession(s) {
    if (!window.confirm(`Delete the test day on ${sessionLabel(s)}?`)) return;
    const { error } = await supabase.from('admission_sessions').delete().eq('session_id', s.session_id);
    if (error) {
      setSessionStatus({ error: true, text: `Not deleted: ${errorText(error)}` });
      return;
    }
    if (selectedId === s.session_id) setSelectedId(null);
    setSessionStatus({ text: 'Deleted.' });
    await loadYear(yearId);
  }

  // ---- Results grid ------------------------------------------------------

  function edit(id, field, value) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setSaveStatus(null);
  }

  // Blank means "don't write", so clearing a box never removes a result.
  function changedFields(id) {
    const e = edits[id];
    const o = originals[id];
    if (!e || !o) return [];
    return EDIT_FIELDS.filter((f) => e[f].trim() !== '' && e[f].trim() !== o[f]);
  }

  const changedIds = booked.map((a) => a.applicant_id).filter((id) => changedFields(id).length);

  async function saveAll() {
    const scoreRows = [];
    const cat4Upserts = [];
    const problems = [];
    for (const a of booked) {
      const changed = changedFields(a.applicant_id);
      if (!changed.length) continue;
      const e = edits[a.applicant_id];
      const name = applicantName(a);
      for (const subject of ['english', 'maths']) {
        if (!changed.includes(subject)) continue;
        const paper = papers[`${a.entry_year_group}-${subject}`];
        const label = subject === 'english' ? 'English' : 'Maths';
        const score = Number(e[subject]);
        if (!paper) { problems.push(`${name}: no Year ${a.entry_year_group} ${label} paper is set up.`); continue; }
        if (!Number.isFinite(score) || score < 0) { problems.push(`${name}: the ${label} score must be a number.`); continue; }
        if (score > Number(paper.max_score)) {
          problems.push(`${name}: ${label} ${score} is more than the paper's maximum of ${numText(paper.max_score)}.`);
          continue;
        }
        scoreRows.push({ applicant_id: a.applicant_id, paper_id: paper.paper_id, score });
      }
      const cat4Changed = changed.filter((f) => f !== 'english' && f !== 'maths');
      if (cat4Changed.length) {
        const old = cat4Rows[a.applicant_id] || {};
        const row = {
          applicant_id: a.applicant_id,
          test_date: old.test_date ?? selected.session_date,
          level: cat4Changed.includes('level') ? e.level.trim() : (old.level ?? null),
        };
        let ok = true;
        for (const [f, label] of CAT4_FIELDS) {
          if (!cat4Changed.includes(f)) { row[f] = old[f] ?? null; continue; }
          const v = Number(e[f]);
          if (!Number.isFinite(v) || v < 0 || v > 200) {
            problems.push(`${name}: CAT4 ${label} SAS must be a number (SAS scores run from about 60 to 141).`);
            ok = false;
          }
          row[f] = Math.round(v * 10) / 10;
        }
        if (ok) cat4Upserts.push(row);
      }
    }
    if (problems.length) {
      setSaveStatus({ error: true, text: `Nothing saved. ${problems.join(' ')}` });
      return;
    }
    if (!scoreRows.length && !cat4Upserts.length) return;

    setSaveStatus({ text: 'Saving...' });
    if (scoreRows.length) {
      const { error } = await supabase.from('admission_test_scores').upsert(scoreRows, { onConflict: 'applicant_id,paper_id' });
      if (error) { setSaveStatus({ error: true, text: `Scores not saved: ${errorText(error)}` }); return; }
    }
    if (cat4Upserts.length) {
      const { error } = await supabase.from('admission_cat4').upsert(cat4Upserts, { onConflict: 'applicant_id' });
      if (error) {
        const scoresNote = scoreRows.length ? 'English and Maths scores were saved, but ' : '';
        setSaveStatus({ error: true, text: `${scoresNote}CAT4 not saved: ${errorText(error)}` });
        const fresh = await loadYear(yearId);
        if (fresh) await loadGrid(selectedId, fresh, papers);
        return;
      }
    }
    const fresh = await loadYear(yearId);
    if (fresh) await loadGrid(selectedId, fresh, papers);
    setSaveStatus({ text: `Saved results for ${changedIds.length} applicant${changedIds.length === 1 ? '' : 's'}.` });
  }

  // ---- Booking -----------------------------------------------------------

  async function bookSelected() {
    const chosen = bookable.filter((a) => toBook[a.applicant_id]);
    if (!chosen.length) return;
    setBooking(true);
    const results = [];
    for (const a of chosen) {
      const { data, error } = await supabase.rpc('book_admission_test', {
        p_applicant_id: a.applicant_id, p_session_id: selectedId, p_send_email: sendEmail,
      });
      if (error) {
        results.push({ id: a.applicant_id, name: applicantName(a), error: true, text: errorText(error) });
      } else {
        const parts = ['Booked.'];
        if (data?.emailed_to) parts.push(`Letter emailed to ${data.emailed_to}.`);
        else if (data?.letter_id) parts.push('Letter produced (not emailed).');
        if (data?.note) parts.push(data.note);
        results.push({ id: a.applicant_id, name: applicantName(a), text: parts.join(' ') });
      }
    }
    setBooking(false);
    setToBook({});
    const fresh = await loadYear(yearId);
    if (fresh) await loadGrid(selectedId, fresh, papers);
    setBookResults(results);
  }

  // ---- Rendering ---------------------------------------------------------

  const small = { padding: '0.3rem 0.4rem', fontSize: '0.9rem' };
  const groups = [...new Set(booked.map((a) => a.entry_year_group))].sort((x, y) => x - y);
  const printRows = booked.filter((a) => a.status !== 'withdrawn');

  function scoreCell(a, subject) {
    const paper = papers[`${a.entry_year_group}-${subject}`];
    const label = subject === 'english' ? 'English' : 'Maths';
    if (!paper) {
      return <Link href="/admissions/papers" style={{ fontSize: '0.85em' }}>set up paper</Link>;
    }
    const e = edits[a.applicant_id]?.[subject] ?? '';
    const s = summary[a.applicant_id];
    const pct = s?.[`${subject}_pct`];
    const tooHigh = e.trim() !== '' && Number(e) > Number(paper.max_score);
    return (
      <div style={{ whiteSpace: 'nowrap' }}>
        <input
          type="number" min="0" max={Number(paper.max_score)} step="0.5"
          value={e}
          onChange={(ev) => edit(a.applicant_id, subject, ev.target.value)}
          aria-label={`${label} score for ${applicantName(a)}`}
          style={{ ...small, width: '4.5rem', borderColor: tooHigh ? '#a3232c' : undefined }}
        />
        <span style={{ color: '#666' }}> / {numText(paper.max_score)}</span>
        {pct != null && <div style={{ fontSize: '0.8em', color: '#555' }}>{Number(pct)}%</div>}
      </div>
    );
  }

  function meanHint(e) {
    const vals = ['verbal_sas', 'quantitative_sas', 'non_verbal_sas', 'spatial_sas'].map((f) => e?.[f]?.trim());
    if (vals.some((v) => !v || !Number.isFinite(Number(v)))) return '';
    return String(Math.round((vals.reduce((sum, v) => sum + Number(v), 0) / 4) * 10) / 10);
  }

  function averageCell(a) {
    const s = summary[a.applicant_id];
    if (!s || s.average_pct == null) return <span style={{ color: '#999' }}>—</span>;
    const passed = s.passed;
    return (
      <div style={{ whiteSpace: 'nowrap' }}>
        <strong>{Number(s.average_pct)}%</strong>
        <div>
          <span className={`badge ${passed ? 'badge-positive' : 'badge-negative'}`}>
            {passed ? 'Pass' : 'Below'} ({Number(s.pass_mark)}%)
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        .adm-print-sheet { display: none; }
        @media print {
          .adm-screen { display: none !important; }
          .adm-print-sheet { display: block !important; }
          .adm-print-sheet table { width: 100%; border-collapse: collapse; }
          .adm-print-sheet th, .adm-print-sheet td { border: 1px solid #000; padding: 6px; font-size: 10.5pt; text-align: left; background: none; color: #000; }
          .adm-print-sheet h2 { font-size: 13pt; margin: 0 0 4px; }
          .adm-print-sheet p { font-size: 10pt; margin: 0 0 8px; }
        }
      `}</style>

      <div className="adm-screen">
        <h1>Test Days</h1>
        <p>
          Admission test days for an entry year. Book children onto a day once the bursar has recorded their
          admission form fee, then enter their English, Maths and CAT4 results after the test. A child is marked as
          tested automatically once all three are in.
        </p>

        <div className="card">
          <label style={{ maxWidth: '14rem' }}>
            Entry year
            <select value={yearId ?? ''} onChange={(ev) => setYearId(Number(ev.target.value))}>
              {years.map((y) => (
                <option key={y.academic_year_id} value={y.academic_year_id}>
                  {y.label}{y.status === 'planning' ? ' (next year)' : y.status === 'current' ? ' (this year)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? <p>Loading...</p> : loadError ? <p style={{ color: '#a3232c' }}>Could not load: {loadError}</p> : (
          <>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 style={{ margin: 0 }}>Test days for {year?.label} entry</h2>
                {!sessionForm && (
                  <button type="button" onClick={() => { setSessionForm(EMPTY_SESSION); setSessionStatus(null); }}>+ Add test day</button>
                )}
              </div>

              {sessionForm && (
                <form onSubmit={saveSession} style={{ marginTop: '1rem' }}>
                  <label style={{ flex: '0 1 11rem' }}>
                    Date
                    <input type="date" value={sessionForm.session_date} onChange={(ev) => setSessionForm({ ...sessionForm, session_date: ev.target.value })} />
                    {sessionForm.session_date && <span style={{ fontSize: '0.8em' }}>{formatUKDate(sessionForm.session_date, { weekday: true })}</span>}
                  </label>
                  <label style={{ flex: '0 1 8rem' }}>
                    Start time
                    <input type="time" value={sessionForm.start_time} onChange={(ev) => setSessionForm({ ...sessionForm, start_time: ev.target.value })} />
                  </label>
                  <label style={{ flex: '1 1 12rem' }}>
                    Venue
                    <input value={sessionForm.venue} onChange={(ev) => setSessionForm({ ...sessionForm, venue: ev.target.value })} />
                  </label>
                  <label style={{ flex: '2 1 16rem' }}>
                    Notes
                    <input value={sessionForm.notes} onChange={(ev) => setSessionForm({ ...sessionForm, notes: ev.target.value })} />
                  </label>
                  <button type="submit">{sessionForm.session_id ? 'Save changes' : 'Add test day'}</button>
                  <button type="button" className="secondary" onClick={() => setSessionForm(null)}>Cancel</button>
                </form>
              )}
              {sessionStatus && (
                <p style={{ color: sessionStatus.error ? '#a3232c' : undefined }}>{sessionStatus.text}</p>
              )}

              {!sessions.length ? <p>No test days set up for {year?.label} entry yet.</p> : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Date</th><th>Time</th><th>Venue</th><th>Notes</th><th>Booked</th><th /></tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => {
                        const n = bookedCount(s.session_id);
                        const isSel = s.session_id === selectedId;
                        return (
                          <tr key={s.session_id} style={isSel ? { background: '#eef3fb' } : undefined}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(s.session_date, { weekday: true })}</td>
                            <td>{timeText(s.start_time)}</td>
                            <td>{s.venue}</td>
                            <td>{s.notes}</td>
                            <td style={{ textAlign: 'center' }}>{n}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button type="button" style={small} onClick={() => setSelectedId(isSel ? null : s.session_id)}>
                                {isSel ? 'Close' : 'Open'}
                              </button>{' '}
                              <button type="button" className="secondary" style={small}
                                onClick={() => {
                                  setSessionStatus(null);
                                  setSessionForm({
                                    session_id: s.session_id, session_date: s.session_date,
                                    start_time: timeText(s.start_time), venue: s.venue ?? '', notes: s.notes ?? '',
                                  });
                                }}>
                                Edit
                              </button>{' '}
                              <button type="button" className="secondary" style={small} onClick={() => deleteSession(s)}
                                title={n ? 'Children are booked on this day, so it can’t be deleted.' : undefined}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {selected && (
              <>
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h2 style={{ margin: 0 }}>
                      {sessionLabel(selected)}{selected.venue ? ` — ${selected.venue}` : ''}
                    </h2>
                    <button type="button" className="secondary" onClick={() => window.print()} disabled={!printRows.length}>
                      Print list
                    </button>
                  </div>
                  {selected.notes && <p style={{ color: '#555' }}>{selected.notes}</p>}

                  {gridLoading ? <p>Loading results...</p> : !booked.length ? (
                    <p>Nobody is booked on this day yet.</p>
                  ) : (
                    <>
                      <p style={{ color: '#666', fontSize: '0.9em' }}>
                        Enter marks as they come in; a blank box is left as it is. The average and pass/below are
                        worked out once English and Maths are both saved.
                      </p>
                      {groups.map((yg) => (
                        <div key={yg} style={{ marginTop: '1.25rem' }}>
                          <h3 style={{ margin: 0 }}>Year {yg}</h3>
                          <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Year</th>
                                  <th>English</th>
                                  <th>Maths</th>
                                  {CAT4_FIELDS.map(([f, label]) => <th key={f}>CAT4 {label}</th>)}
                                  <th>Level</th>
                                  <th>Average</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {booked.filter((a) => a.entry_year_group === yg).map((a) => {
                                  const e = edits[a.applicant_id] || {};
                                  const changed = changedFields(a.applicant_id).length > 0;
                                  return (
                                    <tr key={a.applicant_id} style={{
                                      ...(a.status === 'withdrawn' ? { opacity: 0.5 } : {}),
                                      ...(changed ? { background: '#fffbe6' } : {}),
                                    }}>
                                      <td><Link href={`/admissions/${a.applicant_id}`}>{applicantName(a)}</Link></td>
                                      <td>{a.entry_year_group}</td>
                                      <td>{scoreCell(a, 'english')}</td>
                                      <td>{scoreCell(a, 'maths')}</td>
                                      {CAT4_FIELDS.map(([f, label]) => (
                                        <td key={f}>
                                          <input
                                            type="number" min="0" step="0.1"
                                            value={e[f] ?? ''}
                                            placeholder={f === 'mean_sas' ? meanHint(e) : ''}
                                            title={f === 'mean_sas' && meanHint(e) ? `Average of the four: ${meanHint(e)}` : undefined}
                                            onChange={(ev) => edit(a.applicant_id, f, ev.target.value)}
                                            aria-label={`CAT4 ${label} SAS for ${applicantName(a)}`}
                                            style={{ ...small, width: '4.5rem' }}
                                          />
                                        </td>
                                      ))}
                                      <td>
                                        <input
                                          value={e.level ?? ''}
                                          onChange={(ev) => edit(a.applicant_id, 'level', ev.target.value)}
                                          aria-label={`CAT4 level for ${applicantName(a)}`}
                                          style={{ ...small, width: '3.5rem' }}
                                        />
                                      </td>
                                      <td>{averageCell(a)}</td>
                                      <td>
                                        <span className="badge" style={statusBadgeStyle(a.status)}>{STATUS_LABELS[a.status] || a.status}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                      <p style={{ marginTop: '1rem' }}>
                        <button type="button" onClick={saveAll} disabled={!changedIds.length}>
                          Save all{changedIds.length ? ` (${changedIds.length} changed)` : ''}
                        </button>
                        {saveStatus && (
                          <span style={{ marginLeft: '0.75rem', color: saveStatus.error ? '#a3232c' : undefined }}>{saveStatus.text}</span>
                        )}
                      </p>
                    </>
                  )}
                  {!booked.length && saveStatus && (
                    <p style={{ color: saveStatus.error ? '#a3232c' : undefined }}>{saveStatus.text}</p>
                  )}
                </div>

                <div className="card">
                  <h2 style={{ marginTop: 0 }}>Book applicants onto this day</h2>
                  <p style={{ color: '#666', marginTop: 0 }}>
                    Children for {year?.label} entry whose admission form has been paid for and who aren&apos;t booked
                    on a test day yet. Children already booked on another day aren&apos;t listed.
                  </p>
                  {!bookable.length ? <p>Nobody is waiting for a test date.</p> : (
                    <>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={bookable.every((a) => toBook[a.applicant_id])}
                          onChange={(ev) => setToBook(ev.target.checked ? Object.fromEntries(bookable.map((a) => [a.applicant_id, true])) : {})}
                        />
                        <strong>Select all ({bookable.length})</strong>
                      </label>
                      {bookable.map((a) => (
                        <label className="checkbox-row" key={a.applicant_id}>
                          <input
                            type="checkbox"
                            checked={!!toBook[a.applicant_id]}
                            onChange={(ev) => setToBook((prev) => ({ ...prev, [a.applicant_id]: ev.target.checked }))}
                          />
                          <span>{applicantName(a)} <span style={{ color: '#666' }}>— Year {a.entry_year_group}</span></span>
                        </label>
                      ))}
                      <hr style={{ margin: '0.75rem 0', border: 'none', borderTop: '1px solid var(--slate-200)' }} />
                      <label className="checkbox-row">
                        <input type="checkbox" checked={sendEmail} onChange={(ev) => setSendEmail(ev.target.checked)} />
                        Email the test-date letter to each family
                      </label>
                      <p style={{ color: '#666', fontSize: '0.85em', margin: '0.25rem 0 0.75rem' }}>
                        The letter is kept on the child&apos;s record either way, so it can be printed. If the
                        test-date letter hasn&apos;t been set up yet, children are booked without one.
                      </p>
                      <button type="button" onClick={bookSelected}
                        disabled={booking || !bookable.some((a) => toBook[a.applicant_id])}>
                        {booking ? 'Booking...' : `Book ${bookable.filter((a) => toBook[a.applicant_id]).length || ''} onto ${formatUKDate(selected.session_date)}`}
                      </button>
                    </>
                  )}
                  {bookResults && (
                    <ul style={{ marginTop: '1rem' }}>
                      {bookResults.map((r) => (
                        <li key={r.id} style={{ color: r.error ? '#a3232c' : undefined }}>
                          <strong>{r.name}:</strong> {r.error ? `Not booked: ${r.text}` : r.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {selected && (
        <div className="adm-print-sheet">
          <h2>Admission test — {sessionLabel(selected)}{selected.venue ? `, ${selected.venue}` : ''}</h2>
          <p>{year?.label} entry · {printRows.length} candidate{printRows.length === 1 ? '' : 's'}</p>
          <table>
            <thead>
              <tr>
                <th style={{ width: '2rem' }}>#</th>
                <th>Name</th>
                <th>Year group</th>
                <th style={{ width: '4.5rem' }}>Present</th>
                <th style={{ width: '5rem' }}>English</th>
                <th style={{ width: '5rem' }}>Maths</th>
                <th style={{ width: '5rem' }}>CAT4</th>
                <th style={{ width: '12rem' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((a, i) => (
                <tr key={a.applicant_id}>
                  <td>{i + 1}</td>
                  <td>{a.last_name}, {a.first_name}{a.preferred_name && a.preferred_name !== a.first_name ? ` (${a.preferred_name})` : ''}</td>
                  <td>Year {a.entry_year_group}</td>
                  <td /><td /><td /><td /><td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdmissionSessionsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admissions/sessions">
        <SessionsInner />
      </RequireResource>
    </RequireAuth>
  );
}
