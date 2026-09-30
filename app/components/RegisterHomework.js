'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { LESSON_COLUMNS } from '../../lib/lessons';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import { addDays } from '../../lib/homework';
import HomeworkForm, { btnSmall } from './HomeworkForm';

// Homework on the class register (/attendance): teachers set homework from the
// lesson they are taking, rather than going to another page. Shown only where
// can_set_homework() allows it (the class's teachers, its Head of Department
// and admins, for classes homework is switched on for); the database applies
// the same check when the homework is saved.
export default function RegisterHomework({ classId }) {
  const [allowed, setAllowed] = useState(false);
  const [cls, setCls] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [homework, setHomework] = useState([]);
  const [markCounts, setMarkCounts] = useState({});
  const [formOpen, setFormOpen] = useState(false);
  const [status, setStatus] = useState(null);

  const loadHomework = useCallback(async () => {
    if (!classId) return;
    const { data } = await supabase.from('homework')
      .select('homework_id, title, due_on, status, marks_released')
      .eq('class_id', classId).eq('status', 'set')
      .gte('due_on', addDays(schoolToday(), -14))
      .order('due_on');
    setHomework(data || []);
    const ids = (data || []).map((h) => h.homework_id);
    const { data: marks } = ids.length
      ? await supabase.from('homework_marks').select('homework_id').in('homework_id', ids)
      : { data: [] };
    const counts = {};
    (marks || []).forEach((m) => { counts[m.homework_id] = (counts[m.homework_id] || 0) + 1; });
    setMarkCounts(counts);
  }, [classId]);

  useEffect(() => {
    setAllowed(false);
    setFormOpen(false);
    setStatus(null);
    if (!classId) return;
    let cancelled = false;
    (async () => {
      const { data: ok } = await supabase.rpc('can_set_homework', { p_class_id: Number(classId) });
      if (cancelled || ok !== true) return;
      const [{ data: c }, { data: sch }] = await Promise.all([
        supabase.from('classes')
          .select(`class_id, class_code, subjects(subject_name, display_name), timetable_slots(${LESSON_COLUMNS})`)
          .eq('class_id', classId).single(),
        supabase.from('homework_schemes').select('*, homework_scheme_values(value, sort_order)').order('sort_order'),
      ]);
      if (cancelled) return;
      setCls(c);
      setSchemes(sch || []);
      setAllowed(true);
      loadHomework();
    })();
    return () => { cancelled = true; };
  }, [classId, loadHomework]);

  if (!allowed || !cls) return null;
  const today = schoolToday();

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>📘 Homework · {cls.class_code}</h2>
        {!formOpen && (
          <button type="button" onClick={() => { setFormOpen(true); setStatus(null); }}>Set homework</button>
        )}
      </div>
      {status && <p style={{ marginBottom: 0 }}>{status}</p>}
      {homework.length === 0 ? (
        !formOpen && <p style={{ color: 'var(--ink-soft)', marginBottom: 0 }}>No homework due for this class in the last two weeks or coming up.</p>
      ) : (
        <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
          {homework.map((h) => (
            <li key={h.homework_id} style={{ marginBottom: '0.3rem' }}>
              <strong>{h.title}</strong>{' '}
              <span style={{ color: 'var(--ink-soft)' }}>
                · due {formatUKDate(h.due_on, { weekday: true })}{h.due_on < today ? ' (past)' : ''}{' '}
                · {markCounts[h.homework_id] || 0} marked{h.marks_released ? ', released' : ''}
              </span>{' '}
              <a href={`/homework?class=${classId}&homework=${h.homework_id}`} style={{ ...btnSmall, whiteSpace: 'nowrap' }}>Mark book →</a>
            </li>
          ))}
        </ul>
      )}
      {formOpen && (
        <div style={{ marginTop: '0.75rem' }}>
          <HomeworkForm
            cls={cls} schemes={schemes} markCount={0} embedded
            onCancel={() => setFormOpen(false)}
            onSaved={(msg) => { setFormOpen(false); setStatus(msg || 'Homework set. Students will see it on their timetable.'); loadHomework(); }}
          />
        </div>
      )}
    </div>
  );
}
