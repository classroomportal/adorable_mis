'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { Chip } from '../../components/MedicalChips';
import { formatUKDate } from '../../../lib/formatDate';
import { bmiBand, isoToday, studentName } from '../../../lib/medical';

// Height and weight get taken for a whole form class in one session, so
// entering them one student at a time on /students/[id] was never going to
// survive contact with the nurse. This is the round: pick a group, type
// down the list, save once.
//
// BMI is not calculated here — it is a generated column in Postgres. What
// the table shows after a save is the number the database computed, which
// is the same one every other reader gets.

function MeasurementsInner() {
  const [groups, setGroups] = useState({ forms: [], years: [] });
  const [groupType, setGroupType] = useState('form');
  const [groupValue, setGroupValue] = useState('');
  const [measuredOn, setMeasuredOn] = useState(isoToday());
  const [rows, setRows] = useState([]);       // { student, height_cm, weight_kg, saved }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('students')
        .select('form_class, year_group').eq('status', 'active');
      const forms = Array.from(new Set((data || []).map((s) => s.form_class).filter(Boolean))).sort();
      const years = Array.from(new Set((data || []).map((s) => s.year_group).filter(Boolean))).sort((a, b) => a - b);
      setGroups({ forms, years });
    })();
  }, []);

  const load = useCallback(async () => {
    if (!groupValue) { setRows([]); return; }
    setLoading(true);
    setError(null);

    let studentQuery = supabase.from('students')
      .select('student_id, first_name, last_name, year_group, form_class, dob')
      .eq('status', 'active')
      .order('last_name');
    studentQuery = groupType === 'form'
      ? studentQuery.eq('form_class', groupValue)
      : studentQuery.eq('year_group', Number(groupValue));

    const { data: studentRows, error: studentErr } = await studentQuery;
    if (studentErr) { setError(studentErr.message); setLoading(false); return; }

    const ids = (studentRows || []).map((s) => s.student_id);
    // Pre-fill anything already recorded for this date so a re-measure
    // corrects the row rather than colliding with the (student, date)
    // uniqueness constraint.
    const { data: existing, error: existingErr } = ids.length
      ? await supabase.from('student_growth_record')
          .select('student_id, height_cm, weight_kg, bmi, bmi_z')
          .eq('measured_on', measuredOn).in('student_id', ids)
      : { data: [], error: null };
    if (existingErr) { setError(existingErr.message); setLoading(false); return; }

    const byStudent = new Map((existing || []).map((m) => [m.student_id, m]));
    setRows((studentRows || []).map((s) => {
      const prior = byStudent.get(s.student_id);
      return {
        student: s,
        height_cm: prior?.height_cm ?? '',
        weight_kg: prior?.weight_kg ?? '',
        bmi: prior?.bmi ?? null,
        bmi_z: prior?.bmi_z ?? null,
      };
    }));
    setLoading(false);
  }, [groupType, groupValue, measuredOn]);

  useEffect(() => { load(); }, [load]);

  function setCell(studentId, key, value) {
    setRows((rs) => rs.map((r) => (r.student.student_id === studentId ? { ...r, [key]: value } : r)));
  }

  async function saveAll(e) {
    e.preventDefault();
    const filled = rows.filter((r) => r.height_cm !== '' || r.weight_kg !== '');
    if (filled.length === 0) { setStatus('Nothing to save — enter at least one height or weight.'); return; }
    setStatus(`Saving ${filled.length} measurement${filled.length === 1 ? '' : 's'}...`);

    const { data: userData } = await supabase.auth.getUser();
    const payload = filled.map((r) => ({
      student_id: r.student.student_id,
      measured_on: measuredOn,
      height_cm: r.height_cm === '' ? null : Number(r.height_cm),
      weight_kg: r.weight_kg === '' ? null : Number(r.weight_kg),
      recorded_by: userData?.user?.id ?? null,
    }));

    const { error: err } = await supabase.from('student_growth_measurements')
      .upsert(payload, { onConflict: 'student_id,measured_on' });
    if (err) { setStatus(`Could not save: ${err.message}`); return; }

    setStatus(`Saved ${filled.length} measurement${filled.length === 1 ? '' : 's'}.`);
    load(); // re-read so the BMI column shows what the database computed
  }

  const filledCount = rows.filter((r) => r.height_cm !== '' || r.weight_kg !== '').length;

  return (
    <main style={{ padding: '1.25rem', maxWidth: 1100, margin: '0 auto' }}>
      <a className="dashboard-back" href="/clinic">← Clinic</a>
      <h1>Height &amp; weight round</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ maxWidth: '9rem' }}>Group by
            <select value={groupType} onChange={(e) => { setGroupType(e.target.value); setGroupValue(''); }}>
              <option value="form">Form class</option>
              <option value="year">Year group</option>
            </select>
          </label>
          <label style={{ maxWidth: '11rem' }}>{groupType === 'form' ? 'Form class' : 'Year group'}
            <select value={groupValue} onChange={(e) => setGroupValue(e.target.value)}>
              <option value="">— pick one —</option>
              {groupType === 'form'
                ? groups.forms.map((f) => <option key={f} value={f}>{f}</option>)
                : groups.years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </label>
          <label style={{ maxWidth: '11rem' }}>Date measured
            <input type="date" value={measuredOn} onChange={(e) => setMeasuredOn(e.target.value)} />
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>{formatUKDate(measuredOn)}</span>
          </label>
        </div>
        {status && <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 0 }}>{status}</p>}
      </div>

      {loading && <p>Loading...</p>}
      {error && (
        <div className="card" style={{ borderColor: '#f3bcbc' }}>
          <p style={{ color: '#a3232c', margin: 0 }}>{error}</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
            If this says a relation does not exist, migration 128 has not been run against the database yet.
          </p>
        </div>
      )}

      {!loading && !error && groupValue && rows.length === 0 && (
        <div className="card"><p style={{ margin: 0 }}>No active students in that group.</p></div>
      )}

      {!loading && !error && rows.length > 0 && (
        <form onSubmit={saveAll}>
          <div className="card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Student</th><th>Form</th><th>Height (cm)</th><th>Weight (kg)</th><th>BMI on record</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const band = bmiBand(r.bmi_z);
                    return (
                      <tr key={r.student.student_id}>
                        <td><a href={`/students/${r.student.student_id}`}>{studentName(r.student)}</a></td>
                        <td>{r.student.form_class || `Y${r.student.year_group}`}</td>
                        <td>
                          <input
                            type="number" step="0.1" min="30" max="250"
                            value={r.height_cm}
                            onChange={(e) => setCell(r.student.student_id, 'height_cm', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number" step="0.1" min="5" max="250"
                            value={r.weight_kg}
                            onChange={(e) => setCell(r.student.student_id, 'weight_kg', e.target.value)}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {r.bmi ?? '—'}
                          {band && <> <Chip tone={band.tone}>{band.label}</Chip></>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <button type="submit">Save {filledCount} measurement{filledCount === 1 ? '' : 's'}</button>
              <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginLeft: '0.6rem' }}>
                Re-entering a student already measured on this date corrects that row.
              </span>
            </div>
          </div>
        </form>
      )}
    </main>
  );
}

export default function ClinicMeasurementsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/clinic/measurements">
        <MeasurementsInner />
      </RequireResource>
    </RequireAuth>
  );
}
