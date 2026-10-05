# Reward Store: design

Status, 5 October 2026: **design only, nothing built.** The questions under
"To decide" need the principal's answers before migration work starts; each has
a recommended answer so building can begin as soon as they are agreed.

What was asked for (the principal, 5 Oct 2026): "a reward store where students
can use the merit points to purchase things. The merit total for our records
and reports needs to stay but their buying points go down. Things they might
buy would be a day of wearing mufti in school, visit to tuckshop. Be an
assistant for a day."

So two different numbers per student:

| Number | What it is | Changes when | Used by |
| --- | --- | --- | --- |
| **Merit total** | Positive points earned, as today | A merit is logged, edited, voided or deleted | Certificates, Behaviour Totals, reports, the profile, parents. **Unchanged by the store.** |
| **Points to spend** | Merits earned since the store opened, less what has been spent | A merit is logged/removed, or the student buys or gets a refund | The Reward Store only |

Spending never touches `behaviour_events`. A purchase is a separate row in a new
ledger, so every existing total, certificate and report reads exactly what it
reads today.

## What exists today (checked against the live database, 5 Oct 2026)

- Merits are `behaviour_events` rows with `type = 'positive'` and `points` set
  from the category (1–5: Good work 1, Kindness 2, Helping others 3,
  Representing the school 5 …). Voided events (`voided_at`) don't count.
- Logging started 21 Sept 2026. In the two weeks since, the median student has
  earned **31 positive points**, the top 10% **50 or more**, the highest **78**;
  279 active students. That is roughly **15 points a week** for a typical
  student, about **200 a term**.
- Certificates (Bronze 100, Silver 200, Gold 500) use the **net** total
  (positive plus negative) and stay as they are.
- The tuckshop is run on a money balance (`get_tuckshop_balance()`), with weekly
  ordering windows and special sessions (migration 241). There is no "mufti"
  or "reward" anything yet.

## How it works

### For a student (portal, new **Reward Store** tile)

1. The tile shows **Points to spend: 46** (and, smaller, "Merit total this
   year: 58").
2. The store lists what is on offer: name, picture/icon, cost, what it involves,
   and why it can't be bought if it can't (not enough points, already had one
   this term, sold out for that day, not for your year group).
3. Some rewards need a date (mufti day, assistant for a day): the student picks
   from the school days still open for it.
4. **Buy** takes the points straight away (so they can't be spent twice) and
   creates a request with status *Requested*. The student can cancel while it
   is still *Requested*; the points come back.
5. Staff approve or decline. Declined: points come back, with the reason.
   Approved: the student sees "Approved: Mufti, Friday 16 October".
6. When it has happened, staff mark it *Used*. That is the end of it.

### For staff

- **`/rewards`** (Pastoral card): the request queue (Requested → Approved →
  Used), filters by reward, date and year group, Approve / Decline with a
  reason / Mark used. A **day list**: "Mufti on Friday 16 October: 12
  students", printable, for duty staff and mentors at registration.
- **`/rewards/items`**: the catalogue: add, retire, price, limits. Prices are
  data, never hard-coded (like `behaviour_rules`).
- Mentors see their own group's purchases; the student profile gets a small
  "Rewards" panel (bought, used, points to spend).
- Inbox notice to the approver for a new request, and to the student when it is
  decided (`post_inbox_notice`, kind `reward`).

### Starting rewards (prices to be agreed)

Prices assume ~15 points a week, so a typical student can afford something
small every few weeks and something big about once a term.

| Reward | Suggested cost | Needs a date | Limits (suggested) | Approved by | Notes |
| --- | --- | --- | --- | --- | --- |
| Mufti day | **40** | Yes, a school day | 1 per student per half term | Pastoral / head of boarding | Not on exam days, trips or `prep_blocks` days; the day list goes to mentors. Mufti rules (what's acceptable) shown on the item. |
| Extra tuckshop visit | **25** | Yes, a tuckshop day | 1 per student per fortnight | Tuckshop | A *visit* (go to the front / an extra visit), **not money**: goods are still paid from the tuckshop balance. See "To decide" 4. |
| Assistant for a day | **100** | Yes | 1 per student per term; **1 student per day** school-wide | SMT | The student shadows a member of staff who has agreed (librarian, lab technician, the office, a head of department, the principal). The approver picks the member of staff. See "To decide" 5. |

Later ideas the catalogue can take without new code: front of the lunch queue
for a week, choose the music at a house event, a seat at the principal's lunch,
a stationery item, extra screen time in boarding.

## Data (sketch; migration numbers from 370)

- **`reward_items`**: name, description, cost (points, > 0), `needs_date`,
  `allowed_days` (school days / tuckshop days), `year_groups` (null = all),
  `per_student_limit` + `limit_period` (`term` / `half_term` / `fortnight` /
  `year`), `per_day_capacity` (null = unlimited), `approver_roles`
  (text[] of `staff_roles` names), `active`. Never deleted: retired with
  `active = false`. Changing the cost doesn't change requests already made.
- **`reward_purchases`** (the ledger): student, item, `cost` (copied from the
  item at the moment of buying), `for_date`, `status` (`requested`,
  `approved`, `declined`, `cancelled`, `used`), `decided_by/at`,
  `decline_reason`, `assigned_staff_id` (assistant for a day), `used_at`,
  `created_at`. Never deleted. Points are *held* by `requested`, `approved`
  and `used`; `declined` and `cancelled` give them back.
- **`reward_settings`** (one row): `store_open`, `points_count_from` (date: only
  merits from this date can be spent), whether points reset each academic year.
- **`reward_points_balance(student_id)`**: merits earned (non-voided, positive,
  since `points_count_from`, current academic year if resetting) minus held
  purchases. Worked out every time, never stored, so a merit voided on appeal
  or deleted by SMT fixes the balance automatically.

### Rules the database enforces

- **Only through functions.** `reward_purchases` has select policies only;
  writes go through `buy_reward(item, for_date)`, `cancel_reward(purchase)`,
  `decide_reward(purchase, approve, reason, staff_id)` and
  `mark_reward_used(purchase)`, all `SECURITY DEFINER`, identifying the
  caller through `auth.uid()` (`my_student_id()` for the student; the student
  ID is never taken from the request).
- `buy_reward()` locks the student's row (`select … for update`) before checking
  the balance, so two taps at once can't spend the same points twice; it checks
  the store is open, the item is active and for the student's year, the date is
  allowed and not full, the per-student limit, and that the balance covers the
  cost.
- A balance can go **below zero** only when a merit is removed after it was
  spent (an upheld appeal can't touch merits, but SMT can delete one). Nothing
  is clawed back; the student simply can't buy again until it is positive.
- Only a holder of the item's `approver_roles` (checked in `staff_roles`, plus
  admin) can approve, decline or mark used. Nobody decides a request for their
  own child.
- Who can see: the student (own), staff (all, as with behaviour), parents (see
  "To decide" 3). Other students never see who bought what, except that a mufti
  day is visible by its nature.
- Logged in `change_history` under a new area `rewards` (added to
  `change_history_area_check`) for `reward_items` and `reward_purchases`.
- Every new table is granted to `authenticated` only, with only the verbs its
  policies allow, and gets `stamp_actor()` on its "who" columns.

### What doesn't change

`behaviour_events`, `behaviour_totals()`, certificates, the written report,
Behaviour Totals, detentions and alerts. None of them read the store.

## To decide (the principal)

| # | Question | Recommended |
| --- | --- | --- |
| 1 | Do **negative points** reduce points to spend? | **No.** Spending is for merits earned; negatives are already handled by detentions and alerts, and one Stage 5 wiping out a term's savings would discourage good behaviour. (Option: allow it as a setting.) |
| 2 | Which merits can be spent: everything since 21 Sept, or only from the store's opening day? Do unspent points **reset** each academic year? | **Everything since 21 Sept** (students already earned them), and **reset each September**, so the store follows the school year. |
| 3 | Can **parents** see what their child bought? | **Yes, read-only** on the parent portal (what, when, status). Parents can't buy. |
| 4 | Tuckshop visit: an extra visit paid from the tuckshop balance, or a **voucher worth money** (e.g. ₦1,000 of goods)? | **Visit only.** Turning points into money brings in the bursar, the tuckshop balance and fee rules; a visit keeps points and money separate. |
| 5 | Assistant for a day: does the student **miss lessons**? Which staff are willing? | **Yes, with the day recorded as an authorised absence** through a planned absence (so registers don't chase it); the approver checks it's not a test or mock day. A list of willing staff kept on the item. |
| 6 | Who approves each reward? | Mufti: pastoral or head of boarding. Tuckshop: the tuckshop. Assistant: SMT. All editable on the item. |
| 7 | Prices and limits | As in the table above, reviewed after half term against how fast points are being spent. |
| 8 | Who manages the catalogue? | SMT and pastoral (`/rewards/items`), a tickable ability on `/admin/permissions` like the other new tables. |

## Build stages

1. **Store and ledger**: tables, balance function, `buy_reward` / `cancel_reward`
   / `decide_reward` / `mark_reward_used`, the portal tile and the staff queue,
   starting catalogue (mufti, tuckshop visit, assistant).
2. **Day lists and notices**: printable mufti list, inbox notices, mentor view,
   profile panel, parent view (if agreed).
3. **Assistant-for-a-day link to attendance** (planned absence), if agreed.
4. Review prices after half term; docs (`SYSTEM_RULES.md`, FS, PRD, User Manual).
