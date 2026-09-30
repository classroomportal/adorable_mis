'use client';
import { Fragment, useEffect, useRef } from 'react';
import { formatUKDate } from '../../lib/formatDate';
import { homeworkStatus, linkifyParts } from '../../lib/homework';
import { AttachmentList } from './HomeworkAttachments';

// The small "Homework" button shown on a timetable lesson or a Homework grid
// card; tapping it opens HomeworkDetail below the grid.
export function HomeworkChip({ hw, selected, onSelect }) {
  const status = homeworkStatus(hw);
  return (
    <button
      type="button"
      className={`hw-chip hw-${status.key}${selected ? ' hw-chip-selected' : ''}`}
      onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : hw.homework_id); }}
      aria-expanded={selected}
      title={hw.title}
    >
      {status.key === 'done' ? '✓ Homework' : '📘 Homework'}
    </button>
  );
}

// Plain text with https links made clickable; nothing else is rendered.
export function Instructions({ text }) {
  return (
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {linkifyParts(text).map((p, i) => (
        <Fragment key={i}>
          {p.isLink ? <a href={p.text} target="_blank" rel="noopener noreferrer">{p.text}</a> : p.text}
        </Fragment>
      ))}
    </div>
  );
}

export function HomeworkDetail({ hw, onClose, onToggleDone }) {
  const ref = useRef(null);
  // Chips and cards can be far from the panel (a small screen, or the lists
  // under the Homework grid), so bring it into view when it opens.
  useEffect(() => {
    if (hw) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [hw?.homework_id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hw) return null;
  const status = homeworkStatus(hw);
  return (
    <div className="hw-detail" ref={ref}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
        <div>
          <div className="hw-detail-subject">{hw.subject_name}</div>
          <h3 style={{ margin: '0.1rem 0 0.4rem' }}>{hw.title}</h3>
        </div>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
      <p style={{ margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span className={`hw-status hw-${status.key}`}>{status.label}</span>
        {/* The student's own tick (migration 288); gone once a grade is released. */}
        {onToggleDone && !hw.marked && (
          <label className="hw-tick hw-tick-large">
            <input type="checkbox" checked={!!hw.done} onChange={(e) => onToggleDone(hw, e.target.checked)} />
            I&apos;ve done this
          </label>
        )}
      </p>
      {hw.instructions ? <Instructions text={hw.instructions} /> : <p style={{ color: 'var(--ink-soft)' }}>No further instructions.</p>}
      <AttachmentList homeworkId={hw.homework_id} />
      <dl className="hw-facts">
        <dt>Due</dt>
        <dd>{formatUKDate(hw.due_on, { weekday: true })}{hw.due_period != null ? ` · lesson ${hw.due_period}` : ' · end of day'}</dd>
        <dt>Set</dt>
        <dd>{formatUKDate(hw.set_on, { weekday: true })}{hw.teacher_name ? ` by ${hw.teacher_name}` : ''}</dd>
        <dt>Graded as</dt>
        <dd>{hw.scheme_kind === 'mark' && hw.scheme_name !== 'Percentage' ? `Mark out of ${Number(hw.out_of)}` : hw.scheme_name}</dd>
        {hw.mark_comment && (
          <>
            <dt>Teacher&apos;s comment</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{hw.mark_comment}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
