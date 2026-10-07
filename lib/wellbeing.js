// Sorting wellbeing check-ins by priority and issue (migration 397). Each
// question carries `issue`, `priority` ('red' | 'amber' | null) and, for a
// scale, `red_at`. The rule is in migration 397's header and is written again
// in SQL as wellbeing_check_in_triage() (migration 398, for the end-of-prep
// email); keep all three in step. Only the DSL and the principal can read
// the answers this works on.

export const ISSUES = [
  { key: 'safety', label: 'Safety', help: 'Said they don’t feel safe at school or in the boarding house' },
  { key: 'low_mood', label: 'Low mood', help: 'Feeling low, or stopped enjoying things' },
  { key: 'needs_adult', label: 'Wants an adult to talk to', help: 'Asked to talk to someone, or has no adult they could talk to' },
  { key: 'pressure', label: 'Pressure and workload', help: 'Pressure to get good results, coping with work and tests, time to rest' },
  { key: 'friendships', label: 'Friendships and unkindness', help: 'Getting on with friends, someone unkind or leaving them out' },
  { key: 'home_boarding', label: 'Home and boarding', help: 'Being away from home, getting on in the boarding house' },
  { key: 'sleep_eating', label: 'Sleep and eating', help: 'Sleeping or eating badly' },
  { key: 'comment', label: 'Written comment', help: 'Wrote something in the comment box' },
];

export const TIERS = {
  red: { label: 'Red', help: 'You or the DSL see the student', bg: '#fbdede', fg: '#a3232c' },
  amber: { label: 'Amber', help: 'A conversation with someone you choose', bg: '#fdf3d8', fg: '#8a5a00' },
  green: { label: 'Green', help: 'No one-to-one follow-up; part of the school-wide picture', bg: '#dcf5e3', fg: '#1a7a3d' },
};

// A scale answer turned so that 5 is always good.
function goodScore(q, a) {
  return q.good_high ? a.score : 6 - a.score;
}

// mine: Map(question_id -> answer). Returns 'red' | 'amber' | 'green', or null
// for a check-in that isn't flagged.
export function checkInTier(checkIn, mine, questions) {
  if (!checkIn.flagged) return null;
  let red = false;
  let amber = !!checkIn.comment;
  let alerts = 0;
  for (const q of questions) {
    const a = mine.get(q.question_id);
    if (!a) continue;
    if (a.alert) {
      alerts += 1;
      if (q.priority === 'red') red = true;
      if (q.priority === 'amber') amber = true;
    }
    if (q.kind === 'scale' && q.red_at != null && a.score != null && goodScore(q, a) <= q.red_at) red = true;
  }
  if (red) return 'red';
  if (amber || alerts >= 4) return 'amber';
  return 'green';
}

// The issues a check-in has answers needing a look in, in ISSUES order.
export function checkInIssues(checkIn, mine, questions) {
  const found = new Set();
  for (const q of questions) {
    const a = mine.get(q.question_id);
    if (a?.alert && q.issue) found.add(q.issue);
  }
  if (checkIn.comment) found.add('comment');
  return ISSUES.filter((i) => found.has(i.key)).map((i) => i.key);
}

const TIER_ORDER = { red: 0, amber: 1, green: 2 };
export function byTier(a, b) {
  return (TIER_ORDER[a] ?? 3) - (TIER_ORDER[b] ?? 3);
}
