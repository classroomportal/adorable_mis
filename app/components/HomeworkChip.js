'use client';
import { Fragment, useEffect, useRef } from 'react';
import { formatUKDate } from '../../lib/formatDate';
import { homeworkStatus, linkifyParts, addDays } from '../../lib/homework';
import { schoolToday } from '../../lib/schoolTime';
import { AttachmentList } from './HomeworkAttachments';

// The small "Homework" button shown on a timetable lesson or a Homework grid
// card; tapping it opens HomeworkDetail below the grid.
// With `prep`, the chip sits under the evening the homework is done on the
// Homework page (migration 352), or the earlier day the student moved it
// to, and names the subject and time.
export function HomeworkChip({ hw, selected, onSelect, prep = false }) {
  const status = homeworkStatus(hw);
  if (prep) {
    return (
      <button
        type="button"
        className={`hw-chip hw-${status.key}${selected ? ' hw-chip-selected' : ''}`}
        onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : hw.homework_id); }}
        aria-expanded={selected}
        title={hw.plan_on ? `${hw.title}: moved here by you` : `${hw.title}: do this in prep`}
      >
        {status.key === 'done' ? '✓' : hw.plan_on ? '📌' : '📝'} {hw.subject_name}{hw.minutes ? ` · ${hw.minutes} min` : ''}
      </button>
    );
  }
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

// The student's own planning day (migration 352): from today up to the
// homework's prep evening, which is where it goes back to.
function PlanPicker({ hw, onPlan }) {
  const today = schoolToday();
  if (!hw.prep_on || hw.prep_on <= today) return null;
  const days = [];
  for (let d = today; d < hw.prep_on; d = addDays(d, 1)) days.push(d);
  const label = (d) => formatUKDate(d, { weekday: true }).replace(/ \d{4}$/, '');
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', margin: '0 0 0.6rem' }}>
      I&apos;ll do it on
      <select value={hw.plan_on || hw.prep_on} onChange={(e) => onPlan(hw, e.target.value)} style={{ width: 'auto' }}>
        {days.map((d) => <option key={d} value={d}>{label(d)}</option>)}
        <option value={hw.prep_on}>{label(hw.prep_on)} (prep evening)</option>
      </select>
      {hw.minutes ? <span style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>about {hw.minutes} min</span> : null}
    </label>
  );
}

export function HomeworkDetail({ hw, onClose, onToggleDone, onPlan }) {
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
      {onPlan && !hw.marked && <PlanPicker hw={hw} onPlan={onPlan} />}
      {hw.instructions ? <Instructions text={hw.instructions} /> : <p style={{ color: 'var(--ink-soft)' }}>No further instructions.</p>}
      <AttachmentList homeworkId={hw.homework_id} />
      <dl className="hw-facts">
        <dt>Due</dt>
        <dd>{formatUKDate(hw.due_on, { weekday: true })}{hw.due_period != null ? ` · lesson ${hw.due_period}` : ' · end of day'}</dd>
        <dt>Set</dt>
        <dd>{formatUKDate(hw.set_on, { weekday: true })}{hw.teacher_name ? ` by ${hw.teacher_name}` : ''}</dd>
        {hw.marking_note && (
          <>
            <dt>Marking</dt>
            <dd>{hw.marking_note}</dd>
          </>
        )}
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
