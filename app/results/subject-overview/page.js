'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';

// All result_type values currently in use — extend as new types appear.
const RESULT_TYPES = [
  { value: 'term_exam_import', label: 'Term Exam Import' },
];

// UK academic year runs Sept–Aug. Returns the year the academic year started in
// (e.g. a date in July 2026 or Jan 2027 both return 2026, for "2026/27").
function academicYearStart(date) {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-indexed, so 8 = September
  return m >= 8 ? y : y - 1;
}

// A dataset (calendar event) is labelled with the year group the selected student
// was actually in when it happened, not their current year group — e.g. a July 2026
// exam sat by a student now in Y12 was sat while they were in Y11, one academic year
// earlier, so it's labelled "Y11 T3 Exam" rather than "Y12 T3 Exam".
function datasetLabel(event, currentYearGroup) {
  if (!event) return '';
  if (currentYearGroup == null) return event.event_name;
  const eventYear = academicYearStart(new Date(event.event_date));
  const thisYear = academicYearStart(new Date());
  const yearsAgo = thisYear - eventYear;
  if (yearsAgo <= 0) return event.event_name;
  const yearGroupThen = currentYearGroup - yearsAgo;
  return `Y${yearGroupThen} ${event.event_name}`;
}

function SubjectOverviewInner() {
  const { profile, staffRoles, loading: authLoading } = useAuth();

  const isStaff = !!profile?.staff_id && staffRoles.length > 0;
  const isStudent = !!profile?.student_id && !profile?.staff_id;

  const [students, setStudents] = useState([]);
  const [ownStudent, setOwnStudent] = useState(null);
  const [mentorGroups, setMentorGroups] = useState([]);
  const [selectedYearGroup, setSelectedYearGroup] = useState('');
  const [selectedMentorGroupId, setSelectedMentorGroupId] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [datasets, setDatasets] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedTypes, setSelectedTypes] = useState(RESULT_TYPES.map((t) => t.value));
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Student login is locked to their own record. Staff pick Year Group -> TG (mentor
  // group) -> student, all fetched once and filtered client-side (student count is small).
  useEffect(() => {
    if (isStudent) {
      setSelectedStudentId(String(profile.student_id));
      supabase.from('students').select('student_id, first_name, last_name, year_group').eq('student_id', profile.student_id).single()
        .then(({ data }) => setOwnStudent(data || null));
      return;
    }
    if (isStaff) {
      supabase.from('students').select('student_id, first_name, last_name, year_group, mentor_group_id').order('last_name')
        .then(({ data }) => setStudents(data || []));
      supabase.from('mentor_groups').select('mentor_group_id, group_name, year_group').order('group_name')
        .then(({ data }) => setMentorGroups(data || []));
    }
  }, [isStaff, isStudent, profile]);

  // Datasets = calendar events, most recent first (any category — exam, relp, etc.).
  useEffect(() => {
    if (!isStaff && !isStudent) return;
    supabase.from('calendar_events').select('event_id, event_date, event_name, category')
      .order('event_date', { ascending: false })
      .then(({ data }) => setDatasets(data || []));
  }, [isStaff, isStudent]);

  const yearGroups = Array.from(new Set(students.map((s) => s.year_group).filter((y) => y != null))).sort((a, b) => a - b);
  const mentorGroupsForYear = selectedYearGroup
    ? mentorGroups.filter((m) => String(m.year_group) === String(selectedYearGroup))
    : [];
  const filteredStudents = students.filter((s) => {
    if (selectedYearGroup && String(s.year_group) !== String(selectedYearGroup)) return false;
    if (selectedMentorGroupId && String(s.mentor_group_id) !== String(selectedMentorGroupId)) return false;
    return true;
  });

  const matchedStudent = students.find((s) => String(s.student_id) === String(selectedStudentId));
  const selectedStudentYearGroup = isStudent ? ownStudent?.year_group : matchedStudent?.year_group;
  const selectedEvent = datasets.find((d) => String(d.event_id) === String(selectedEventId));

  const fetchData = useCallback(async () => {
    if (!profile) return;
    if (!isStaff && !isStudent) {
      setChartData([]);
      setError('This view is only available to staff and students.');
      return;
    }
    if (!selectedStudentId || !selectedEventId) {
      setChartData([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const eventDate = selectedEvent?.event_date;
    if (!eventDate) { setLoading(false); return; }

    // Base query (exact dataset date + result type) shared by both the selected
    // student's results and the whole-cohort results used for the average line.
    // Paginated explicitly: Supabase/PostgREST caps a single request at 1000 rows by
    // default, and one dataset can match several thousand rows school-wide — an
    // unpaginated fetch silently truncates.
    const PAGE_SIZE = 1000;
    let allRows = [];
    let from = 0;
    let qError = null;
    for (;;) {
      let pageQuery = supabase
        .from('results')
        .select('score, max_score, student_id, week_start_date, result_type, subject_id, subjects(subject_name, display_name)')
        .gt('max_score', 0)
        .eq('week_start_date', eventDate);
      if (selectedTypes.length > 0) pageQuery = pageQuery.in('result_type', selectedTypes);
      pageQuery = pageQuery.range(from, from + PAGE_SIZE - 1);

      const { data: page, error: pageError } = await pageQuery;
      if (pageError) { qError = pageError; break; }
      allRows = allRows.concat(page || []);
      if (!page || page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    const data = allRows;

    if (qError) {
      console.error('subject-overview query error:', qError);
      setError('Failed to load results.');
      setChartData([]);
      setLoading(false);
      return;
    }

    const cohortBySubject = new Map();
    const studentBySubject = new Map();

    for (const row of data) {
      if (!row.max_score || row.max_score <= 0) continue;
      const pct = (row.score / row.max_score) * 100;
      const label = row.subjects?.display_name || row.subjects?.subject_name || 'Unknown';

      if (!cohortBySubject.has(label)) cohortBySubject.set(label, { sum: pct, count: 1 });
      else { const e = cohortBySubject.get(label); e.sum += pct; e.count += 1; }

      if (String(row.student_id) === String(selectedStudentId)) {
        if (!studentBySubject.has(label)) studentBySubject.set(label, { sum: pct, count: 1 });
        else { const e = studentBySubject.get(label); e.sum += pct; e.count += 1; }
      }
    }

    const summary = Array.from(studentBySubject.entries())
      .map(([subject, s]) => {
        const cohort = cohortBySubject.get(subject);
        return {
          subject,
          student_percentage: Math.round((s.sum / s.count) * 10) / 10,
          cohort_avg_percentage: cohort ? Math.round((cohort.sum / cohort.count) * 10) / 10 : null,
        };
      })
      .sort((a, b) => a.subject.localeCompare(b.subject));

    setChartData(summary);
    setLoading(false);
  }, [profile, isStaff, isStudent, selectedStudentId, selectedEventId, selectedEvent, selectedTypes]);

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [authLoading, fetchData]);

  const toggleType = (value) => {
    setSelectedTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  if (authLoading) return <p>Loading...</p>;

  const selectedStudentName = isStudent
    ? 'My'
    : (matchedStudent ? `${matchedStudent.first_name} ${matchedStudent.last_name}'s` : null);

  return (
    <div style={{ padding: '1rem', maxWidth: '100%' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
        {selectedStudentName ? `${selectedStudentName} Subject Overview` : 'Subject Overview'} — % vs Cohort Average
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
        {isStaff && (
          <>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Year group</label>
              <select
                value={selectedYearGroup}
                onChange={(e) => { setSelectedYearGroup(e.target.value); setSelectedMentorGroupId(''); setSelectedStudentId(''); }}
                style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="">All years</option>
                {yearGroups.map((y) => (
                  <option key={y} value={y}>Year {y}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>TG (mentor group)</label>
              <select
                value={selectedMentorGroupId}
                onChange={(e) => { setSelectedMentorGroupId(e.target.value); setSelectedStudentId(''); }}
                disabled={!selectedYearGroup}
                style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="">All TGs</option>
                {mentorGroupsForYear.map((m) => (
                  <option key={m.mentor_group_id} value={m.mentor_group_id}>{m.group_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Student</label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '180px' }}
              >
                <option value="">Select a student...</option>
                {filteredStudents.map((s) => (
                  <option key={s.student_id} value={s.student_id}>{s.first_name} {s.last_name}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Dataset</label>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '220px' }}
          >
            <option value="">Select a dataset...</option>
            {datasets.map((d) => (
              <option key={d.event_id} value={d.event_id}>
                {datasetLabel(d, selectedStudentYearGroup)} — {formatUKDate(d.event_date)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Result type</label>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {RESULT_TYPES.map((t) => (
              <label key={t.value} style={{ fontSize: '0.85rem', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                <input type="checkbox" checked={selectedTypes.includes(t.value)} onChange={() => toggleType(t.value)} />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <button
          onClick={() => { setSelectedEventId(''); setSelectedTypes(RESULT_TYPES.map((t) => t.value)); }}
          style={{ padding: '0.4rem 0.75rem', border: '1px solid #A6192E', color: '#A6192E', background: 'white', borderRadius: '4px', fontSize: '0.85rem' }}
        >
          Reset
        </button>
      </div>

      {isStaff && !selectedStudentId && <p>Select a student to see their subject breakdown against the cohort average.</p>}
      {selectedStudentId && !selectedEventId && <p>Select a dataset (exam or ReLP) to see results.</p>}
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#A6192E' }}>{error}</p>}
      {!loading && !error && selectedStudentId && selectedEventId && chartData.length === 0 && <p>No results found for this student in the selected dataset.</p>}

      {!loading && !error && chartData.length > 0 && (
        <div style={{ width: '100%', height: 450 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="subject" angle={-35} textAnchor="end" interval={0} height={80} tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(value) => (value === null ? 'No cohort data' : `${value}%`)} />
              <Legend verticalAlign="top" />
              <Bar dataKey="student_percentage" name={isStudent ? 'My %' : `${selectedStudentName} %`} fill="#A6192E" radius={[4, 4, 0, 0]} />
              <Line dataKey="cohort_avg_percentage" name="Cohort Average %" stroke="#1a1a1a" strokeWidth={3} dot={{ r: 4 }} type="monotone" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function SubjectOverviewPage() {
  return (
    <RequireAuth>
      <SubjectOverviewInner />
    </RequireAuth>
  );
}
