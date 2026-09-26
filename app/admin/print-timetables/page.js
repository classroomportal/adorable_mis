'use client';
import { useEffect, useState, Fragment } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { LESSON_COLUMNS, lessonRoom, lessonTeacher } from '../../../lib/lessons';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

const YEARS = [7, 8, 9, 10, 11, 12, 13];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function PrintTimetablesInner() {
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [students, setStudents] = useState([]); // [{student_id, first_name, last_name, form_class, cellMap}]

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('periods').select('*').order('period_number');
      setPeriods(data || []);
    })();
  }, []);

  async function generate() {
    setError(null);
    setLoading(true);
    setStudents([]);
    try {
      const { data: yearStudents, error: sErr } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, form_class')
        .eq('year_group', Number(year))
        .eq('status', 'active')
        .order('form_class')
        .order('last_name');
      if (sErr) throw sErr;
      if (!yearStudents || yearStudents.length === 0) {
        setError('No active students in that year group.');
        setLoading(false);
        return;
      }

      const studentIds = yearStudents.map((s) => s.student_id);
      // Page through in case this year group's enrolment rows pass Supabase's
      // default 1000-row cap (see Nova-T import notes for the bug this avoids).
      const links = [];
      const PAGE_SIZE = 1000;
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: lErr } = await supabase
          .from('student_class')
          .select(`student_id, classes(room, subjects(subject_name, display_name), staff(first_name, last_name), timetable_slots(${LESSON_COLUMNS}))`)
          .in('student_id', studentIds)
          .range(from, from + PAGE_SIZE - 1);
        if (lErr) throw lErr;
        links.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      const cellMapsByStudent = new Map();
      for (const link of links) {
        if (!link.classes) continue;
        const cellMap = cellMapsByStudent.get(link.student_id) || {};
        (link.classes.timetable_slots || []).forEach((slot) => {
          const key = `${slot.day_of_week}-${slot.period_number}`;
          const entry = {
            subject: link.classes.subjects?.display_name || link.classes.subjects?.subject_name,
            room: lessonRoom(slot, link.classes),
            teacher: lessonTeacher(slot, link.classes),
          };
          cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
        });
        cellMapsByStudent.set(link.student_id, cellMap);
      }

      setStudents(yearStudents.map((s) => ({ ...s, cellMap: cellMapsByStudent.get(s.student_id) || {} })));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '1rem', maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>Print Timetables</h1>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1rem' }}>
        Pick a year group to print every active student's timetable, eight to an A4 page.
      </p>

      <div className="no-print" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          Year group
          <select value={year} onChange={(e) => setYear(e.target.value)} style={selectStyle}>
            <option value="">Select year…</option>
            {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>

        <button onClick={generate} disabled={!year || loading} style={{ padding: '0.5rem 1rem' }}>
          {loading ? 'Loading…' : 'Generate'}
        </button>

        {students.length > 0 && (
          <button onClick={() => window.print()} style={{ padding: '0.5rem 1rem' }}>
            Print all ({students.length})
          </button>
        )}
      </div>

      {error && <p className="no-print" style={{ color: 'crimson' }}>{error}</p>}

      {students.length > 0 && (
        <p className="tt-quad-legend">
          {periods.map((p) => `${p.period_number}=${p.period_name}`).join('  ·  ')}
        </p>
      )}

      {chunk(students, 8).map((group, i) => (
        <div key={i} className="timetable-quad-page">
          {group.map((s) => (
            <div key={s.student_id} className="timetable-quad-card">
              <div className="tt-quad-name">{s.first_name} {s.last_name}</div>
              <div className="tt-quad-form">{s.form_class || ''}</div>
              <div className="timetable-grid tt-quad-grid">
                <div className="tt-head"></div>
                {DAYS.map((d) => <div key={d} className="tt-head">{d}</div>)}
                {periods.map((p) => (
                  <Fragment key={p.period_number}>
                    <div className="tt-cell tt-period-label">{p.period_number}</div>
                    {DAYS.map((d) => {
                      const entries = s.cellMap[`${d}-${p.period_number}`];
                      return (
                        <div key={`${d}-${p.period_number}`} className={`tt-cell ${entries ? 'tt-filled' : ''}`}>
                          {entries ? entries.map((e) => e.subject).join(', ') : ''}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const selectStyle = { padding: '0.4rem', fontSize: '0.9rem', marginTop: '0.25rem', minWidth: 160 };

export default function PrintTimetablesPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/print-timetables">
        <PrintTimetablesInner />
      </RequireResource>
    </RequireAuth>
  );
}
