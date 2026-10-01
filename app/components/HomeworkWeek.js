'use client';
import { defaultWeekStart, addDays, shortDate, homeworkStatus } from '../../lib/homework';

// The student's Homework week: the week picker and the homework cards, used
// on the student portal and in the staff "Student view" on /homework.

// Previous / this / next week, shared by the timetable and the Homework grid.
export function WeekPicker({ weekStart, onChange }) {
  const thisWeek = defaultWeekStart();
  return (
    <div className="hw-week-picker no-print">
      <button type="button" className="secondary" onClick={() => onChange(addDays(weekStart, -7))} aria-label="Previous week">←</button>
      <span>Week of {shortDate(weekStart)}</span>
      <button type="button" className="secondary" onClick={() => onChange(addDays(weekStart, 7))} aria-label="Next week">→</button>
      {weekStart !== thisWeek && (
        <button type="button" className="secondary" onClick={() => onChange(thisWeek)}>This week</button>
      )}
    </div>
  );
}

// One homework as a card on the Homework grid or in its lists.
// The student's "Done" tick (migration 288). Clicking it doesn't open the card.
function DoneTick({ hw, onToggleDone }) {
  if (!onToggleDone || hw.marked) return null;
  return (
    <label className="hw-tick" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={!!hw.done} onChange={(e) => onToggleDone(hw, e.target.checked)} />
      Done
    </label>
  );
}

// One homework as a card on the Homework grid or in its lists. Once ticked
// done (and not yet graded) it turns green and shrinks to just the subject.
export function HomeworkCard({ hw, selected, onSelect, showDate, onToggleDone }) {
  const status = homeworkStatus(hw);
  const compact = hw.done && !hw.marked;
  const open = () => onSelect(selected ? null : hw.homework_id);
  return (
    <div
      role="button" tabIndex={0}
      className={`hw-card hw-${status.key}${compact ? ' hw-card-compact' : ''}${selected ? ' hw-card-selected' : ''}`}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      aria-expanded={selected}
      title={compact ? hw.title : undefined}
    >
      <span className="hw-card-subject">{compact ? `✓ ${hw.subject_name}` : hw.subject_name}</span>
      {!compact && (
        <>
          <span className="hw-card-title">{hw.title}</span>
          <span className="hw-card-meta">
            {showDate ? `${shortDate(hw.due_on)} · ` : ''}
            {hw.due_period != null ? `Lesson ${hw.due_period}` : 'End of day'}
          </span>
          <span className={`hw-status hw-${status.key}`}>{status.label}</span>
        </>
      )}
      <DoneTick hw={hw} onToggleDone={onToggleDone} />
    </div>
  );
}
