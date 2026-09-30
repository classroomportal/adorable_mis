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
      { key: 'messages', label: 'Messages', icon: '📬' },
    ],
  },
  staff: {
    label: 'Staff dashboard: row 1',
    where: 'The big tiles along the top of the staff dashboard.',
    tiles: [
      { key: 'log_behaviour', label: 'Log behaviour', icon: '✍️' },
      { key: 'timetable', label: 'My Timetable', icon: '🗓️' },
      { key: 'calendar', label: 'Calendar', icon: '📅' },
      { key: 'inbox', label: 'Inbox', icon: '✉️' },
      { key: 'my_children', label: 'My Children', icon: '👪', note: 'only staff who are also parents' },
    ],
  },
  // Migration 282.
  staff_stats: {
    label: 'Staff dashboard: row 2',
    where: 'The numbers under the top row.',
    tiles: [
      { key: 'students', label: 'Active students', icon: '🎓' },
      { key: 'staff', label: 'Staff', icon: '🧑‍🏫' },
      { key: 'alerts', label: 'Behaviour alerts (7 days)', icon: '⚠️' },
    ],
  },
  staff_modules: {
    label: 'Staff dashboard: larger tiles',
    where: 'The larger tiles underneath the two rows, each with its own links. The bursar’s home page follows this order too.',
    tiles: [
      { key: 'students', label: 'Students', icon: '🎓' },
      { key: 'pastoral', label: 'Pastoral', icon: '💛' },
      { key: 'admissions', label: 'Admissions', icon: '📥' },
      { key: 'clinic', label: 'Clinic', icon: '🩺' },
      { key: 'reports', label: 'Reports', icon: '📝' },
      { key: 'comms', label: 'Communication', icon: '💬' },
      { key: 'timetable', label: 'Timetable', icon: '🗓️' },
      { key: 'otherhalf', label: 'The Other Half', icon: '🎭' },
      { key: 'assessment', label: 'Assessment', icon: '📊' },
      { key: 'fees', label: 'Fees & Bills', icon: '💳' },
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
