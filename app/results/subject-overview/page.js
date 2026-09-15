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

function SubjectOverviewInner() {
  const { profile, staffRoles, loading: authLoading } = useAuth();

  const isStaff = !!profile?.staff_id && staffRoles.length > 0;
  const isStudent = !!profile?.student_id && !profile?.staff_id;

  const [students, setStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTypes, setSelectedTypes] = useState(RESULT_TYPES.map((t) => t.value));
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Student login is locked to their own record. Staff pick a student from a dropdown.
  useEffect(() => {
    if (isStudent) {
      setSelectedStudentId(String(profile.student_id));
      return;
    }
    if (isStaff) {
      supabase.from('students').select('student_id, first_name, last_name').order('last_name')
        .then(({ data }) => setStudents(data || []));
    }
  }, [isStaff, isStudent, profile]);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    if (!isStaff && !isStudent) {
      setChartData([]);
      setError('This view is only available to staff and students.');
      return;
    }
    if (!selectedStudentId) {
      setChartData([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Base query (date range + result type) shared by both the selected student's
    // results and the whole-cohort results used to compute the average line.
    let baseQuery = supabase
      .from('results')
      .select('score, max_score, student_id, week_start_date, result_type, subject_id, subjects(subject_name, display_name)')
      .gt('max_score', 0);
    if (startDate) baseQuery = baseQuery.gte('week_start_date', startDate);
    if (endDate) baseQuery = baseQuery.lte('week_start_date', endDate);
    if (selectedTypes.length > 0) baseQuery = baseQuery.in('result_type', selectedTypes);

    const { data, error: qError } = await baseQuery;

    if (qError) {
      console.error('subject-overview query error:', qError);
      setError('Failed to load results.');
      setChartData([]);
      setLoading(false);
      return;
    }

    // Cohort average % per subject (all students, same filters).
    const cohortBySubject = new Map();
    // Selected student's own average % per subject, over the same filters
    // (averaged in case more than one result falls in the chosen date range).
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

    // Only chart subjects the selected student actually has results for.
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
  }, [profile, isStaff, isStudent, selectedStudentId, startDate, endDate, selectedTypes]);

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [authLoading, fetchData]);

  const toggleType = (value) => {
    setSelectedTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  if (authLoading) return <p>Loading...</p>;

  const matchedStudent = students.find((s) => String(s.student_id) === String(selectedStudentId));
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
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Student</label>
            <select
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '180px' }}
            >
              <option value="">Select a student...</option>
              {students.map((s) => (
                <option key={s.student_id} value={s.student_id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px' }} />
          {startDate && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(startDate)}</span>}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px' }} />
          {endDate && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(endDate)}</span>}
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
          onClick={() => { setStartDate(''); setEndDate(''); setSelectedTypes(RESULT_TYPES.map((t) => t.value)); }}
          style={{ padding: '0.4rem 0.75rem', border: '1px solid #A6192E', color: '#A6192E', background: 'white', borderRadius: '4px', fontSize: '0.85rem' }}
        >
          Reset
        </button>
      </div>

      {isStaff && !selectedStudentId && <p>Select a student to see their subject breakdown against the cohort average.</p>}
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#A6192E' }}>{error}</p>}
      {!loading && !error && selectedStudentId && chartData.length === 0 && <p>No results found for this student in the selected filters.</p>}

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
