'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { schoolToday } from '../../lib/schoolTime';
import { addDays, weekStartOf, loadMyHomework, isOutstanding } from '../../lib/homework';
import { useTileOrder, sortTiles } from '../../lib/tileOrder';

// A student's home page: the same big tiles as their portal, in the
// school-wide order set at /admin/tile-order (migration 280). Homework only
// appears once one of their classes has it switched on (migration 278).
export default function StudentHome() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;
  const order = useTileOrder('student');
  const [homeworkOn, setHomeworkOn] = useState(false);
  const [dueThisWeek, setDueThisWeek] = useState(null);

  useEffect(() => {
    if (!studentId) return;
    (async () => {
      const { data: enrol } = await supabase.from('student_class').select('class_id').eq('student_id', studentId);
      const ids = (enrol || []).map((e) => e.class_id);
      if (ids.length === 0) return;
      const { data: on } = await supabase.from('homework_classes').select('class_id').in('class_id', ids);
      if (!(on || []).length) return;
      setHomeworkOn(true);
      const today = schoolToday();
      const { homework } = await loadMyHomework(today, addDays(weekStartOf(today), 6));
      setDueThisWeek(homework.filter(isOutstanding).length);
    })();
  }, [studentId]);

  const tiles = sortTiles([
    { key: 'timetable', href: '/portal#timetable', label: 'Timetable', icon: '🗓️', accent: 'myinfo', sub: 'Your week' },
    homeworkOn && {
      key: 'homework', href: '/portal#homework', label: 'Homework', icon: '📘', accent: 'students',
      sub: dueThisWeek == null ? 'What’s due and when' : dueThisWeek === 0 ? 'Nothing due this week' : `${dueThisWeek} due this week`,
    },
    { key: 'other_half', href: '/portal/other-half', label: 'The Other Half', icon: '🎭', accent: 'students', sub: 'Choose your activities' },
    { key: 'assessment', href: '/portal#assessment', label: 'Assessment', icon: '⭐', accent: 'school', sub: 'Your grades and targets' },
    { key: 'behaviour', href: '/portal#behaviour', label: 'Behaviour', icon: '📋', accent: 'students', sub: 'Your behaviour record' },
    { key: 'tuckshop', href: '/portal/tuckshop', label: 'Tuckshop', icon: '🛒', accent: 'family', sub: 'Balance and orders' },
    { key: 'messages', href: '/inbox', label: 'Messages', icon: '📬', accent: 'family', sub: 'Your inbox' },
  ].filter(Boolean), order);

  return (
    <div>
      <h1>Welcome{studentId ? '' : ' — account not linked yet'}</h1>
      <div className="stat-card-row">
        {tiles.map((t) => (
          <a key={t.key} className={`stat-card quick-link accent-${t.accent}`} href={t.href}>
            <div className="stat-card-icon">{t.icon}</div>
            <div>
              <div className="quick-link-label">{t.label}</div>
              <div className="stat-card-label">{t.sub}</div>
            </div>
          </a>
        ))}
      </div>
      <p style={{ marginTop: '1rem' }}><a href="/change-password">Change password</a></p>
    </div>
  );
}
