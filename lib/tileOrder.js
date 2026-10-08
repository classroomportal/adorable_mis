import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// The big dashboard tiles and their school-wide order (migration 280,
// arranged at /admin/tile-order). Pages still decide which tiles a person
// sees; this only decides the order. A tile with no saved position keeps its
// place from the lists below, after the ordered ones.

export const TILE_LISTS = {
  student: {
    label: "Students' tiles",
    where: 'A student’s home page and their portal.',
    tiles: [
      { key: 'timetable', label: 'Timetable', icon: '🗓️' },
      { key: 'homework', label: 'Homework', icon: '📘', note: 'only students in a class with homework switched on' },
      { key: 'other_half', label: 'The Other Half', icon: '🎭' },
      { key: 'assessment', label: 'Assessment', icon: '⭐' },
      { key: 'behaviour', label: 'Behaviour', icon: '📋' },
      { key: 'tuckshop', label: 'Tuckshop', icon: '🛒' },
      // Migration 370.
      { key: 'rewards', label: 'Reward Store', icon: '🎁', note: 'only while the store is open' },
      { key: 'messages', label: 'Messages', icon: '📬' },
      // Migration 300.
      { key: 'groups', label: 'Groups', icon: '👥', note: 'only students in a group shown to students' },
      // Migration 391.
      { key: 'worries', label: 'Worry Box', icon: '💌' },
      // Migration 394.
      { key: 'rating', label: 'Rate the School', icon: '⭐', note: 'only while a school rating is open' },
    ],
  },
  staff: {
    label: 'Staff dashboard: row 1',
    where: 'The big tiles along the top of the staff dashboard.',
    tiles: [
      { key: 'timetable', label: 'My Timetable', icon: '🗓️' },
      { key: 'calendar', label: 'Calendar', icon: '📅' },
      // Moved from row 2 at the principal's request (migration 294).
      { key: 'my_children', label: 'My Children', icon: '👪', note: 'only staff who are also parents' },
      // Migration 312.
      { key: 'class_progress', label: 'Class Progress', icon: '📈', note: 'only Heads of Department (their department), SMT and admins (every class)' },
    ],
  },
  // Migration 282.
  staff_stats: {
    label: 'Staff dashboard: row 2',
    where: 'The tiles under the top row.',
    tiles: [
      // Both moved from row 1 at the principal's request (migrations 292,
      // 294). The numbers that were here are on the Students, Staff & Access
      // and Pastoral cards (292–293).
      { key: 'log_behaviour', label: 'Log behaviour', icon: '✍️' },
      { key: 'inbox', label: 'Inbox', icon: '✉️' },
      // Migrations 307–308.
      { key: 'missed_lessons', label: 'Missed Lessons', icon: '🚸', note: 'only staff with the Missed Lessons page (SMT, pastoral, school office, attendance officer)' },
      // Migration 311.
      { key: 'homework_monitor', label: 'Homework Monitor', icon: '📘', note: 'only staff with the Homework Monitor page (SMT)' },
      // Migration 391.
      { key: 'worry_box', label: 'Worry Box', icon: '💌', note: 'only the DSL and the principal' },
      // Migration 392.
      { key: 'wellbeing', label: 'Wellbeing', icon: '🌱', note: 'only the DSL and the principal' },
      // Migration 394.
      { key: 'school_rating', label: 'School Rating', icon: '⭐', note: 'only the DSL and the principal' },
    ],
  },
  staff_modules: {
    label: 'Staff dashboard: larger tiles',
    where: 'The larger tiles underneath the two rows, each with its own links. The bursar’s home page follows this order too.',
    tiles: [
      { key: 'students', label: 'Students', icon: '🎓' },
      { key: 'pastoral', label: 'Pastoral', icon: '💛' },
      // Migration 395.
      { key: 'attendance', label: 'Attendance', icon: '✅', note: 'Take a Register, Missing Registers, Register Alerts, Planned Absences and Student Marks' },
      // Migration 371.
      { key: 'rewards', label: 'Rewards', icon: '🎁', note: 'Orders, Rewards & Prices and Certificates' },
      { key: 'admissions', label: 'Admissions', icon: '📥' },
      { key: 'clinic', label: 'Clinic', icon: '🩺' },
      { key: 'reports', label: 'Reports', icon: '📝' },
      { key: 'comms', label: 'Communication', icon: '💬' },
      { key: 'timetable', label: 'Timetable', icon: '🗓️' },
      { key: 'otherhalf', label: 'The Other Half', icon: '🎭' },
      { key: 'assessment', label: 'Assessment', icon: '📊' },
      // Migration 413.
      { key: 'targets', label: 'Targets & Baselines', icon: '🎯', note: 'Import CAT4/NGRT, Reading Ages, Add Reading Test and Import Targets' },
      { key: 'fees', label: 'Fees & Bills', icon: '💳' },
      // Migrations 338–339: the principal only, while it is being built.
      { key: 'budget', label: 'Budget', icon: '💰', note: 'only the principal and the college secretary, while it is being built' },
      { key: 'tuckshop', label: 'Tuckshop', icon: '🍭' },
      { key: 'staff', label: 'Staff & Access', icon: '🔐' },
      { key: 'administration', label: 'Administration', icon: '⏰' },
    ],
  },
};

export async function loadTileOrder(dashboard) {
  const { data } = await supabase.from('dashboard_tile_order').select('tile_key, position').eq('dashboard', dashboard);
  return Object.fromEntries((data || []).map((r) => [r.tile_key, r.position]));
}

// { tile_key: position }, or null while loading.
export function useTileOrder(dashboard) {
  const [order, setOrder] = useState(null);
  useEffect(() => { loadTileOrder(dashboard).then(setOrder); }, [dashboard]);
  return order;
}

// Sort objects carrying `key` by the saved order; unsaved ones keep their
// original order after the saved ones.
export function sortTiles(tiles, order) {
  const o = order || {};
  return tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const pa = a.t.key in o ? o[a.t.key] : 10000 + a.i;
      const pb = b.t.key in o ? o[b.t.key] : 10000 + b.i;
      return pa - pb;
    })
    .map(({ t }) => t);
}
