'use client';
import { Fragment, useEffect, useRef, useState, Suspense } from 'react';
import EventCommentEditor, { useCanEditEventComment } from '../components/EventCommentEditor';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { schoolToday, schoolDateOffset } from '../../lib/schoolTime';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';
import { resizePhotoToBase64 } from '../../lib/photo';
import BehaviourPhoto from '../components/BehaviourPhoto';

// boarding_room_number is text, so a plain sort puts "10" before "2". Sort the
// numeric ones by value and leave anything non-numeric (e.g. "3A") after them.
function compareRooms(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return String(a).localeCompare(String(b));
}

function BehaviourPageInner() {
  const { profile } = useAuth();
  const canEditComment = useCanEditEventComment();
  const [openEvent, setOpenEvent] = useState(null); // event_id whose comment is shown
  const searchParams = useSearchParams();

  const [mentorClasses, setMentorClasses] = useState([]);
  const [myClasses, setMyClasses] = useState([]); // timetabled lessons this person teaches
  const [allStudents, setAllStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [events, setEvents] = useState([]);

  const [boardingHouses, setBoardingHouses] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [yearGroups, setYearGroups] = useState([]);
  const [houseScope, setHouseScope] = useState(null);
  // Assume locked until my_house_access() answers, so a slow RPC never briefly
  // shows other houses to a house-only houseparent.
  const [houseScopeExclusive, setHouseScopeExclusive] = useState(true);
  const [showAllHouses, setShowAllHouses] = useState(!!searchParams.get('classId'));

  // /attendance links here as ?classId=<lesson>&date=<date> ("Log behaviour for
  // this class"). That class is a timetabled lesson, not a mentor group, and
  // the link has to survive the Houseparent defaults below — arriving from a
  // lesson means the viewer is teaching, not on house duty.
  const linkedClassId = searchParams.get('classId') || '';

  const [groupType, setGroupType] = useState(searchParams.get('groupType') || (linkedClassId ? 'mentor' : ''));
  const [classId, setClassId] = useState(linkedClassId); // mentor group or timetabled lesson class_id
  const [linkedClass, setLinkedClass] = useState(null); // the linked lesson, when it is not a mentor group
  const [boardingHouse, setBoardingHouse] = useState('');
  const [restaurant, setRestaurant] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState(new Set()); // rooms within the chosen house; empty = whole house

  const [roster, setRoster] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selected, setSelected] = useState(new Set()); // student_ids chosen from roster
  const [singleStudentId, setSingleStudentId] = useState(''); // used when no group chosen

  const [form, setForm] = useState({
    event_date: searchParams.get('date') || schoolToday(),
    type: 'positive', category: '', points: '', description: '',
  });
  const [status, setStatus] = useState(null);
  // One optional picture (migration 209), already shrunk to base64 JPEG.
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // On a slow connection staff assumed the first tap hadn't registered and
  // tapped again, logging every event twice. The ref blocks a second submit
  // synchronously (state alone can let a fast double tap through before the
  // re-render); the state drives the disabled button.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  // behaviour_events has two FKs to staff (staff_id and protocol_reviewed_by),
  // so a bare staff(...) embed is ambiguous: PostgREST rejects the whole query
  // and these lists came back empty while the homepage count (no embed) didn't.
  // Always name the FK.
  async function loadEvents() {
    const { data } = await supabase
      .from('behaviour_events')
      .select('event_id, event_date, type, category, points, description, staff_id, photo_id, students(student_id, first_name, last_name, boarding_house), staff!behaviour_events_staff_id_fkey(first_name, last_name)')
      .eq('is_demo', !!profile?.is_demo_account)
      .is('voided_at', null)
      .order('event_date', { ascending: false })
      .limit(20);
    setEvents(data || []);
  }

  // houseScope NULL means unscoped (admin, pastoral, SMT, etc.) — see
  // everything, same as today. A house means the viewer is a Houseparent, and
  // that house is their default: the group picker defaults to it, the
  // single-student list narrows to it, and the recent-events table only
  // shows it. A houseparent who also teaches or mentors (exclusive false, see
  // migration 126) can untick that and log behaviour for any student they meet
  // during the day; for a house-only houseparent the pickers stay locked.
  const canWidenScope = !!houseScope && !houseScopeExclusive;
  const activeHouseScope = houseScope && !(canWidenScope && showAllHouses) ? houseScope : null;

  const scopedEvents = activeHouseScope ? events.filter((e) => e.students?.boarding_house === activeHouseScope) : events;
  const scopedAllStudents = activeHouseScope ? allStudents.filter((s) => s.boarding_house === activeHouseScope) : allStudents;

  // Room numbers restart at 1 in every house — there is a room 1 in Birmingham
  // and a room 1 in Buckingham — so the list is always derived from the house
  // currently chosen, and the roster below filters on house AND room.
  const roomsInHouse = boardingHouse
    ? [...new Set(
        allStudents
          .filter((s) => s.boarding_house === boardingHouse)
          .map((s) => s.boarding_room_number)
          .filter(Boolean)
      )].sort(compareRooms)
    : [];

  // The lesson followed in from /attendance may be someone else's class (a
  // cover lesson), so it is offered even when it is in neither list.
  const knownClass = (id) => myClasses.some((c) => c.class_id === id) || mentorClasses.some((c) => c.class_id === id);
  const extraClasses = linkedClass && !knownClass(linkedClass.class_id) ? [linkedClass] : [];
  const hasClassOptions = myClasses.length + mentorClasses.length + extraClasses.length > 0;
  const classLabel = (c) => (c.subjects?.subject_name ? `${c.class_code} — ${c.subjects.subject_name}` : c.class_code || `Class ${c.class_id}`);

  function toggleRoom(room) {
    setRoomFilter((prev) => {
      const next = new Set(prev);
      if (next.has(room)) next.delete(room); else next.add(room);
      return next;
    });
  }

  useEffect(() => {
    async function loadOptions() {
      const { data: c } = await supabase
        .from('classes')
        .select('class_id, class_code, staff_id, subjects(subject_name), curriculum_blocks(block_name)')
        .not('class_code', 'is', null)
        .order('class_code');
      const allClasses = c || [];
      setMentorClasses(allClasses.filter((cl) => cl.curriculum_blocks?.block_name === 'Mentor'));
      // A teacher's own timetabled lessons. Without these the picker offered
      // mentor groups only, so the group a teacher actually wanted — the class
      // they had just taught — could not be chosen here at all.
      setMyClasses(allClasses.filter((cl) => cl.staff_id === profile?.staff_id
        && cl.curriculum_blocks?.block_name !== 'Mentor'));

      const { data: s } = await supabase.from('students').select('student_id, first_name, last_name, boarding_house, boarding_room_number, restaurant, year_group').eq('status', 'active').order('last_name');
      const list = s || [];
      setAllStudents(list);
      setBoardingHouses([...new Set(list.map((x) => x.boarding_house).filter(Boolean))].sort());
      setRestaurants([...new Set(list.map((x) => x.restaurant).filter(Boolean))].sort());
      setYearGroups([...new Set(list.map((x) => x.year_group).filter(Boolean))].sort((a, b) => a - b));

      const { data: cat } = await supabase.from('behaviour_categories').select('category_id, name, type, default_points').order('name');
      setCategories(cat || []);

      const { data: access } = await supabase.rpc('my_house_access');
      if (access?.house) {
        setHouseScope(access.house);
        setHouseScopeExclusive(!!access.exclusive);
        // Only default to the house when the viewer arrived here cold. A lesson
        // link already says which group they want.
        if (!linkedClassId) {
          setGroupType('boarding');
          setBoardingHouse(access.house);
        }
      }

      // A timetabled lesson is not in mentorClasses, so without this the
      // dropdown would show "Select..." while the roster below loaded the
      // right students — looking broken. Fetch it and offer it by name.
      if (linkedClassId) {
        const { data: linked } = await supabase
          .from('classes')
          .select('class_id, class_code')
          .eq('class_id', linkedClassId)
          .maybeSingle();
        if (linked) setLinkedClass(linked);
      }
    }
    loadOptions();
    loadEvents();
    // profile arrives after the first render, and staff_id decides which
    // classes are "mine", so this re-runs once it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.staff_id]);

  async function loadRoster() {
    if (groupType === 'mentor' && classId) {
      setLoadingRoster(true);
      const { data: sc } = await supabase
        .from('student_class')
        .select('students(student_id, first_name, last_name, status)')
        .eq('class_id', classId);
      const studentList = (sc || [])
        .map((row) => row.students)
        .filter((s) => s && s.status === 'active')
        .sort((a, b) => a.last_name.localeCompare(b.last_name));
      setRoster(studentList);
      setSelected(new Set(studentList.map((s) => s.student_id)));
      setLoadingRoster(false);
      return;
    }
    if (groupType === 'boarding' && boardingHouse) {
      const studentList = allStudents
        .filter((s) => s.boarding_house === boardingHouse
          && (!yearFilter || String(s.year_group) === yearFilter)
          && (roomFilter.size === 0 || roomFilter.has(s.boarding_room_number)))
        .sort((a, b) => a.last_name.localeCompare(b.last_name));
      setRoster(studentList);
      setSelected(new Set(studentList.map((s) => s.student_id)));
      return;
    }
    if (groupType === 'restaurant' && restaurant) {
      const studentList = allStudents
        .filter((s) => s.restaurant === restaurant)
        .sort((a, b) => a.last_name.localeCompare(b.last_name));
      setRoster(studentList);
      setSelected(new Set(studentList.map((s) => s.student_id)));
      return;
    }
    setRoster([]);
    setSelected(new Set());
  }

  useEffect(() => { loadRoster(); }, [groupType, classId, boardingHouse, restaurant, yearFilter, roomFilter, allStudents]);

  // Coming back to the house-only view drops any group picked while the whole
  // school was visible, which the re-locked pickers could otherwise not clear.
  // This runs from the toggle rather than an effect on activeHouseScope: as an
  // effect it also fired on first load and wiped a ?classId= lesson link.
  function handleHouseOnlyChange(houseOnly) {
    setShowAllHouses(!houseOnly);
    if (!houseOnly || !houseScope) return;
    setGroupType('boarding');
    setBoardingHouse(houseScope);
    setClassId('');
    setRestaurant('');
    setYearFilter('');
    setRoomFilter(new Set());
  }

  function handleGroupTypeChange(newType) {
    setGroupType(newType);
    setClassId(''); setBoardingHouse(''); setRestaurant(''); setYearFilter('');
    setRoomFilter(new Set());
  }

  const usingGroup = groupType && (classId || boardingHouse || restaurant);

  const categoriesForType = categories.filter((c) => c.type === form.type);

  function handleTypeChange(newType) {
    setForm({ ...form, type: newType, category: '', points: '' });
  }

  // Points are set centrally per category (/admin/lookups) — staff can't change
  // them here, and the database enforces the same (migration 140).
  function handleCategoryChange(categoryName) {
    const match = categoriesForType.find((c) => c.name === categoryName);
    setForm({ ...form, category: categoryName, points: match?.default_points ?? '' });
  }

  function toggleStudent(studentId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId); else next.add(studentId);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(roster.map((s) => s.student_id))); }
  function selectNone() { setSelected(new Set()); }

  const isSerious = form.type === 'negative' && Number(form.points) <= -5 && form.points !== '';

  // Shrink on the device before upload: 800px on the long side is plenty to
  // see on a phone without being high definition. Measured on real iPad
  // photos (1.1-1.8 MB), that comes out at 18-35 KB. An unusually detailed
  // picture that is still over 100 KB is tried again at 640px.
  async function handlePhotoChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      let b64 = await resizePhotoToBase64(file, 800, 0.6);
      if (b64.length > 136000) b64 = await resizePhotoToBase64(file, 640, 0.5);
      setPhoto(b64);
    } catch {
      setStatus("That file couldn't be read as a picture.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const studentIds = usingGroup ? Array.from(selected) : (singleStudentId ? [Number(singleStudentId)] : []);
    if (studentIds.length === 0) {
      setStatus('Choose at least one student.');
      return;
    }

    // A blank event (no category, no points) was being saved and showed up to
    // students as an unexplained negative — they appealed those too.
    if (!form.category) {
      setStatus('Choose a category before saving.');
      return;
    }

    if (isSerious && !form.description.trim()) {
      setStatus('This is a serious event (-5 points) — an explanation of what happened is required before it can be saved.');
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setStatus('Saving...');
    // The picture is stored once and every event logged here points at it.
    let photoId = null;
    if (photo) {
      const { data: ph, error: phErr } = await supabase
        .from('behaviour_photos')
        .insert({ image_jpeg_base64: photo })
        .select('photo_id')
        .single();
      if (phErr) {
        savingRef.current = false;
        setSaving(false);
        setStatus(`Couldn't save the picture: ${phErr.message}`);
        return;
      }
      photoId = ph.photo_id;
    }
    const rows = studentIds.map((student_id) => ({
      student_id,
      event_date: form.event_date,
      type: form.type,
      category: form.category || null,
      description: form.description || null,
      // The lesson or mentor group picked, so parents can see the subject
      // (migration 145 works it out from the timetable otherwise).
      class_id: groupType === 'mentor' && classId ? Number(classId) : null,
      photo_id: photoId,
    }));
    let error;
    try {
      ({ error } = await supabase.from('behaviour_events').insert(rows));
    } catch (err) {
      error = err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus(`Saved ${rows.length} event${rows.length > 1 ? 's' : ''}.`);
      setForm({ ...form, category: '', points: '', description: '' });
      setPhoto(null);
      if (usingGroup) selectAll(); else setSingleStudentId('');
      loadEvents();
    }
  }

  async function handleDelete(eventId) {
    if (!window.confirm('Delete this behaviour event? This cannot be undone.')) return;
    const { error } = await supabase.from('behaviour_events').delete().eq('event_id', eventId);
    if (error) setStatus(`Error: ${error.message}`);
    else loadEvents();
  }

  const pointsLabel = form.points === '' ? null : `${Number(form.points) > 0 ? '+' : ''}${form.points} pts`;

  return (
    <div>
      <h1>Log behaviour</h1>

      {canWidenScope && (
        <p style={{ background: '#fdecad', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <input
              type="checkbox"
              checked={!showAllHouses}
              onChange={(e) => handleHouseOnlyChange(e.target.checked)}
              style={{ flex: '0 0 auto', width: 'auto' }}
            />
            <span>{houseScope} only (Houseparent view) — untick to log for any student you teach</span>
          </label>
        </p>
      )}

      {/* One compact card: who, then what. The app-wide form/label rules lay
          fields out in a wrapping row, which in a column stretched every
          label to 140px tall — the big gaps between fields. .behaviour-log
          sets its own layout instead. */}
      <form onSubmit={handleSubmit} className="card behaviour-log">
        <div className="bl-section-title">Who</div>
        <div className="bl-row">
          <label>
            Log for
            <select value={groupType} onChange={(e) => handleGroupTypeChange(e.target.value)} disabled={!!activeHouseScope}>
              <option value="">One student</option>
              <option value="mentor">My lesson or mentor group</option>
              <option value="boarding">Boarding house</option>
              <option value="restaurant">Restaurant</option>
            </select>
          </label>

          {!groupType && (
            <label>
              Student
              <select value={singleStudentId} onChange={(e) => setSingleStudentId(e.target.value)}>
                <option value="">Select...</option>
                {scopedAllStudents.map((s) => (
                  <option key={s.student_id} value={s.student_id}>{s.first_name} {s.last_name}</option>
                ))}
              </select>
            </label>
          )}

          {groupType === 'mentor' && (
            <label>
              Class or mentor group
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">Select...</option>
                {extraClasses.map((c) => (
                  <option key={c.class_id} value={c.class_id}>{classLabel(c)}</option>
                ))}
                {myClasses.length > 0 && (
                  <optgroup label="My lessons">
                    {myClasses.map((c) => (
                      <option key={c.class_id} value={c.class_id}>{classLabel(c)}</option>
                    ))}
                  </optgroup>
                )}
                {mentorClasses.length > 0 && (
                  <optgroup label="Mentor groups">
                    {mentorClasses.map((c) => (
                      <option key={c.class_id} value={c.class_id}>{c.class_code}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {!hasClassOptions && (
                <span style={{ color: '#5a6b8c', fontSize: '0.85rem' }}>
                  You have no timetabled lessons or mentor groups.
                </span>
              )}
            </label>
          )}

          {groupType === 'boarding' && (
            <>
              <label>
                Boarding house
                <select
                  value={boardingHouse}
                  onChange={(e) => { setBoardingHouse(e.target.value); setRoomFilter(new Set()); }}
                  disabled={!!activeHouseScope}
                >
                  <option value="">Select...</option>
                  {(activeHouseScope ? [activeHouseScope] : boardingHouses).map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
              <label>
                Year group
                <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                  <option value="">All years</option>
                  {yearGroups.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </>
          )}

          {groupType === 'restaurant' && (
            <label>
              Restaurant
              <select value={restaurant} onChange={(e) => setRestaurant(e.target.value)}>
                <option value="">Select...</option>
                {restaurants.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
        </div>

        {groupType === 'boarding' && boardingHouse && roomsInHouse.length > 0 && (
          <div>
            <div className="bl-hint">Rooms — tick none for the whole house</div>
            <div className="bl-chips">
              {roomsInHouse.map((room) => (
                <label key={room} className={`bl-chip${roomFilter.has(room) ? ' on' : ''}`}>
                  <input type="checkbox" checked={roomFilter.has(room)} onChange={() => toggleRoom(room)} />
                  <span>{room}</span>
                </label>
              ))}
              {roomFilter.size > 0 && (
                <button type="button" className="secondary bl-small" onClick={() => setRoomFilter(new Set())}>
                  Whole house
                </button>
              )}
            </div>
          </div>
        )}

        {usingGroup && (
          loadingRoster ? <p style={{ margin: 0 }}>Loading students…</p> : roster.length === 0 ? (
            <p style={{ margin: 0 }}>No students in this group yet.</p>
          ) : (
            <div>
              <div className="bl-roster-bar">
                <span>{selected.size} of {roster.length} selected</span>
                <button type="button" className="secondary bl-small" onClick={selectAll}>All</button>
                <button type="button" className="secondary bl-small" onClick={selectNone}>None</button>
              </div>
              <div className="bl-roster">
                {roster.map((s) => (
                  <label key={s.student_id}>
                    <input type="checkbox" checked={selected.has(s.student_id)} onChange={() => toggleStudent(s.student_id)} />
                    <span>{s.first_name} {s.last_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        )}

        <div className="bl-section-title">What</div>
        <div className="bl-row">
          <label>
            {/* Devices set to US format show the picker as MM/DD/YYYY, so the
                date is repeated here the UK way. */}
            <span>Date{form.event_date && <span className="bl-date-hint">{formatUKDate(form.event_date, { weekday: true })}</span>}</span>
            <input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} required />
          </label>
          <div className="bl-field">
            Type
            <div className="bl-seg" role="group" aria-label="Type">
              <button type="button" className={form.type === 'positive' ? 'on-pos' : ''} onClick={() => handleTypeChange('positive')} aria-pressed={form.type === 'positive'}>
                Positive
              </button>
              <button type="button" className={form.type === 'negative' ? 'on-neg' : ''} onClick={() => handleTypeChange('negative')} aria-pressed={form.type === 'negative'}>
                Negative
              </button>
            </div>
          </div>
          <label>
            <span>Category{pointsLabel && <strong className={`bl-points ${form.type}`}>{pointsLabel}</strong>}</span>
            <select value={form.category} onChange={(e) => handleCategoryChange(e.target.value)} required>
              <option value="">Select...</option>
              {categoriesForType.map((c) => (
                <option key={c.category_id} value={c.name}>{c.name} ({c.default_points > 0 ? '+' : ''}{c.default_points})</option>
              ))}
            </select>
          </label>
        </div>

        {isSerious && (
          <div className="bl-serious">
            <strong>Serious event (-5 points) — an explanation is required.</strong>{' '}
            Explain what happened in your own words, following school protocol. Don&apos;t name any other
            student. A school office reviewer checks this before parents see it.
          </div>
        )}

        <label>
          {isSerious ? 'Explanation (required)' : 'Comment (optional)'}
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            required={isSerious}
            rows={isSerious ? 5 : 3}
          />
        </label>

        <div className="bl-field">
          Picture (optional)
          {photo ? (
            <div className="bl-photo-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/jpeg;base64,${photo}`} alt="Picture to add" />
              <div>
                <button type="button" className="secondary bl-small" onClick={() => setPhoto(null)}>Remove picture</button>
                <div className="bl-hint" style={{ marginTop: '0.35rem' }}>
                  About {Math.round((photo.length * 0.75) / 1024)} KB. Parents see it once the school office approves it.
                </div>
              </div>
            </div>
          ) : (
            <label className="bl-photo-pick">
              <input type="file" accept="image/*" onChange={handlePhotoChosen} disabled={photoBusy} />
              <span>{photoBusy ? 'Preparing picture…' : '📷 Take or choose a picture'}</span>
            </label>
          )}
        </div>

        <button type="submit" className="bl-submit" disabled={saving || photoBusy}>
          {saving ? 'Saving…' : usingGroup ? `Log for ${selected.size} student${selected.size === 1 ? '' : 's'}` : 'Log event'}
        </button>
        {status && <p style={{ margin: 0 }}>{status}</p>}
      </form>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2>Recently logged</h2>
        <a href="/behaviour/log">Full behaviour log →</a>
      </div>
      {houseScope && <p style={{ color: '#666', fontSize: '0.85rem' }}>Showing {houseScope} only (Houseparent view)</p>}
      <div className="table-scroll"><table>
        <thead>
          <tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Logged by</th><th></th>{profile?.role === 'admin' && <th></th>}</tr>
        </thead>
        <tbody>
          {scopedEvents.map((ev) => (
            <Fragment key={ev.event_id}>
            <tr className="student-link" onClick={() => window.location.href = `/students/${ev.students?.student_id}`}>
              <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(ev.event_date).replace(/ \d{4}$/, '')}</td>
              <td>{ev.students?.first_name} {ev.students?.last_name}</td>
              <td>{ev.category ?? '—'}{ev.photo_id && <span title="Has a picture"> 📷</span>}</td>
              <td style={{ color: ev.type === 'negative' ? 'var(--red-700)' : '#1d6b3a', fontWeight: 600 }}>
                {ev.points == null ? '—' : `${ev.points > 0 ? '+' : ''}${ev.points}`}
              </td>
              <td>{ev.staff ? `${ev.staff.first_name} ${ev.staff.last_name}` : '—'}</td>
              <td>
                <button
                  type="button"
                  className="secondary bl-small"
                  onClick={(e) => { e.stopPropagation(); setOpenEvent((o) => (o === ev.event_id ? null : ev.event_id)); }}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {openEvent === ev.event_id ? 'Hide' : canEditComment(ev) ? 'View / edit' : 'View'}
                </button>
              </td>
              {profile?.role === 'admin' && (
                <td><button type="button" className="secondary bl-small" onClick={(e) => { e.stopPropagation(); handleDelete(ev.event_id); }}>Delete</button></td>
              )}
            </tr>
            {openEvent === ev.event_id && (
              <tr>
                <td colSpan={profile?.role === 'admin' ? 7 : 6} style={{ paddingLeft: '1.5rem' }}>
                  <EventCommentEditor
                    event={ev}
                    onSaved={(changes) => setEvents((list) => list.map((x) => (x.event_id === ev.event_id ? { ...x, ...changes } : x)))}
                  />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function BehaviourPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/behaviour">
      <Suspense fallback={<p>Loading...</p>}>
        <BehaviourPageInner />
      </Suspense>
    </RequireResource></RequireAuth>
  );
}
