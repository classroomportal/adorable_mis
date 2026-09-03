'use client';
import { useEffect, useState, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function Collapsible({ title, defaultOpen = false, extra, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <h2 style={{ margin: 0 }}>{open ? '▾' : '▸'} {title}</h2>
        {extra && <span onClick={(e) => e.stopPropagation()}>{extra}</span>}
      </div>
      {open && <div style={{ marginTop: '0.75rem' }}>{children}</div>}
    </div>
  );
}


function StudentDetail() {
  const params = useParams();
  const id = params.id;
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [student, setStudent] = useState(null);
  const [parents, setParents] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [results, setResults] = useState([]);
  const [targetMap, setTargetMap] = useState({}); // subject_id -> target grade
  const [targetList, setTargetList] = useState([]); // all target grades for this student, incl. subjects with no results yet
  const [gradePoints, setGradePoints] = useState({}); // grade -> points
  const [cat4, setCat4] = useState([]);
  const [ngrt, setNgrt] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [fullView, setFullView] = useState(false);
  const [siblings, setSiblings] = useState([]);

  const [blocks, setBlocks] = useState([]); // curriculum_blocks applicable to this student's year
  const [blockClasses, setBlockClasses] = useState({}); // block_id -> [classes]
  const [blockSelections, setBlockSelections] = useState({}); // block_id -> class_id (current + edits)
  const [blockSaveStatus, setBlockSaveStatus] = useState(null);
  const [blocksError, setBlocksError] = useState(null);

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
        .neq('student_id', id);
      setSiblings(sibs || []);
    } else {
      setSiblings([]);
    }

    const { data: p } = await supabase
      .from('student_parent')
      .select('is_primary_contact, parents(first_name,last_name,phone,email,relationship_type)')
      .eq('student_id', id);
    setParents(p || []);

    const { data: pr } = await supabase.from('periods').select('*').order('period_number');
    setPeriods(pr || []);

    const { data: tt } = await supabase
      .from('student_class')
      .select('classes(class_id, room, subjects(subject_name), timetable_slots(day_of_week, period_number, start_time, end_time))')
      .eq('student_id', id);
    setTimetable(tt || []);

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
      .limit(30);
    setAttendance(att || []);

    const { data: r } = await supabase
      .from('results')
      .select('*, subjects(subject_name)')
      .eq('student_id', id)
      .order('week_start_date', { ascending: false });
    setResults(r || []);

    const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name)').eq('student_id', id);
    setTargetList(tg || []);
    setTargetMap(Object.fromEntries((tg || []).map((t) => [t.subject_id, t.target_grade])));
    const { data: gs } = await supabase.from('grade_scale').select('*');
    setGradePoints(Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)])));

    const { data: c4 } = await supabase.from('cat4_results').select('*').eq('student_id', id).order('test_date', { ascending: false });
    setCat4(c4 || []);

    const { data: ng } = await supabase.from('ngrt_results').select('*').eq('student_id', id).order('test_date', { ascending: false });
    setNgrt(ng || []);

    if (s.year_group) {
      const { data: cb, error: cbErr } = await supabase
        .from('curriculum_blocks')
        .select('block_id, block_name, band, classes!classes_block_id_fkey(class_id, class_code, room, subjects(subject_name), staff(first_name, last_name))')
        .eq('year_group', s.year_group)
        .order('block_name');
      if (cbErr) {
        setBlocksError(cbErr.message);
        setBlocks([]);
        setBlockClasses({});
      } else {
        setBlocksError(null);
        setBlocks(cb || []);
        const byBlock = {};
        (cb || []).forEach((b) => { byBlock[b.block_id] = b.classes || []; });
        setBlockClasses(byBlock);
      }
    } else {
      setBlocks([]);
      setBlockClasses({});
    }

    const { data: currentLinks } = await supabase
      .from('student_class')
      .select('class_id, block_id')
      .eq('student_id', id)
      .not('block_id', 'is', null);
    const sel = {};
    (currentLinks || []).forEach((l) => { sel[l.block_id] = l.class_id; });
    setBlockSelections(sel);

    setLoading(false);
  }

  useEffect(() => { loadAll(); }, [id]);

  async function handleSave(e) {
    e.preventDefault();
    setSaveStatus('Saving...');
    const today = new Date().toISOString().slice(0, 10);
    const computedStatus = (editForm.leaving_date && editForm.leaving_date <= today) ? 'left' : editForm.status;
    const { error } = await supabase
      .from('students')
      .update({
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
      })
      .eq('student_id', id);
    if (error) setSaveStatus(`Error: ${error.message}`);
    else {
      setSaveStatus('Saved.');
      setEditing(false);
      loadAll();
    }
  }

  async function handleBlockChange(blockId, newClassId) {
    setBlockSaveStatus('Saving...');
    setBlockSelections((prev) => ({ ...prev, [blockId]: newClassId || null }));

    // Remove any existing link for this block, then insert the new one (if a class was chosen)
    const { data: existing } = await supabase
      .from('student_class')
      .select('class_id')
      .eq('student_id', id)
      .eq('block_id', blockId);

    if (existing && existing.length > 0) {
      await supabase
        .from('student_class')
        .delete()
        .eq('student_id', id)
        .eq('block_id', blockId);
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

  // Build a lookup: cellMap[day][period_number] = { subject, room }
  const cellMap = {};
  timetable.forEach((tc) => {
    (tc.classes?.timetable_slots || []).forEach((slot) => {
      cellMap[`${slot.day_of_week}-${slot.period_number}`] = {
        subject: tc.classes?.subjects?.subject_name,
        room: tc.classes?.room,
      };
    });
  });

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;
  if (!student) return <p>Student not found (id: {id}).</p>;

  return (
    <div>
      <h1>{student.first_name} {student.last_name}</h1>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Core Data</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="secondary" onClick={() => setFullView(!fullView)}>
              {fullView ? 'Simple view' : 'Full view'}
            </button>
            {isAdmin && !editing && <button className="secondary" onClick={() => setEditing(true)}>Edit</button>}
          </div>
        </div>

        {student.photo_base64 && (
          <img
            src={`data:image/jpeg;base64,${student.photo_base64}`}
            alt={`${student.first_name} ${student.last_name}`}
            style={{ width: 140, height: 175, objectFit: 'cover', borderRadius: 8, margin: '0.75rem 0' }}
          />
        )}

        {!editing ? (
          <>
            <p><strong>Name:</strong> {student.first_name} {student.middle_name || ''} {student.last_name}</p>
            {student.preferred_name && <p><strong>Preferred name:</strong> {student.preferred_name}</p>}
            <p><strong>DOB:</strong> {student.dob}</p>
            <p><strong>Year group:</strong> {student.year_group} &nbsp; <strong>Form:</strong> {student.form_class}</p>
            <p><strong>Status:</strong> {student.status}{student.leaving_date ? ` (leaving date: ${student.leaving_date})` : ''}</p>

            {fullView && (
              <>
                <p><strong>UPN:</strong> {student.upn || '—'}</p>
                <p><strong>Legal first name:</strong> {student.legal_first_name || '—'}</p>
                <p><strong>Legal last name:</strong> {student.legal_last_name || '—'}</p>
                <p><strong>Student email:</strong> {student.student_email || '—'}</p>
                <p><strong>Admission date:</strong> {student.admission_date}</p>
                <p><strong>Admitted/letter date:</strong> {student.admitted_letter_date || '—'}</p>
                <p><strong>Gender:</strong> {student.gender || '—'}</p>
                <p><strong>Nationality:</strong> {student.nationality || '—'}</p>
                <p><strong>State of origin:</strong> {student.state_of_origin || '—'}</p>
                <p><strong>LGA:</strong> {student.lga || '—'}</p>
                <p><strong>Home town:</strong> {student.home_town || '—'}</p>
                <p><strong>Religion:</strong> {student.religion || '—'}</p>
                <p><strong>Boarding house:</strong> {student.boarding_house || '—'}</p>
                <p><strong>Boarding room number:</strong> {student.boarding_room_number || '—'}</p>
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
          </>
        ) : (
          <form onSubmit={handleSave} style={{ marginTop: '1rem' }}>
            <label>First name
              <input value={editForm.first_name || ''} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
            </label>
            <label>Middle name
              <input value={editForm.middle_name || ''} onChange={(e) => setEditForm({ ...editForm, middle_name: e.target.value })} />
            </label>
            <label>Last name
              <input value={editForm.last_name || ''} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
            </label>
            <label>Preferred/chosen name
              <input value={editForm.preferred_name || ''} onChange={(e) => setEditForm({ ...editForm, preferred_name: e.target.value })} />
            </label>
            <label>Legal first name
              <input value={editForm.legal_first_name || ''} onChange={(e) => setEditForm({ ...editForm, legal_first_name: e.target.value })} />
            </label>
            <label>Legal last name
              <input value={editForm.legal_last_name || ''} onChange={(e) => setEditForm({ ...editForm, legal_last_name: e.target.value })} />
            </label>
            <label>UPN
              <input value={editForm.upn || ''} onChange={(e) => setEditForm({ ...editForm, upn: e.target.value })} />
            </label>
            <label>Student email
              <input type="email" value={editForm.student_email || ''} onChange={(e) => setEditForm({ ...editForm, student_email: e.target.value })} />
            </label>
            <label>DOB
              <input type="date" value={editForm.dob || ''} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} />
            </label>
            <label>Year group
              <input type="number" value={editForm.year_group || ''} onChange={(e) => setEditForm({ ...editForm, year_group: e.target.value })} />
            </label>
            <label>Form class
              <input value={editForm.form_class || ''} onChange={(e) => setEditForm({ ...editForm, form_class: e.target.value })} />
            </label>
            <label>Admission date
              <input type="date" value={editForm.admission_date || ''} onChange={(e) => setEditForm({ ...editForm, admission_date: e.target.value })} />
            </label>
            <label>Admitted/letter date
              <input type="date" value={editForm.admitted_letter_date || ''} onChange={(e) => setEditForm({ ...editForm, admitted_letter_date: e.target.value })} />
            </label>
            <label>Gender
              <input value={editForm.gender || ''} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} />
            </label>
            <label>Nationality
              <input value={editForm.nationality || ''} onChange={(e) => setEditForm({ ...editForm, nationality: e.target.value })} />
            </label>
            <label>State of origin
              <input value={editForm.state_of_origin || ''} onChange={(e) => setEditForm({ ...editForm, state_of_origin: e.target.value })} />
            </label>
            <label>LGA
              <input value={editForm.lga || ''} onChange={(e) => setEditForm({ ...editForm, lga: e.target.value })} />
            </label>
            <label>Home town
              <input value={editForm.home_town || ''} onChange={(e) => setEditForm({ ...editForm, home_town: e.target.value })} />
            </label>
            <label>Religion
              <input value={editForm.religion || ''} onChange={(e) => setEditForm({ ...editForm, religion: e.target.value })} />
            </label>
            <label>Boarding house
              <input value={editForm.boarding_house || ''} onChange={(e) => setEditForm({ ...editForm, boarding_house: e.target.value })} />
            </label>
            <label>Boarding room number
              <input value={editForm.boarding_room_number || ''} onChange={(e) => setEditForm({ ...editForm, boarding_room_number: e.target.value })} />
            </label>
            <label>Sports house
              <input value={editForm.sports_house || ''} onChange={(e) => setEditForm({ ...editForm, sports_house: e.target.value })} />
            </label>
            <label>National identity number
              <input value={editForm.national_identity_number || ''} onChange={(e) => setEditForm({ ...editForm, national_identity_number: e.target.value })} />
            </label>
            <label>NECO exam number
              <input value={editForm.neco_exam_number || ''} onChange={(e) => setEditForm({ ...editForm, neco_exam_number: e.target.value })} />
            </label>
            <label>UTME PIN
              <input value={editForm.utme_pin || ''} onChange={(e) => setEditForm({ ...editForm, utme_pin: e.target.value })} />
            </label>
            <label>UTME profile code
              <input value={editForm.utme_profile_code || ''} onChange={(e) => setEditForm({ ...editForm, utme_profile_code: e.target.value })} />
            </label>
            <label>Address line 1
              <input value={editForm.address_line1 || ''} onChange={(e) => setEditForm({ ...editForm, address_line1: e.target.value })} />
            </label>
            <label>Address line 2
              <input value={editForm.address_line2 || ''} onChange={(e) => setEditForm({ ...editForm, address_line2: e.target.value })} />
            </label>
            <label>City
              <input value={editForm.city || ''} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            </label>
            <label>Postcode
              <input value={editForm.postcode || ''} onChange={(e) => setEditForm({ ...editForm, postcode: e.target.value })} />
            </label>
            <label>Country
              <input value={editForm.country || ''} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} />
            </label>
            <label>Emergency contact name
              <input value={editForm.emergency_contact_name || ''} onChange={(e) => setEditForm({ ...editForm, emergency_contact_name: e.target.value })} />
            </label>
            <label>Emergency contact phone
              <input value={editForm.emergency_contact_phone || ''} onChange={(e) => setEditForm({ ...editForm, emergency_contact_phone: e.target.value })} />
            </label>
            <label>Medical notes
              <input value={editForm.medical_notes || ''} onChange={(e) => setEditForm({ ...editForm, medical_notes: e.target.value })} />
            </label>
            <label>Leaving date
              <input type="date" value={editForm.leaving_date || ''} onChange={(e) => setEditForm({ ...editForm, leaving_date: e.target.value })} />
            </label>
            <label>Status
              <select value={editForm.status || 'active'} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="left">Left</option>
              </select>
            </label>
            {editForm.leaving_date && editForm.leaving_date <= new Date().toISOString().slice(0, 10) && (
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

      {siblings.length > 0 && (
        <Collapsible title="Siblings">
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
        </Collapsible>
      )}

      <Collapsible title="Parents / Guardians">
        {parents.length === 0 ? <p>None on record.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th>Primary</th></tr></thead>
              <tbody>
                {parents.map((pp, i) => (
                  <tr key={i}>
                    <td>{pp.parents?.first_name} {pp.parents?.last_name}</td>
                    <td>{pp.parents?.relationship_type}</td>
                    <td>{pp.parents?.phone}</td>
                    <td>{pp.parents?.email}</td>
                    <td>{pp.is_primary_contact ? 'Yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      <Collapsible title="Timetable">
        <div className="table-scroll">
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
                      {cell ? <>{cell.subject}<br /><span style={{ opacity: 0.6 }}>{cell.room}</span></> : ''}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Curriculum Blocks" extra={blockSaveStatus && <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>{blockSaveStatus}</span>}>
        {blocks.length === 0 ? (
          <p>{blocksError ? `Error loading blocks: ${blocksError}` : `No curriculum blocks are set up for Year ${student.year_group} yet.`}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Block</th><th>Class / Set</th></tr></thead>
              <tbody>
                {blocks.map((b) => {
                  const options = blockClasses[b.block_id] || [];
                  const currentClassId = blockSelections[b.block_id] || '';
                  return (
                    <tr key={b.block_id}>
                      <td>{b.block_name}{b.band && b.band !== 'a' ? ` (${b.band})` : ''}</td>
                      <td>
                        {isAdmin ? (
                          <select
                            value={currentClassId}
                            onChange={(e) => handleBlockChange(b.block_id, e.target.value || null)}
                          >
                            <option value="">— Not allocated —</option>
                            {options.map((c) => (
                              <option key={c.class_id} value={c.class_id}>
                                {c.class_code} — {c.subjects?.subject_name || ''}
                                {c.staff ? ` (${c.staff.first_name} ${c.staff.last_name})` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          options.find((c) => String(c.class_id) === String(currentClassId))?.class_code || 'Not allocated'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      <Collapsible title="Attendance">
        {attendance.length === 0 ? <p>No attendance recorded.</p> : (
          <>
            <p>
              <strong>{attendance.filter(a => a.status === 'present').length}</strong> present, {' '}
              <strong>{attendance.filter(a => a.status === 'late').length}</strong> late, {' '}
              <strong>{attendance.filter(a => a.status === 'authorized_absence').length}</strong> authorized absence, {' '}
              <strong>{attendance.filter(a => a.status === 'absent').length}</strong> unauthorized absence
            </p>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {attendance.map((a) => (
                    <tr key={a.attendance_id}><td>{a.attend_date}</td><td>{a.status}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Collapsible>

      <Collapsible title="Behaviour">
        {behaviour.length === 0 ? <p>No events logged.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th><th>Description</th></tr></thead>
              <tbody>
                {behaviour.map((b) => (
                  <tr key={b.event_id}>
                    <td>{b.event_date}</td>
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
      </Collapsible>

      <Collapsible title="Target Grades">
        {targetList.length === 0 ? <p>No target grades set for this student.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Target</th><th>Most recent grade</th><th>vs Target</th></tr></thead>
              <tbody>
                {targetList.map((t) => {
                  const latestResult = results.find((r) => r.subject_id === t.subject_id);
                  const targetPts = gradePoints[t.target_grade];
                  const gotPts = latestResult?.grade ? gradePoints[latestResult.grade.trim().toUpperCase()] : undefined;
                  let cmp = null;
                  if (targetPts !== undefined && gotPts !== undefined) {
                    cmp = gotPts > targetPts ? 'above' : gotPts < targetPts ? 'below' : 'on';
                  }
                  const style = { above: { background: '#dcf5e3', color: '#1a7a3d' }, on: { background: '#fdecad', color: '#8a6d00' }, below: { background: '#fbdede', color: '#a3232c' } }[cmp];
                  const label = { above: 'Above target', on: 'On target', below: 'Below target' }[cmp];
                  return (
                    <tr key={t.subject_id}>
                      <td>{t.subjects?.subject_name}</td>
                      <td>{t.target_grade}</td>
                      <td>{latestResult?.grade ?? '—'}</td>
                      <td>{cmp ? <span className="badge" style={style}>{label}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      <Collapsible title="Results">
        {results.length === 0 ? <p>No results recorded.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Week</th><th>Subject</th><th>Score</th><th>Grade</th><th>Target</th><th>vs Target</th></tr></thead>
              <tbody>
                {results.map((r) => {
                  const target = targetMap[r.subject_id];
                  const targetPts = target ? gradePoints[target] : undefined;
                  const gotPts = r.grade ? gradePoints[r.grade.trim().toUpperCase()] : undefined;
                  let cmp = null;
                  if (targetPts !== undefined && gotPts !== undefined) {
                    cmp = gotPts > targetPts ? 'above' : gotPts < targetPts ? 'below' : 'on';
                  }
                  const style = { above: { background: '#dcf5e3', color: '#1a7a3d' }, on: { background: '#fdecad', color: '#8a6d00' }, below: { background: '#fbdede', color: '#a3232c' } }[cmp];
                  const label = { above: 'Above target', on: 'On target', below: 'Below target' }[cmp];
                  return (
                    <tr key={r.result_id}>
                      <td>{r.week_start_date}</td>
                      <td>{r.subjects?.subject_name}</td>
                      <td>{r.score ?? '—'}{r.max_score ? ` / ${r.max_score}` : ''}</td>
                      <td>{r.grade ?? '—'}</td>
                      <td>{target ?? '—'}</td>
                      <td>{cmp ? <span className="badge" style={style}>{label}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      <Collapsible title="Predictive Assessment Data (CAT4 / NGRT)">
        {cat4.length === 0 && ngrt.length === 0 ? <p>No assessment data recorded.</p> : (
          <>
            {cat4.length > 0 && (
              <>
                <h3 style={{ fontSize: '1rem' }}>CAT4</h3>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Level</th><th>Mean SAS</th><th>Verbal</th><th>Non-verbal</th><th>Quantitative</th><th>Spatial</th></tr></thead>
                    <tbody>
                      {cat4.map((c) => (
                        <tr key={c.cat4_id}>
                          <td>{c.test_date}</td><td>{c.level}</td><td>{c.mean_sas}</td>
                          <td>{c.verbal_sas}</td><td>{c.non_verbal_sas}</td><td>{c.quantitative_sas}</td><td>{c.spatial_sas}</td>
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
                      {ngrt.map((n) => (
                        <tr key={n.ngrt_id}>
                          <td>{n.test_date}</td><td>{n.form}</td><td>{n.sas}</td>
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
      </Collapsible>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><StudentDetail /></RequireAuth>;
}
