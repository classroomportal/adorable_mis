'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

const YEARS = [7, 8, 9, 10, 11, 12];

function ClassListsInner() {
  const [year, setYear] = useState('');
  const [subjects, setSubjects] = useState([]); // [{subject_id, subject_name}]
  const [subjectId, setSubjectId] = useState('');
  const [classesForFilter, setClassesForFilter] = useState([]); // classes matching year(+subject), for the class dropdown
  const [classId, setClassId] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rosters, setRosters] = useState([]); // [{class_id, class_code, subject_name, teacher, room, students:[...]}]

  // Load subjects with at least one class in the chosen year
  useEffect(() => {
    setSubjectId('');
    setClassId('');
    setClassesForFilter([]);
    setRosters([]);
    if (!year) { setSubjects([]); return; }
    (async () => {
      const { data, error: err } = await supabase
        .from('classes')
        .select('subject_id, subjects(subject_name)')
        .eq('year_group', Number(year));
      if (err) { setError(err.message); return; }
      const seen = new Map();
      for (const row of data || []) {
        if (row.subject_id && !seen.has(row.subject_id)) {
          seen.set(row.subject_id, row.subjects?.subject_name || `Subject ${row.subject_id}`);
        }
      }
      setSubjects(
        [...seen.entries()]
          .map(([subject_id, subject_name]) => ({ subject_id, subject_name }))
          .sort((a, b) => a.subject_name.localeCompare(b.subject_name))
      );
    })();
  }, [year]);

  // Load classes matching year + subject, for the optional "single class" dropdown
  useEffect(() => {
    setClassId('');
    setRosters([]);
    if (!year || !subjectId) { setClassesForFilter([]); return; }
    (async () => {
      const { data, error: err } = await supabase
        .from('classes')
        .select('class_id, class_code')
        .eq('year_group', Number(year))
        .eq('subject_id', Number(subjectId))
        .order('class_code');
      if (err) { setError(err.message); return; }
      setClassesForFilter(data || []);
    })();
  }, [year, subjectId]);

  async function generate() {
    setError(null);
    setLoading(true);
    setRosters([]);
    try {
      let classQuery = supabase
        .from('classes')
        .select('class_id, class_code, room, subjects(subject_name), staff(first_name, last_name)')
        .eq('year_group', Number(year));
      if (subjectId) classQuery = classQuery.eq('subject_id', Number(subjectId));
      if (classId) classQuery = classQuery.eq('class_id', Number(classId));
      const { data: classes, error: cErr } = await classQuery.order('class_code');
      if (cErr) throw cErr;
      if (!classes || classes.length === 0) {
        setError('No classes match that selection.');
        setLoading(false);
        return;
      }

      const classIds = classes.map((c) => c.class_id);
      // Page through in case "all subjects" for a year pulls past Supabase's
      // default 1000-row cap (see the Student Numbers page for the bug this avoids).
      const links = [];
      const PAGE_SIZE = 1000;
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: lErr } = await supabase
          .from('student_class')
          .select('class_id, students(student_id, first_name, last_name, gender, form_class, status)')
          .in('class_id', classIds)
          .range(from, from + PAGE_SIZE - 1);
        if (lErr) throw lErr;
        links.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      const studentsByClass = new Map();
      for (const link of links || []) {
        if (!link.students || link.students.status !== 'active') continue;
        if (!studentsByClass.has(link.class_id)) studentsByClass.set(link.class_id, []);
        studentsByClass.get(link.class_id).push(link.students);
      }

      const built = classes.map((c) => ({
        class_id: c.class_id,
        class_code: c.class_code,
        subject_name: c.subjects?.subject_name || '',
        teacher: c.staff ? `${c.staff.first_name || ''} ${c.staff.last_name || ''}`.trim() : '',
        room: c.room || '',
        students: (studentsByClass.get(c.class_id) || []).sort((a, b) =>
          (a.last_name || '').localeCompare(b.last_name || '')
        ),
      }));
      setRosters(built);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '1rem', maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>Class Lists</h1>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1rem' }}>
        Pick a year group, optionally narrow to one subject or one class, then print.
      </p>

      <div className="no-print" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          Year group
          <select value={year} onChange={(e) => setYear(e.target.value)} style={selectStyle}>
            <option value="">Select year…</option>
            {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          Subject
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!year} style={selectStyle}>
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
          Class (optional)
          <select value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!subjectId} style={selectStyle}>
            <option value="">All classes in subject</option>
            {classesForFilter.map((c) => <option key={c.class_id} value={c.class_id}>{c.class_code}</option>)}
          </select>
        </label>

        <button onClick={generate} disabled={!year || loading} style={{ padding: '0.5rem 1rem' }}>
          {loading ? 'Loading…' : 'Generate'}
        </button>

        {rosters.length > 0 && (
          <button onClick={() => window.print()} style={{ padding: '0.5rem 1rem' }}>
            Print
          </button>
        )}
      </div>

      {error && <p className="no-print" style={{ color: 'crimson' }}>{error}</p>}

      {rosters.map((r) => (
        <div key={r.class_id} style={{ marginBottom: '1.5rem', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.1rem' }}>
            {r.class_code} — {r.subject_name}
          </h2>
          <div style={{ color: '#555', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            {r.teacher && <>Teacher: {r.teacher} · </>}
            {r.room && <>Room: {r.room} · </>}
            {r.students.length} student{r.students.length === 1 ? '' : 's'}
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Last name</th>
                  <th style={thStyle}>First name</th>
                  <th style={thStyle}>Gender</th>
                  <th style={thStyle}>Form class</th>
                </tr>
              </thead>
              <tbody>
                {r.students.map((s, i) => (
                  <tr key={s.student_id}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={tdStyle}>{s.last_name}</td>
                    <td style={tdStyle}>{s.first_name}</td>
                    <td style={tdStyle}>{s.gender || ''}</td>
                    <td style={tdStyle}>{s.form_class || ''}</td>
                  </tr>
                ))}
                {r.students.length === 0 && (
                  <tr><td style={tdStyle} colSpan={5}>No active students in this class.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

const selectStyle = { padding: '0.4rem', fontSize: '0.9rem', marginTop: '0.25rem', minWidth: 160 };

const thStyle = {
  padding: '0.4rem 0.5rem',
  textAlign: 'left',
  borderBottom: '1px solid #ddd',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '0.3rem 0.5rem',
  borderBottom: '1px solid #eee',
  whiteSpace: 'nowrap',
};

export default function ClassListsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/class-lists">
        <ClassListsInner />
      </RequireResource>
    </RequireAuth>
  );
}
