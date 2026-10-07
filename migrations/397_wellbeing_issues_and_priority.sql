-- Migration 397: wellbeing check-ins sorted by issue and priority.
--
-- Why (the principal, 8 Oct 2026): "There are too many to follow up", and
-- then "Categorise them and we can then ask other people to discuss issues".
-- In the first round 130 of 134 check-ins were flagged, so the DSL and the
-- principal can't see every student themselves. Each question now says which
-- issue it is about and how urgent an answer that needs a look is, so the
-- Wellbeing page can:
--   * give each flagged check-in a priority: red (the DSL or the principal
--     see the student), amber (someone they choose has a conversation), green
--     (no one-to-one follow-up; it counts towards the school-wide picture);
--   * group the students by issue (safety, low mood, wanting an adult to talk
--     to, pressure and workload, friendships and unkindness, home and
--     boarding, sleep and eating), with a list to download for the person
--     they ask to discuss that issue.
-- Who reads the answers is unchanged (can_read_worries()); passing a list on
-- is the DSL's or the principal's own decision, outside Formwork.
--
-- The rule, worked out on the page from these columns:
--   red    an alert answer on a question with priority 'red', or a scale
--          answer at or below red_at (on the good-high scale);
--   amber  an alert on a question with priority 'amber', 4 or more alert
--          answers, or a written comment;
--   green  any other flagged check-in.
-- First round: red is "doesn't feel safe" or feeling 1 out of 5; amber is
-- wanting to talk, no adult to talk to, feeling 2 out of 5, many low answers
-- or a comment. "Felt so low you stopped enjoying things" is grouped under
-- low mood but doesn't raise the priority on its own: 92 of 134 said yes,
-- which suggests it was read as "ever felt down".

set local formwork.change_note = 'Principal (direct)';

alter table public.wellbeing_questions
  add column if not exists issue text
    check (issue in ('safety', 'low_mood', 'needs_adult', 'pressure', 'friendships', 'home_boarding', 'sleep_eating')),
  add column if not exists priority text check (priority in ('red', 'amber')),
  add column if not exists red_at integer check (red_at between 1 and 4);

update public.wellbeing_questions q set issue = v.issue, priority = v.priority, red_at = v.red_at
from (values
  (1,  'low_mood',      'amber', 1),
  (2,  'sleep_eating',  null,    null),
  (3,  'sleep_eating',  null,    null),
  (4,  'pressure',      null,    null),
  (5,  'pressure',      null,    null),
  (6,  'pressure',      null,    null),
  (7,  'home_boarding', null,    null),
  (8,  'home_boarding', null,    null),
  (9,  'friendships',   null,    null),
  (10, 'safety',        'red',   null),
  (11, 'needs_adult',   'amber', null),
  (12, 'friendships',   null,    null),
  (13, 'pressure',      null,    null),
  (14, 'low_mood',      null,    null),
  (15, 'needs_adult',   'amber', null)
) as v(position, issue, priority, red_at)
where q.position = v.position;
