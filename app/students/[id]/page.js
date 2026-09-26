'use client';
import { useEffect, useState, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { LESSON_COLUMNS, lessonRoom } from '../../../lib/lessons';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import TermTestScoresDownload from '../../components/TermTestScoresDownload';
import PublishedDocuments from '../../components/PublishedDocuments';
import MedicalRecordCard from '../../components/MedicalRecordCard';
import StudentParentsEditor from '../../components/StudentParentsEditor';
import KeyStageTranscriptDownload from '../../components/KeyStageTranscriptDownload';
import { useHashView, DashboardTile, DashboardBack } from '../../components/Dashboard';
import { classifyGrade, STYLE, LABEL, visibleTargets } from '../../../lib/gradeCompare';
import { groupResultSets } from '../../../lib/resultSets';
import { formatTimeRange } from '../../../lib/formatTime';
import { schoolToday, schoolWeekdayShort } from '../../../lib/schoolTime';
import { classGroupKey, groupClassesByKey } from '../../../lib/blockGroups';
import {
  AttendanceScopeCards,
  AttendanceTodayTable,
  AttendanceRecentTable,
  attendanceTodayLessons,
} from '../../components/AttendanceSummary';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// One section of the profile, opened from its tile. `extra` holds the
// section's own buttons (Edit, Print) beside the heading.
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


function StudentDetail() {
  const params = useParams();
  const id = params.id;
  const { profile, staffRoles, hasAccess } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canEditAssessment = isAdmin || (staffRoles || []).includes('assessment_manager');
  // Which Core Data fields this user may change is set per role at
  // /admin/permissions (migration 151) and enforced by a trigger on
  // students; fields outside it show read-only in the edit form.
  // Class allocation below stays admin-only.
  const [editableFields, setEditableFields] = useState(new Set());
  const canEditField = (key) => isAdmin || editableFields.has(key);
  const canEditCore = isAdmin || editableFields.size > 0;
  // The medical record is gated on its own resource key so
  // /admin/permissions can move it between roles. Writing is narrower
  // than seeing it: only the nurse (and admin) pass the RLS policies in
  // migration 128, so anyone else gets a read-only card rather than
  // buttons that fail on save.
  const canSeeMedical = hasAccess('/students/medical');
  const canEditMedical = isAdmin || (staffRoles || []).includes('nurse');
  // Parents and the student_parent links are writable by admin and the
  // school office under their RLS policies, so only they get the Edit button.
  const canEditParents = isAdmin || (staffRoles || []).includes('school_office');
  const [editingParents, setEditingParents] = useState(false);
  // Portal login state per linked parent (parent_login_status, migration 159)
  // and the outcome of the last Create login click, keyed by parent_id.
  const [parentLogins, setParentLogins] = useState({});
  const [loginOutcome, setLoginOutcome] = useState({});

  const [student, setStudent] = useState(null);
  const [parents, setParents] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [otherHalf, setOtherHalf] = useState([]); // chosen OH activities (other_half_timetable)
  const [periods, setPeriods] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [attendance, setAttendance] = useState([]); // most recent marks, newest first
  const [attendanceToday, setAttendanceToday] = useState([]); // today's marks, lesson by lesson
  const [attendanceSummary, setAttendanceSummary] = useState([]); // today / week / year, counted in the DB
  const [results, setResults] = useState([]);
  const [resultSetEvents, setResultSetEvents] = useState([]); // calendar_events flagged is_result_set
  const [resultSetKey, setResultSetKey] = useState(''); // '' = newest set
  const [targetMap, setTargetMap] = useState({}); // subject_id -> target grade
  const [targetList, setTargetList] = useState([]); // all target grades for this student, incl. subjects with no results yet
  const [enrolledSubjectIds, setEnrolledSubjectIds] = useState(new Set()); // subject_ids this student is timetabled for
  const [gradePoints, setGradePoints] = useState({}); // grade -> points
  const [gradeList, setGradeList] = useState([]); // grades, best first, for the target dropdown
  const [subjectsById, setSubjectsById] = useState({}); // subject_id -> display name

  // Assessment staff maintain targets and the CAT4/NGRT standardised scores.
  // As everywhere else in this app the real boundary is RLS — target_grades,
  // cat4_results and ngrt_results all carry assessment-manager write policies
  // — so this only decides whether the Edit buttons render.
  const [editingTargets, setEditingTargets] = useState(false);
  const [targetDraft, setTargetDraft] = useState({}); // subject_id -> grade ('' clears)
  const [targetStatus, setTargetStatus] = useState(null);
  const [editingScores, setEditingScores] = useState(false);
  const [cat4Draft, setCat4Draft] = useState([]);
  const [ngrtDraft, setNgrtDraft] = useState([]);
  const [scoreStatus, setScoreStatus] = useState(null);
  const [photoStatus, setPhotoStatus] = useState(null);
  const [cat4, setCat4] = useState([]);
  const [ngrt, setNgrt] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [fullView, setFullView] = useState(false);
  const [view, openView] = useHashView();
  const [siblings, setSiblings] = useState([]);

  const [blocks, setBlocks] = useState([]); // curriculum_blocks applicable to this student's year
  const [blockClasses, setBlockClasses] = useState({}); // block_id -> [classes]
  const [blockSelections, setBlockSelections] = useState({}); // block_id -> class_id, or group key for a compound block
  const [extraGroups, setExtraGroups] = useState({}); // block_id -> other group keys held in a compound block (should be none)
  const [otherYearClasses, setOtherYearClasses] = useState([]); // class_codes in blocks outside the student's year group
  const [blockSaveStatus, setBlockSaveStatus] = useState(null);
  const [blocksError, setBlocksError] = useState(null);
  const [boardingHouses, setBoardingHouses] = useState([]);
  const [sportsHouses, setSportsHouses] = useState([]);
  const [mentorGroups, setMentorGroups] = useState([]);

  useEffect(() => {
    async function loadLookups() {
      const { data: bh } = await supabase.from('boarding_houses').select('name').order('name');
      setBoardingHouses((bh || []).map((r) => r.name));
      const { data: sh } = await supabase.from('sports_houses').select('name').order('name');
      setSportsHouses((sh || []).map((r) => r.name));
      const { data: mg } = await supabase.from('mentor_groups').select('group_name').order('group_name');
      setMentorGroups((mg || []).map((r) => r.group_name));
    }
    loadLookups();
    supabase.rpc('my_editable_student_fields').then(({ data }) => setEditableFields(new Set(data || [])));
  }, []);

  async function loadParentLogins() {
    if (!canEditParents || parents.length === 0) { setParentLogins({}); return; }
    const { data } = await supabase.rpc('parent_login_status', { p_parent_ids: parents.map((pp) => pp.parent_id) });
    setParentLogins(Object.fromEntries((data || []).map((r) => [r.parent_id, r])));
  }
  useEffect(() => { loadParentLogins(); }, [parents, canEditParents]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createParentLogin(pp) {
    const name = `${pp.parents?.first_name || ''} ${pp.parents?.last_name || ''}`.trim() || 'this parent';
    if (!window.confirm(`Create a parent portal login for ${name} (${pp.parents?.email})?`)) return;
    setLoginOutcome((o) => ({ ...o, [pp.parent_id]: { busy: true } }));
    const { data, error } = await supabase.rpc('create_parent_login', { p_parent_id: pp.parent_id });
    const row = (data || [])[0];
    setLoginOutcome((o) => ({ ...o, [pp.parent_id]: error ? { error: error.message } : row }));
    loadParentLogins();
  }

  function renderLoginCell(pp) {
    const outcome = loginOutcome[pp.parent_id];
    if (outcome?.busy) return 'Creating...';
    if (outcome?.error) return <span style={{ color: 'var(--danger, #b91c1c)' }}>{outcome.error}</span>;
    if (outcome?.emailed) return `Created — login details emailed to ${outcome.login_email}`;
    if (outcome?.temp_password) {
      return (
        <span>
          Created. Parent emails are paused, so nothing was sent — give the parent these details now (they won&apos;t be shown again):
          <br /><strong>Login:</strong> {outcome.login_email}
          <br /><strong>Temporary password:</strong> <code>{outcome.temp_password}</code>
        </span>
      );
    }
    const st = parentLogins[pp.parent_id];
    if (!st) return '';
    if (st.has_login) return 'Has login';
    if (!pp.parents?.email) return 'No email';
    if (st.email_in_use) return 'Email used by another login';
    return <button className="secondary" onClick={() => createParentLogin(pp)}>Create login</button>;
  }

  async function loadAll() {
    const { data: s, error: sErr } = await supabase
      .from('students')
      .select('*')
      .eq('student_id', id)
      .maybeSingle();

    if (sErr) { setError(sErr.message); setLoading(false); return; }
    setStudent(s);
    setEditForm(s);
    if (!s) { setLoading(false); return; }

    if (s.family_id) {
      const { data: sibs } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, year_group, form_class')
        .eq('family_id', s.family_id)
        .eq('status', 'active')
        .neq('student_id', id);
      setSiblings(sibs || []);
    } else {
      setSiblings([]);
    }

    const { data: p } = await supabase
      .from('student_parent')
      .select('parent_id, is_primary_contact, parents(first_name,last_name,phone,email,address,relationship_type)')
      .eq('student_id', id);
    setParents(p || []);

    const { data: pr } = await supabase.from('periods').select('*').order('period_number');
    setPeriods(pr || []);

    const { data: tt } = await supabase
      .from('student_class')
      .select(`classes(class_id, room, subjects(subject_name, display_name), timetable_slots(${LESSON_COLUMNS}))`)
      .eq('student_id', id);
    setTimetable(tt || []);

    const { data: oh } = await supabase.from('other_half_timetable').select('*').eq('student_id', id);
    setOtherHalf(oh || []);

    const { data: be } = await supabase
      .from('behaviour_events')
      .select('*')
      .eq('student_id', id)
      .order('event_date', { ascending: false });
    setBehaviour(be || []);

    const { data: att } = await supabase
      .from('attendance')
      .select('*')
      .eq('student_id', id)
      .order('attend_date', { ascending: false })
      .order('period_number', { ascending: true })
      .limit(60);
    setAttendance(att || []);

    const { data: attToday } = await supabase
      .from('attendance')
      .select('attendance_id, period_number, code, status, minutes_late, notes')
      .eq('student_id', id)
      .eq('attend_date', schoolToday())
      .order('period_number');
    setAttendanceToday(attToday || []);

    // Counted in Postgres rather than in the browser: a full academic year is
    // well over a thousand marks per student, past PostgREST's default page
    // size, so totalling client-side would quietly under-report.
    const { data: attSummary } = await supabase.rpc('student_attendance_summary', { p_student_id: Number(id) });
    setAttendanceSummary(attSummary || []);

    const { data: r } = await supabase
      .from('results')
      .select('*, subjects(subject_name, display_name)')
      .eq('student_id', id)
      .order('week_start_date', { ascending: false });
    setResults(r || []);
    const { data: rse } = await supabase.from('calendar_events').select('event_id, event_name, event_date').eq('is_result_set', true);
    setResultSetEvents(rse || []);

    const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', id);
    setTargetList(tg || []);
    setTargetMap(Object.fromEntries((tg || []).map((t) => [t.subject_id, t.target_grade])));
    const { data: gs } = await supabase.from('grade_scale').select('*');
    setGradePoints(Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)])));
    // Best grade first, so the dropdown reads A* → U rather than alphabetically.
    setGradeList((gs || []).slice().sort((a, b) => Number(b.points) - Number(a.points)).map((g) => g.grade));

    // Needed to offer a target for a subject the student takes but has no
    // target row for yet — those subjects are absent from target_grades, so
    // the joined name isn't available from the query above.
    const { data: subs } = await supabase.from('subjects').select('subject_id, subject_name, display_name');
    setSubjectsById(Object.fromEntries((subs || []).map((s2) => [s2.subject_id, s2.display_name || s2.subject_name])));

    const { data: c4 } = await supabase.from('cat4_results').select('*').eq('student_id', id).order('test_date', { ascending: false });
    setCat4(c4 || []);

    const { data: ng } = await supabase.from('ngrt_results').select('*').eq('student_id', id).order('test_date', { ascending: false });
    setNgrt(ng || []);

    let byBlock = {};
    let compoundByBlock = {};
    let blocksLoaded = false;
    if (s.year_group) {
      const { data: cb, error: cbErr } = await supabase
        .from('curriculum_blocks')
        .select('block_id, block_name, band, is_compound, classes!classes_block_id_fkey(class_id, class_code, block_group, room, subjects(subject_name, display_name), staff(first_name, last_name))')
        .eq('year_group', s.year_group)
        .order('block_name');
      if (cbErr) {
        setBlocksError(cbErr.message);
        setBlocks([]);
        setBlockClasses({});
      } else {
        setBlocksError(null);
        setBlocks(cb || []);
        (cb || []).forEach((b) => { byBlock[b.block_id] = b.classes || []; compoundByBlock[b.block_id] = b.is_compound; });
        blocksLoaded = true;
        setBlockClasses(byBlock);
      }
    } else {
      setBlocks([]);
      setBlockClasses({});
    }

    // Read the live block_id via the classes join rather than trusting student_class.block_id:
    // that column is only a denormalised copy kept in sync by a trigger on insert/update of
    // student_class, so it goes stale whenever a class gets linked to a block afterwards.
    const { data: currentLinks } = await supabase
      .from('student_class')
      .select('class_id, classes(class_code, block_group, block_id, subject_id)')
      .eq('student_id', id);
    const sel = {};
    const groupsHeld = {};
    (currentLinks || []).forEach((l) => {
      const bId = l.classes?.block_id;
      if (!bId) return;
      if (compoundByBlock[bId]) {
        const key = classGroupKey(l.classes);
        (groupsHeld[bId] ||= new Set()).add(key);
        sel[bId] ||= key;
      } else {
        sel[bId] = l.class_id;
      }
    });
    setBlockSelections(sel);
    // A compound block is one group per student; more than one is a data
    // problem to show, not something the dropdown can represent.
    setExtraGroups(Object.fromEntries(Object.entries(groupsHeld)
      .filter(([, keys]) => keys.size > 1)
      .map(([bId, keys]) => [bId, [...keys].filter((k) => k !== sel[bId])])));
    // Classes in a block that isn't this student's year — typically left over
    // from before a year-group change. They still drive the timetable, but the
    // panel below only lists this year's blocks, so call them out explicitly.
    setOtherYearClasses(!blocksLoaded ? [] : (currentLinks || [])
      .filter((l) => l.classes?.block_id && !(l.classes.block_id in compoundByBlock))
      .map((l) => l.classes.class_code)
      .sort());
    setEnrolledSubjectIds(new Set((currentLinks || []).map((l) => l.classes?.subject_id).filter(Boolean)));

    setLoading(false);
  }

  useEffect(() => { loadAll(); }, [id]);

  // The subjects the Target Grades panel offers: what the student is
  // timetabled for, plus anything they already carry a target or a result in
  // so an existing row is never hidden from the person trying to correct it.
  function targetEditableSubjectIds() {
    const ids = new Set(enrolledSubjectIds);
    targetList.forEach((t) => ids.add(t.subject_id));
    results.forEach((r) => ids.add(r.subject_id));
    return [...ids].sort((a, b) => (subjectsById[a] || '').localeCompare(subjectsById[b] || ''));
  }

  function startEditingTargets() {
    setTargetDraft(Object.fromEntries(targetList.map((t) => [t.subject_id, t.target_grade])));
    setTargetStatus(null);
    setEditingTargets(true);
  }

  async function saveTargets() {
    setTargetStatus('Saving...');
    const current = Object.fromEntries(targetList.map((t) => [t.subject_id, t.target_grade]));
    const upserts = [];
    const clears = [];
    for (const [key, grade] of Object.entries(targetDraft)) {
      const subjectId = Number(key);
      const was = current[subjectId];
      if (grade) {
        if (grade !== was) upserts.push({ student_id: Number(id), subject_id: subjectId, target_grade: grade });
      } else if (was) {
        clears.push(subjectId);
      }
    }

    if (upserts.length === 0 && clears.length === 0) {
      setTargetStatus('No changes.');
      setEditingTargets(false);
      return;
    }

    if (upserts.length > 0) {
      const { error } = await supabase.from('target_grades').upsert(upserts, { onConflict: 'student_id,subject_id' });
      if (error) { setTargetStatus(`Error: ${error.message}`); return; }
    }
    if (clears.length > 0) {
      const { error } = await supabase.from('target_grades').delete().eq('student_id', id).in('subject_id', clears);
      if (error) { setTargetStatus(`Error: ${error.message}`); return; }
    }

    setEditingTargets(false);
    setTargetStatus(`Saved — ${upserts.length} set, ${clears.length} cleared.`);
    await loadAll();
  }

  function startEditingScores() {
    setCat4Draft(cat4.map((c) => ({ ...c })));
    setNgrtDraft(ngrt.map((n) => ({ ...n })));
    setScoreStatus(null);
    setEditingScores(true);
  }

  // '' means "not recorded" for every one of these columns, all of which are
  // nullable — sending an empty string instead would fail the numeric ones and
  // silently store a blank in the text ones.
  function blankToNull(value) {
    return value === '' || value === undefined ? null : value;
  }

  async function saveScores() {
    setScoreStatus('Saving...');
    let saved = 0;
    for (const row of cat4Draft) {
      const before = cat4.find((c) => c.cat4_id === row.cat4_id);
      const patch = {};
      for (const f of ['test_date', 'level', 'mean_sas', 'verbal_sas', 'non_verbal_sas', 'quantitative_sas', 'spatial_sas', 'profile']) {
        if (String(row[f] ?? '') !== String(before?.[f] ?? '')) patch[f] = blankToNull(row[f]);
      }
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from('cat4_results').update(patch).eq('cat4_id', row.cat4_id);
      if (error) { setScoreStatus(`Error saving CAT4 row: ${error.message}`); return; }
      saved++;
    }
    for (const row of ngrtDraft) {
      const before = ngrt.find((n) => n.ngrt_id === row.ngrt_id);
      const patch = {};
      for (const f of ['test_date', 'form', 'sas', 'pc_stanine', 'sc_stanine', 'overall_stanine', 'reading_age']) {
        if (String(row[f] ?? '') !== String(before?.[f] ?? '')) patch[f] = blankToNull(row[f]);
      }
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from('ngrt_results').update(patch).eq('ngrt_id', row.ngrt_id);
      if (error) { setScoreStatus(`Error saving NGRT row: ${error.message}`); return; }
      saved++;
    }

    setEditingScores(false);
    setScoreStatus(saved === 0 ? 'No changes.' : `Saved ${saved} row${saved === 1 ? '' : 's'}.`);
    if (saved > 0) await loadAll();
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaveStatus('Saving...');
    const today = schoolToday();
    const computedStatus = (editForm.leaving_date && editForm.leaving_date <= today) ? 'left' : editForm.status;
    const changes = {
      first_name: editForm.first_name,
      last_name: editForm.last_name,
      middle_name: editForm.middle_name,
      legal_first_name: editForm.legal_first_name,
      legal_last_name: editForm.legal_last_name,
      preferred_name: editForm.preferred_name,
      student_email: editForm.student_email,
      upn: editForm.upn || null,
      boarding_house: editForm.boarding_house,
      boarding_room_number: editForm.boarding_room_number,
      restaurant: editForm.restaurant,
      home_town: editForm.home_town,
      lga: editForm.lga,
      national_identity_number: editForm.national_identity_number,
      neco_exam_number: editForm.neco_exam_number,
      utme_pin: editForm.utme_pin,
      utme_profile_code: editForm.utme_profile_code,
      sports_house: editForm.sports_house,
      state_of_origin: editForm.state_of_origin,
      admitted_letter_date: editForm.admitted_letter_date || null,
      dob: editForm.dob,
      year_group: editForm.year_group,
      form_class: editForm.form_class,
      admission_date: editForm.admission_date,
      gender: editForm.gender,
      address_line1: editForm.address_line1,
      address_line2: editForm.address_line2,
      city: editForm.city,
      postcode: editForm.postcode,
      country: editForm.country,
      nationality: editForm.nationality,
      religion: editForm.religion,
      emergency_contact_name: editForm.emergency_contact_name,
      emergency_contact_phone: editForm.emergency_contact_phone,
      medical_notes: editForm.medical_notes,
      leaving_date: editForm.leaving_date || null,
      status: computedStatus,
    };
    // Send only the fields this user may edit; the trigger rejects the rest.
    const update = Object.fromEntries(Object.entries(changes).filter(([key]) => canEditField(key)));
    const { error } = await supabase
      .from('students')
      .update(update)
      .eq('student_id', id);
    if (error) setSaveStatus(`Error: ${error.message}`);
    else {
      setSaveStatus('Saved.');
      setEditing(false);
      loadAll();
    }
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoStatus('Processing photo...');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = dataUrl;
      });
      // Resize down to a passport-photo-ish size — plenty to recognise someone, a fraction of a raw phone photo
      const MAX_DIM = 400;
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const base64 = resizedDataUrl.split(',')[1];

      setPhotoStatus('Uploading...');
      const { error } = await supabase.from('students').update({ photo_base64: base64 }).eq('student_id', id);
      if (error) {
        setPhotoStatus(`Error: ${error.message}`);
      } else {
        setStudent((s) => ({ ...s, photo_base64: base64 }));
        setPhotoStatus('Photo updated.');
      }
    } catch {
      setPhotoStatus('Could not process that file.');
    }
  }

  async function handleBlockChange(blockId, newClassId) {
    setBlockSaveStatus('Saving...');
    setBlockSelections((prev) => ({ ...prev, [blockId]: newClassId || null }));

    // Remove any existing link for this block, then insert the new one (if a
    // class was chosen). Matched on the block's class_ids rather than
    // student_class.block_id, which is only a trigger-maintained copy of
    // classes.block_id and can go stale (see migration 073).
    const allClassIds = (blockClasses[blockId] || []).map((c) => c.class_id);
    if (allClassIds.length > 0) {
      const { error } = await supabase
        .from('student_class')
        .delete()
        .eq('student_id', id)
        .in('class_id', allClassIds);
      if (error) {
        setBlockSaveStatus(`Error: ${error.message}`);
        return;
      }
    }

    if (newClassId) {
      const { error } = await supabase
        .from('student_class')
        .insert({ student_id: id, class_id: newClassId });
      if (error) {
        setBlockSaveStatus(`Error: ${error.message}`);
        return;
      }
    }
    setBlockSaveStatus('Saved.');
    loadAll();
  }

  // For a compound block (Class, Pathway, Vocational) picking a group enrols
  // the student in every one of that group's classes at once — Pathway "101"
  // is Bi, Ch, Co, Cv and Ph — rather than in just a single class_id the way
  // handleBlockChange does for a normal single-subject block.
  async function handleGroupBlockChange(blockId, newKey) {
    setBlockSaveStatus('Saving...');
    setBlockSelections((prev) => ({ ...prev, [blockId]: newKey || null }));

    const allClassIds = (blockClasses[blockId] || []).map((c) => c.class_id);
    if (allClassIds.length > 0) {
      const { error } = await supabase
        .from('student_class')
        .delete()
        .eq('student_id', id)
        .in('class_id', allClassIds);
      if (error) {
        setBlockSaveStatus(`Error: ${error.message}`);
        return;
      }
    }

    if (newKey) {
      const newClassIds = (blockClasses[blockId] || [])
        .filter((c) => classGroupKey(c) === newKey)
        .map((c) => c.class_id);
      if (newClassIds.length > 0) {
        const { error } = await supabase
          .from('student_class')
          .insert(newClassIds.map((class_id) => ({ student_id: id, class_id })));
        if (error) {
          setBlockSaveStatus(`Error: ${error.message}`);
          return;
        }
      }
    }
    setBlockSaveStatus('Saved.');
    loadAll();
  }

  // Build a lookup: cellMap[day][period_number] = { subject, room, time }
  const cellMap = {};
  timetable.forEach((tc) => {
    (tc.classes?.timetable_slots || []).forEach((slot) => {
      cellMap[`${slot.day_of_week}-${slot.period_number}`] = {
        subject: tc.classes?.subjects?.display_name || tc.classes?.subjects?.subject_name,
        room: lessonRoom(slot, tc.classes),
        time: formatTimeRange(slot.start_time, slot.end_time),
      };
    });
  });
  // The activity chosen for each Other Half day replaces Nova-T's whole-year OH group.
  otherHalf.forEach((r) => {
    if (!r.period_number) return;
    cellMap[`${r.day_of_week}-${r.period_number}`] = {
      subject: r.activity_name,
      room: r.room,
      time: formatTimeRange(r.start_time, r.end_time),
    };
  });

  const periodName = (n) => periods.find((p) => p.period_number === n)?.period_name || (n ? `Period ${n}` : '—');

  const todayDayLabel = schoolWeekdayShort();
  const todayLessons = attendanceTodayLessons({
    periods,
    marks: attendanceToday,
    lessonFor: (n) => cellMap[`${todayDayLabel}-${n}`],
  });

  function renderTimetableGrid() {
    return (
      <div className="timetable-grid">
        <div className="tt-head"></div>
        {DAYS.map((d) => <div key={d} className="tt-head">{d}</div>)}
        {periods.map((p) => (
          <Fragment key={p.period_number}>
            <div className="tt-cell tt-period-label">{p.period_name}</div>
            {DAYS.map((d) => {
              const cell = cellMap[`${d}-${p.period_number}`];
              return (
                <div key={`${d}-${p.period_number}`} className={`tt-cell ${cell ? 'tt-filled' : ''}`}>
                  {cell ? (
                    <>
                      {cell.subject}<br />
                      <span style={{ opacity: 0.6 }}>{cell.room}</span><br />
                      <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{cell.time}</span>
                    </>
                  ) : ''}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    );
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;
  if (!student) return <p>Student not found (id: {id}).</p>;

  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
  const positiveCount = behaviour.filter((b) => b.type === 'positive').length;
  const negativeCount = behaviour.filter((b) => b.type === 'negative').length;
  const attendanceYear = attendanceSummary.find((r) => r.scope === 'year');
  const attendanceSessions = Number(attendanceYear?.sessions || 0);
  const attendancePct = attendanceSessions > 0
    ? Math.round(((Number(attendanceYear.present) + Number(attendanceYear.late)) / attendanceSessions) * 100)
    : null;
  const shownTargetCount = visibleTargets(targetList, results, enrolledSubjectIds).length;
  const allocatedBlocks = blocks.filter((b) => blockSelections[b.block_id]).length;

  // The tiles on the profile's front page; each opens one section below.
  const tiles = [
    { key: 'core', label: 'Core Data', icon: '🪪', sub: student.dob ? `Born ${formatUKDate(student.dob)}` : 'Personal details' },
    canSeeMedical && { key: 'medical', label: 'Medical', icon: '🩺', sub: 'Health record' },
    { key: 'parents', label: 'Parents / Guardians', icon: '👪', sub: parents.length === 0 ? 'None on record' : plural(parents.length, 'contact') },
    siblings.length > 0 && { key: 'siblings', label: 'Siblings', icon: '🧒', sub: `${plural(siblings.length, 'sibling')} at school` },
    { key: 'timetable', label: 'Timetable', icon: '🗓️', sub: `${student.first_name}'s week` },
    { key: 'blocks', label: 'Curriculum Blocks', icon: '🧩', sub: blocks.length === 0 ? 'None set up' : `${allocatedBlocks} of ${blocks.length} allocated` },
    { key: 'attendance', label: 'Attendance', icon: '📊', sub: attendancePct === null ? 'No data yet' : `${attendancePct}% this year` },
    { key: 'behaviour', label: 'Behaviour', icon: '📋', sub: behaviour.length === 0 ? 'No events logged' : `${positiveCount} positive, ${negativeCount} negative` },
    { key: 'targets', label: 'Target Grades', icon: '🎯', sub: shownTargetCount === 0 ? 'No targets set' : `${plural(shownTargetCount, 'subject')} tracked` },
    { key: 'results', label: 'Results', icon: '⭐', sub: results.length === 0 ? 'No results yet' : plural(groupResultSets(results, resultSetEvents).length, 'result set') },
    { key: 'predictive', label: 'CAT4 / NGRT', icon: '🧠', sub: cat4.length + ngrt.length === 0 ? 'No data recorded' : plural(cat4.length + ngrt.length, 'sitting') },
    { key: 'documents', label: 'Reports & Documents', icon: '📄', sub: 'Downloads' },
  ].filter(Boolean);
  // A hash for a section this user can't open (e.g. #medical) shows the tiles.
  const activeView = tiles.some((t) => t.key === view) ? view : null;

  return (
    <div className="dashboard-red">
      <div className="profile-hero no-print">
        {student.photo_base64 ? (
          <img className="profile-hero-photo" src={`data:image/jpeg;base64,${student.photo_base64}`} alt="" />
        ) : (
          <span className="profile-hero-photo">{student.first_name?.[0]}{student.last_name?.[0]}</span>
        )}
        <div>
          <h1>{student.first_name} {student.last_name}</h1>
          <div className="profile-hero-sub">
            {[student.year_group && `Year ${student.year_group}`, student.form_class, student.status !== 'active' && student.status].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      {activeView === null ? (
        <div className="dashboard-tiles">
          {tiles.map((t) => (
            <DashboardTile key={t.key} label={t.label} icon={t.icon} sub={t.sub} onClick={() => openView(t.key)} />
          ))}
        </div>
      ) : (
        <DashboardBack onClick={() => openView(null)}>Back to {student.first_name}&apos;s profile</DashboardBack>
      )}

      {activeView === 'documents' && (
        <Section title="Reports &amp; Documents">
          <TermTestScoresDownload studentId={student.student_id} />
          <KeyStageTranscriptDownload studentId={student.student_id} />
          <PublishedDocuments studentId={student.student_id} />
        </Section>
      )}

      {activeView === 'core' && (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Core Data</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="secondary" onClick={() => setFullView(!fullView)}>
              {fullView ? 'Simple view' : 'Full view'}
            </button>
            {canEditCore && !editing && <button className="secondary" onClick={() => setEditing(true)}>Edit</button>}
          </div>
        </div>

        <div style={{ overflow: 'hidden' }}>
          {(student.photo_base64 || canEditField('photo_base64')) && (
            <div style={{ float: 'left', marginRight: '1.25rem', marginBottom: '0.5rem', textAlign: 'center' }}>
              {student.photo_base64 && (
                <img
                  src={`data:image/jpeg;base64,${student.photo_base64}`}
                  alt={`${student.first_name} ${student.last_name}`}
                  style={{ width: 120, height: 150, objectFit: 'cover', borderRadius: 8, display: 'block' }}
                />
              )}
              {canEditField('photo_base64') && (
                <div style={{ marginTop: '0.4rem' }}>
                  <label className="secondary" style={{ display: 'inline-block', padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>
                    {student.photo_base64 ? 'Change photo' : 'Add photo'}
                    <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                  </label>
                  {photoStatus && <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>{photoStatus}</div>}
                </div>
              )}
            </div>
          )}

          {!editing ? (
            <div className="core-data-fields">
              <p><strong>Name:</strong> {student.first_name} {student.middle_name || ''} {student.last_name}</p>
              {student.preferred_name && <p><strong>Preferred name:</strong> {student.preferred_name}</p>}
              <p><strong>DOB:</strong> {formatUKDate(student.dob)}</p>
              <p><strong>Year group:</strong> {student.year_group} &nbsp; <strong>Form:</strong> {student.form_class}</p>
              <p><strong>Status:</strong> {student.status}{student.leaving_date ? ` (leaving date: ${formatUKDate(student.leaving_date)})` : ''}</p>

              {fullView && (
                <>
                  <p><strong>UPN:</strong> {student.upn || '—'}</p>
                  <p><strong>Admission number:</strong> {student.admission_number || '—'}</p>
                  <p><strong>Legal first name:</strong> {student.legal_first_name || '—'}</p>
                  <p><strong>Legal last name:</strong> {student.legal_last_name || '—'}</p>
                  <p><strong>Student email:</strong> {student.student_email || '—'}</p>
                  <p><strong>Admission date:</strong> {formatUKDate(student.admission_date) || '—'}</p>
                  <p><strong>Admitted/letter date:</strong> {formatUKDate(student.admitted_letter_date) || '—'}</p>
                  <p><strong>Gender:</strong> {student.gender || '—'}</p>
                  <p><strong>Nationality:</strong> {student.nationality || '—'}</p>
                  <p><strong>State of origin:</strong> {student.state_of_origin || '—'}</p>
                  <p><strong>LGA:</strong> {student.lga || '—'}</p>
                  <p><strong>Home town:</strong> {student.home_town || '—'}</p>
                  <p><strong>Religion:</strong> {student.religion || '—'}</p>
                  <p><strong>Boarding house:</strong> {student.boarding_house || '—'}</p>
                  <p><strong>Boarding room number:</strong> {student.boarding_room_number || '—'}</p>
                  <p><strong>Restaurant:</strong> {student.restaurant || '—'}</p>
                  <p><strong>Sports house:</strong> {student.sports_house || '—'}</p>
                  <p><strong>National identity number:</strong> {student.national_identity_number || '—'}</p>
                  <p><strong>NECO exam number:</strong> {student.neco_exam_number || '—'}</p>
                  <p><strong>UTME PIN:</strong> {student.utme_pin || '—'}</p>
                  <p><strong>UTME profile code:</strong> {student.utme_profile_code || '—'}</p>
                  <p><strong>Address:</strong> {[student.address_line1, student.address_line2, student.city, student.postcode, student.country].filter(Boolean).join(', ') || '—'}</p>
                  <p><strong>Emergency contact:</strong> {student.emergency_contact_name || '—'} {student.emergency_contact_phone ? `(${student.emergency_contact_phone})` : ''}</p>
                  <p><strong>Medical notes:</strong> {student.medical_notes || '—'}</p>
                </>
              )}
            </div>
          ) : (
          <form onSubmit={handleSave} style={{ marginTop: '1rem' }}>
            <label>First name
              <input disabled={!canEditField('first_name')} value={editForm.first_name || ''} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
            </label>
            <label>Middle name
              <input disabled={!canEditField('middle_name')} value={editForm.middle_name || ''} onChange={(e) => setEditForm({ ...editForm, middle_name: e.target.value })} />
            </label>
            <label>Last name
              <input disabled={!canEditField('last_name')} value={editForm.last_name || ''} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
            </label>
            <label>Preferred/chosen name
              <input disabled={!canEditField('preferred_name')} value={editForm.preferred_name || ''} onChange={(e) => setEditForm({ ...editForm, preferred_name: e.target.value })} />
            </label>
            <label>Legal first name
              <input disabled={!canEditField('legal_first_name')} value={editForm.legal_first_name || ''} onChange={(e) => setEditForm({ ...editForm, legal_first_name: e.target.value })} />
            </label>
            <label>Legal last name
              <input disabled={!canEditField('legal_last_name')} value={editForm.legal_last_name || ''} onChange={(e) => setEditForm({ ...editForm, legal_last_name: e.target.value })} />
            </label>
            <label>UPN
              <input disabled={!canEditField('upn')} value={editForm.upn || ''} onChange={(e) => setEditForm({ ...editForm, upn: e.target.value })} />
            </label>
            <label>Student email
              <input disabled={!canEditField('student_email')} type="email" value={editForm.student_email || ''} onChange={(e) => setEditForm({ ...editForm, student_email: e.target.value })} />
            </label>
            <label>DOB
              <input disabled={!canEditField('dob')} type="date" value={editForm.dob || ''} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} />
              {editForm.dob && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(editForm.dob)}</span>}
            </label>
            <label>Year group
              <input disabled={!canEditField('year_group')} type="number" value={editForm.year_group || ''} onChange={(e) => setEditForm({ ...editForm, year_group: e.target.value })} />
            </label>
            <label>Form class
              <select disabled={!canEditField('form_class')} value={editForm.form_class || ''} onChange={(e) => setEditForm({ ...editForm, form_class: e.target.value })}>
                <option value="">—</option>
                {mentorGroups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label>Admission date
              <input disabled={!canEditField('admission_date')} type="date" value={editForm.admission_date || ''} onChange={(e) => setEditForm({ ...editForm, admission_date: e.target.value })} />
              {editForm.admission_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(editForm.admission_date)}</span>}
            </label>
            <label>Admitted/letter date
              <input disabled={!canEditField('admitted_letter_date')} type="date" value={editForm.admitted_letter_date || ''} onChange={(e) => setEditForm({ ...editForm, admitted_letter_date: e.target.value })} />
              {editForm.admitted_letter_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(editForm.admitted_letter_date)}</span>}
            </label>
            <label>Gender
              <input disabled={!canEditField('gender')} value={editForm.gender || ''} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} />
            </label>
            <label>Nationality
              <input disabled={!canEditField('nationality')} value={editForm.nationality || ''} onChange={(e) => setEditForm({ ...editForm, nationality: e.target.value })} />
            </label>
            <label>State of origin
              <input disabled={!canEditField('state_of_origin')} value={editForm.state_of_origin || ''} onChange={(e) => setEditForm({ ...editForm, state_of_origin: e.target.value })} />
            </label>
            <label>LGA
              <input disabled={!canEditField('lga')} value={editForm.lga || ''} onChange={(e) => setEditForm({ ...editForm, lga: e.target.value })} />
            </label>
            <label>Home town
              <input disabled={!canEditField('home_town')} value={editForm.home_town || ''} onChange={(e) => setEditForm({ ...editForm, home_town: e.target.value })} />
            </label>
            <label>Religion
              <input disabled={!canEditField('religion')} value={editForm.religion || ''} onChange={(e) => setEditForm({ ...editForm, religion: e.target.value })} />
            </label>
            <label>Boarding house
              <select disabled={!canEditField('boarding_house')} value={editForm.boarding_house || ''} onChange={(e) => setEditForm({ ...editForm, boarding_house: e.target.value })}>
                <option value="">—</option>
                {boardingHouses.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label>Boarding room number
              <input disabled={!canEditField('boarding_room_number')} value={editForm.boarding_room_number || ''} onChange={(e) => setEditForm({ ...editForm, boarding_room_number: e.target.value })} />
            </label>
            <label>Sports house
              <select disabled={!canEditField('sports_house')} value={editForm.sports_house || ''} onChange={(e) => setEditForm({ ...editForm, sports_house: e.target.value })}>
                <option value="">—</option>
                {sportsHouses.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label>Restaurant
              <select disabled={!canEditField('restaurant')} value={editForm.restaurant || ''} onChange={(e) => setEditForm({ ...editForm, restaurant: e.target.value })}>
                <option value="">—</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </label>
            <label>National identity number
              <input disabled={!canEditField('national_identity_number')} value={editForm.national_identity_number || ''} onChange={(e) => setEditForm({ ...editForm, national_identity_number: e.target.value })} />
            </label>
            <label>NECO exam number
              <input disabled={!canEditField('neco_exam_number')} value={editForm.neco_exam_number || ''} onChange={(e) => setEditForm({ ...editForm, neco_exam_number: e.target.value })} />
            </label>
            <label>UTME PIN
              <input disabled={!canEditField('utme_pin')} value={editForm.utme_pin || ''} onChange={(e) => setEditForm({ ...editForm, utme_pin: e.target.value })} />
            </label>
            <label>UTME profile code
              <input disabled={!canEditField('utme_profile_code')} value={editForm.utme_profile_code || ''} onChange={(e) => setEditForm({ ...editForm, utme_profile_code: e.target.value })} />
            </label>
            <label>Address line 1
              <input disabled={!canEditField('address_line1')} value={editForm.address_line1 || ''} onChange={(e) => setEditForm({ ...editForm, address_line1: e.target.value })} />
            </label>
            <label>Address line 2
              <input disabled={!canEditField('address_line2')} value={editForm.address_line2 || ''} onChange={(e) => setEditForm({ ...editForm, address_line2: e.target.value })} />
            </label>
            <label>City
              <input disabled={!canEditField('city')} value={editForm.city || ''} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            </label>
            <label>Postcode
              <input disabled={!canEditField('postcode')} value={editForm.postcode || ''} onChange={(e) => setEditForm({ ...editForm, postcode: e.target.value })} />
            </label>
            <label>Country
              <input disabled={!canEditField('country')} value={editForm.country || ''} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} />
            </label>
            <label>Emergency contact name
              <input disabled={!canEditField('emergency_contact_name')} value={editForm.emergency_contact_name || ''} onChange={(e) => setEditForm({ ...editForm, emergency_contact_name: e.target.value })} />
            </label>
            <label>Emergency contact phone
              <input disabled={!canEditField('emergency_contact_phone')} value={editForm.emergency_contact_phone || ''} onChange={(e) => setEditForm({ ...editForm, emergency_contact_phone: e.target.value })} />
            </label>
            <label>Medical notes
              <input disabled={!canEditField('medical_notes')} value={editForm.medical_notes || ''} onChange={(e) => setEditForm({ ...editForm, medical_notes: e.target.value })} />
            </label>
            <label>Leaving date
              <input disabled={!canEditField('leaving_date')} type="date" value={editForm.leaving_date || ''} onChange={(e) => setEditForm({ ...editForm, leaving_date: e.target.value })} />
              {editForm.leaving_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(editForm.leaving_date)}</span>}
            </label>
            <label>Status
              <select disabled={!canEditField('status')} value={editForm.status || 'active'} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="left">Left</option>
              </select>
            </label>
            {editForm.leaving_date && editForm.leaving_date <= schoolToday() && (
              <p style={{ color: '#a3232c', flexBasis: '100%' }}>
                Leaving date has passed — status will be set to Left automatically on save.
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit">Save</button>
              <button type="button" className="secondary" onClick={() => { setEditing(false); setEditForm(student); }}>Cancel</button>
            </div>
            {saveStatus && <p>{saveStatus}</p>}
          </form>
        )}
        </div>
      </div>
      )}

      {canSeeMedical && activeView === 'medical' && (
        <MedicalRecordCard studentId={student.student_id} canEdit={canEditMedical} />
      )}

      {activeView === 'siblings' && (
        <Section title="Siblings">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Year</th><th>Form</th></tr></thead>
              <tbody>
                {siblings.map((sib) => (
                  <tr key={sib.student_id} className="student-link" onClick={() => window.location.href = `/students/${sib.student_id}`}>
                    <td>{sib.first_name} {sib.last_name}</td>
                    <td>{sib.year_group}</td>
                    <td>{sib.form_class}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {activeView === 'parents' && (
      <Section
        title="Parents / Guardians"
        extra={canEditParents && !editingParents && (
          <button className="secondary" onClick={() => setEditingParents(true)}>Edit</button>
        )}
      >
        {editingParents ? (
          <StudentParentsEditor
            studentId={id}
            links={parents}
            onCancel={() => setEditingParents(false)}
            onDone={() => { setEditingParents(false); loadAll(); }}
          />
        ) : parents.length === 0 ? <p>None on record.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th>Primary</th>{canEditParents && <th>Portal login</th>}</tr></thead>
              <tbody>
                {parents.map((pp) => (
                  <tr key={pp.parent_id}>
                    <td>{pp.parents?.first_name} {pp.parents?.last_name}</td>
                    <td>{pp.parents?.relationship_type}</td>
                    <td>{pp.parents?.phone}</td>
                    <td>{pp.parents?.email}</td>
                    <td>{pp.is_primary_contact ? 'Yes' : ''}</td>
                    {canEditParents && <td>{renderLoginCell(pp)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      )}

      {activeView === 'timetable' && (
      <Section
        title="Timetable"
        extra={<button className="secondary" onClick={() => window.print()}>Print</button>}
      >
        <div className="table-scroll">
          {renderTimetableGrid()}
        </div>
      </Section>
      )}

      <div className="timetable-print">
        <h2>{student.first_name} {student.last_name}</h2>
        <p>{student.form_class || ''}{student.form_class && student.year_group ? ' · ' : ''}{student.year_group ? `Year ${student.year_group}` : ''}</p>
        {renderTimetableGrid()}
      </div>

      {activeView === 'blocks' && (
      <Section title="Curriculum Blocks" extra={blockSaveStatus && <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>{blockSaveStatus}</span>}>
        {blocks.length === 0 ? (
          <p>{blocksError ? `Error loading blocks: ${blocksError}` : `No curriculum blocks are set up for Year ${student.year_group} yet.`}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Block</th><th>Class / Set</th></tr></thead>
              <tbody>
                {blocks.map((b) => {
                  const options = blockClasses[b.block_id] || [];
                  const byGroup = groupClassesByKey(options);
                  // Whether a group bundles several distinct subjects a student
                  // takes together (e.g. Pathway "101" = Bi+Ch+Co+Cv+Ph) is exactly
                  // what curriculum_blocks.is_compound already records — MFL/Option
                  // classes can share a prefix too (it's just the form code, e.g.
                  // "10a"), but that's one choice among them, not a bundle, so
                  // is_compound (not prefix grouping) is the signal.
                  const grouped = !!b.is_compound;
                  const currentValue = blockSelections[b.block_id] || '';
                  const extra = extraGroups[b.block_id] || [];
                  // Name a Pathway's handful of subjects; a form group's dozen-plus
                  // in the "Class" block would swamp the dropdown, so count those.
                  const groupSubjects = (classes) => (classes.length > 6
                    ? `${classes.length} subjects`
                    : classes.map((c) => c.subjects?.display_name || c.subjects?.subject_name || c.class_code).join(', '));
                  return (
                    <tr key={b.block_id}>
                      <td>{b.block_name}{b.band && b.band !== 'a' ? ` (${b.band})` : ''}</td>
                      <td>
                        {extra.length > 0 && (
                          <div style={{ fontSize: '0.85rem', color: '#8a5a00', marginBottom: '0.25rem' }}>
                            Also in {extra.join(', ')} — a student should be in only one group here.
                          </div>
                        )}
                        {isAdmin ? (
                          grouped ? (
                            <select
                              value={currentValue}
                              onChange={(e) => handleGroupBlockChange(b.block_id, e.target.value || null)}
                            >
                              <option value="">— Not allocated —</option>
                              {[...byGroup.entries()].map(([key, classes]) => (
                                <option key={key} value={key}>
                                  {key} — {groupSubjects(classes)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              value={currentValue}
                              onChange={(e) => handleBlockChange(b.block_id, e.target.value || null)}
                            >
                              <option value="">— Not allocated —</option>
                              {options.map((c) => (
                                <option key={c.class_id} value={c.class_id}>
                                  {c.class_code} — {c.subjects?.display_name || c.subjects?.subject_name || ''}
                                  {c.staff ? ` (${c.staff.first_name} ${c.staff.last_name})` : ''}
                                </option>
                              ))}
                            </select>
                          )
                        ) : grouped ? (
                          currentValue ? `${currentValue} — ${groupSubjects(byGroup.get(currentValue) || [])}` : 'Not allocated'
                        ) : (
                          options.find((c) => String(c.class_id) === String(currentValue))?.class_code || 'Not allocated'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {otherYearClasses.length > 0 && (
          <p style={{ fontSize: '0.85rem', color: '#8a5a00', marginTop: '0.5rem' }}>
            Still allocated to classes from another year group's blocks: {otherYearClasses.join(', ')}.
            Remove them from /admin/block-allocation for that year if they no longer apply.
          </p>
        )}
      </Section>
      )}

      {activeView === 'attendance' && (
      <Section title="Attendance">
        {attendanceSummary.length === 0 && attendance.length === 0 ? <p>No attendance recorded.</p> : (
          <>
            <AttendanceScopeCards summary={attendanceSummary} />

            <h3 style={{ margin: '0 0 0.4rem' }}>Today, lesson by lesson</h3>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#5b6472' }}>
              {formatUKDate(schoolToday())}
              {todayLessons.length === 0 && ' — nothing timetabled and no register taken.'}
            </p>
            <AttendanceTodayTable lessons={todayLessons} />

            <h3 style={{ margin: '1.25rem 0 0.4rem' }}>Recent marks</h3>
            {attendance.length === 0
              ? <p>No marks recorded yet.</p>
              : <AttendanceRecentTable marks={attendance} periodName={periodName} />}
          </>
        )}
      </Section>
      )}

      {activeView === 'behaviour' && (
      <Section title="Behaviour">
        {behaviour.length === 0 ? <p>No events logged.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th><th>Description</th></tr></thead>
              <tbody>
                {behaviour.map((b) => (
                  <tr key={b.event_id}>
                    <td>{formatUKDate(b.event_date)}</td>
                    <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                    <td>{b.category}</td>
                    <td>{b.points}</td>
                    <td>{b.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      )}

      {activeView === 'targets' && (
      <Section
        title="Target Grades"
        extra={canEditAssessment && (editingTargets ? (
          <>
            <button onClick={saveTargets}>Save targets</button>{' '}
            <button className="secondary" onClick={() => { setEditingTargets(false); setTargetStatus(null); }}>Cancel</button>
          </>
        ) : (
          <button className="secondary" onClick={startEditingTargets}>Edit</button>
        ))}
      >
        {targetStatus && <p>{targetStatus}</p>}
        {editingTargets ? (
          <>
            <p>
              Every subject {student.first_name} is timetabled for is listed, so a blank can be filled in.
              Clearing a target removes it.
            </p>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Subject</th><th>Target</th><th>Most recent grade</th></tr></thead>
                <tbody>
                  {targetEditableSubjectIds().map((subjectId) => {
                    const latestResult = results.find((r) => r.subject_id === subjectId);
                    return (
                      <tr key={subjectId}>
                        <td>{subjectsById[subjectId] || `Subject ${subjectId}`}</td>
                        <td>
                          <select
                            value={targetDraft[subjectId] ?? ''}
                            onChange={(e) => setTargetDraft({ ...targetDraft, [subjectId]: e.target.value })}
                          >
                            <option value="">—</option>
                            {gradeList.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </td>
                        <td>{latestResult?.grade ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (() => {
          // Narrowed to the subjects this student actually takes — see
          // visibleTargets for why enrolment rather than "has a result".
          // classifyGrade returns undefined without an actual grade, so a
          // target with no result yet renders with dashes in the last two
          // columns rather than being dropped.
          const sortedTargets = visibleTargets(targetList, results, enrolledSubjectIds);
          if (sortedTargets.length === 0) return <p>No target grades set for this student.</p>;
          return (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Target</th><th>Most recent grade</th><th>vs Target</th></tr></thead>
              <tbody>
                {sortedTargets.map((t) => {
                  const latestResult = results.find((r) => r.subject_id === t.subject_id);
                  const cmp = classifyGrade(t.target_grade, latestResult?.grade, gradePoints);
                  return (
                    <tr key={t.subject_id}>
                      <td>{t.subjects?.display_name || t.subjects?.subject_name}</td>
                      <td>{t.target_grade}</td>
                      <td>{latestResult?.grade ?? '—'}</td>
                      <td>{cmp ? <span className="badge" style={STYLE[cmp]}>{LABEL[cmp]}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })()}
      </Section>
      )}

      {activeView === 'results' && (() => {
        const resultSets = groupResultSets(results, resultSetEvents);
        const shownSet = resultSets.find((rs) => rs.key === resultSetKey) || resultSets[0];
        const label = (r) => r.subjects?.display_name || r.subjects?.subject_name || '';
        const shown = shownSet ? [...shownSet.results].sort((a, b) => label(a).localeCompare(label(b))) : [];
        return (
      <Section
        title="Results"
        extra={resultSets.length > 0 && (
          <select aria-label="Result set" value={shownSet.key} onChange={(e) => setResultSetKey(e.target.value)}>
            {resultSets.map((rs) => <option key={rs.key} value={rs.key}>{rs.label}</option>)}
          </select>
        )}
      >
        {results.length === 0 ? <p>No results recorded.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Score</th><th>Grade</th><th>Target</th><th>vs Target</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const target = targetMap[r.subject_id];
                  const cmp = classifyGrade(target, r.grade, gradePoints);
                  return (
                    <tr key={r.result_id}>
                      <td>{label(r)}</td>
                      <td>{r.score ?? '—'}{r.max_score ? ` / ${r.max_score}` : ''}</td>
                      <td>{r.grade ?? '—'}</td>
                      <td>{target ?? '—'}</td>
                      <td>{cmp ? <span className="badge" style={STYLE[cmp]}>{LABEL[cmp]}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
        );
      })()}

      {activeView === 'predictive' && (
      <Section
        title="Predictive Assessment Data (CAT4 / NGRT)"
        extra={canEditAssessment && (cat4.length > 0 || ngrt.length > 0) && (editingScores ? (
          <>
            <button onClick={saveScores}>Save scores</button>{' '}
            <button className="secondary" onClick={() => { setEditingScores(false); setScoreStatus(null); }}>Cancel</button>
          </>
        ) : (
          <button className="secondary" onClick={startEditingScores}>Edit</button>
        ))}
      >
        {scoreStatus && <p>{scoreStatus}</p>}
        {cat4.length === 0 && ngrt.length === 0 ? <p>No assessment data recorded.</p> : (
          <>
            {editingScores && (
              <p>
                Correcting what was recorded for a sitting. To add a sitting, use the
                assessment import — Mean SAS is stored as reported, not recalculated from
                the four batteries.
              </p>
            )}
            {cat4.length > 0 && (
              <>
                <h3 style={{ fontSize: '1rem' }}>CAT4</h3>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Level</th><th>Mean SAS</th><th>Verbal</th><th>Non-verbal</th><th>Quantitative</th><th>Spatial</th><th>Profile</th></tr></thead>
                    <tbody>
                      {editingScores ? cat4Draft.map((c, i) => (
                        <tr key={c.cat4_id}>
                          {[['test_date', 'date', '9rem'], ['level', 'text', '4rem'], ['mean_sas', 'number', '5rem'],
                            ['verbal_sas', 'number', '5rem'], ['non_verbal_sas', 'number', '5rem'],
                            ['quantitative_sas', 'number', '5rem'], ['spatial_sas', 'number', '5rem'],
                            ['profile', 'text', '11rem']].map(([field, type, width]) => (
                            <td key={field}>
                              <input
                                type={type}
                                style={{ width }}
                                value={c[field] ?? ''}
                                onChange={(e) => {
                                  const next = cat4Draft.slice();
                                  next[i] = { ...next[i], [field]: e.target.value };
                                  setCat4Draft(next);
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      )) : cat4.map((c) => (
                        <tr key={c.cat4_id}>
                          <td>{formatUKDate(c.test_date) || '—'}</td><td>{c.level ?? '—'}</td><td>{c.mean_sas}</td>
                          <td>{c.verbal_sas}</td><td>{c.non_verbal_sas}</td><td>{c.quantitative_sas}</td><td>{c.spatial_sas}</td>
                          <td>{c.profile ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {ngrt.length > 0 && (
              <>
                <h3 style={{ fontSize: '1rem', marginTop: '1rem' }}>NGRT</h3>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Form</th><th>SAS</th><th>PC Stanine</th><th>SC Stanine</th><th>Overall Stanine</th><th>Reading Age</th></tr></thead>
                    <tbody>
                      {editingScores ? ngrtDraft.map((n, i) => (
                        <tr key={n.ngrt_id}>
                          {[['test_date', 'date', '9rem'], ['form', 'text', '4rem'], ['sas', 'number', '5rem'],
                            ['pc_stanine', 'number', '5rem'], ['sc_stanine', 'number', '5rem'],
                            ['overall_stanine', 'number', '5rem'], ['reading_age', 'text', '6rem']].map(([field, type, width]) => (
                            <td key={field}>
                              <input
                                type={type}
                                style={{ width }}
                                value={n[field] ?? ''}
                                onChange={(e) => {
                                  const next = ngrtDraft.slice();
                                  next[i] = { ...next[i], [field]: e.target.value };
                                  setNgrtDraft(next);
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      )) : ngrt.map((n) => (
                        <tr key={n.ngrt_id}>
                          <td>{formatUKDate(n.test_date) || '—'}</td><td>{n.form}</td><td>{n.sas}</td>
                          <td>{n.pc_stanine}</td><td>{n.sc_stanine}</td><td>{n.overall_stanine}</td><td>{n.reading_age}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </Section>
      )}
    </div>
  );
}

export default function Page() {
  return <RequireAuth><StudentDetail /></RequireAuth>;
}
