'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { schoolToday } from '../../lib/schoolTime';
import { addDays, defaultWeekStart, shortDate, groupHomeworkByDay } from '../../lib/homework';
import { HomeworkDetail } from './HomeworkChip';
import { WeekPicker, HomeworkCard } from './HomeworkWeek';

// Staff preview of a class's homework as its students see it on their
// Homework page (the principal, 1 Oct 2026): the same week grid, cards,
// colours and detail panel. It shows the homework only, as a student who
// hasn't ticked anything or been graded would see it; no student's own ticks
// or grades. Reads homework the way any member of staff can (all staff read
// homework); nothing here is written.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function HomeworkStudentView({ cls, schemes, onBack }) {
  const [weekStart, setWeekStart] = useState(defaultWeekStart());
  const [homework, setHomework] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHomework(null);
      setSelected(null);
      const { data } = await supabase.from('homework')
        .select('homework_id, class_id, class_code, title, instructions, set_on, due_on, due_slot_id, scheme_id, out_of, set_by:staff!homework_set_by_staff_id_fkey(first_name, last_name)')
        .eq('class_id', cls.class_id).eq('status', 'set')
        .gte('due_on', weekStart).lte('due_on', addDays(weekStart, 6))
        .order('due_on').order('homework_id');
      if (cancelled) return;
      const subject = cls.subjects?.display_name || cls.subjects?.subject_name || '';
      setHomework((data || []).map((h) => {
        const scheme = schemes.find((s) => s.scheme_id === h.scheme_id);
        const slot = (cls.timetable_slots || []).find((t) => t.slot_id === h.due_slot_id);
        return {
          ...h,
          subject_name: subject,
          due_period: slot ? slot.period_number : null,
          scheme_name: scheme?.name,
          scheme_kind: scheme?.kind,
          out_of: h.out_of ?? scheme?.fixed_max,
          teacher_name: h.set_by ? `${h.set_by.first_name || ''} ${h.set_by.last_name || ''}`.trim() : null,
          marked: false,
          done: false,
        };
      }));
    })();
    return () => { cancelled = true; };
  }, [cls, schemes, weekStart]);

  const today = schoolToday();
  const byDay = groupHomeworkByDay(homework || [], weekStart);
  const weekend = [...byDay[addDays(weekStart, 5)], ...byDay[addDays(weekStart, 6)]];
  const days = DAYS.map((d, i) => ({ key: d, date: addDays(weekStart, i), items: byDay[addDays(weekStart, i)] }));
  if (weekend.length) days.push({ key: 'Weekend', date: addDays(weekStart, 5), items: weekend, weekend: true });
  const selectedHw = (homework || []).find((h) => h.homework_id === selected) || null;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Student view · {cls.class_code}</h2>
        <button type="button" className="secondary" onClick={onBack}>← Back to homework</button>
      </div>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        What a student in this class sees on their Homework page, for this class only. Each student also sees their
        other classes&apos; homework, their own Done ticks and, once released, their own grades.
      </p>
      <WeekPicker weekStart={weekStart} onChange={setWeekStart} />
      {homework === null ? <p>Loading…</p> : (
        <div className={`hw-grid${days.length > 5 ? ' hw-grid-6' : ''}`}>
          {days.map((d) => (
            <div key={d.key} className={`hw-day${!d.weekend && d.date === today ? ' hw-today' : ''}`}>
              <div className="hw-day-head">{d.weekend ? 'Weekend' : shortDate(d.date)}</div>
              {d.items.length === 0 ? <div className="hw-nothing">Nothing due</div> : d.items.map((hw) => (
                <HomeworkCard key={hw.homework_id} hw={hw} selected={selected === hw.homework_id} onSelect={setSelected} showDate={d.weekend} />
              ))}
            </div>
          ))}
        </div>
      )}
      <HomeworkDetail hw={selectedHw} onClose={() => setSelected(null)} />
    </div>
  );
}
