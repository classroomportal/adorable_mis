'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { Chip, Stat, Field } from '../../components/MedicalChips';
import StudentFilterBar, { useStudentFilterOptions, StudentPhoto } from '../../components/StudentFilterBar';
import { formatUKDate } from '../../../lib/formatDate';
import {
  SCREENING_SYSTEMS, FINDING_STATUSES, FITNESS_STATUSES, MALARIA_RESULTS,
  SCREENING_TYPES, fitnessTone, labelFor, matchesStudentFilter,
  EMPTY_STUDENT_FILTER, isoToday, studentName, bmiBand,
} from '../../../lib/medical';

// The resumption medical check: the form a boarder comes back with, and the
// examination the nurse does on arrival. One screening per student per term.
//
// Height and weight are edited here but stored in
// student_growth_measurements, where BMI is a generated column — so there is
// never a second, disagreeing height for the same child on the same day.

// Photos total ~7 MB across the roster, so they are fetched only for the
// students actually on screen and kept in a cache as the filter changes.
const PAGE_SIZE = 60;

const SCREENING_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'not_started', label: 'Not screened yet' },
  { value: 'pending', label: 'Started, not concluded' },
  { value: 'fit', label: 'Fit to resume' },
  { value: 'attention', label: 'Needs attention' },
];

function emptyScreening(termId) {
  return {
    term_id: termId, screening_type: 'resumption', screened_on: isoToday(),
    temperature_c: '', pulse_bpm: '', respiratory_rate: '', bp_systolic: '', bp_diastolic: '',
    pcv_percent: '', malaria_test: 'not_done', urinalysis: '', other_tests: '',
    parent_form_received: false, holiday_illness: '', current_medication: '',
    medication_handed_in: false, medication_handed_in_detail: '',
    allergies_confirmed: false, blood_group_confirmed: false, genotype_confirmed: false,
    immunisations_up_to_date: false,
    fitness: 'pending', restrictions: '', referral_needed: false, referral_detail: '',
    recommendations: '', notes: '',
  };
}

function ScreeningsInner() {
  const options = useStudentFilterOptions();
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [roster, setRoster] = useState([]);
  const [screenings, setScreenings] = useState({});     // student_id -> screening row
  const [photos, setPhotos] = useState({});             // student_id -> base64
  const [filter, setFilter] = useState({ ...EMPTY_STUDENT_FILTER });
  const [screeningStatus, setScreeningStatus] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [openStudent, setOpenStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('terms').select('term_id, term_name, start_date, end_date').order('start_date', { ascending: false });
      setTerms(data || []);
      const today = isoToday();
      const current = (data || []).find((t) => today >= t.start_date && today <= t.end_date);
      setTermId(String(current?.term_id ?? data?.[0]?.term_id ?? ''));
    })();
  }, []);

  const loadRoster = useCallback(async () => {
    if (!termId) return;
    setLoading(true);
    const [studentsRes, screeningsRes] = await Promise.all([
      supabase.from('students')
        .select('student_id, first_name, last_name, year_group, form_class, gender, boarding_house, dob, admission_number')
        .eq('status', 'active').order('last_name'),
      supabase.from('student_medical_screenings')
        .select('*').eq('term_id', Number(termId)).eq('screening_type', 'resumption'),
    ]);
    const firstError = [studentsRes, screeningsRes].find((r) => r.error);
    if (firstError) { setError(firstError.error.message); setLoading(false); return; }
    setError(null);
    setRoster(studentsRes.data || []);
    setScreenings(Object.fromEntries((screeningsRes.data || []).map((s) => [s.student_id, s])));
    setLoading(false);
  }, [termId]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  const filtered = useMemo(() => roster.filter((s) => {
    if (!matchesStudentFilter(s, filter)) return false;
    const sc = screenings[s.student_id];
    if (screeningStatus === 'not_started') return !sc;
    if (screeningStatus === 'pending') return sc && sc.fitness === 'pending';
    if (screeningStatus === 'fit') return sc && sc.fitness === 'fit';
    if (screeningStatus === 'attention') {
      return sc && (sc.fitness === 'not_fit' || sc.fitness === 'fit_with_restrictions' || sc.referral_needed);
    }
    return true;
  }), [roster, filter, screenings, screeningStatus]);

  useEffect(() => { setVisible(PAGE_SIZE); }, [filter, screeningStatus, termId]);

  // Fetch photos for whoever is on screen, once each.
  const onScreen = filtered.slice(0, visible);
  useEffect(() => {
    const missing = onScreen.map((s) => s.student_id).filter((id) => !(id in photos));
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase.from('students').select('student_id, photo_base64').in('student_id', missing.slice(0, 80));
      setPhotos((p) => ({
        ...p,
        ...Object.fromEntries(missing.slice(0, 80).map((id) => [id, null])),
        ...Object.fromEntries((data || []).map((r) => [r.student_id, r.photo_base64])),
      }));
    })();
  }, [onScreen, photos]);

  const counts = useMemo(() => {
    const done = roster.filter((s) => screenings[s.student_id]).length;
    const fit = roster.filter((s) => screenings[s.student_id]?.fitness === 'fit').length;
    const attention = roster.filter((s) => {
      const sc = screenings[s.student_id];
      return sc && (sc.fitness === 'not_fit' || sc.fitness === 'fit_with_restrictions' || sc.referral_needed);
    }).length;
    return { done, outstanding: roster.length - done, fit, attention };
  }, [roster, screenings]);

  if (openStudent) {
    return (
      <ScreeningForm
        student={openStudent}
        photo={photos[openStudent.student_id]}
        termId={Number(termId)}
        termName={terms.find((t) => String(t.term_id) === String(termId))?.term_name}
        existing={screenings[openStudent.student_id] || null}
        onClose={() => setOpenStudent(null)}
        onSaved={() => { setOpenStudent(null); loadRoster(); }}
      />
    );
  }

  return (
    <main style={{ padding: '1.25rem', maxWidth: 1200, margin: '0 auto' }}>
      <a className="dashboard-back" href="/clinic">← Clinic</a>
      <h1>Resumption medical screening</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
        The medical form each boarder returns with, and the check done on arrival. One screening per student per term.
      </p>

      <div className="card">
        <label style={{ maxWidth: '16rem' }}>Term
          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.map((t) => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
          </select>
        </label>
      </div>

      {!loading && !error && (
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <Stat label="Screened" value={counts.done} sub={`of ${roster.length}`} />
          <Stat label="Outstanding" value={counts.outstanding} />
          <Stat label="Fit to resume" value={counts.fit} />
          <Stat label="Needs attention" value={counts.attention} sub="restricted, not fit or referred" />
        </div>
      )}

      <StudentFilterBar
        filter={filter}
        onChange={setFilter}
        options={options}
        resultCount={filtered.length}
        totalCount={roster.length}
        extra={
          <label style={{ maxWidth: '12rem' }}>Screening
            <select value={screeningStatus} onChange={(e) => setScreeningStatus(e.target.value)}>
              {SCREENING_STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        }
      />

      {loading && <p>Loading...</p>}
      {error && (
        <div className="card" style={{ borderColor: '#f3bcbc' }}>
          <p style={{ color: '#a3232c', margin: 0 }}>{error}</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
            If this says a relation does not exist, migration 130 has not been run against the database yet.
          </p>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="student-card-grid">
            {onScreen.map((s) => {
              const sc = screenings[s.student_id];
              const fit = FITNESS_STATUSES.find((f) => f.value === sc?.fitness);
              return (
                <button
                  key={s.student_id}
                  type="button"
                  className="student-card"
                  onClick={() => setOpenStudent(s)}
                >
                  <StudentPhoto student={{ ...s, photo_base64: photos[s.student_id] }} size={54} />
                  <div style={{ minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{studentName(s)}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
                      {s.form_class || `Year ${s.year_group}`}{s.boarding_house ? ` · ${s.boarding_house}` : ''}
                    </div>
                    <div style={{ marginTop: '0.35rem' }}>
                      {sc
                        ? <Chip tone={fit?.tone || 'neutral'}>{fit?.label || sc.fitness}</Chip>
                        : <Chip tone="warn">Not screened</Chip>}
                      {sc?.referral_needed && <Chip tone="bad">Referral</Chip>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="card"><p style={{ margin: 0 }}>No students match these filters.</p></div>
          )}

          {filtered.length > visible && (
            <div style={{ marginTop: '0.9rem' }}>
              <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, filtered.length - visible)} more ({filtered.length - visible} left)
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function ScreeningForm({ student, photo, termId, termName, existing, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...emptyScreening(termId), ...(existing || {}) }));
  const [findings, setFindings] = useState({});   // system key -> { status, note }
  const [growth, setGrowth] = useState({ height_cm: '', weight_kg: '', bmi: null, bmi_z: null });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    (async () => {
      setLoading(true);
      const blank = Object.fromEntries(SCREENING_SYSTEMS.map((s) => [s.key, { status: 'not_examined', note: '' }]));

      if (existing) {
        const { data } = await supabase.from('student_screening_findings')
          .select('system, status, note').eq('screening_id', existing.screening_id);
        (data || []).forEach((f) => { blank[f.system] = { status: f.status, note: f.note || '' }; });
      }
      setFindings(blank);

      // Height/weight live in the growth record, keyed on the screening date.
      const { data: g } = await supabase.from('student_growth_record')
        .select('height_cm, weight_kg, bmi, bmi_z')
        .eq('student_id', student.student_id)
        .eq('measured_on', existing?.screened_on || isoToday())
        .maybeSingle();
      setGrowth({
        height_cm: g?.height_cm ?? '', weight_kg: g?.weight_kg ?? '',
        bmi: g?.bmi ?? null, bmi_z: g?.bmi_z ?? null,
      });
      setLoading(false);
    })();
  }, [existing, student.student_id]);

  const draftBmi = (() => {
    const h = Number(growth.height_cm); const w = Number(growth.weight_kg);
    if (!h || !w || h <= 0) return null;
    return (w / ((h / 100) ** 2)).toFixed(2);
  })();

  const numeric = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

  async function save(e) {
    e.preventDefault();
    setStatus('Saving...');
    const { data: userData } = await supabase.auth.getUser();

    const payload = {
      student_id: student.student_id,
      term_id: termId,
      screening_type: form.screening_type,
      screened_on: form.screened_on,
      temperature_c: numeric(form.temperature_c),
      pulse_bpm: numeric(form.pulse_bpm),
      respiratory_rate: numeric(form.respiratory_rate),
      bp_systolic: numeric(form.bp_systolic),
      bp_diastolic: numeric(form.bp_diastolic),
      pcv_percent: numeric(form.pcv_percent),
      malaria_test: form.malaria_test || null,
      urinalysis: form.urinalysis || null,
      other_tests: form.other_tests || null,
      parent_form_received: form.parent_form_received,
      holiday_illness: form.holiday_illness || null,
      current_medication: form.current_medication || null,
      medication_handed_in: form.medication_handed_in,
      medication_handed_in_detail: form.medication_handed_in_detail || null,
      allergies_confirmed: form.allergies_confirmed,
      blood_group_confirmed: form.blood_group_confirmed,
      genotype_confirmed: form.genotype_confirmed,
      immunisations_up_to_date: form.immunisations_up_to_date,
      fitness: form.fitness,
      restrictions: form.restrictions || null,
      referral_needed: form.referral_needed,
      referral_detail: form.referral_detail || null,
      recommendations: form.recommendations || null,
      notes: form.notes || null,
      screened_by: userData?.user?.id ?? null,
    };

    const { data: saved, error: saveErr } = await supabase
      .from('student_medical_screenings')
      .upsert(payload, { onConflict: 'student_id,term_id,screening_type' })
      .select('screening_id')
      .single();
    if (saveErr) { setStatus(`Could not save: ${saveErr.message}`); return; }

    // Only systems actually examined are stored — 'not_examined' rows would
    // be noise, and their absence says the same thing.
    const rows = SCREENING_SYSTEMS
      .filter((s) => findings[s.key]?.status !== 'not_examined' || findings[s.key]?.note)
      .map((s) => ({
        screening_id: saved.screening_id,
        system: s.key,
        status: findings[s.key].status,
        note: findings[s.key].note || null,
      }));
    if (rows.length) {
      const { error: findErr } = await supabase.from('student_screening_findings')
        .upsert(rows, { onConflict: 'screening_id,system' });
      if (findErr) { setStatus(`Screening saved, but findings did not: ${findErr.message}`); return; }
    }

    // Height/weight go to the growth record so BMI stays the database's.
    if (growth.height_cm !== '' || growth.weight_kg !== '') {
      const { error: growthErr } = await supabase.from('student_growth_measurements').upsert({
        student_id: student.student_id,
        measured_on: form.screened_on,
        height_cm: numeric(growth.height_cm),
        weight_kg: numeric(growth.weight_kg),
        recorded_by: userData?.user?.id ?? null,
      }, { onConflict: 'student_id,measured_on' });
      if (growthErr) { setStatus(`Screening saved, but height/weight did not: ${growthErr.message}`); return; }
    }

    setStatus('Saved.');
    onSaved();
  }

  const band = bmiBand(growth.bmi_z);
  const abnormal = SCREENING_SYSTEMS.filter((s) => findings[s.key]?.status === 'abnormal');

  return (
    <main style={{ padding: '1.25rem', maxWidth: 1100, margin: '0 auto' }}>
      <button type="button" className="dashboard-back" onClick={onClose}>← Back to the list</button>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <StudentPhoto student={{ ...student, photo_base64: photo }} size={96} />
          <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
            <h1 style={{ margin: 0 }}>{studentName(student)}</h1>
            <p style={{ margin: '0.25rem 0', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
              {student.form_class || `Year ${student.year_group}`}
              {student.boarding_house ? ` · ${student.boarding_house}` : ''}
              {student.gender ? ` · ${student.gender}` : ''}
              {student.dob ? ` · born ${formatUKDate(student.dob)}` : ''}
              {student.admission_number ? ` · ${student.admission_number}` : ''}
            </p>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              <strong>{termName}</strong> · {existing ? `screened ${formatUKDate(existing.screened_on)}` : 'not yet screened'}
              {' '}<a href={`/students/${student.student_id}`}>Full record →</a>
            </p>
          </div>
        </div>
        {status && <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: 0 }}>{status}</p>}
      </div>

      {loading ? <p>Loading...</p> : (
        <form onSubmit={save}>
          <div className="card">
            <h2>Measurements &amp; vitals</h2>
            <div className="form-grid">
              <Field label="Date screened">
                <input type="date" value={form.screened_on} onChange={(e) => set({ screened_on: e.target.value })} />
              </Field>
              <Field label="Screening type">
                <select value={form.screening_type} onChange={(e) => set({ screening_type: e.target.value })}>
                  {SCREENING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Height (cm)">
                <input type="number" step="0.1" min="30" max="250" value={growth.height_cm}
                       onChange={(e) => setGrowth({ ...growth, height_cm: e.target.value })} />
              </Field>
              <Field label="Weight (kg)">
                <input type="number" step="0.1" min="5" max="250" value={growth.weight_kg}
                       onChange={(e) => setGrowth({ ...growth, weight_kg: e.target.value })} />
              </Field>
              <Field label="Temperature (°C)">
                <input type="number" step="0.1" min="30" max="45" value={form.temperature_c ?? ''}
                       onChange={(e) => set({ temperature_c: e.target.value })} />
              </Field>
              <Field label="Pulse (bpm)">
                <input type="number" min="20" max="250" value={form.pulse_bpm ?? ''} onChange={(e) => set({ pulse_bpm: e.target.value })} />
              </Field>
              <Field label="Respiratory rate">
                <input type="number" min="5" max="90" value={form.respiratory_rate ?? ''} onChange={(e) => set({ respiratory_rate: e.target.value })} />
              </Field>
              <Field label="BP systolic">
                <input type="number" min="50" max="260" value={form.bp_systolic ?? ''} onChange={(e) => set({ bp_systolic: e.target.value })} />
              </Field>
              <Field label="BP diastolic">
                <input type="number" min="30" max="180" value={form.bp_diastolic ?? ''} onChange={(e) => set({ bp_diastolic: e.target.value })} />
              </Field>
              <Field label="PCV (%)">
                <input type="number" step="0.1" min="5" max="70" value={form.pcv_percent ?? ''} onChange={(e) => set({ pcv_percent: e.target.value })} />
              </Field>
              <Field label="Malaria test">
                <select value={form.malaria_test || 'not_done'} onChange={(e) => set({ malaria_test: e.target.value })}>
                  {MALARIA_RESULTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Urinalysis">
                <input value={form.urinalysis ?? ''} onChange={(e) => set({ urinalysis: e.target.value })} />
              </Field>
              <Field label="Other tests">
                <input value={form.other_tests ?? ''} onChange={(e) => set({ other_tests: e.target.value })} />
              </Field>
            </div>
            <p style={{ fontSize: '0.9rem', margin: '0.4rem 0 0' }}>
              <strong>BMI:</strong> {draftBmi ?? growth.bmi ?? '—'}
              {band && <> <Chip tone={band.tone}>{band.label}</Chip></>}
              <span style={{ color: 'var(--ink-soft)', fontSize: '0.75rem' }}>
                {' '}— height and weight are saved to the growth record, where the database calculates BMI
              </span>
            </p>
          </div>

          <div className="card">
            <h2>Form from home &amp; medication</h2>
            <div className="form-grid">
              <Field label="Any illness over the holiday">
                <textarea rows={2} style={{ width: '100%' }} value={form.holiday_illness ?? ''} onChange={(e) => set({ holiday_illness: e.target.value })} />
              </Field>
              <Field label="Medication currently taken">
                <textarea rows={2} style={{ width: '100%' }} value={form.current_medication ?? ''} onChange={(e) => set({ current_medication: e.target.value })} />
              </Field>
              <Field label="Medication handed in — what and how much">
                <textarea rows={2} style={{ width: '100%' }} value={form.medication_handed_in_detail ?? ''} onChange={(e) => set({ medication_handed_in_detail: e.target.value })} />
              </Field>
            </div>
            <div className="check-grid">
              {[
                ['parent_form_received', 'Medical form from home received'],
                ['medication_handed_in', 'Medication surrendered to the sick bay'],
                ['allergies_confirmed', 'Allergies confirmed with the student'],
                ['blood_group_confirmed', 'Blood group confirmed'],
                ['genotype_confirmed', 'Genotype confirmed'],
                ['immunisations_up_to_date', 'Immunisations up to date'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={!!form[key]} onChange={(e) => set({ [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Examination</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: 0 }}>
              Leave a system as &ldquo;not examined&rdquo; and nothing is recorded for it — absence is not a normal result.
            </p>
            <div className="table-scroll">
              <table>
                <thead><tr><th style={{ width: '40%' }}>System</th><th style={{ width: '9rem' }}>Finding</th><th>Note</th></tr></thead>
                <tbody>
                  {SCREENING_SYSTEMS.map((sys) => {
                    const f = findings[sys.key] || { status: 'not_examined', note: '' };
                    return (
                      <tr key={sys.key} style={f.status === 'abnormal' ? { background: '#fdf3f3' } : undefined}>
                        <td>{sys.label}</td>
                        <td>
                          <select
                            value={f.status}
                            onChange={(e) => setFindings({ ...findings, [sys.key]: { ...f, status: e.target.value } })}
                          >
                            {FINDING_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            value={f.note}
                            placeholder={f.status === 'abnormal' ? 'What was found' : ''}
                            onChange={(e) => setFindings({ ...findings, [sys.key]: { ...f, note: e.target.value } })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Outcome</h2>
            {abnormal.length > 0 && (
              <p style={{ fontSize: '0.85rem' }}>
                <strong>Abnormal findings:</strong> {abnormal.map((s) => s.label).join(' · ')}
              </p>
            )}
            <div className="form-grid">
              <Field label="Fit to resume?">
                <select value={form.fitness} onChange={(e) => set({ fitness: e.target.value })}>
                  {FITNESS_STATUSES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
              <Field label="Restrictions (sport, boarding, diet)">
                <textarea rows={2} style={{ width: '100%' }} value={form.restrictions ?? ''} onChange={(e) => set({ restrictions: e.target.value })} />
              </Field>
              <Field label="Referral detail">
                <textarea rows={2} style={{ width: '100%' }} value={form.referral_detail ?? ''} onChange={(e) => set({ referral_detail: e.target.value })} />
              </Field>
              <Field label="Recommendations">
                <textarea rows={2} style={{ width: '100%' }} value={form.recommendations ?? ''} onChange={(e) => set({ recommendations: e.target.value })} />
              </Field>
              <Field label="Notes">
                <textarea rows={2} style={{ width: '100%' }} value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.referral_needed} onChange={(e) => set({ referral_needed: e.target.checked })} />
              Referral to a doctor or hospital needed
            </label>
            <button type="submit">{existing ? 'Update screening' : 'Save screening'}</button>{' '}
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </main>
  );
}

export default function ClinicScreeningsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/clinic/screenings">
        <ScreeningsInner />
      </RequireResource>
    </RequireAuth>
  );
}
