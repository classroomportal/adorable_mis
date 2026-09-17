'use client';

// Splits a student's subject/target list into two side-by-side columns so it
// doesn't run into a long single list on wide screens, and shows the most
// recent grade as a coloured badge (above/on/below target, or a fixed WAEC
// band for Year 12) via the shared lib/gradeCompare classifier.

import { classifyGrade, STYLE } from '../../lib/gradeCompare';

function SubjectRow({ t, results, gradePoints }) {
  const latest = results.find((r) => r.subject_id === t.subject_id);
  const latestGrade = latest?.grade ?? '—';
  const cls = classifyGrade(t.target_grade, latestGrade, gradePoints);
  return (
    <tr key={t.subject_id}>
      <td>{t.subjects?.display_name || t.subjects?.subject_name}</td>
      <td>{t.target_grade}</td>
      <td>{cls ? <span className="badge" style={STYLE[cls]}>{latestGrade}</span> : latestGrade}</td>
    </tr>
  );
}

function SubjectTable({ items, results, gradePoints }) {
  return (
    <table>
      <thead><tr><th>Subject</th><th>Target</th><th>Grade</th></tr></thead>
      <tbody>
        {items.map((t) => (
          <SubjectRow key={t.subject_id} t={t} results={results} gradePoints={gradePoints} />
        ))}
      </tbody>
    </table>
  );
}

export default function SubjectsTwoColumn({ targets, results, gradePoints }) {
  const targetsWithResults = targets.filter((t) => results.some((r) => r.subject_id === t.subject_id));
  const mid = Math.ceil(targetsWithResults.length / 2);
  const left = targetsWithResults.slice(0, mid);
  const right = targetsWithResults.slice(mid);

  return (
    <div className="subjects-two-col">
      <div className="table-scroll"><SubjectTable items={left} results={results} gradePoints={gradePoints} /></div>
      {right.length > 0 && (
        <div className="table-scroll"><SubjectTable items={right} results={results} gradePoints={gradePoints} /></div>
      )}
    </div>
  );
}
