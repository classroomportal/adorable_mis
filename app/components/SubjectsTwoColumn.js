'use client';

// Splits a student's subject/target list into two side-by-side columns so it
// doesn't run into a long single list on wide screens, and colours the most
// recent grade red (below target) or green (at/above target) using the
// grade_scale points table. Falls back to no colour if either grade is
// missing from gradePoints (e.g. no grade recorded yet, or an unrecognised
// grade string) rather than guessing.

function gradeColor(targetGrade, latestGrade, gradePoints) {
  if (!latestGrade || latestGrade === '—') return undefined;
  const targetPoints = gradePoints[targetGrade];
  const latestPoints = gradePoints[latestGrade];
  if (targetPoints === undefined || latestPoints === undefined) return undefined;
  return latestPoints >= targetPoints ? '#1a7a3d' : '#a3232c';
}

function SubjectRow({ t, results, gradePoints }) {
  const latest = results.find((r) => r.subject_id === t.subject_id);
  const latestGrade = latest?.grade ?? '—';
  const color = gradeColor(t.target_grade, latestGrade, gradePoints);
  return (
    <tr key={t.subject_id}>
      <td>{t.subjects?.display_name || t.subjects?.subject_name}</td>
      <td>{t.target_grade}</td>
      <td style={{ color, fontWeight: color ? 700 : undefined }}>{latestGrade}</td>
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
  const mid = Math.ceil(targets.length / 2);
  const left = targets.slice(0, mid);
  const right = targets.slice(mid);

  return (
    <div className="subjects-two-col">
      <div className="table-scroll"><SubjectTable items={left} results={results} gradePoints={gradePoints} /></div>
      {right.length > 0 && (
        <div className="table-scroll"><SubjectTable items={right} results={results} gradePoints={gradePoints} /></div>
      )}
    </div>
  );
}
