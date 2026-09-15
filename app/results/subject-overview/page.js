'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

// All result_type values currently in use — extend as new types appear.
const RESULT_TYPES = [
  { value: 'term_exam_import', label: 'Term Exam Import' },
];

function SubjectOverviewInner() {
  const { profile, staffRoles, loading: authLoading } = useAuth();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTypes, setSelectedTypes] = useState(RESULT_TYPES.map((t) => t.value));
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Staff (any staff_role) see the whole cohort. A student login (profile.student_id
  // set, no staff_id) is locked to their own results — enforced here in app code,
  // since the current "read_all_results" RLS policy does not restrict this at the DB level.
  const isStaff = !!profile?.staff_id && staffRoles.length > 0;
  const isStudent = !!profile?.student_id && !profile?.staff_id;

  const fetchData = useCallback(async () => {
    if (!profile) return;
    if (!isStaff && !isStudent) {
      // Parent logins or anything else not yet scoped for this view.
      setChartData([]);
      setError('This view is only available to staff and students.');
      return;
    }

    setLoading(true);
    setError(null);

    let query = supabase
      .from('results')
      .select('score, max_score, week_start_date, result_type, subject_id, subjects(subject_name, display_name)')
      .gt('max_score', 0);

    if (startDate) query = query.gte('week_start_date', startDate);
    if (endDate) query = query.lte('week_start_date', endDate);
    if (selectedTypes.length > 0) query = query.in('result_type', selectedTypes);
    if (isStudent) query = query.eq('student_id', profile.student_id);

    const { data, error: qError } = await query;

    if (qError) {
      console.error('subject-overview query error:', qError);
      setError('Failed to load results.');
      setChartData([]);
      setLoading(false);
      return;
    }

    const bySubject = new Map();
    for (const row of data) {
      if (!row.max_score || row.max_score <= 0) continue;
      const pct = (row.score / row.max_score) * 100;
      const label = row.subjects?.display_name || row.subjects?.subject_name || 'Unknown';
      if (!bySubject.has(label)) {
        bySubject.set(label, { subject: label, max: pct, sum: pct, count: 1 });
      } else {
        const entry = bySubject.get(label);
        entry.max = Math.max(entry.max, pct);
        entry.sum += pct;
        entry.count += 1;
      }
    }

    const summary = Array.from(bySubject.values())
      .map((entry) => ({
        subject: entry.subject,
        max_percentage: Math.round(entry.max * 10) / 10,
        avg_percentage: Math.round((entry.sum / entry.count) * 10) / 10,
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));

    setChartData(summary);
    setLoading(false);
  }, [profile, isStaff, isStudent, startDate, endDate, selectedTypes]);

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [authLoading, fetchData]);

  const toggleType = (value) => {
    setSelectedTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  if (authLoading) return <p>Loading...</p>;

  return (
    <div style={{ padding: '1rem', maxWidth: '100%' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
        {isStudent ? 'My Subject Overview' : 'Subject Overview'} — Max &amp; Average %
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '4px' }} />
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

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#A6192E' }}>{error}</p>}
      {!loading && !error && chartData.length === 0 && <p>No results found for the selected filters.</p>}

      {!loading && !error && chartData.length > 0 && (
        <div style={{ width: '100%', height: 450 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="subject" angle={-35} textAnchor="end" interval={0} height={80} tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend verticalAlign="top" />
              <Bar dataKey="max_percentage" name="Max %" fill="#A6192E" radius={[4, 4, 0, 0]} />
              <Line dataKey="avg_percentage" name={isStudent ? 'My Average %' : 'Cohort Average %'} stroke="#1a1a1a" strokeWidth={3} dot={{ r: 4 }} type="monotone" />
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
