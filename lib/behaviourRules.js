// The school's behaviour thresholds (behaviour_rules, migrations 262-263),
// edited at /admin/lookups. Points are stored as negative numbers. The
// database enforces them; pages read them to show the same rule and to
// ask for an explanation before saving rather than after a refusal. The Stage 5
// guidance shown on Log behaviour (migration 335) is in the same row.
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export const DEFAULT_BEHAVIOUR_RULES = {
  serious_event_points: -5,
  serious_event_guidance: '',
  detention_single_event_points: -5,
  detention_weekly_total_points: -10,
  alert_weekly_total_points: -8,
  merit_review_words: 12,
};

let cached = null;

export async function loadBehaviourRules() {
  if (!cached) {
    cached = supabase.from('behaviour_rules').select('*').maybeSingle()
      .then(({ data }) => ({ ...DEFAULT_BEHAVIOUR_RULES, ...(data || {}) }))
      .catch(() => DEFAULT_BEHAVIOUR_RULES);
  }
  return cached;
}

// React hook: the rules, starting from the defaults until they've loaded.
export function useBehaviourRules() {
  const [rules, setRules] = useState(DEFAULT_BEHAVIOUR_RULES);
  useEffect(() => { loadBehaviourRules().then(setRules); }, []);
  return rules;
}
