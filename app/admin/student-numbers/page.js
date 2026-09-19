'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

const YEARS = [7, 8, 9, 10, 11, 12];

function genderKey(g) {
  if (g === 'M' || g === 'F') return g;
  return 'Unknown';
}

function newCounts() {
  return { M: 0, F: 0, Unknown: 0, total: 0 };
}

function addStudent(counts, gender) {
  counts[genderKey(gender)]++;
  counts.total++;
}

function CountsRow({ label, counts }) {
  return (
    <tr>
      <td style={tdStyle}>{label}</td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.M}</td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>{counts.F}</td>
      <td style={{ ...tdStyle, textAlign: 'center', color: counts.Unknown > 0 ? '#b45309' : '#ccc' }}>
        {counts.Unknown || ''}
      </td>
      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{counts.total}</td>
    </tr>
  );
}

function CountsTable({ title, rows, totalCounts }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{title}</h2>
      <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={thStyle}>{title.includes('Class') ? 'Class' : title.includes('Mentor') ? 'Mentor group' : 'Year'}</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>M</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>F</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Unknown</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows}
            {totalCounts && (
              <tr style={{ background: '#f5f5f5', fontWeight: 600 }}>
                <td style={tdStyle}>All</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{totalCounts.M}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{totalCounts.F}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{totalCounts.Unknown || ''}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{totalCounts.total}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StudentNumbersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [byYear, setByYear] = useState([]);
  const [yearTotal, setYearTotal] = useState(newCounts());

  const [byMentor, setByMentor] = useState([]); // [{year_group, group_name, counts}]
  const [mentorTotal, setMentorTotal] = useState(newCounts());

  const [bySubject, setBySubject] = useState([]); // [{subject_name, classes:[{class_code, counts}], subjectTotal}]
  const [classTotal, setClassTotal] = useState(newCounts());

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: students, error: sErr } = await supabase
          .from('students')
          .select('student_id, year_group, gender, form_class, status')
          .in('year_group', YEARS)
          .eq('status', 'active');
        if (sErr) throw sErr;

        // --- By year group ---
        const yearCounts = {};
        for (const y of YEARS) yearCounts[y] = newCounts();
        const yTotal = newCounts();
        for (const s of students) {
          if (yearCounts[s.year_group]) addStudent(yearCounts[s.year_group], s.gender);
          addStudent(yTotal, s.gender);
        }
        setByYear(YEARS.map((y) => ({ year_group: y, counts: yearCounts[y] })));
        setYearTotal(yTotal);

        // --- By mentor group ---
        const { data: groups, error: gErr } = await supabase
          .from('mentor_groups')
          .select('mentor_group_id, group_name, year_group')
          .in('year_group', YEARS)
          .order('year_group')
          .order('group_name');
        if (gErr) throw gErr;

        const studentByFormClass = new Map();
        for (const s of students) {
          if (!s.form_class) continue;
          if (!studentByFormClass.has(s.form_class)) studentByFormClass.set(s.form_class, []);
          studentByFormClass.get(s.form_class).push(s);
        }
        const mTotal = newCounts();
        const mentorRows = (groups || []).map((g) => {
          const counts = newCounts();
          for (const s of studentByFormClass.get(g.group_name) || []) addStudent(counts, s.gender);
          for (const k of ['M', 'F', 'Unknown']) mTotal[k] += counts[k];
          mTotal.total += counts.total;
          return { year_group: g.year_group, group_name: g.group_name, counts };
        });
        setByMentor(mentorRows);
        setMentorTotal(mTotal);

        // --- By class (every subject class, all years) ---
        const { data: links, error: lErr } = await supabase
          .from('student_class')
          .select('student_id, classes(class_code, subjects(subject_name))');
        if (lErr) throw lErr;

        const studentById = new Map(students.map((s) => [s.student_id, s]));
        const bySubjectMap = new Map(); // subject_name -> Map(class_code -> counts)
        const cTotal = newCounts();
        for (const link of links || []) {
          const s = studentById.get(link.student_id);
          if (!s) continue; // not an active Y7-12 student
          const subjectName = link.classes?.subjects?.subject_name || 'Unassigned';
          const classCode = link.classes?.class_code || 'Unknown';
          if (!bySubjectMap.has(subjectName)) bySubjectMap.set(subjectName, new Map());
          const classMap = bySubjectMap.get(subjectName);
          if (!classMap.has(classCode)) classMap.set(classCode, newCounts());
          addStudent(classMap.get(classCode), s.gender);
          addStudent(cTotal, s.gender);
        }
        const subjectRows = [...bySubjectMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([subjectName, classMap]) => ({
            subjectName,
            classes: [...classMap.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([class_code, counts]) => ({ class_code, counts })),
          }));
        setBySubject(subjectRows);
        setClassTotal(cTotal);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div style={{ padding: '1rem' }}>Loading…</div>;

  return (
    <div style={{ padding: '1rem', maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>Student Numbers by Gender</h1>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1.5rem' }}>
        Active students, Years 7–12, broken down by year group, mentor group and class.
      </p>

      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}

      <CountsTable
        title="By Year Group"
        totalCounts={yearTotal}
        rows={byYear.map((r) => (
          <CountsRow key={r.year_group} label={`Year ${r.year_group}`} counts={r.counts} />
        ))}
      />

      <CountsTable
        title="By Mentor Group"
        totalCounts={mentorTotal}
        rows={byMentor.map((r) => (
          <CountsRow key={r.year_group + r.group_name} label={r.group_name} counts={r.counts} />
        ))}
      />

      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>By Class</h2>
        {bySubject.map((subj) => (
          <details key={subj.subjectName} style={{ marginBottom: '0.5rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '0.3rem 0' }}>{subj.subjectName}</summary>
            <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6, marginTop: '0.3rem' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={thStyle}>Class</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>M</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>F</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Unknown</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {subj.classes.map((c) => (
                    <CountsRow key={c.class_code} label={c.class_code} counts={c.counts} />
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
        <div style={{ marginTop: '0.5rem', fontWeight: 600, fontSize: '0.85rem', color: '#555' }}>
          Total class enrolments (each student counted once per class they're in) — M {classTotal.M} · F {classTotal.F}
          {classTotal.Unknown ? ` · Unknown ${classTotal.Unknown}` : ''} · {classTotal.total}
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: '0.5rem',
  textAlign: 'left',
  borderBottom: '1px solid #ddd',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid #eee',
  whiteSpace: 'nowrap',
};
