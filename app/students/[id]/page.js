'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function StudentDetail() {
  const { id } = useParams();
  const [student, setStudent] = useState(null);
  const [parents, setParents] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: s } = await supabase.from('students').select('*').eq('student_id', id).single();
      setStudent(s);

      const { data: p } = await supabase
        .from('student_parent')
        .select('is_primary_contact, parents(first_name,last_name,phone,email,relationship_type)')
        .eq('student_id', id);
      setParents(p || []);

      const { data: tt } = await supabase
        .from('student_class')
        .select('classes(class_id, room, subjects(subject_name), timetable_slots(day_of_week, period_number, start_time, end_time, periods:period_number(period_name)))')
        .eq('student_id', id);
      setTimetable(tt || []);

      const { data: be } = await supabase
        .from('behaviour_events')
        .select('*')
        .eq('student_id', id)
        .order('event_date', { ascending: false });
      setBehaviour(be || []);

      const { data: r } = await supabase
        .from('results')
        .select('*, subjects(subject_name)')
        .eq('student_id', id)
        .order('week_start_date', { ascending: false });
      setResults(r || []);

      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return <p>Loading...</p>;
  if (!student) return <p>Student not found.</p>;

  return (
    <div>
      <h1>{student.first_name} {student.last_name}</h1>

      <div className="card">
        <h2>Core Data</h2>
        <p><strong>DOB:</strong> {student.dob}</p>
        <p><strong>Year group:</strong> {student.year_group} &nbsp; <strong>Form:</strong> {student.form_class}</p>
        <p><strong>Admission date:</strong> {student.admission_date}</p>
        <p><strong>Gender:</strong> {student.gender || '—'}</p>
        <p><strong>Address:</strong> {student.address || '—'}</p>
        <p><strong>Medical notes:</strong> {student.medical_notes || '—'}</p>
        <p><strong>Status:</strong> {student.status}</p>
      </div>

      <div className="card">
        <h2>Parents / Guardians</h2>
        {parents.length === 0 ? <p>None on record.</p> : (
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
        )}
      </div>

      <div className="card">
        <h2>Timetable</h2>
        {timetable.length === 0 ? <p>No timetable data yet.</p> : (
          <table>
            <thead><tr><th>Day</th><th>Period</th><th>Time</th><th>Subject</th><th>Room</th></tr></thead>
            <tbody>
              {timetable.flatMap((tc, i) =>
                (tc.classes?.timetable_slots || []).map((slot, j) => (
                  <tr key={`${i}-${j}`}>
                    <td>{slot.day_of_week}</td>
                    <td>{slot.periods?.period_name || slot.period_number}</td>
                    <td>{slot.start_time}–{slot.end_time}</td>
                    <td>{tc.classes?.subjects?.subject_name}</td>
                    <td>{tc.classes?.room}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Behaviour</h2>
        {behaviour.length === 0 ? <p>No events logged.</p> : (
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
        )}
      </div>

      <div className="card">
        <h2>Results</h2>
        {results.length === 0 ? <p>No results recorded.</p> : (
          <table>
            <thead><tr><th>Week</th><th>Subject</th><th>Score</th><th>Grade</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.result_id}>
                  <td>{r.week_start_date}</td>
                  <td>{r.subjects?.subject_name}</td>
                  <td>{r.score ?? '—'}{r.max_score ? ` / ${r.max_score}` : ''}</td>
                  <td>{r.grade ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><StudentDetail /></RequireAuth>;
}
