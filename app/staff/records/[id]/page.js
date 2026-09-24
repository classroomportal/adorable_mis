'use client';
import { useEffect, useState, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import RequireAuth from '../../../RequireAuth';
import RequireResource from '../../../RequireResource';
import { useAuth } from '../../../../lib/AuthContext';
import { formatUKDate } from '../../../../lib/formatDate';
import { formatTimeRange } from '../../../../lib/formatTime';
import { schoolToday } from '../../../../lib/schoolTime';
import { resizePhotoToBase64 } from '../../../../lib/photo';
import { ROLE_LABELS } from '../../../../lib/staffRoles';
import {
  EMPLOYMENT_TYPES, HR_DEPARTMENTS, NATIONALITIES, WARNING_LEVELS, ATTENDANCE_TYPES,
  academicYearLabel, clearanceStatus, lengthOfService, isWarningLive,
  isTrainingExpired, attendanceTotals, initials,
} from '../../../../lib/staffHr';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// The Overview tab, as data: the same list drives the read-only view and the
// edit form, so a field can't be shown but not editable or the other way round.
const HR_SECTIONS = [
  {
    title: 'Employment',
    fields: [
      { key: 'job_title', label: 'Job title' },
      { key: 'department', label: 'Department', type: 'select', options: HR_DEPARTMENTS },
      { key: 'employment_type', label: 'Employment type', type: 'select', options: EMPLOYMENT_TYPES },
      { key: 'date_of_appointment', label: 'Date of appointment', type: 'date' },
      { key: 'probation_end_date', label: 'Probation ends', type: 'date' },
      { key: 'leaving_date', label: 'Leaving date', type: 'date' },
      { key: 'annual_leave_days', label: 'Annual leave (days a year)', type: 'number' },
    ],
  },
  {
    title: 'Police clearance',
    fields: [
      { key: 'police_clearance_date', label: 'Date of clearance', type: 'date' },
      { key: 'police_clearance_reference', label: 'Certificate / reference no.' },
      { key: 'police_clearance_renewal_date', label: 'Renewal due', type: 'date' },
    ],
  },
  {
    title: 'Personal & contact',
    fields: [
      { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
      { key: 'gender', label: 'Gender', type: 'select', options: { Female: 'Female', Male: 'Male' } },
      { key: 'nationality', label: 'Nationality', type: 'select', options: NATIONALITIES },
      { key: 'phone', label: 'Phone' },
      { key: 'personal_email', label: 'Personal email', type: 'email' },
      { key: 'address', label: 'Home address', type: 'textarea' },
    ],
  },
  {
    title: 'Next of kin',
    fields: [
      { key: 'next_of_kin_name', label: 'Name' },
      { key: 'next_of_kin_relationship', label: 'Relationship' },
      { key: 'next_of_kin_phone', label: 'Phone' },
    ],
  },
  {
    title: 'Qualifications & notes',
    wide: true,
    fields: [
      { key: 'qualifications', label: 'Qualifications', type: 'textarea' },
      { key: 'notes', label: 'HR notes', type: 'textarea' },
    ],
  },
];
const HR_FIELD_KEYS = HR_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
const CORE_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'staff_code', label: 'Staff code' },
  { key: 'email', label: 'School email', type: 'email' },
];

const TRAINING_FIELDS = [
  { key: 'title', label: 'Course / training', required: true },
  { key: 'provider', label: 'Provider' },
  { key: 'completed_on', label: 'Completed', type: 'date' },
  { key: 'expires_on', label: 'Expires / refresh due', type: 'date' },
  { key: 'certificate_reference', label: 'Certificate ref.' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const WARNING_FIELDS = [
  { key: 'issued_on', label: 'Date issued', type: 'date', required: true },
  { key: 'level', label: 'Level', type: 'select', options: WARNING_LEVELS, required: true },
  { key: 'reason', label: 'Reason', required: true },
  { key: 'issued_by', label: 'Issued by' },
  { key: 'expires_on', label: 'Expires (blank = never)', type: 'date' },
  { key: 'notes', label: 'Notes / outcome', type: 'textarea' },
];

const ATTENDANCE_FIELDS = [
  { key: 'record_type', label: 'Type', type: 'select', options: ATTENDANCE_TYPES, required: true },
  { key: 'start_date', label: 'Date', type: 'date', required: true },
  { key: 'end_date', label: 'Until (if more than one day)', type: 'date', showIf: (f) => f.record_type !== 'late' },
  { key: 'days', label: 'Working days', type: 'number', step: '0.5', showIf: (f) => f.record_type !== 'late' },
  { key: 'minutes_late', label: 'Minutes late', type: 'number', step: '1', showIf: (f) => f.record_type === 'late' },
  { key: 'reason', label: 'Reason / notes' },
];

function blankToNull(v) {
  return v === '' || v === undefined ? null : v;
}

function FieldInput({ field, value, onChange }) {
  const common = { value: value ?? '', onChange: (e) => onChange(e.target.value), required: field.required };
  if (field.type === 'textarea') return <textarea rows={3} {...common} />;
  if (field.type === 'select') {
    // A value saved before the list existed (or since dropped from it) stays
    // selectable, so opening the form and saving doesn't silently blank it.
    const legacy = value && !(value in field.options);
    return (
      <select {...common}>
        <option value="">—</option>
        {legacy && <option value={value}>{value} (not in list)</option>}
        {Object.entries(field.options).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    );
  }
  return (
    <>
      <input type={field.type || 'text'} step={field.step} min={field.type === 'number' ? 0 : undefined} {...common} />
      {field.type === 'date' && value && <span className="hr-date-hint">{formatUKDate(value)}</span>}
    </>
  );
}

function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return <span className="hr-empty">—</span>;
  if (field.type === 'date') return formatUKDate(value);
  if (field.type === 'select') return field.options[value] || value;
  return value;
}

// Add / edit / delete for one of the child tables (training, warnings, days
// off). `fields` drives the form; `columns` drives the table.
function RecordList({ table, staffId, userId, rows, fields, columns, canEdit, addLabel, emptyText, defaults = {}, prepare, onChanged }) {
  const [editingId, setEditingId] = useState(null); // null | 'new' | row id
  const [form, setForm] = useState({});
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  function startAdd() {
    setForm({ ...defaults });
    setEditingId('new');
    setStatus(null);
  }

  function startEdit(row) {
    const f = {};
    fields.forEach((fd) => { f[fd.key] = row[fd.key] ?? ''; });
    setForm(f);
    setEditingId(row.id);
    setStatus(null);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    let payload = {};
    fields.forEach((fd) => {
      const visible = !fd.showIf || fd.showIf(form);
      let v = visible ? blankToNull(form[fd.key]) : null;
      if (fd.type === 'number' && v !== null) v = Number(v);
      payload[fd.key] = v;
    });
    if (prepare) payload = prepare(payload);
    const { error } = editingId === 'new'
      ? await supabase.from(table).insert({ ...payload, staff_id: staffId, created_by: userId })
      : await supabase.from(table).update(payload).eq('id', editingId);
    setSaving(false);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setEditingId(null);
    setStatus('Saved.');
    onChanged();
  }

  async function remove(row) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    const { error } = await supabase.from(table).delete().eq('id', row.id);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setStatus('Deleted.');
    onChanged();
  }

  return (
    <div>
      {canEdit && editingId === null && (
        <div className="no-print" style={{ marginBottom: '0.75rem' }}>
          <button onClick={startAdd}>+ {addLabel}</button>
        </div>
      )}
      {status && <p style={{ fontSize: '0.85rem' }}>{status}</p>}

      {editingId !== null && (
        <form onSubmit={save} className="no-print hr-record-form">
          <div className="form-grid" style={{ width: '100%' }}>
            {fields.filter((fd) => !fd.showIf || fd.showIf(form)).map((fd) => (
              <label key={fd.key}>
                {fd.label}{fd.required ? ' *' : ''}
                <FieldInput field={fd} value={form[fd.key]} onChange={(v) => setForm((f) => ({ ...f, [fd.key]: v }))} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : editingId === 'new' ? 'Add' : 'Save changes'}</button>
            <button type="button" className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="hr-empty">{emptyText}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => <th key={c.label}>{c.label}</th>)}
                {canEdit && <th className="no-print" style={{ width: '8rem' }}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}
                  {canEdit && (
                    <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                      <button className="secondary hr-small-btn" onClick={() => startEdit(row)}>Edit</button>{' '}
                      <button className="secondary hr-small-btn" onClick={() => remove(row)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`hr-kpi ${tone ? `hr-kpi-${tone}` : ''}`}>
      <div className="hr-kpi-label">{label}</div>
      <div className="hr-kpi-value">{value}</div>
      {sub && <div className="hr-kpi-sub">{sub}</div>}
    </div>
  );
}

function StaffRecord() {
  const { id } = useParams();
  const staffId = Number(id);
  const { profile, staffRoles, session, hasAccess } = useAuth();
  const canEdit = profile?.role === 'admin' || (staffRoles || []).includes('hr');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [staff, setStaff] = useState(null);
  const [hr, setHr] = useState({});
  const [roles, setRoles] = useState([]);
  const [training, setTraining] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [classes, setClasses] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [periods, setPeriods] = useState([]);

  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saveStatus, setSaveStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [photoStatus, setPhotoStatus] = useState(null);

  async function loadHr() {
    const [{ data: h, error: hErr }, { data: t }, { data: w }, { data: a }] = await Promise.all([
      supabase.from('staff_hr_profiles').select('*').eq('staff_id', staffId).maybeSingle(),
      supabase.from('staff_training').select('*').eq('staff_id', staffId).order('completed_on', { ascending: false, nullsFirst: true }),
      supabase.from('staff_warnings').select('*').eq('staff_id', staffId).order('issued_on', { ascending: false }),
      supabase.from('staff_attendance_records').select('*').eq('staff_id', staffId).order('start_date', { ascending: false }),
    ]);
    if (hErr) setLoadError(hErr.message);
    setHr(h || {});
    setTraining(t || []);
    setWarnings(w || []);
    setAttendance(a || []);
  }

  async function loadAll() {
    setLoading(true);
    const [{ data: s }, { data: r }, { data: cls }, { data: cm }, { data: pr }] = await Promise.all([
      supabase.from('staff').select('staff_id, first_name, last_name, staff_code, email').eq('staff_id', staffId).maybeSingle(),
      supabase.from('staff_roles').select('role_name, scope_value').eq('staff_id', staffId),
      supabase
        .from('classes')
        .select('class_id, room, class_code, subjects(subject_name, display_name), timetable_slots(day_of_week, period_number, start_time, end_time)')
        .eq('staff_id', staffId),
      supabase.from('staff_commitments').select('day_of_week, period_number, label').eq('staff_id', staffId),
      supabase.from('periods').select('*').order('period_number'),
      loadHr(),
    ]);
    setStaff(s || null);
    setRoles(r || []);
    setClasses(cls || []);
    setCommitments(cm || []);
    setPeriods(pr || []);
    setLoading(false);
  }

  useEffect(() => { if (staffId) loadAll(); }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEditing() {
    const f = {};
    CORE_FIELDS.forEach((fd) => { f[fd.key] = staff[fd.key] ?? ''; });
    HR_FIELD_KEYS.forEach((k) => { f[k] = hr[k] ?? ''; });
    setForm(f);
    setEditing(true);
    setSaveStatus(null);
    setTab('overview');
  }

  async function saveOverview(e) {
    e.preventDefault();
    if (!form.first_name?.trim() || !form.last_name?.trim()) {
      setSaveStatus('First and last name are required.');
      return;
    }
    setSaving(true);
    const corePayload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      staff_code: form.staff_code ? form.staff_code.trim().toUpperCase() : null,
      email: blankToNull(form.email?.trim()),
    };
    const hrPayload = { staff_id: staffId, updated_by: session?.user?.id || null };
    HR_SECTIONS.forEach((sec) => sec.fields.forEach((fd) => {
      let v = blankToNull(typeof form[fd.key] === 'string' ? form[fd.key].trim() : form[fd.key]);
      if (fd.type === 'number' && v !== null) v = Number(v);
      hrPayload[fd.key] = v;
    }));

    // Only touch `staff` if something on it changed — an email change fires
    // the login-provisioning trigger, which shouldn't run on every save.
    const coreChanged = CORE_FIELDS.some((fd) => (corePayload[fd.key] ?? null) !== (staff[fd.key] ?? null));
    if (coreChanged) {
      const { error } = await supabase.from('staff').update(corePayload).eq('staff_id', staffId);
      if (error) { setSaving(false); setSaveStatus(`Error saving name/code/email: ${error.message}`); return; }
    }
    const { error } = await supabase.from('staff_hr_profiles').upsert(hrPayload, { onConflict: 'staff_id' });
    setSaving(false);
    if (error) { setSaveStatus(`Error: ${error.message}`); return; }
    setSaveStatus('Saved.');
    setEditing(false);
    loadAll();
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoStatus('Processing photo...');
    try {
      const base64 = await resizePhotoToBase64(file);
      setPhotoStatus('Uploading...');
      const { error } = await supabase
        .from('staff_hr_profiles')
        .upsert({ staff_id: staffId, photo_base64: base64, updated_by: session?.user?.id || null }, { onConflict: 'staff_id' });
      if (error) { setPhotoStatus(`Error: ${error.message}`); return; }
      setHr((h) => ({ ...h, photo_base64: base64 }));
      setPhotoStatus(null);
    } catch {
      setPhotoStatus('Could not process that file.');
    }
    e.target.value = '';
  }

  async function removePhoto() {
    if (!window.confirm('Remove this photo?')) return;
    const { error } = await supabase.from('staff_hr_profiles').update({ photo_base64: null }).eq('staff_id', staffId);
    if (error) { setPhotoStatus(`Error: ${error.message}`); return; }
    setHr((h) => ({ ...h, photo_base64: null }));
  }

  if (loading) return <p>Loading...</p>;
  if (!staff) return <p>Staff member not found. <a href="/staff/records">Back to Staff Records</a></p>;

  const today = schoolToday();
  const fullName = `${staff.first_name.trim()} ${staff.last_name.trim()}`;
  const clearance = clearanceStatus(hr, today);
  const totals = attendanceTotals(attendance, today);
  const liveWarnings = warnings.filter((w) => isWarningLive(w, today));
  const expiredTraining = training.filter((t) => isTrainingExpired(t, today));
  const yearLabel = academicYearLabel(today);

  // Timetable grid — same shape as /staff/timetable, read-only here.
  const cellMap = {};
  let lessonsPerWeek = 0;
  classes.forEach((c) => {
    (c.timetable_slots || []).forEach((slot) => {
      lessonsPerWeek += 1;
      const key = `${slot.day_of_week}-${slot.period_number}`;
      const entry = {
        subject: c.subjects?.display_name || c.subjects?.subject_name,
        room: c.room,
        classCode: c.class_code,
        time: formatTimeRange(slot.start_time, slot.end_time),
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
  });
  commitments.forEach((cm) => {
    const key = `${cm.day_of_week}-${cm.period_number}`;
    const entry = { commitment: true, label: cm.label?.trim() };
    cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
  });

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'timetable', label: 'Timetable', count: lessonsPerWeek },
    { key: 'training', label: 'Training', count: training.length },
    { key: 'warnings', label: 'Warnings', count: warnings.length, alert: liveWarnings.length > 0 },
    { key: 'attendance', label: 'Days off & lateness', count: attendance.length },
  ];

  return (
    <div className="staff-record">
      {/* A staff record prints as a single landscape sheet for the personnel file. */}
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } }'}</style>

      <div className="staff-record-topbar no-print">
        <a href="/staff/records">← All staff</a>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="secondary" onClick={() => window.print()}>Print</button>
          {canEdit && !editing && <button onClick={startEditing}>Edit details</button>}
        </div>
      </div>

      {loadError && (
        <div className="card" style={{ borderColor: '#e0a0a0', background: '#fde2e2' }}>
          <strong>HR details couldn&apos;t be loaded:</strong> {loadError}
          {/relation|does not exist|schema cache/i.test(loadError) && ' — the HR tables from migration 134 have not been created yet.'}
        </div>
      )}

      <div className="staff-record-layout">
        {/* ---------------- Left: identity ---------------- */}
        <aside className="card staff-record-id">
          <div className="staff-photo">
            {hr.photo_base64
              ? <img src={`data:image/jpeg;base64,${hr.photo_base64}`} alt={fullName} />
              : <span className="staff-photo-initials">{initials(staff)}</span>}
          </div>
          {canEdit && (
            <div className="no-print" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
              <label className="secondary hr-photo-btn">
                {hr.photo_base64 ? 'Change photo' : 'Add photo'}
                <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
              </label>
              {hr.photo_base64 && (
                <button className="secondary hr-small-btn" style={{ marginLeft: '0.35rem' }} onClick={removePhoto}>Remove</button>
              )}
              {photoStatus && <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{photoStatus}</div>}
            </div>
          )}

          <h1 className="staff-record-name">{fullName}</h1>
          <div className="staff-record-title">
            {hr.job_title || <span className="hr-empty">No job title recorded</span>}
            {hr.department ? ` · ${hr.department}` : ''}
          </div>
          {hr.leaving_date && (
            <div style={{ textAlign: 'center', marginTop: '0.4rem' }}>
              <span className={`badge hr-tone-${hr.leaving_date < today ? 'bad' : 'warn'}`}>
                {hr.leaving_date < today ? 'Left' : 'Leaving'} {formatUKDate(hr.leaving_date)}
              </span>
            </div>
          )}

          <dl className="staff-id-facts">
            <dt>Staff code</dt><dd>{staff.staff_code || '—'}</dd>
            <dt>School email</dt><dd style={{ wordBreak: 'break-all' }}>{staff.email || '—'}</dd>
            <dt>Phone</dt><dd>{hr.phone || '—'}</dd>
            <dt>Employment</dt><dd>{EMPLOYMENT_TYPES[hr.employment_type] || '—'}</dd>
          </dl>

          <div className="staff-id-roles">
            <div className="staff-id-roles-head">
              <span>Roles</span>
              {hasAccess('/staff/roles') && <a href="/staff/roles" className="no-print">Manage</a>}
            </div>
            {roles.length === 0
              ? <span className="hr-empty">Class Teacher (default)</span>
              : roles.map((r) => (
                <span key={r.role_name} className="staff-role-chip">
                  {ROLE_LABELS[r.role_name] || r.role_name}{r.scope_value ? ` · ${r.scope_value}` : ''}
                </span>
              ))}
          </div>

          {hr.updated_at && (
            <div className="hr-updated">Record last updated {formatUKDate(hr.updated_at.slice(0, 10))}</div>
          )}
        </aside>

        {/* ---------------- Right: summary + tabs ---------------- */}
        <section className="staff-record-main">
          <div className="hr-kpi-row">
            <Kpi
              label="Date of appointment"
              value={hr.date_of_appointment ? formatUKDate(hr.date_of_appointment) : '—'}
              sub={hr.date_of_appointment ? lengthOfService(hr.date_of_appointment, today) : 'Not recorded'}
            />
            <Kpi
              label="Police clearance"
              value={hr.police_clearance_date ? formatUKDate(hr.police_clearance_date) : '—'}
              sub={clearance.label + (hr.police_clearance_renewal_date ? ` · renew ${formatUKDate(hr.police_clearance_renewal_date)}` : '')}
              tone={clearance.tone}
            />
            <Kpi
              label={`Days off ${yearLabel}`}
              value={totals.daysOff}
              sub={hr.annual_leave_days != null
                ? `Annual leave ${totals.annualLeaveTaken} of ${Number(hr.annual_leave_days)} · sick ${totals.sickDays}`
                : `Sick ${totals.sickDays} · annual leave ${totals.annualLeaveTaken}`}
            />
            <Kpi
              label={`Days late ${yearLabel}`}
              value={totals.timesLate}
              sub={totals.minutesLate ? `${totals.minutesLate} minutes in total` : 'No minutes recorded'}
              tone={totals.timesLate >= 5 ? 'warn' : undefined}
            />
            <Kpi
              label="Live warnings"
              value={liveWarnings.length}
              sub={`${warnings.length} on file`}
              tone={liveWarnings.length ? 'bad' : undefined}
            />
            <Kpi
              label="Training"
              value={training.length}
              sub={expiredTraining.length ? `${expiredTraining.length} due for refresh` : 'All current'}
              tone={expiredTraining.length ? 'warn' : undefined}
            />
          </div>

          <div className="card hr-tabs-card">
            <div className="hr-tabs no-print" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`hr-tab ${tab === t.key ? 'is-active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.count > 0 && <span className={`hr-tab-count ${t.alert ? 'is-alert' : ''}`}>{t.count}</span>}
                </button>
              ))}
            </div>

            <div className="hr-tab-body">
              {/* ---------- Overview ---------- */}
              {tab === 'overview' && !editing && (
                <>
                  {saveStatus && <p style={{ fontSize: '0.85rem' }}>{saveStatus}</p>}
                  <div className="hr-sections">
                    {HR_SECTIONS.map((sec) => (
                      <div key={sec.title} className={`hr-section ${sec.wide ? 'is-wide' : ''}`}>
                        <h3>{sec.title}</h3>
                        <dl>
                          {sec.fields.map((fd) => (
                            <Fragment key={fd.key}>
                              <dt>{fd.label}</dt>
                              <dd style={fd.type === 'textarea' ? { whiteSpace: 'pre-wrap' } : undefined}>{displayValue(fd, hr[fd.key])}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {tab === 'overview' && editing && (
                <form onSubmit={saveOverview} className="hr-edit-form">
                  <div className="hr-section is-wide">
                    <h3>Name &amp; login</h3>
                    <div className="form-grid">
                      {CORE_FIELDS.map((fd) => (
                        <label key={fd.key}>
                          {fd.label}
                          <FieldInput field={fd} value={form[fd.key]} onChange={(v) => setForm((f) => ({ ...f, [fd.key]: v }))} />
                        </label>
                      ))}
                    </div>
                    <p className="hr-date-hint" style={{ marginTop: '0.25rem' }}>
                      Changing the school email creates a login for the new address if one doesn&apos;t already exist.
                    </p>
                  </div>
                  {HR_SECTIONS.map((sec) => (
                    <div key={sec.title} className="hr-section is-wide">
                      <h3>{sec.title}</h3>
                      <div className="form-grid">
                        {sec.fields.map((fd) => (
                          <label key={fd.key}>
                            {fd.label}
                            <FieldInput
                              field={fd}
                              value={form[fd.key]}
                              onChange={(v) => setForm((f) => ({ ...f, [fd.key]: v }))}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {saveStatus && <p style={{ width: '100%', fontSize: '0.85rem' }}>{saveStatus}</p>}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                    <button type="button" className="secondary" onClick={() => { setEditing(false); setSaveStatus(null); }}>Cancel</button>
                  </div>
                </form>
              )}

              {/* ---------- Timetable ---------- */}
              {tab === 'timetable' && (
                <>
                  <p className="hr-tab-intro">
                    {lessonsPerWeek} lesson{lessonsPerWeek === 1 ? '' : 's'} a week across {classes.length} class{classes.length === 1 ? '' : 'es'}
                    {commitments.length ? `, plus ${commitments.length} other commitment${commitments.length === 1 ? '' : 's'}` : ''}.
                  </p>
                  <div className="table-scroll">
                    <div className="timetable-grid" style={{ marginTop: 0 }}>
                      <div className="tt-head"></div>
                      {DAYS.map((d) => <div key={d} className="tt-head">{d}</div>)}
                      {periods.map((p) => (
                        <Fragment key={p.period_number}>
                          <div className="tt-cell tt-period-label">{p.period_name}</div>
                          {DAYS.map((d) => {
                            const entries = cellMap[`${d}-${p.period_number}`];
                            return (
                              <div key={`${d}-${p.period_number}`} className={`tt-cell ${entries ? 'tt-filled' : ''}`}>
                                {(entries || []).map((en, i) => (en.commitment ? (
                                  <div key={i} style={{ fontStyle: 'italic', opacity: 0.75 }}>{en.label}</div>
                                ) : (
                                  <div key={i} style={{ marginBottom: entries.length > 1 ? '0.3rem' : 0 }}>
                                    {en.classCode && <><strong>{en.classCode}</strong><br /></>}
                                    {en.subject}{en.room ? <span style={{ opacity: 0.6 }}> · {en.room}</span> : ''}
                                  </div>
                                )))}
                              </div>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ---------- Training ---------- */}
              {tab === 'training' && (
                <RecordList
                  table="staff_training"
                  staffId={staffId}
                  userId={session?.user?.id}
                  rows={training}
                  fields={TRAINING_FIELDS}
                  canEdit={canEdit}
                  addLabel="Add training"
                  emptyText="No training recorded yet."
                  onChanged={loadHr}
                  columns={[
                    { label: 'Course / training', render: (r) => <><strong>{r.title}</strong>{r.notes && <div className="hr-row-note">{r.notes}</div>}</> },
                    { label: 'Provider', render: (r) => r.provider || '—' },
                    { label: 'Completed', render: (r) => (r.completed_on ? formatUKDate(r.completed_on) : '—') },
                    {
                      label: 'Expires',
                      render: (r) => (r.expires_on ? (
                        <>
                          {formatUKDate(r.expires_on)}{' '}
                          {isTrainingExpired(r, today) && <span className="badge hr-tone-warn">Refresh due</span>}
                        </>
                      ) : '—'),
                    },
                    { label: 'Certificate', render: (r) => r.certificate_reference || '—' },
                  ]}
                />
              )}

              {/* ---------- Warnings ---------- */}
              {tab === 'warnings' && (
                <RecordList
                  table="staff_warnings"
                  staffId={staffId}
                  userId={session?.user?.id}
                  rows={warnings}
                  fields={WARNING_FIELDS}
                  canEdit={canEdit}
                  addLabel="Record a warning"
                  emptyText="No warnings on file."
                  defaults={{ issued_on: today, level: 'verbal' }}
                  onChanged={loadHr}
                  columns={[
                    { label: 'Issued', render: (r) => formatUKDate(r.issued_on) },
                    { label: 'Level', render: (r) => WARNING_LEVELS[r.level] || r.level },
                    { label: 'Reason', render: (r) => <>{r.reason}{r.notes && <div className="hr-row-note">{r.notes}</div>}</> },
                    { label: 'Issued by', render: (r) => r.issued_by || '—' },
                    {
                      label: 'Status',
                      render: (r) => (isWarningLive(r, today)
                        ? <span className="badge hr-tone-bad">Live{r.expires_on ? ` until ${formatUKDate(r.expires_on)}` : ''}</span>
                        : <span className="badge hr-tone-muted">Spent {formatUKDate(r.expires_on)}</span>),
                    },
                  ]}
                />
              )}

              {/* ---------- Days off & lateness ---------- */}
              {tab === 'attendance' && (
                <>
                  <div className="hr-att-summary">
                    <span><strong>{totals.daysOff}</strong> day{totals.daysOff === 1 ? '' : 's'} off in {yearLabel}</span>
                    <span><strong>{totals.sickDays}</strong> sick</span>
                    <span>
                      <strong>{totals.annualLeaveTaken}</strong> annual leave
                      {hr.annual_leave_days != null && ` of ${Number(hr.annual_leave_days)}`}
                    </span>
                    <span><strong>{totals.timesLate}</strong> late arrival{totals.timesLate === 1 ? '' : 's'} ({totals.minutesLate} min)</span>
                  </div>
                  <RecordList
                    table="staff_attendance_records"
                    staffId={staffId}
                    userId={session?.user?.id}
                    rows={attendance}
                    fields={ATTENDANCE_FIELDS}
                    canEdit={canEdit}
                    addLabel="Record day off or late arrival"
                    emptyText="No days off or late arrivals recorded."
                    defaults={{ record_type: 'sick', start_date: today, days: '1' }}
                    // A late arrival is never a day off, and a day off is never late.
                    prepare={(p) => (p.record_type === 'late'
                      ? { ...p, end_date: null, days: null }
                      : { ...p, minutes_late: null, days: p.days ?? 1 })}
                    onChanged={loadHr}
                    columns={[
                      {
                        label: 'Date',
                        render: (r) => (r.end_date && r.end_date !== r.start_date
                          ? `${formatUKDate(r.start_date)} – ${formatUKDate(r.end_date)}`
                          : formatUKDate(r.start_date)),
                      },
                      {
                        label: 'Type',
                        render: (r) => (
                          <span className={`badge ${r.record_type === 'late' || r.record_type === 'unauthorised_absence' ? 'hr-tone-warn' : 'hr-tone-muted'}`}>
                            {ATTENDANCE_TYPES[r.record_type] || r.record_type}
                          </span>
                        ),
                      },
                      {
                        label: 'Days / minutes',
                        render: (r) => (r.record_type === 'late'
                          ? (r.minutes_late != null ? `${r.minutes_late} min late` : 'Late')
                          : `${Number(r.days ?? 1)} day${Number(r.days ?? 1) === 1 ? '' : 's'}`),
                      },
                      { label: 'Reason / notes', render: (r) => r.reason || '—' },
                    ]}
                  />
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth><RequireResource resourceKey="/staff/records">
      <StaffRecord />
    </RequireResource></RequireAuth>
  );
}
