'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { YEAR_GROUPS, STATUS_LABELS, applicantName, loadAcademicYears, errorText } from '../../../lib/admissions';
import { PreviousSchoolPicker, SiblingPicker } from '../../components/AdmissionPickers';
import ApplicantReadingAgeFields, { EMPTY_READING, readingToRow } from '../../components/ApplicantReadingAge';

const EMPTY_CONTACT = { name: '', relationship: '', email: '', phone: '' };

function NewApplicationInner() {
  const router = useRouter();
  const [years, setYears] = useState([]);
  const [schools, setSchools] = useState([]);
  const [form, setForm] = useState({
    first_name: '', middle_name: '', last_name: '', preferred_name: '',
    dob: '', gender: '', nationality: '',
    entry_academic_year_id: '', entry_year_group: '',
    previous_school_id: null, previous_school_year: '',
    heard_about_us: '', notes: '',
  });
  const [sibling, setSibling] = useState(null);
  const [reading, setReading] = useState({ ...EMPTY_READING });
  const [contacts, setContacts] = useState([{ ...EMPTY_CONTACT }]);
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [duplicates, setDuplicates] = useState([]);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAcademicYears().then(({ years: ys, defaultYearId }) => {
      setYears(ys);
      setForm((f) => ({ ...f, entry_academic_year_id: defaultYearId ?? '' }));
    });
    supabase.from('previous_schools').select('*').order('name').then(({ data }) => setSchools(data || []));
  }, []);

  // Warn (not block) when this child seems to be on file already for the
  // same entry year: same first and last name, and the same date of birth
  // when one is given.
  useEffect(() => {
    const first = form.first_name.trim();
    const last = form.last_name.trim();
    if (!first || !last || !form.entry_academic_year_id) { setDuplicates([]); return undefined; }
    const timer = setTimeout(async () => {
      let query = supabase
        .from('applicants')
        .select('applicant_id, first_name, last_name, preferred_name, dob, entry_year_group, status')
        .eq('entry_academic_year_id', form.entry_academic_year_id)
        .ilike('first_name', first.replace(/[%_]/g, ''))
        .ilike('last_name', last.replace(/[%_]/g, ''));
      if (form.dob) query = query.eq('dob', form.dob);
      const { data } = await query.limit(5);
      setDuplicates(data || []);
    }, 400);
    return () => clearTimeout(timer);
  }, [form.first_name, form.last_name, form.dob, form.entry_academic_year_id]);

  function set(key, value) { setForm((f) => ({ ...f, [key]: value })); }
  function setContact(i, key, value) { setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, [key]: value } : c))); }
  function removeContact(i) {
    setContacts((cs) => cs.filter((_, j) => j !== i));
    setPrimaryIndex((p) => (p === i ? 0 : p > i ? p - 1 : p));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) { setStatus('Give the child\'s first and last name.'); return; }
    if (!form.entry_academic_year_id || !form.entry_year_group) { setStatus('Choose the entry year and year group.'); return; }
    const filled = contacts.map((c, i) => ({ ...c, i })).filter((c) => c.name.trim() || c.email.trim() || c.phone.trim());
    if (filled.length === 0) { setStatus('Add at least one parent or guardian.'); return; }
    if (filled.some((c) => !c.name.trim())) { setStatus('Every contact needs a name.'); return; }
    const readingRow = readingToRow(reading);
    if (readingRow.error) { setStatus(readingRow.error); return; }

    setSaving(true);
    setStatus('Saving...');
    const row = {
      first_name: form.first_name.trim(),
      middle_name: form.middle_name.trim() || null,
      last_name: form.last_name.trim(),
      preferred_name: form.preferred_name.trim() || null,
      dob: form.dob || null,
      gender: form.gender || null,
      nationality: form.nationality.trim() || null,
      entry_academic_year_id: Number(form.entry_academic_year_id),
      entry_year_group: Number(form.entry_year_group),
      previous_school_id: form.previous_school_id,
      previous_school_year: form.previous_school_year.trim() || null,
      sibling_student_id: sibling?.student_id ?? null,
      heard_about_us: form.heard_about_us.trim() || null,
      notes: form.notes.trim() || null,
      ...readingRow,
    };
    const { data, error } = await supabase.from('applicants').insert(row).select('applicant_id').single();
    if (error) { setStatus(errorText(error)); setSaving(false); return; }

    const primary = filled.some((c) => c.i === primaryIndex) ? primaryIndex : filled[0].i;
    const contactRows = filled.map((c) => ({
      applicant_id: data.applicant_id,
      name: c.name.trim(),
      relationship: c.relationship.trim() || null,
      email: c.email.trim() || null,
      phone: c.phone.trim() || null,
      is_primary: c.i === primary,
    }));
    const { error: cErr } = await supabase.from('applicant_contacts').insert(contactRows);
    if (cErr) {
      setStatus(`The application was saved, but not its contacts: ${errorText(cErr)}. Add them on the applicant's page.`);
      setSaving(false);
      setTimeout(() => router.push(`/admissions/${data.applicant_id}`), 2500);
      return;
    }
    router.push(`/admissions/${data.applicant_id}`);
  }

  return (
    <div>
      <p style={{ margin: 0 }}><a href="/admissions">← Applicants</a></p>
      <h1>New application</h1>
      <form onSubmit={save}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>The child</h2>
          <div className="form-grid">
            <label>First name<input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required /></label>
            <label>Middle name<input value={form.middle_name} onChange={(e) => set('middle_name', e.target.value)} /></label>
            <label>Last name<input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} required /></label>
            <label>Preferred name<input value={form.preferred_name} onChange={(e) => set('preferred_name', e.target.value)} placeholder="If different" /></label>
            <label>
              Date of birth
              <input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} />
              {form.dob && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(form.dob)}</span>}
            </label>
            <label>
              Gender
              <select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="">—</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
              </select>
            </label>
            <label>Nationality<input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} /></label>
            <label>
              Entry year
              <select value={form.entry_academic_year_id} onChange={(e) => set('entry_academic_year_id', e.target.value)} required>
                <option value="">Choose...</option>
                {years.map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.label}</option>)}
              </select>
            </label>
            <label>
              Entering year group
              <select value={form.entry_year_group} onChange={(e) => set('entry_year_group', e.target.value)} required>
                <option value="">Choose...</option>
                {YEAR_GROUPS.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </label>
          </div>

          {duplicates.length > 0 && (
            <div style={{ marginTop: '0.75rem', background: '#fff8e1', border: '1px solid #f0c419', borderRadius: 4, padding: '0.5rem 0.75rem' }}>
              <strong>Possibly already on file for this entry year:</strong>
              <ul style={{ margin: '0.3rem 0 0' }}>
                {duplicates.map((d) => (
                  <li key={d.applicant_id}>
                    <a href={`/admissions/${d.applicant_id}`} target="_blank" rel="noreferrer">{applicantName(d)}</a>
                    {d.dob ? `, born ${formatUKDate(d.dob)}` : ''}, Year {d.entry_year_group}, {STATUS_LABELS[d.status] || d.status}
                  </li>
                ))}
              </ul>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.85em' }}>You can still save this as a new application if it is a different child.</p>
            </div>
          )}

          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
            <PreviousSchoolPicker
              value={form.previous_school_id}
              schools={schools}
              onChange={(id) => set('previous_school_id', id)}
              onAdded={(s) => setSchools((list) => [...list, s].sort((a, b) => a.name.localeCompare(b.name)))}
            />
            <div className="form-grid">
              <label>Year / class at previous school<input value={form.previous_school_year} onChange={(e) => set('previous_school_year', e.target.value)} placeholder="e.g. Year 6, Primary 6, JSS1" /></label>
              <label>How they heard about us<input value={form.heard_about_us} onChange={(e) => set('heard_about_us', e.target.value)} /></label>
            </div>
            <SiblingPicker value={sibling} onChange={setSibling} />
            <label>
              Notes
              <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Reading age</h2>
          <p style={{ color: '#666', marginTop: 0 }}>
            If the child was tested when they applied. It comes across to their reading age history when they are enrolled.
          </p>
          <ApplicantReadingAgeFields value={reading} onChange={setReading} dob={form.dob} />
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Parents and guardians</h2>
          <p style={{ color: '#666', marginTop: 0 }}>The main contact receives the letters.</p>
          {contacts.map((c, i) => (
            <fieldset key={i} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}>
              <legend>Contact {i + 1}</legend>
              <div className="form-grid">
                <label>Name<input value={c.name} onChange={(e) => setContact(i, 'name', e.target.value)} required={i === 0} /></label>
                <label>Relationship<input value={c.relationship} onChange={(e) => setContact(i, 'relationship', e.target.value)} placeholder="e.g. Mother" /></label>
                <label>Email<input type="email" value={c.email} onChange={(e) => setContact(i, 'email', e.target.value)} /></label>
                <label>Phone<input type="tel" value={c.phone} onChange={(e) => setContact(i, 'phone', e.target.value)} /></label>
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'row', gap: '0.4rem', alignItems: 'center', flex: '0 0 auto' }}>
                  <input type="radio" name="primary" style={{ width: 'auto' }} checked={primaryIndex === i} onChange={() => setPrimaryIndex(i)} />
                  Main contact
                </label>
                {contacts.length > 1 && <button type="button" className="secondary" onClick={() => removeContact(i)}>Remove</button>}
              </div>
            </fieldset>
          ))}
          {contacts.length < 2 && (
            <button type="button" className="secondary" onClick={() => setContacts((cs) => [...cs, { ...EMPTY_CONTACT }])}>+ Add a second contact</button>
          )}
        </div>

        {status && <p><strong>{status}</strong></p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" disabled={saving}>Save application</button>
          <button type="button" className="secondary" onClick={() => router.push('/admissions')}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

export default function NewApplicationPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/admissions">
      <NewApplicationInner />
    </RequireResource></RequireAuth>
  );
}
