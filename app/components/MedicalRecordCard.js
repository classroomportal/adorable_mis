'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';

// The student medical record — standing profile, allergies/conditions, the
// growth (height/weight/BMI) record, the sick bay day book and
// immunisations. Backed by migration 128.
//
// Visibility is decided by the caller (the /students/medical resource key);
// as everywhere else in this app the real boundary is RLS — every table here
// carries a nurse-only policy — so hiding the card is a UX decision, not the
// security one.

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'growth', label: 'Growth & BMI' },
  { key: 'clinic', label: 'Sick Bay' },
  { key: 'immunisations', label: 'Immunisations' },
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENOTYPES = ['AA', 'AS', 'SS', 'AC', 'SC', 'CC'];
const CONDITION_KINDS = [
  { value: 'allergy', label: 'Allergy' },
  { value: 'condition', label: 'Condition' },
  { value: 'medication', label: 'Regular medication' },
  { value: 'dietary', label: 'Dietary' },
];
const SEVERITIES = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'life_threatening', label: 'Life-threatening' },
];
const VISIT_CATEGORIES = [
  { value: 'illness', label: 'Illness' },
  { value: 'injury', label: 'Injury' },
  { value: 'medication', label: 'Medication round' },
  { value: 'routine', label: 'Routine check' },
  { value: 'mental_health', label: 'Mental health' },
  { value: 'other', label: 'Other' },
];
const VISIT_OUTCOMES = [
  { value: 'returned_to_class', label: 'Returned to class' },
  { value: 'rested_in_sick_bay', label: 'Rested in sick bay' },
  { value: 'sent_home', label: 'Sent home' },
  { value: 'referred_to_hospital', label: 'Referred to hospital' },
  { value: 'other', label: 'Other' },
];

// WHO BMI-for-age (5–19) reads the z-score, not the adult 18.5/25/30 bands,
// which are wrong for every student here (they are 9–18). A z-score only
// exists once bmi_for_age_reference has been loaded — until then the app
// shows the BMI number alone rather than inventing a category.
function bmiBand(z) {
  if (z === null || z === undefined) return null;
  if (z < -3) return { label: 'Severe thinness', tone: 'bad' };
  if (z < -2) return { label: 'Thinness', tone: 'bad' };
  if (z <= 1) return { label: 'Healthy weight', tone: 'good' };
  if (z <= 2) return { label: 'Overweight', tone: 'warn' };
  return { label: 'Obesity', tone: 'bad' };
}

const TONE_STYLE = {
  good: { background: '#dcf5e3', color: '#1a7a3d' },
  warn: { background: '#fdecad', color: '#7a5a10' },
  bad: { background: '#fbdede', color: '#a3232c' },
  neutral: { background: 'var(--slate-100)', color: 'var(--ink-soft)' },
};

function Chip({ children, tone = 'neutral', title }) {
  return (
    <span className="badge" style={{ ...TONE_STYLE[tone], marginRight: '0.4rem' }} title={title}>
      {children}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: '0.6rem' }}>
      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--ink-soft)', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const EMPTY_PROFILE = {
  blood_group: '', genotype: '', gp_name: '', gp_phone: '',
  preferred_hospital: '', preferred_hospital_phone: '',
  health_insurance_provider: '', health_insurance_number: '',
  consent_first_aid: false, consent_simple_analgesia: false, consent_emergency_treatment: false,
  carries_own_medication: false, dietary_requirements: '', sport_restrictions: '', notes: '',
};

export default function MedicalRecordCard({ studentId, canEdit = false }) {
  const [tab, setTab] = useState('summary');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  const [profile, setProfile] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState(EMPTY_PROFILE);

  const [conditions, setConditions] = useState([]);
  const [growth, setGrowth] = useState([]);
  const [visits, setVisits] = useState([]);
  const [immunisations, setImmunisations] = useState([]);

  const [newCondition, setNewCondition] = useState(null);
  const [newMeasurement, setNewMeasurement] = useState(null);
  const [newVisit, setNewVisit] = useState(null);
  const [newImmunisation, setNewImmunisation] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [prof, cond, grow, vis, imm] = await Promise.all([
      supabase.from('student_medical').select('*').eq('student_id', studentId).maybeSingle(),
      supabase.from('student_medical_conditions').select('*').eq('student_id', studentId).order('active', { ascending: false }).order('kind'),
      // The view adds age in months and the BMI-for-age z-score; it is
      // security_invoker, so the same nurse-only RLS applies.
      supabase.from('student_growth_record').select('*').eq('student_id', studentId).order('measured_on', { ascending: false }),
      supabase.from('student_clinic_visits').select('*').eq('student_id', studentId).order('visited_at', { ascending: false }).limit(50),
      supabase.from('student_immunisations').select('*').eq('student_id', studentId).order('given_on', { ascending: false, nullsFirst: false }),
    ]);

    const firstError = [prof, cond, grow, vis, imm].find((r) => r.error);
    if (firstError) setError(firstError.error.message);

    setProfile(prof.data || null);
    setConditions(cond.data || []);
    setGrowth(grow.data || []);
    setVisits(vis.data || []);
    setImmunisations(imm.data || []);
    setLoading(false);
  }, [studentId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function currentUserId() {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  }

  function report(result, okMessage) {
    if (result.error) { setStatus(`Could not save: ${result.error.message}`); return false; }
    setStatus(okMessage);
    return true;
  }

  // --- profile ---

  function startEditingProfile() {
    setProfileDraft({ ...EMPTY_PROFILE, ...(profile || {}) });
    setEditingProfile(true);
    setOpen(true);
    setTab('summary');
  }

  async function saveProfile(e) {
    e.preventDefault();
    setStatus('Saving...');
    const payload = { ...profileDraft, student_id: studentId };
    delete payload.created_at;
    delete payload.updated_at;
    // Empty selects and text boxes are absences, not empty strings — the
    // blood_group/genotype CHECK constraints reject ''.
    Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
    const result = await supabase.from('student_medical').upsert(payload, { onConflict: 'student_id' });
    if (report(result, 'Medical profile saved.')) {
      setEditingProfile(false);
      load();
    }
  }

  async function markReviewed() {
    setStatus('Saving...');
    const result = await supabase.from('student_medical').upsert(
      { student_id: studentId, last_reviewed_on: new Date().toISOString().slice(0, 10), last_reviewed_by: await currentUserId() },
      { onConflict: 'student_id' }
    );
    if (report(result, 'Marked as reviewed today.')) load();
  }

  // --- conditions ---

  async function addCondition(e) {
    e.preventDefault();
    if (!newCondition.label.trim()) { setStatus('Give the allergy/condition a name.'); return; }
    setStatus('Saving...');
    const result = await supabase.from('student_medical_conditions').insert({
      student_id: studentId,
      kind: newCondition.kind,
      label: newCondition.label.trim(),
      severity: newCondition.severity || null,
      management: newCondition.management || null,
      dose: newCondition.dose || null,
      frequency: newCondition.frequency || null,
      diagnosed_on: newCondition.diagnosed_on || null,
      created_by: await currentUserId(),
    });
    if (report(result, 'Added.')) { setNewCondition(null); load(); }
  }

  async function setConditionActive(conditionId, active) {
    const result = await supabase.from('student_medical_conditions').update({ active }).eq('condition_id', conditionId);
    // Conditions are resolved rather than deleted — the history is worth keeping.
    if (report(result, active ? 'Marked active again.' : 'Marked resolved.')) load();
  }

  // --- growth ---

  async function addMeasurement(e) {
    e.preventDefault();
    if (!newMeasurement.height_cm && !newMeasurement.weight_kg) { setStatus('Enter a height, a weight, or both.'); return; }
    setStatus('Saving...');
    const result = await supabase.from('student_growth_measurements').upsert({
      student_id: studentId,
      measured_on: newMeasurement.measured_on,
      height_cm: newMeasurement.height_cm ? Number(newMeasurement.height_cm) : null,
      weight_kg: newMeasurement.weight_kg ? Number(newMeasurement.weight_kg) : null,
      notes: newMeasurement.notes || null,
      recorded_by: await currentUserId(),
    }, { onConflict: 'student_id,measured_on' });
    if (report(result, 'Measurement recorded.')) { setNewMeasurement(null); load(); }
  }

  // --- clinic visits ---

  async function addVisit(e) {
    e.preventDefault();
    if (!newVisit.reason.trim()) { setStatus('Record what the student came in with.'); return; }
    setStatus('Saving...');
    const result = await supabase.from('student_clinic_visits').insert({
      student_id: studentId,
      visited_at: new Date(newVisit.visited_at).toISOString(),
      category: newVisit.category || null,
      reason: newVisit.reason.trim(),
      temperature_c: newVisit.temperature_c ? Number(newVisit.temperature_c) : null,
      observations: newVisit.observations || null,
      treatment: newVisit.treatment || null,
      medication_given: newVisit.medication_given || null,
      dose_given: newVisit.dose_given || null,
      outcome: newVisit.outcome || null,
      parent_notified: newVisit.parent_notified,
      parent_notified_at: newVisit.parent_notified ? new Date().toISOString() : null,
      follow_up_needed: newVisit.follow_up_needed,
      recorded_by: await currentUserId(),
    });
    if (report(result, 'Sick bay visit recorded.')) { setNewVisit(null); load(); }
  }

  // --- immunisations ---

  async function addImmunisation(e) {
    e.preventDefault();
    if (!newImmunisation.vaccine.trim()) { setStatus('Name the vaccine.'); return; }
    setStatus('Saving...');
    const result = await supabase.from('student_immunisations').insert({
      student_id: studentId,
      vaccine: newImmunisation.vaccine.trim(),
      dose_label: newImmunisation.dose_label || null,
      given_on: newImmunisation.given_on || null,
      next_due_on: newImmunisation.next_due_on || null,
      batch_number: newImmunisation.batch_number || null,
      administered_by: newImmunisation.administered_by || null,
      notes: newImmunisation.notes || null,
      recorded_by: await currentUserId(),
    });
    if (report(result, 'Immunisation recorded.')) { setNewImmunisation(null); load(); }
  }

  // --- derived ---

  const activeConditions = conditions.filter((c) => c.active);
  const alerts = activeConditions.filter((c) => c.severity === 'severe' || c.severity === 'life_threatening');
  const latest = growth[0] || null;
  const previous = growth[1] || null;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = immunisations.filter((i) => i.next_due_on && i.next_due_on < today);

  // Live preview only — the stored BMI is the generated column the database
  // computes, so the table and any export always agree.
  const draftBmi = (() => {
    const h = Number(newMeasurement?.height_cm);
    const w = Number(newMeasurement?.weight_kg);
    if (!h || !w || h <= 0) return null;
    return (w / ((h / 100) ** 2)).toFixed(2);
  })();

  return (
    <div className="card">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <h2 style={{ margin: 0 }}>{open ? '▾' : '▸'} 🩺 Medical Record</h2>
        {canEdit && open && !editingProfile && (
          <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="button" onClick={startEditingProfile}>Edit profile</button>
            <button type="button" onClick={markReviewed}>Mark reviewed</button>
          </span>
        )}
      </div>

      {!open && (
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
          Allergies, conditions, growth &amp; BMI, sick bay visits and immunisations.
        </p>
      )}

      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          {loading && <p>Loading...</p>}
          {error && <p style={{ color: '#a3232c' }}>{error}</p>}
          {status && <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{status}</p>}

          {!loading && !error && (
            <>
              {/* The strip anyone opening this record needs to see first,
                  whichever tab they then go to. */}
              <div style={{ background: alerts.length ? '#fbdede' : 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 10, padding: '0.7rem', marginBottom: '0.9rem' }}>
                <div style={{ marginBottom: alerts.length ? '0.5rem' : 0 }}>
                  <Chip tone={profile?.blood_group ? 'neutral' : 'warn'}>Blood group: {profile?.blood_group || 'not recorded'}</Chip>
                  <Chip tone={profile?.genotype ? 'neutral' : 'warn'}>Genotype: {profile?.genotype || 'not recorded'}</Chip>
                  {profile?.carries_own_medication && <Chip tone="warn">Carries own medication</Chip>}
                  {overdue.length > 0 && <Chip tone="warn">{overdue.length} immunisation{overdue.length === 1 ? '' : 's'} overdue</Chip>}
                </div>
                {alerts.length > 0 ? (
                  <div style={{ fontSize: '0.85rem' }}>
                    <strong>⚠ Alerts:</strong>{' '}
                    {alerts.map((a) => `${a.label}${a.severity === 'life_threatening' ? ' (life-threatening)' : ' (severe)'}`).join(' · ')}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>No severe allergies or conditions recorded.</div>
                )}
                {profile?.last_reviewed_on && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: '0.4rem' }}>
                    Last reviewed {formatUKDate(profile.last_reviewed_on)}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    style={{
                      padding: '0.3rem 0.75rem', borderRadius: 999, cursor: 'pointer',
                      border: '1px solid var(--slate-200)',
                      background: tab === t.key ? 'var(--brand-700)' : 'white',
                      color: tab === t.key ? 'white' : 'var(--ink-soft)',
                      fontWeight: 600, fontSize: '0.8rem',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'summary' && (
                <>
                  {editingProfile ? (
                    <form onSubmit={saveProfile}>
                      <Field label="Blood group">
                        <select value={profileDraft.blood_group || ''} onChange={(e) => setProfileDraft({ ...profileDraft, blood_group: e.target.value })}>
                          <option value="">—</option>
                          {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </Field>
                      <Field label="Genotype">
                        <select value={profileDraft.genotype || ''} onChange={(e) => setProfileDraft({ ...profileDraft, genotype: e.target.value })}>
                          <option value="">—</option>
                          {GENOTYPES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </Field>
                      <Field label="Doctor / GP name">
                        <input value={profileDraft.gp_name || ''} onChange={(e) => setProfileDraft({ ...profileDraft, gp_name: e.target.value })} />
                      </Field>
                      <Field label="Doctor / GP phone">
                        <input value={profileDraft.gp_phone || ''} onChange={(e) => setProfileDraft({ ...profileDraft, gp_phone: e.target.value })} />
                      </Field>
                      <Field label="Preferred hospital">
                        <input value={profileDraft.preferred_hospital || ''} onChange={(e) => setProfileDraft({ ...profileDraft, preferred_hospital: e.target.value })} />
                      </Field>
                      <Field label="Preferred hospital phone">
                        <input value={profileDraft.preferred_hospital_phone || ''} onChange={(e) => setProfileDraft({ ...profileDraft, preferred_hospital_phone: e.target.value })} />
                      </Field>
                      <Field label="Health insurance provider">
                        <input value={profileDraft.health_insurance_provider || ''} onChange={(e) => setProfileDraft({ ...profileDraft, health_insurance_provider: e.target.value })} />
                      </Field>
                      <Field label="Health insurance number">
                        <input value={profileDraft.health_insurance_number || ''} onChange={(e) => setProfileDraft({ ...profileDraft, health_insurance_number: e.target.value })} />
                      </Field>
                      <Field label="Dietary requirements">
                        <input value={profileDraft.dietary_requirements || ''} onChange={(e) => setProfileDraft({ ...profileDraft, dietary_requirements: e.target.value })} />
                      </Field>
                      <Field label="Sport / PE restrictions">
                        <input value={profileDraft.sport_restrictions || ''} onChange={(e) => setProfileDraft({ ...profileDraft, sport_restrictions: e.target.value })} />
                      </Field>
                      <Field label="Notes">
                        <textarea rows={3} style={{ width: '100%' }} value={profileDraft.notes || ''} onChange={(e) => setProfileDraft({ ...profileDraft, notes: e.target.value })} />
                      </Field>

                      <fieldset style={{ border: '1px solid var(--slate-200)', borderRadius: 8, padding: '0.6rem', marginBottom: '0.75rem' }}>
                        <legend style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', fontWeight: 600 }}>Consents on file</legend>
                        {[
                          ['consent_first_aid', 'First aid may be given'],
                          ['consent_simple_analgesia', 'Simple analgesia (paracetamol etc) without calling home first'],
                          ['consent_emergency_treatment', 'Emergency treatment if parents cannot be reached'],
                          ['carries_own_medication', 'Student carries their own medication (inhaler, EpiPen…)'],
                        ].map(([key, label]) => (
                          <label key={key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
                            <input type="checkbox" style={{ width: 'auto' }} checked={!!profileDraft[key]} onChange={(e) => setProfileDraft({ ...profileDraft, [key]: e.target.checked })} />
                            {label}
                          </label>
                        ))}
                      </fieldset>

                      <button type="submit">Save</button>{' '}
                      <button type="button" onClick={() => { setEditingProfile(false); setStatus(null); }}>Cancel</button>
                    </form>
                  ) : (
                    <div className="core-data-fields">
                      <p><strong>Doctor / GP:</strong> {profile?.gp_name || '—'} {profile?.gp_phone ? `(${profile.gp_phone})` : ''}</p>
                      <p><strong>Preferred hospital:</strong> {profile?.preferred_hospital || '—'} {profile?.preferred_hospital_phone ? `(${profile.preferred_hospital_phone})` : ''}</p>
                      <p><strong>Health insurance:</strong> {profile?.health_insurance_provider || '—'} {profile?.health_insurance_number ? `· ${profile.health_insurance_number}` : ''}</p>
                      <p><strong>Dietary requirements:</strong> {profile?.dietary_requirements || '—'}</p>
                      <p><strong>Sport / PE restrictions:</strong> {profile?.sport_restrictions || '—'}</p>
                      <p><strong>Notes:</strong> {profile?.notes || '—'}</p>
                      <p style={{ marginTop: '0.6rem' }}>
                        <strong>Consents:</strong>{' '}
                        <Chip tone={profile?.consent_first_aid ? 'good' : 'bad'}>First aid {profile?.consent_first_aid ? '✓' : '✗'}</Chip>
                        <Chip tone={profile?.consent_simple_analgesia ? 'good' : 'bad'}>Analgesia {profile?.consent_simple_analgesia ? '✓' : '✗'}</Chip>
                        <Chip tone={profile?.consent_emergency_treatment ? 'good' : 'bad'}>Emergency treatment {profile?.consent_emergency_treatment ? '✓' : '✗'}</Chip>
                      </p>
                    </div>
                  )}

                  <h3 style={{ marginTop: '1.2rem', fontSize: '0.95rem' }}>Allergies, conditions &amp; medication</h3>
                  {conditions.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Nothing recorded.</p>}
                  {conditions.length > 0 && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Type</th><th>What</th><th>Severity</th><th>Management</th><th>Dose / frequency</th>{canEdit && <th></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {conditions.map((c) => (
                            <tr key={c.condition_id} style={{ opacity: c.active ? 1 : 0.5 }}>
                              <td>{CONDITION_KINDS.find((k) => k.value === c.kind)?.label || c.kind}</td>
                              <td>{c.label}{!c.active && ' (resolved)'}</td>
                              <td>
                                {c.severity
                                  ? <Chip tone={c.severity === 'life_threatening' || c.severity === 'severe' ? 'bad' : c.severity === 'moderate' ? 'warn' : 'neutral'}>
                                      {SEVERITIES.find((s) => s.value === c.severity)?.label}
                                    </Chip>
                                  : '—'}
                              </td>
                              <td>{c.management || '—'}</td>
                              <td>{[c.dose, c.frequency].filter(Boolean).join(' · ') || '—'}</td>
                              {canEdit && (
                                <td>
                                  <button type="button" onClick={() => setConditionActive(c.condition_id, !c.active)}>
                                    {c.active ? 'Resolve' : 'Reactivate'}
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canEdit && !newCondition && (
                    <button type="button" style={{ marginTop: '0.6rem' }} onClick={() => setNewCondition({ kind: 'allergy', label: '', severity: '', management: '', dose: '', frequency: '', diagnosed_on: '' })}>
                      Add allergy / condition / medication
                    </button>
                  )}
                  {canEdit && newCondition && (
                    <form onSubmit={addCondition} style={{ marginTop: '0.75rem', borderTop: '1px solid var(--slate-200)', paddingTop: '0.75rem' }}>
                      <Field label="Type">
                        <select value={newCondition.kind} onChange={(e) => setNewCondition({ ...newCondition, kind: e.target.value })}>
                          {CONDITION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                        </select>
                      </Field>
                      <Field label="What (e.g. Peanuts, Asthma, Salbutamol inhaler)">
                        <input value={newCondition.label} onChange={(e) => setNewCondition({ ...newCondition, label: e.target.value })} />
                      </Field>
                      <Field label="Severity">
                        <select value={newCondition.severity} onChange={(e) => setNewCondition({ ...newCondition, severity: e.target.value })}>
                          <option value="">—</option>
                          {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Management / what to do">
                        <textarea rows={2} style={{ width: '100%' }} value={newCondition.management} onChange={(e) => setNewCondition({ ...newCondition, management: e.target.value })} />
                      </Field>
                      {newCondition.kind === 'medication' && (
                        <>
                          <Field label="Dose"><input value={newCondition.dose} onChange={(e) => setNewCondition({ ...newCondition, dose: e.target.value })} /></Field>
                          <Field label="Frequency"><input value={newCondition.frequency} onChange={(e) => setNewCondition({ ...newCondition, frequency: e.target.value })} /></Field>
                        </>
                      )}
                      <button type="submit">Add</button>{' '}
                      <button type="button" onClick={() => setNewCondition(null)}>Cancel</button>
                    </form>
                  )}
                </>
              )}

              {tab === 'growth' && (
                <>
                  {latest ? (
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                      <Stat label="Height" value={latest.height_cm ? `${latest.height_cm} cm` : '—'} />
                      <Stat label="Weight" value={latest.weight_kg ? `${latest.weight_kg} kg` : '—'} />
                      <Stat label="BMI" value={latest.bmi ?? '—'} />
                      <Stat
                        label="BMI-for-age"
                        value={bmiBand(latest.bmi_z)?.label || 'no reference loaded'}
                        sub={latest.bmi_z !== null && latest.bmi_z !== undefined ? `z = ${latest.bmi_z}` : 'WHO 5–19 table not loaded yet'}
                      />
                      {previous && latest.height_cm && previous.height_cm && (
                        <Stat label="Growth since last" value={`${(latest.height_cm - previous.height_cm).toFixed(1)} cm`} sub={formatUKDate(previous.measured_on)} />
                      )}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>No measurements recorded yet.</p>
                  )}

                  {growth.length > 0 && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>Date</th><th>Age</th><th>Height (cm)</th><th>Weight (kg)</th><th>BMI</th><th>BMI-for-age</th><th>Notes</th></tr>
                        </thead>
                        <tbody>
                          {growth.map((g) => {
                            const band = bmiBand(g.bmi_z);
                            return (
                              <tr key={g.measurement_id}>
                                <td>{formatUKDate(g.measured_on)}</td>
                                <td>{g.age_months != null ? `${Math.floor(g.age_months / 12)}y ${g.age_months % 12}m` : '—'}</td>
                                <td>{g.height_cm ?? '—'}</td>
                                <td>{g.weight_kg ?? '—'}</td>
                                <td>{g.bmi ?? '—'}</td>
                                <td>{band ? <Chip tone={band.tone}>{band.label} (z {g.bmi_z})</Chip> : '—'}</td>
                                <td>{g.notes || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canEdit && !newMeasurement && (
                    <button type="button" style={{ marginTop: '0.6rem' }} onClick={() => setNewMeasurement({ measured_on: today, height_cm: '', weight_kg: '', notes: '' })}>
                      Record height &amp; weight
                    </button>
                  )}
                  {canEdit && newMeasurement && (
                    <form onSubmit={addMeasurement} style={{ marginTop: '0.75rem', borderTop: '1px solid var(--slate-200)', paddingTop: '0.75rem' }}>
                      <Field label="Date measured">
                        <input type="date" value={newMeasurement.measured_on} onChange={(e) => setNewMeasurement({ ...newMeasurement, measured_on: e.target.value })} />
                        {newMeasurement.measured_on && <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>{formatUKDate(newMeasurement.measured_on)}</span>}
                      </Field>
                      <Field label="Height (cm)">
                        <input type="number" step="0.1" min="30" max="250" value={newMeasurement.height_cm} onChange={(e) => setNewMeasurement({ ...newMeasurement, height_cm: e.target.value })} />
                      </Field>
                      <Field label="Weight (kg)">
                        <input type="number" step="0.1" min="5" max="250" value={newMeasurement.weight_kg} onChange={(e) => setNewMeasurement({ ...newMeasurement, weight_kg: e.target.value })} />
                      </Field>
                      <p style={{ fontSize: '0.85rem', margin: '0 0 0.6rem' }}>
                        <strong>BMI:</strong> {draftBmi ?? '—'}{' '}
                        <span style={{ color: 'var(--ink-soft)', fontSize: '0.75rem' }}>(preview — the stored value is calculated by the database on save)</span>
                      </p>
                      <Field label="Notes">
                        <input value={newMeasurement.notes} onChange={(e) => setNewMeasurement({ ...newMeasurement, notes: e.target.value })} />
                      </Field>
                      <button type="submit">Save measurement</button>{' '}
                      <button type="button" onClick={() => setNewMeasurement(null)}>Cancel</button>
                    </form>
                  )}
                </>
              )}

              {tab === 'clinic' && (
                <>
                  {visits.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>No sick bay visits recorded.</p>}
                  {visits.length > 0 && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>When</th><th>Type</th><th>Reason</th><th>Temp</th><th>Treatment / medication</th><th>Outcome</th><th>Parent told</th></tr>
                        </thead>
                        <tbody>
                          {visits.map((v) => (
                            <tr key={v.visit_id}>
                              <td>{formatDateTime(v.visited_at)}</td>
                              <td>{VISIT_CATEGORIES.find((c) => c.value === v.category)?.label || '—'}</td>
                              <td>{v.reason}{v.follow_up_needed && <> <Chip tone="warn">follow-up</Chip></>}</td>
                              <td>{v.temperature_c ? `${v.temperature_c}°C` : '—'}</td>
                              <td>{[v.treatment, v.medication_given, v.dose_given].filter(Boolean).join(' · ') || '—'}</td>
                              <td>{VISIT_OUTCOMES.find((o) => o.value === v.outcome)?.label || '—'}</td>
                              <td>{v.parent_notified ? <Chip tone="good">Yes</Chip> : <Chip tone="bad">No</Chip>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canEdit && !newVisit && (
                    <button
                      type="button"
                      style={{ marginTop: '0.6rem' }}
                      onClick={() => setNewVisit({
                        visited_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
                        category: 'illness', reason: '', temperature_c: '', observations: '', treatment: '',
                        medication_given: '', dose_given: '', outcome: 'returned_to_class',
                        parent_notified: false, follow_up_needed: false,
                      })}
                    >
                      Record a sick bay visit
                    </button>
                  )}
                  {canEdit && newVisit && (
                    <form onSubmit={addVisit} style={{ marginTop: '0.75rem', borderTop: '1px solid var(--slate-200)', paddingTop: '0.75rem' }}>
                      <Field label="When">
                        <input type="datetime-local" value={newVisit.visited_at} onChange={(e) => setNewVisit({ ...newVisit, visited_at: e.target.value })} />
                      </Field>
                      <Field label="Type">
                        <select value={newVisit.category} onChange={(e) => setNewVisit({ ...newVisit, category: e.target.value })}>
                          {VISIT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Presenting complaint">
                        <input value={newVisit.reason} onChange={(e) => setNewVisit({ ...newVisit, reason: e.target.value })} />
                      </Field>
                      <Field label="Temperature (°C)">
                        <input type="number" step="0.1" min="30" max="45" value={newVisit.temperature_c} onChange={(e) => setNewVisit({ ...newVisit, temperature_c: e.target.value })} />
                      </Field>
                      <Field label="Observations">
                        <textarea rows={2} style={{ width: '100%' }} value={newVisit.observations} onChange={(e) => setNewVisit({ ...newVisit, observations: e.target.value })} />
                      </Field>
                      <Field label="Treatment given">
                        <textarea rows={2} style={{ width: '100%' }} value={newVisit.treatment} onChange={(e) => setNewVisit({ ...newVisit, treatment: e.target.value })} />
                      </Field>
                      <Field label="Medication given">
                        <input value={newVisit.medication_given} onChange={(e) => setNewVisit({ ...newVisit, medication_given: e.target.value })} />
                      </Field>
                      <Field label="Dose given">
                        <input value={newVisit.dose_given} onChange={(e) => setNewVisit({ ...newVisit, dose_given: e.target.value })} />
                      </Field>
                      <Field label="Outcome">
                        <select value={newVisit.outcome} onChange={(e) => setNewVisit({ ...newVisit, outcome: e.target.value })}>
                          {VISIT_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </Field>
                      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={newVisit.parent_notified} onChange={(e) => setNewVisit({ ...newVisit, parent_notified: e.target.checked })} />
                        Parent / guardian notified
                      </label>
                      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={newVisit.follow_up_needed} onChange={(e) => setNewVisit({ ...newVisit, follow_up_needed: e.target.checked })} />
                        Follow-up needed
                      </label>
                      <button type="submit">Save visit</button>{' '}
                      <button type="button" onClick={() => setNewVisit(null)}>Cancel</button>
                    </form>
                  )}
                </>
              )}

              {tab === 'immunisations' && (
                <>
                  {immunisations.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>No immunisations recorded.</p>}
                  {immunisations.length > 0 && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>Vaccine</th><th>Dose</th><th>Given</th><th>Next due</th><th>Batch</th><th>Given by</th></tr>
                        </thead>
                        <tbody>
                          {immunisations.map((i) => (
                            <tr key={i.immunisation_id}>
                              <td>{i.vaccine}</td>
                              <td>{i.dose_label || '—'}</td>
                              <td>{i.given_on ? formatUKDate(i.given_on) : '—'}</td>
                              <td>
                                {i.next_due_on
                                  ? <Chip tone={i.next_due_on < today ? 'bad' : 'neutral'}>{formatUKDate(i.next_due_on)}{i.next_due_on < today ? ' — overdue' : ''}</Chip>
                                  : '—'}
                              </td>
                              <td>{i.batch_number || '—'}</td>
                              <td>{i.administered_by || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canEdit && !newImmunisation && (
                    <button type="button" style={{ marginTop: '0.6rem' }} onClick={() => setNewImmunisation({ vaccine: '', dose_label: '', given_on: today, next_due_on: '', batch_number: '', administered_by: '', notes: '' })}>
                      Record an immunisation
                    </button>
                  )}
                  {canEdit && newImmunisation && (
                    <form onSubmit={addImmunisation} style={{ marginTop: '0.75rem', borderTop: '1px solid var(--slate-200)', paddingTop: '0.75rem' }}>
                      <Field label="Vaccine"><input value={newImmunisation.vaccine} onChange={(e) => setNewImmunisation({ ...newImmunisation, vaccine: e.target.value })} /></Field>
                      <Field label="Dose (e.g. Dose 1, Booster)"><input value={newImmunisation.dose_label} onChange={(e) => setNewImmunisation({ ...newImmunisation, dose_label: e.target.value })} /></Field>
                      <Field label="Date given">
                        <input type="date" value={newImmunisation.given_on} onChange={(e) => setNewImmunisation({ ...newImmunisation, given_on: e.target.value })} />
                      </Field>
                      <Field label="Next due">
                        <input type="date" value={newImmunisation.next_due_on} onChange={(e) => setNewImmunisation({ ...newImmunisation, next_due_on: e.target.value })} />
                      </Field>
                      <Field label="Batch number"><input value={newImmunisation.batch_number} onChange={(e) => setNewImmunisation({ ...newImmunisation, batch_number: e.target.value })} /></Field>
                      <Field label="Administered by"><input value={newImmunisation.administered_by} onChange={(e) => setNewImmunisation({ ...newImmunisation, administered_by: e.target.value })} /></Field>
                      <button type="submit">Save</button>{' '}
                      <button type="button" onClick={() => setNewImmunisation(null)}>Cancel</button>
                    </form>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 10, padding: '0.6rem 0.85rem', minWidth: '7.5rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)' }}>{sub}</div>}
    </div>
  );
}
