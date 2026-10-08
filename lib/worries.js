// The Worry Box (migration 391). Every worry, with the student's name, is
// read by the DSL and the principal only; the database checks that
// (can_read_worries(), on the roles themselves, so admin is not enough).
// This file holds the wording shared by the student and staff pages, and
// loads the category list.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

// The categories are a list the Worry Box readers edit on Lookups (migration
// 411, the principal 8 Oct 2026), in worry_categories. These seven are what
// it was seeded with, used only until the list has loaded (or if it can't).
// Each has an area, Facilities or Other (migration 407): students choose
// between the two first; staff move a misfiled worry with set_worry_category().
const SEEDED_CATEGORIES = [
  { key: 'bullying', label: 'Bullying, unkindness or friendship problems', short: 'Bullying / friends', area: 'other' },
  { key: 'staff', label: 'Something a member of staff said or did', short: 'A member of staff', area: 'other', dailyToDsl: true },
  { key: 'feelings', label: 'How I am feeling', short: 'Feelings', area: 'other' },
  { key: 'home', label: 'Home or family', short: 'Home / family', area: 'other' },
  { key: 'boarding', label: 'The boarding house', short: 'Boarding', area: 'other' },
  { key: 'equipment', label: 'Facilities: equipment, rooms, food, water or toilets', short: 'Facilities', area: 'facilities' },
  { key: 'other', label: 'Something else', short: 'Something else', area: 'other' },
];

export const WORRY_AREAS = {
  facilities: { label: 'Facilities', hint: 'Equipment, rooms, food, water, toilets' },
  other: { label: 'Other', hint: 'Friends, staff, feelings, home, boarding, anything else' },
};

function fromRow(r) {
  return {
    key: r.category_key, label: r.label, short: r.short_label, area: r.area,
    dailyToDsl: r.daily_to_dsl, sortOrder: r.sort_order, retired: r.retired,
  };
}

export async function loadWorryCategories() {
  const { data, error } = await supabase.from('worry_categories')
    .select('category_key, label, short_label, area, daily_to_dsl, sort_order, retired')
    .order('sort_order').order('short_label');
  if (error) throw error;
  return (data || []).map(fromRow);
}

// Every category, retired ones included (old worries keep theirs), with
// helpers. `active` is what can be chosen for a new or moved worry.
export function useWorryCategories() {
  const [all, setAll] = useState(SEEDED_CATEGORIES);
  const reload = useCallback(() => loadWorryCategories().then(setAll).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  return useMemo(() => {
    const byKey = Object.fromEntries(all.map((c) => [c.key, c]));
    return {
      all,
      active: all.filter((c) => !c.retired),
      reload,
      area: (key) => byKey[key]?.area || 'other',
      label: (key, { short = false } = {}) => {
        const c = byKey[key];
        return c ? (short ? c.short : c.label) : key;
      },
    };
  }, [all, reload]);
}

// What a student sees for each status.
export const WORRY_STATUS_STUDENT = {
  new: 'Sent',
  open: 'Read by staff',
  closed: 'Closed',
};

export const WORRY_STATUS_STAFF = {
  new: 'New',
  open: 'Open',
  closed: 'Closed',
};

export function holdsWorryRole(staffRoles) {
  // Guidance staff too since migration 402.
  return (staffRoles || []).some((r) => r === 'dsl' || r === 'principal' || r === 'guidance');
}
