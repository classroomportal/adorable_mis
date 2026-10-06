'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import {
  STATUS_LABELS, NEXT_STEPS, STEP_ACTIONS, STEPS_WITH_LETTERS, LETTER_KIND_LABELS, INTERESTS,
  YEAR_GROUPS, statusBadgeStyle, applicantName, formatMonths, ageInMonths, formatMoney,
  loadAcademicYears, errorText,
} from '../../../lib/admissions';
import { generateAdmissionLetterPdf } from '../../../lib/generateAdmissionLetterPdf';
import { PreviousSchoolPicker, SiblingPicker, schoolLabel } from '../../components/AdmissionPickers';
import ApplicantReadingAgeFields, { readingFromApplicant, readingToRow } from '../../components/ApplicantReadingAge';

// <input type="datetime-local"> works in the device's zone; the school is on
// Lagos time (UTC+1, no DST), so convert explicitly rather than trusting it.
// (The same approach as app/other-half/activities/page.js.)

const INTERVIEW_STAGES = new Set(['invited_to_interview', 'interviewed', 'waitlisted', 'offered', 'accepted', 'deposit_paid', 'enrolled']);
function toLagosLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() + 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}
function fromLagosLocalInput(v) {
  if (!v) return null;
  return new Date(`${v}:00+01:00`).toISOString();
}
// "15 Sep 2026 at 14:30", school time.
function formatDateTime(ts) {
  const local = toLagosLocalInput(ts);
  if (!local) return '';
  const [date, time] = local.split('T');
  return `${formatUKDate(date)} at ${time}`;
}

function sessionLabel(s) {
  if (!s) return '';
  return [
    formatUKDate(s.session_date, { weekday: true }),
    s.start_time ? s.start_time.slice(0, 5) : null,
    s.venue || null,
  ].filter(Boolean).join(' · ');
}

// Reading age against the child's age: "+8 months", "−1 y 2 m".
function formatGap(months) {
  if (months == null) return '';
  const sign = months < 0 ? '−' : '+';
  const abs = Math.abs(months);
  if (abs < 12) return `${sign}${abs} month${abs === 1 ? '' : 's'}`;
  return `${sign}${formatMonths(abs)}`;
}

// What happened to the letter, from book_admission_test() or
// post_admission_decision().
function letterOutcome(data) {
  if (!data) return null;
  if (data.note) return data.note;
  if (data.emailed_to) return `The letter was emailed to ${data.emailed_to}.`;
  if (data.letter_id) return 'The letter was produced but not emailed. Download it under Letters to print it.';
  return null;
}

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
const strOrNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

function Section({ title, extra, children }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {extra && <span>{extra}</span>}
      </div>
      <div style={{ marginTop: '0.75rem' }}>{children}</div>
    </div>
  );
}

function Msg({ text }) {
  if (!text) return null;
  return <p style={{ marginBottom: 0 }}><strong>{text}</strong></p>;
}

const CAT4_FIELDS = [
  ['verbal_sas', 'Verbal SAS'],
  ['quantitative_sas', 'Quantitative SAS'],
  ['non_verbal_sas', 'Non-verbal SAS'],
  ['spatial_sas', 'Spatial SAS'],
  ['mean_sas', 'Mean SAS'],
];

const EMPTY_CAT4 = { test_date: '', level: '', verbal_sas: '', quantitative_sas: '', non_verbal_sas: '', spatial_sas: '', mean_sas: '', profile: '' };

function ApplicantInner() {
  const { id } = useParams();
  const applicantId = Number(id);

  const [a, setA] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [years, setYears] = useState([]);
  const [schools, setSchools] = useState([]);
  const [staff, setStaff] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [sibling, setSibling] = useState(null);
  const [summary, setSummary] = useState(null);
  const [papers, setPapers] = useState([]);
  const [scores, setScores] = useState([]);
  const [cat4, setCat4] = useState(null);
  const [interview, setInterview] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [letters, setLetters] = useState([]);

  // Page-wide outcome of a status change (sticky, so it's seen).
  const [notice, setNotice] = useState(null);

  const [editDetails, setEditDetails] = useState(null);
  const [detailsSibling, setDetailsSibling] = useState(null);
  const [detailsMsg, setDetailsMsg] = useState(null);

  const [contactEdit, setContactEdit] = useState(null);
  const [contactMsg, setContactMsg] = useState(null);

  const [bookSessionId, setBookSessionId] = useState('');
  const [bookEmail, setBookEmail] = useState(true);
  const [bookMsg, setBookMsg] = useState(null);

  const [scoreDraft, setScoreDraft] = useState({ english: '', maths: '' });
  const [scoreMsg, setScoreMsg] = useState(null);
  const [cat4Draft, setCat4Draft] = useState(EMPTY_CAT4);
  const [cat4Msg, setCat4Msg] = useState(null);

  const [interviewDraft, setInterviewDraft] = useState(null);
  const [interviewMsg, setInterviewMsg] = useState(null);

  const [step, setStep] = useState(null);
  const [stepNotes, setStepNotes] = useState('');
  const [stepInterviewAt, setStepInterviewAt] = useState('');
  const [stepEmail, setStepEmail] = useState(true);
  const [stepMsg, setStepMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadAcademicYears().then(({ years: ys }) => setYears(ys));
    supabase.from('previous_schools').select('*').order('name').then(({ data }) => setSchools(data || []));
    supabase.from('staff').select('staff_id, first_name, last_name, staff_code').order('last_name').then(({ data }) => setStaff(data || []));
  }, []);

  async function load() {
    const { data: app, error } = await supabase
      .from('applicants')
      .select('*, previous_schools(*)')
      .eq('applicant_id', applicantId)
      .maybeSingle();
    if (error || !app) { setNotFound(true); return; }

    const [
      { data: cs }, { data: sum }, { data: ps }, { data: sc }, { data: c4 },
      { data: iv }, { data: ss }, { data: ls }, sib,
    ] = await Promise.all([
      supabase.from('applicant_contacts').select('*').eq('applicant_id', applicantId).order('is_primary', { ascending: false }).order('contact_id'),
      supabase.from('applicant_test_summary').select('*').eq('applicant_id', applicantId).maybeSingle(),
      supabase.from('admission_papers').select('*').eq('academic_year_id', app.entry_academic_year_id).eq('year_group', app.entry_year_group),
      supabase.from('admission_test_scores').select('*').eq('applicant_id', applicantId),
      supabase.from('admission_cat4').select('*').eq('applicant_id', applicantId).maybeSingle(),
      supabase.from('applicant_interviews').select('*').eq('applicant_id', applicantId).maybeSingle(),
      supabase.from('admission_sessions').select('*').eq('academic_year_id', app.entry_academic_year_id).order('session_date').order('start_time'),
      supabase.from('applicant_letters').select('*').eq('applicant_id', applicantId).order('sent_at', { ascending: false }),
      app.sibling_student_id
        ? supabase.from('students').select('student_id, first_name, last_name, year_group, form_class').eq('student_id', app.sibling_student_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    setA(app);
    setContacts(cs || []);
    setSummary(sum || null);
    setPapers(ps || []);
    setScores(sc || []);
    setCat4(c4 || null);
    setInterview(iv || null);
    setSessions(ss || []);
    setLetters(ls || []);
    setSibling(sib.data || null);
    setBookSessionId(app.session_id ? String(app.session_id) : '');

    const paperFor = (subject) => (ps || []).find((p) => p.subject === subject);
    const scoreFor = (subject) => {
      const p = paperFor(subject);
      const s = p && (sc || []).find((r) => r.paper_id === p.paper_id);
      return s ? String(Number(s.score)) : '';
    };
    setScoreDraft({ english: scoreFor('english'), maths: scoreFor('maths') });
    setCat4Draft(c4 ? Object.fromEntries(Object.keys(EMPTY_CAT4).map((k) => [k, c4[k] == null ? '' : String(c4[k])])) : EMPTY_CAT4);
    setInterviewDraft(interviewToDraft(iv));
  }

  useEffect(() => { if (applicantId) load(); }, [applicantId]);

  function interviewToDraft(iv) {
    const today = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      interviewed_on: iv?.interviewed_on || today,
      interviewer_staff_id: iv?.interviewer_staff_id ? String(iv.interviewer_staff_id) : '',
      reading_years: iv?.reading_age_months != null ? String(Math.floor(iv.reading_age_months / 12)) : '',
      reading_months: iv?.reading_age_months != null ? String(iv.reading_age_months % 12) : '',
      reading_test_name: iv?.reading_test_name || '',
      interests: iv?.interests || [],
      interests_other: iv?.interests_other || '',
      languages_spoken: iv?.languages_spoken || '',
      strengths: iv?.strengths || '',
      concerns: iv?.concerns || '',
      recommendation: iv?.recommendation || '',
      comments: iv?.comments || '',
    };
  }

  if (notFound) return <p>Applicant not found. <a href="/admissions">Back to applicants</a></p>;
  if (!a) return <p>Loading...</p>;

  const year = years.find((y) => y.academic_year_id === a.entry_academic_year_id);
  const primaryContact = contacts.find((c) => c.is_primary) || contacts[0];
  const letterEmail = primaryContact?.email?.trim() || null;
  const bookedSession = sessions.find((s) => s.session_id === a.session_id);

  // ---- Details ------------------------------------------------------------

  function startEditDetails() {
    setEditDetails({
      first_name: a.first_name, middle_name: a.middle_name || '', last_name: a.last_name,
      preferred_name: a.preferred_name || '', dob: a.dob || '', gender: a.gender || '',
      nationality: a.nationality || '', entry_academic_year_id: String(a.entry_academic_year_id),
      entry_year_group: String(a.entry_year_group), previous_school_id: a.previous_school_id,
      previous_school_year: a.previous_school_year || '', heard_about_us: a.heard_about_us || '',
      notes: a.notes || '',
      ...readingFromApplicant(a),
    });
    setDetailsSibling(sibling);
    setDetailsMsg(null);
  }

  async function saveDetails(e) {
    e.preventDefault();
    const d = editDetails;
    const readingRow = readingToRow(d);
    if (readingRow.error) { setDetailsMsg(readingRow.error); return; }
    const row = {
      first_name: d.first_name.trim(),
      middle_name: strOrNull(d.middle_name),
      last_name: d.last_name.trim(),
      preferred_name: strOrNull(d.preferred_name),
      dob: d.dob || null,
      gender: d.gender || null,
      nationality: strOrNull(d.nationality),
      previous_school_id: d.previous_school_id,
      previous_school_year: strOrNull(d.previous_school_year),
      sibling_student_id: detailsSibling?.student_id ?? null,
      heard_about_us: strOrNull(d.heard_about_us),
      notes: strOrNull(d.notes),
      ...readingRow,
    };
    // Only send the entry year and year group if they changed: the database
    // refuses changing them once the test is booked.
    if (Number(d.entry_academic_year_id) !== a.entry_academic_year_id) row.entry_academic_year_id = Number(d.entry_academic_year_id);
    if (Number(d.entry_year_group) !== a.entry_year_group) row.entry_year_group = Number(d.entry_year_group);
    setDetailsMsg('Saving...');
    const { error } = await supabase.from('applicants').update(row).eq('applicant_id', applicantId);
    if (error) { setDetailsMsg(errorText(error)); return; }
    setEditDetails(null);
    setDetailsMsg('Saved.');
    load();
  }

  // ---- Contacts -----------------------------------------------------------

  async function saveContact(e) {
    e.preventDefault();
    const c = contactEdit;
    if (!c.name.trim()) { setContactMsg('Give the contact a name.'); return; }
    const row = { name: c.name.trim(), relationship: strOrNull(c.relationship), email: strOrNull(c.email), phone: strOrNull(c.phone) };
    setContactMsg('Saving...');
    const { error } = c.contact_id
      ? await supabase.from('applicant_contacts').update(row).eq('contact_id', c.contact_id)
      : await supabase.from('applicant_contacts').insert({ ...row, applicant_id: applicantId, is_primary: contacts.length === 0 });
    if (error) { setContactMsg(errorText(error)); return; }
    setContactEdit(null);
    setContactMsg(null);
    load();
  }

  // Only one main contact is allowed (a unique index), so clear the old one
  // before setting the new one.
  async function makePrimary(c) {
    setContactMsg('Saving...');
    const { error: e1 } = await supabase.from('applicant_contacts').update({ is_primary: false })
      .eq('applicant_id', applicantId).eq('is_primary', true);
    if (e1) { setContactMsg(errorText(e1)); return; }
    const { error: e2 } = await supabase.from('applicant_contacts').update({ is_primary: true }).eq('contact_id', c.contact_id);
    setContactMsg(e2 ? errorText(e2) : `${c.name} is now the main contact.`);
    load();
  }

  async function deleteContact(c) {
    if (!window.confirm(`Remove ${c.name} from this application?`)) return;
    const { error } = await supabase.from('applicant_contacts').delete().eq('contact_id', c.contact_id);
    if (error) { setContactMsg(errorText(error)); return; }
    const rest = contacts.filter((x) => x.contact_id !== c.contact_id);
    if (c.is_primary && rest.length) {
      const { error: e2 } = await supabase.from('applicant_contacts').update({ is_primary: true }).eq('contact_id', rest[0].contact_id);
      setContactMsg(e2 ? errorText(e2) : `Removed. ${rest[0].name} is now the main contact.`);
    } else {
      setContactMsg(rest.length ? 'Removed.' : 'Removed. Add a contact, or no one will receive the letters.');
    }
    load();
  }

  // ---- Test ---------------------------------------------------------------

  async function bookTest() {
    if (!bookSessionId) { setBookMsg('Choose a test day.'); return; }
    setBusy(true);
    setBookMsg('Booking...');
    const { data, error } = await supabase.rpc('book_admission_test', {
      p_applicant_id: applicantId, p_session_id: Number(bookSessionId), p_send_email: bookEmail,
    });
    setBusy(false);
    if (error) { setBookMsg(errorText(error)); return; }
    setBookMsg(null);
    setNotice(['Test date booked.', letterOutcome(data)].filter(Boolean).join(' '));
    load();
  }

  async function saveScores() {
    setScoreMsg('Saving...');
    for (const subject of ['english', 'maths']) {
      const paper = papers.find((p) => p.subject === subject);
      if (!paper) continue;
      const raw = scoreDraft[subject].trim();
      const existing = scores.find((s) => s.paper_id === paper.paper_id);
      if (raw === '') {
        if (existing) {
          const { error } = await supabase.from('admission_test_scores').delete().eq('applicant_id', applicantId).eq('paper_id', paper.paper_id);
          if (error) { setScoreMsg(errorText(error)); load(); return; }
        }
        continue;
      }
      const score = Number(raw);
      if (!Number.isFinite(score) || score < 0) { setScoreMsg(`The ${subject === 'english' ? 'English' : 'Maths'} score must be a number, 0 or more.`); return; }
      if (existing && Number(existing.score) === score) continue;
      const { error } = await supabase.from('admission_test_scores')
        .upsert({ applicant_id: applicantId, paper_id: paper.paper_id, score }, { onConflict: 'applicant_id,paper_id' });
      if (error) { setScoreMsg(errorText(error)); load(); return; }
    }
    setScoreMsg('Scores saved.');
    load();
  }

  async function saveCat4() {
    const row = {
      applicant_id: applicantId,
      test_date: cat4Draft.test_date || null,
      level: strOrNull(cat4Draft.level),
      profile: strOrNull(cat4Draft.profile),
    };
    for (const [k, label] of CAT4_FIELDS) {
      const v = numOrNull(String(cat4Draft[k]).trim());
      if (v != null && !Number.isFinite(v)) { setCat4Msg(`${label} must be a number.`); return; }
      row[k] = v;
    }
    setCat4Msg('Saving...');
    const { error } = await supabase.from('admission_cat4').upsert(row, { onConflict: 'applicant_id' });
    if (error) { setCat4Msg(errorText(error)); return; }
    setCat4Msg('CAT4 saved.');
    load();
  }

  // ---- Interview ----------------------------------------------------------

  const readingMonthsDraft = interviewDraft && (interviewDraft.reading_years !== '' || interviewDraft.reading_months !== '')
    ? Number(interviewDraft.reading_years || 0) * 12 + Number(interviewDraft.reading_months || 0)
    : null;

  async function saveInterview(e) {
    e.preventDefault();
    const d = interviewDraft;
    if (!d.interviewed_on) { setInterviewMsg('Give the interview date.'); return; }
    const ry = d.reading_years === '' ? 0 : Number(d.reading_years);
    const rm = d.reading_months === '' ? 0 : Number(d.reading_months);
    if (!Number.isInteger(ry) || !Number.isInteger(rm) || ry < 0 || rm < 0 || rm > 11) {
      setInterviewMsg('Reading age: whole years, and months from 0 to 11.');
      return;
    }
    const row = {
      applicant_id: applicantId,
      interviewed_on: d.interviewed_on,
      interviewer_staff_id: d.interviewer_staff_id ? Number(d.interviewer_staff_id) : null,
      reading_age_months: readingMonthsDraft,
      reading_test_name: strOrNull(d.reading_test_name),
      interests: d.interests,
      interests_other: strOrNull(d.interests_other),
      languages_spoken: strOrNull(d.languages_spoken),
      strengths: strOrNull(d.strengths),
      concerns: strOrNull(d.concerns),
      recommendation: d.recommendation || null,
      comments: strOrNull(d.comments),
    };
    setInterviewMsg('Saving...');
    const { error } = await supabase.from('applicant_interviews').upsert(row, { onConflict: 'applicant_id' });
    if (error) { setInterviewMsg(errorText(error)); return; }
    setInterviewMsg('Interview saved.');
    load();
  }

  // ---- Decision -----------------------------------------------------------

  function openStep(s) {
    setStep(s);
    setStepNotes('');
    setStepInterviewAt(s === 'invited_to_interview' ? toLagosLocalInput(a.interview_at) : '');
    setStepEmail(true);
    setStepMsg(null);
  }

  async function postStep(e) {
    e.preventDefault();
    if (step === 'withdrawn' && !stepNotes.trim()) { setStepMsg('Say why the application was withdrawn.'); return; }
    if (step === 'invited_to_interview' && !stepInterviewAt) { setStepMsg('Give the interview date and time.'); return; }
    setBusy(true);
    setStepMsg('Saving...');
    const { data, error } = await supabase.rpc('post_admission_decision', {
      p_applicant_id: applicantId,
      p_status: step,
      p_notes: stepNotes.trim() || null,
      p_interview_at: step === 'invited_to_interview' ? fromLagosLocalInput(stepInterviewAt) : null,
      p_send_email: STEPS_WITH_LETTERS.has(step) ? stepEmail : false,
    });
    setBusy(false);
    if (error) { setStepMsg(errorText(error)); return; }
    setNotice([`Now: ${STATUS_LABELS[data?.status || step]}.`, letterOutcome(data)].filter(Boolean).join(' '));
    setStep(null);
    load();
  }

  async function downloadLetter(l) {
    try {
      await generateAdmissionLetterPdf({ letter: l, applicant: a });
    } catch (err) {
      setNotice(`Couldn't make the PDF: ${errorText(err)}`);
    }
  }

  const englishPaper = papers.find((p) => p.subject === 'english');
  const mathsPaper = papers.find((p) => p.subject === 'maths');
  const canBook = ['form_paid', 'test_booked'].includes(a.status);
  const nextSteps = NEXT_STEPS[a.status] || [];
  const childAgeAtInterview = interviewDraft ? ageInMonths(a.dob, interviewDraft.interviewed_on) : null;

  return (
    <div>
      <p style={{ margin: 0 }}><a href="/admissions">← Applicants</a></p>

      {notice && (
        <p style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff8e1', border: '1px solid #f0c419', borderRadius: 4, padding: '0.5rem 0.75rem' }}>
          <strong>{notice}</strong>{' '}
          <button type="button" className="secondary" style={{ marginLeft: '0.5rem' }} onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      {/* Header */}
      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{applicantName(a)}</h1>
          <span className="badge" style={{ ...statusBadgeStyle(a.status), fontSize: '0.85rem' }}>{STATUS_LABELS[a.status] || a.status}</span>
        </div>
        <p style={{ margin: '0.4rem 0 0', color: '#444' }}>
          Year {a.entry_year_group} · entry {year?.label || '…'}
          {a.previous_schools && <> · from {schoolLabel(a.previous_schools)}</>}
          {' · '}applied {formatUKDate(a.application_date)}
        </p>
      </div>

      {/* Details */}
      <Section title="Details" extra={!editDetails && <button type="button" className="secondary" onClick={startEditDetails}>Edit</button>}>
        {editDetails ? (
          <form onSubmit={saveDetails}>
            <div className="form-grid">
              <label>First name<input value={editDetails.first_name} onChange={(e) => setEditDetails({ ...editDetails, first_name: e.target.value })} required /></label>
              <label>Middle name<input value={editDetails.middle_name} onChange={(e) => setEditDetails({ ...editDetails, middle_name: e.target.value })} /></label>
              <label>Last name<input value={editDetails.last_name} onChange={(e) => setEditDetails({ ...editDetails, last_name: e.target.value })} required /></label>
              <label>Preferred name<input value={editDetails.preferred_name} onChange={(e) => setEditDetails({ ...editDetails, preferred_name: e.target.value })} /></label>
              <label>
                Date of birth
                <input type="date" value={editDetails.dob} onChange={(e) => setEditDetails({ ...editDetails, dob: e.target.value })} />
                {editDetails.dob && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(editDetails.dob)}</span>}
              </label>
              <label>
                Gender
                <select value={editDetails.gender} onChange={(e) => setEditDetails({ ...editDetails, gender: e.target.value })}>
                  <option value="">—</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </select>
              </label>
              <label>Nationality<input value={editDetails.nationality} onChange={(e) => setEditDetails({ ...editDetails, nationality: e.target.value })} /></label>
              <label>
                Entry year
                <select value={editDetails.entry_academic_year_id} onChange={(e) => setEditDetails({ ...editDetails, entry_academic_year_id: e.target.value })}>
                  {years.map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.label}</option>)}
                </select>
              </label>
              <label>
                Entering year group
                <select value={editDetails.entry_year_group} onChange={(e) => setEditDetails({ ...editDetails, entry_year_group: e.target.value })}>
                  {YEAR_GROUPS.map((y) => <option key={y} value={y}>Year {y}</option>)}
                </select>
              </label>
              <label>Year / class at previous school<input value={editDetails.previous_school_year} onChange={(e) => setEditDetails({ ...editDetails, previous_school_year: e.target.value })} /></label>
              <label>How they heard about us<input value={editDetails.heard_about_us} onChange={(e) => setEditDetails({ ...editDetails, heard_about_us: e.target.value })} /></label>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
              <PreviousSchoolPicker
                value={editDetails.previous_school_id}
                schools={schools}
                onChange={(sid) => setEditDetails((d) => ({ ...d, previous_school_id: sid }))}
                onAdded={(s) => setSchools((list) => [...list, s].sort((x, y) => x.name.localeCompare(y.name)))}
              />
              <SiblingPicker value={detailsSibling} onChange={setDetailsSibling} />
              <label>Notes<textarea rows={3} value={editDetails.notes} onChange={(e) => setEditDetails({ ...editDetails, notes: e.target.value })} /></label>
              <h3 style={{ margin: '0.5rem 0 0' }}>Reading age at application</h3>
              <ApplicantReadingAgeFields value={editDetails} onChange={(v) => setEditDetails(v)} dob={editDetails.dob} />
            </div>
            <Msg text={detailsMsg} />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="submit">Save details</button>
              <button type="button" className="secondary" onClick={() => { setEditDetails(null); setDetailsMsg(null); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <div className="table-scroll"><table>
              <tbody>
                <tr><th style={{ width: '14rem' }}>Full name</th><td>{[a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ')}{a.preferred_name ? ` (known as ${a.preferred_name})` : ''}</td></tr>
                <tr><th>Date of birth</th><td>{a.dob ? formatUKDate(a.dob) : '—'}</td></tr>
                <tr><th>Gender</th><td>{a.gender === 'F' ? 'Female' : a.gender === 'M' ? 'Male' : a.gender || '—'}</td></tr>
                <tr><th>Nationality</th><td>{a.nationality || '—'}</td></tr>
                <tr><th>Entry</th><td>Year {a.entry_year_group}, {year?.label || ''}</td></tr>
                <tr><th>Previous school</th><td>{a.previous_schools ? `${schoolLabel(a.previous_schools)}${a.previous_schools.curriculum ? ` · ${a.previous_schools.curriculum}` : ''}` : '—'}{a.previous_school_year ? ` (${a.previous_school_year})` : ''}</td></tr>
                <tr><th>Sibling at the school</th><td>{sibling ? <a href={`/students/${sibling.student_id}`}>{sibling.first_name} {sibling.last_name}</a> : '—'}{sibling ? ` · ${sibling.form_class || `Year ${sibling.year_group}`}` : ''}</td></tr>
                <tr><th>Heard about us</th><td>{a.heard_about_us || '—'}</td></tr>
                <tr><th>Notes</th><td style={{ whiteSpace: 'pre-wrap' }}>{a.notes || '—'}</td></tr>
                <tr><th>Reading age at application</th><td>{a.reading_age_months != null ? (
                  <>
                    {formatMonths(a.reading_age_months)}, tested {formatUKDate(a.reading_tested_on)}{a.reading_test_name ? ` (${a.reading_test_name})` : ''}
                    {a.dob && a.reading_tested_on && (() => {
                      const gap = a.reading_age_months - ageInMonths(a.dob, a.reading_tested_on);
                      return <> · difference <strong style={{ color: gap < 0 ? '#a3232c' : '#1a7a3d' }}>{formatGap(gap)}</strong></>;
                    })()}
                  </>
                ) : '—'}</td></tr>
              </tbody>
            </table></div>
            <Msg text={detailsMsg} />
          </>
        )}
      </Section>

      {/* Contacts */}
      <Section
        title="Parents and guardians"
        extra={!contactEdit && contacts.length < 4 && (
          <button type="button" className="secondary" onClick={() => { setContactEdit({ name: '', relationship: '', email: '', phone: '' }); setContactMsg(null); }}>+ Add contact</button>
        )}
      >
        {contacts.length === 0 && <p style={{ color: '#a3232c', marginTop: 0 }}>No contacts yet. Letters need a main contact.</p>}
        {contacts.length > 0 && (
          <div className="table-scroll"><table>
            <thead><tr><th>Name</th><th>Relationship</th><th>Email</th><th>Phone</th><th></th></tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.contact_id}>
                  <td>{c.name}{c.is_primary && <span className="badge" style={{ marginLeft: '0.4rem', background: '#e6eefb', color: '#1d4a8f' }}>Main contact</span>}</td>
                  <td>{c.relationship || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.phone || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="secondary" onClick={() => { setContactEdit({ contact_id: c.contact_id, name: c.name, relationship: c.relationship || '', email: c.email || '', phone: c.phone || '' }); setContactMsg(null); }}>Edit</button>{' '}
                    {!c.is_primary && <><button type="button" className="secondary" onClick={() => makePrimary(c)}>Make main contact</button>{' '}</>}
                    <button type="button" className="secondary" onClick={() => deleteContact(c)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {contactEdit && (
          <form onSubmit={saveContact} style={{ marginTop: '0.75rem', border: '1px solid #2f6fad', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
            <strong>{contactEdit.contact_id ? `Edit ${contactEdit.name || 'contact'}` : 'New contact'}</strong>
            <div className="form-grid">
              <label>Name<input value={contactEdit.name} onChange={(e) => setContactEdit({ ...contactEdit, name: e.target.value })} required /></label>
              <label>Relationship<input value={contactEdit.relationship} onChange={(e) => setContactEdit({ ...contactEdit, relationship: e.target.value })} placeholder="e.g. Father" /></label>
              <label>Email<input type="email" value={contactEdit.email} onChange={(e) => setContactEdit({ ...contactEdit, email: e.target.value })} /></label>
              <label>Phone<input type="tel" value={contactEdit.phone} onChange={(e) => setContactEdit({ ...contactEdit, phone: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="submit">Save contact</button>
              <button type="button" className="secondary" onClick={() => { setContactEdit(null); setContactMsg(null); }}>Cancel</button>
            </div>
          </form>
        )}
        <Msg text={contactMsg} />
      </Section>

      {/* Payments */}
      <Section title="Payments">
        <div className="table-scroll"><table>
          <thead><tr><th></th><th>Paid on</th><th>Amount</th><th>Receipt</th></tr></thead>
          <tbody>
            <tr>
              <th>Admission form</th>
              {a.form_fee_paid_on ? (
                <><td>{formatUKDate(a.form_fee_paid_on)}</td><td>{formatMoney(a.form_fee_amount) || '—'}</td><td>{a.form_fee_receipt || '—'}</td></>
              ) : (
                <td colSpan={3} style={{ color: '#666' }}>Not paid yet{year?.admission_form_fee != null ? ` (${formatMoney(year.admission_form_fee)})` : ''}. Recorded by the bursar.</td>
              )}
            </tr>
            <tr>
              <th>Deposit</th>
              {a.deposit_paid_on ? (
                <><td>{formatUKDate(a.deposit_paid_on)}</td><td>{formatMoney(a.deposit_amount) || '—'}</td><td>{a.deposit_receipt || '—'}</td></>
              ) : (
                <td colSpan={3} style={{ color: '#666' }}>Not paid yet{year?.admission_deposit != null ? ` (${formatMoney(year.admission_deposit)})` : ''}. Recorded by the bursar.</td>
              )}
            </tr>
          </tbody>
        </table></div>
      </Section>

      {/* Test */}
      <Section title="Entrance test">
        <h3 style={{ marginTop: 0 }}>Test day</h3>
        {bookedSession
          ? <p style={{ marginTop: 0 }}>Booked: <strong>{sessionLabel(bookedSession)}</strong></p>
          : <p style={{ marginTop: 0, color: '#666' }}>No test day booked.</p>}
        {canBook ? (
          sessions.length === 0 ? (
            <p style={{ color: '#666' }}>No test days are set up for {year?.label || 'this entry year'} yet. Add them on <a href="/admissions/sessions">Test days</a>.</p>
          ) : (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ flex: '1 1 16rem' }}>
                Test day
                <select value={bookSessionId} onChange={(e) => setBookSessionId(e.target.value)}>
                  <option value="">Choose...</option>
                  {sessions.map((s) => <option key={s.session_id} value={s.session_id}>{sessionLabel(s)}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'row', gap: '0.4rem', alignItems: 'center', flex: '0 0 auto' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={bookEmail} onChange={(e) => setBookEmail(e.target.checked)} disabled={!letterEmail} />
                {letterEmail ? `Email the letter to ${letterEmail}` : 'The main contact has no email address; the letter is kept here to print'}
              </label>
              <button type="button" onClick={bookTest} disabled={busy || !bookSessionId}>Book / change test date</button>
            </div>
          )
        ) : a.status === 'enquiry' ? (
          <p style={{ color: '#666' }}>A test date can be fixed once the bursar has recorded the admission form payment.</p>
        ) : null}
        <Msg text={bookMsg} />

        <h3>English and Maths</h3>
        <div className="form-grid">
          {[['english', 'English', englishPaper], ['maths', 'Maths', mathsPaper]].map(([subject, label, paper]) => (
            <label key={subject}>
              {label}{paper ? ` (out of ${Number(paper.max_score)}${paper.paper_name ? `, ${paper.paper_name}` : ''})` : ''}
              {paper ? (
                <input
                  type="number" min="0" max={Number(paper.max_score)} step="0.5" inputMode="decimal"
                  value={scoreDraft[subject]}
                  onChange={(e) => setScoreDraft({ ...scoreDraft, [subject]: e.target.value })}
                />
              ) : (
                <span style={{ display: 'block', color: '#b45309', padding: '0.4rem 0' }}>
                  No {label} paper set up for Year {a.entry_year_group}, {year?.label}. <a href="/admissions/papers">Set it up</a>.
                </span>
              )}
            </label>
          ))}
        </div>
        {(englishPaper || mathsPaper) && (
          <div style={{ marginTop: '0.5rem' }}>
            <button type="button" onClick={saveScores}>Save scores</button>
          </div>
        )}
        <Msg text={scoreMsg} />

        <div className="table-scroll" style={{ marginTop: '0.75rem' }}><table>
          <tbody>
            <tr><th style={{ width: '14rem' }}>English</th><td>{summary?.english_pct != null ? `${Number(summary.english_pct)}%` : '—'}</td></tr>
            <tr><th>Maths</th><td>{summary?.maths_pct != null ? `${Number(summary.maths_pct)}%` : '—'}</td></tr>
            <tr>
              <th>Average (pass mark {summary?.pass_mark != null ? `${Number(summary.pass_mark)}%` : '—'})</th>
              <td>
                {summary?.average_pct == null ? <span style={{ color: '#666' }}>Needs both English and Maths.</span> : (
                  <span style={{ color: summary.passed ? '#1a7a3d' : '#a3232c', fontWeight: 600 }}>
                    {Number(summary.average_pct)}% — {summary.passed ? 'pass' : 'below the pass mark'}
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table></div>

        <h3>CAT4</h3>
        <div className="form-grid">
          <label>
            Test date
            <input type="date" value={cat4Draft.test_date} onChange={(e) => setCat4Draft({ ...cat4Draft, test_date: e.target.value })} />
            {cat4Draft.test_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(cat4Draft.test_date)}</span>}
          </label>
          <label>Level<input value={cat4Draft.level} onChange={(e) => setCat4Draft({ ...cat4Draft, level: e.target.value })} placeholder="e.g. E" /></label>
          {CAT4_FIELDS.map(([k, label]) => (
            <label key={k}>
              {label}
              <input type="number" step="0.1" inputMode="decimal" value={cat4Draft[k]} onChange={(e) => setCat4Draft({ ...cat4Draft, [k]: e.target.value })} />
            </label>
          ))}
          <label>Profile<input value={cat4Draft.profile} onChange={(e) => setCat4Draft({ ...cat4Draft, profile: e.target.value })} placeholder="e.g. No bias" /></label>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button type="button" onClick={saveCat4}>Save CAT4</button>
        </div>
        <Msg text={cat4Msg} />
        {a.status === 'test_booked' && (
          <p style={{ color: '#666', fontSize: '0.85em', marginBottom: 0 }}>The applicant moves to Tested by itself once English, Maths and CAT4 are all in.</p>
        )}
      </Section>

      {/* Interview. Only once the child has been invited (or an interview is
          already on record): an interview saved earlier would make a later
          post-test decision send the "after the interview" letter. */}
      {interviewDraft && (interview || INTERVIEW_STAGES.has(a.status)) && (
        <Section title="Interview">
          {a.interview_at && <p style={{ marginTop: 0 }}>Interview arranged for <strong>{formatDateTime(a.interview_at)}</strong>.</p>}
          {!interview && a.status === 'invited_to_interview' && (
            <p style={{ marginTop: 0, color: '#666', fontSize: '0.9em' }}>Saving the interview moves the applicant to Interviewed.</p>
          )}
          <form onSubmit={saveInterview}>
            <div className="form-grid">
              <label>
                Interviewed on
                <input type="date" value={interviewDraft.interviewed_on} onChange={(e) => setInterviewDraft({ ...interviewDraft, interviewed_on: e.target.value })} required />
                {interviewDraft.interviewed_on && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(interviewDraft.interviewed_on)}</span>}
              </label>
              <label>
                Interviewer
                <select value={interviewDraft.interviewer_staff_id} onChange={(e) => setInterviewDraft({ ...interviewDraft, interviewer_staff_id: e.target.value })}>
                  <option value="">—</option>
                  {staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.first_name} {s.last_name}{s.staff_code ? ` (${s.staff_code})` : ''}</option>)}
                </select>
              </label>
              <label>Reading test used<input value={interviewDraft.reading_test_name} onChange={(e) => setInterviewDraft({ ...interviewDraft, reading_test_name: e.target.value })} /></label>
              <label>
                Reading age: years
                <input type="number" min="3" max="20" step="1" inputMode="numeric" value={interviewDraft.reading_years} onChange={(e) => setInterviewDraft({ ...interviewDraft, reading_years: e.target.value })} />
              </label>
              <label>
                and months
                <input type="number" min="0" max="11" step="1" inputMode="numeric" value={interviewDraft.reading_months} onChange={(e) => setInterviewDraft({ ...interviewDraft, reading_months: e.target.value })} />
              </label>
              <div style={{ fontSize: '0.9em', paddingTop: '1.2rem' }}>
                {readingMonthsDraft != null && <>Reading age <strong>{formatMonths(readingMonthsDraft)}</strong><br /></>}
                {childAgeAtInterview != null
                  ? <>Age on the day <strong>{formatMonths(childAgeAtInterview)}</strong></>
                  : <span style={{ color: '#666' }}>Add a date of birth to compare with age.</span>}
                {readingMonthsDraft != null && childAgeAtInterview != null && (
                  <><br />Difference <strong style={{ color: readingMonthsDraft - childAgeAtInterview < 0 ? '#a3232c' : '#1a7a3d' }}>{formatGap(readingMonthsDraft - childAgeAtInterview)}</strong></>
                )}
              </div>
              <label>Languages spoken<input value={interviewDraft.languages_spoken} onChange={(e) => setInterviewDraft({ ...interviewDraft, languages_spoken: e.target.value })} /></label>
              <label>
                Recommendation
                <select value={interviewDraft.recommendation} onChange={(e) => setInterviewDraft({ ...interviewDraft, recommendation: e.target.value })}>
                  <option value="">—</option>
                  <option value="offer">Offer a place</option>
                  <option value="waitlist">Waiting list</option>
                  <option value="reject">Unsuccessful</option>
                </select>
              </label>
            </div>
            <fieldset style={{ marginTop: '0.75rem', border: '1px solid #ddd', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
              <legend>Interests</legend>
              <div style={{ display: 'flex', gap: '0.4rem 1rem', flexWrap: 'wrap' }}>
                {INTERESTS.map((i) => (
                  <label key={i} style={{ display: 'flex', flexDirection: 'row', flex: '0 0 auto', gap: '0.3rem', alignItems: 'center' }}>
                    <input
                      type="checkbox" style={{ width: 'auto' }}
                      checked={interviewDraft.interests.includes(i)}
                      onChange={() => setInterviewDraft({
                        ...interviewDraft,
                        interests: interviewDraft.interests.includes(i)
                          ? interviewDraft.interests.filter((x) => x !== i)
                          : [...interviewDraft.interests, i],
                      })}
                    />
                    {i}
                  </label>
                ))}
              </div>
              <label style={{ marginTop: '0.5rem' }}>Other interests<input value={interviewDraft.interests_other} onChange={(e) => setInterviewDraft({ ...interviewDraft, interests_other: e.target.value })} /></label>
            </fieldset>
            <div className="form-grid" style={{ marginTop: '0.75rem' }}>
              <label>Strengths<textarea rows={2} value={interviewDraft.strengths} onChange={(e) => setInterviewDraft({ ...interviewDraft, strengths: e.target.value })} /></label>
              <label>Concerns<textarea rows={2} value={interviewDraft.concerns} onChange={(e) => setInterviewDraft({ ...interviewDraft, concerns: e.target.value })} /></label>
              <label>Comments<textarea rows={3} value={interviewDraft.comments} onChange={(e) => setInterviewDraft({ ...interviewDraft, comments: e.target.value })} /></label>
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <button type="submit">Save interview</button>
            </div>
            <Msg text={interviewMsg} />
          </form>
        </Section>
      )}

      {/* Decision */}
      <Section title="Status and decision">
        <p style={{ marginTop: 0 }}>
          Now: <span className="badge" style={statusBadgeStyle(a.status)}>{STATUS_LABELS[a.status] || a.status}</span>
        </p>
        {(a.decision_notes || a.decided_at || a.withdrawn_reason || a.accepted_at) && (
          <div className="table-scroll"><table>
            <tbody>
              {a.decided_at && <tr><th style={{ width: '14rem' }}>Last decision</th><td>{formatDateTime(a.decided_at)}</td></tr>}
              {a.decision_notes && <tr><th>Decision notes</th><td style={{ whiteSpace: 'pre-wrap' }}>{a.decision_notes}</td></tr>}
              {a.accepted_at && <tr><th>Offer accepted</th><td>{formatDateTime(a.accepted_at)}</td></tr>}
              {a.withdrawn_reason && <tr><th>Withdrawn because</th><td style={{ whiteSpace: 'pre-wrap' }}>{a.withdrawn_reason}</td></tr>}
            </tbody>
          </table></div>
        )}
        {nextSteps.length === 0 ? (
          <p style={{ color: '#666', marginBottom: 0 }}>No further steps from here.</p>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            {nextSteps.map((s) => (
              <button key={s} type="button" className={step === s ? undefined : 'secondary'} onClick={() => openStep(s)}>
                {STEP_ACTIONS[s] || STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
        {a.status === 'offered' && (
          <p style={{ color: '#666', fontSize: '0.85em' }}>Once the family accepts, the bursar records the deposit.</p>
        )}
        {step && (
          <form onSubmit={postStep} style={{ marginTop: '0.75rem', border: '1px solid #2f6fad', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
            <strong>{STEP_ACTIONS[step] || STATUS_LABELS[step]}</strong>
            {step === 'invited_to_interview' && (
              <label style={{ marginTop: '0.5rem' }}>
                Interview date and time (school time)
                <input type="datetime-local" value={stepInterviewAt} onChange={(e) => setStepInterviewAt(e.target.value)} required />
                {stepInterviewAt && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(stepInterviewAt.slice(0, 10), { weekday: true })} at {stepInterviewAt.slice(11, 16)}</span>}
              </label>
            )}
            <label style={{ marginTop: '0.5rem' }}>
              {step === 'withdrawn' ? 'Why was the application withdrawn? (required)' : 'Notes (optional)'}
              <textarea rows={2} value={stepNotes} onChange={(e) => setStepNotes(e.target.value)} required={step === 'withdrawn'} />
            </label>
            {STEPS_WITH_LETTERS.has(step) && (
              <label style={{ display: 'flex', flexDirection: 'row', gap: '0.4rem', alignItems: 'center', marginTop: '0.5rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={stepEmail && !!letterEmail} onChange={(e) => setStepEmail(e.target.checked)} disabled={!letterEmail} />
                {letterEmail ? `Email the letter to ${letterEmail}` : 'The main contact has no email address; the letter is kept here to print'}
              </label>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="submit" disabled={busy}>Confirm</button>
              <button type="button" className="secondary" onClick={() => { setStep(null); setStepMsg(null); }}>Cancel</button>
            </div>
            <Msg text={stepMsg} />
          </form>
        )}
      </Section>

      {/* Letters */}
      <Section title="Letters">
        {letters.length === 0 ? (
          <p style={{ color: '#666', margin: 0 }}>No letters yet.</p>
        ) : letters.map((l) => (
          <div key={l.letter_id} style={{ borderTop: '1px solid #eee', padding: '0.6rem 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <strong>{LETTER_KIND_LABELS[l.letter_kind] || l.letter_kind}</strong>: {l.subject}
                <div style={{ fontSize: '0.85em', color: '#666' }}>
                  {formatDateTime(l.sent_at)} · {l.emailed_to ? `emailed to ${l.emailed_to}` : 'not emailed'}
                </div>
              </div>
              <button type="button" className="secondary" onClick={() => downloadLetter(l)}>Download PDF</button>
            </div>
            <details style={{ marginTop: '0.3rem' }}>
              <summary style={{ cursor: 'pointer', color: '#2f6fad' }}>Preview</summary>
              <div style={{ whiteSpace: 'pre-wrap', background: '#fafafa', border: '1px solid #eee', borderRadius: 4, padding: '0.6rem 0.75rem', marginTop: '0.3rem' }}>
                {l.body}
              </div>
            </details>
          </div>
        ))}
      </Section>
    </div>
  );
}

export default function ApplicantPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/admissions">
      <ApplicantInner />
    </RequireResource></RequireAuth>
  );
}
