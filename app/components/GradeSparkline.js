'use client';

// A small line of a student's grades through the year, with their target as
// a dashed line and the latest grade marked. Grades the scale doesn't know
// are skipped rather than plotted at zero.
export default function GradeSparkline({ grades, target, points, width = 110, height = 34 }) {
  const ys = grades.map((g) => points[g]).filter((p) => p !== undefined);
  if (ys.length < 2) return <span style={{ color: '#888', fontSize: '0.8rem' }}>—</span>;
  const targetPts = target !== undefined && target !== null ? points[target] : undefined;
  const pad = 5;
  const all = targetPts !== undefined ? [...ys, targetPts] : ys;
  const lo = Math.min(...all) - 0.5;
  const hi = Math.max(...all) + 0.5;
  const x = (i) => pad + (i * (width - 2 * pad)) / (ys.length - 1);
  const y = (v) => height - pad - ((v - lo) * (height - 2 * pad)) / (hi - lo);
  const last = ys.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grade trend this year">
      {targetPts !== undefined && (
        <line x1={pad} x2={width - pad} y1={y(targetPts)} y2={y(targetPts)} stroke="#8a93a0" strokeDasharray="3 3" strokeWidth="1" />
      )}
      <polyline
        points={ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
        fill="none"
        stroke="#2f6fa8"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(last)} cy={y(ys[last])} r="3.2" fill="#2f6fa8" />
    </svg>
  );
}
