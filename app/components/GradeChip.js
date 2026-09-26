'use client';
import { STYLE, classifyGrade } from '../../lib/gradeCompare';

// A grade coloured against the student's target with the shared
// above/on/below palette. `exam` outlines it, so an exam grade stands out
// from the weekly tests around it; `target` draws the target itself.
export default function GradeChip({ grade, target, points, exam = false, isTarget = false }) {
  const cls = isTarget ? null : classifyGrade(target, grade, points);
  const style = cls ? STYLE[cls] : { background: '#eef0f3', color: '#1f2733' };
  return (
    <span
      title={isTarget ? 'Target' : exam ? 'Exam' : undefined}
      style={{
        display: 'inline-block',
        minWidth: '2.4em',
        padding: '2px 6px',
        borderRadius: 5,
        fontWeight: 700,
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums',
        ...(isTarget
          ? { background: 'transparent', color: '#1f2733', border: '1.5px dashed #8a93a0' }
          : { ...style, boxShadow: exam ? 'inset 0 0 0 1.5px currentColor' : undefined }),
      }}
    >
      {grade}
    </span>
  );
}
