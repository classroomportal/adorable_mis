# Budgets and requisitions: design

Status, 2 October 2026: **design only, nothing built.** The principal's
decisions so far are under "Decided"; the proposed answers under "Still to
decide" are what will be built unless the principal says otherwise.

What was asked for (the principal, 2 October 2026): "We collect fees in term 2
and can allocate them in advance to different cost centres including staffing,
power, food, maintenance. Staff raise requisitions which are then signed by
principal, costed and approved by college secretary, goods supplied." And:
"Some things are charged directly like swimming, sports, exam entry, ICT."

So two things:

1. **A budget.** Fee income is shared out in advance across cost centres, and
   each cost centre shows how much is allocated, committed, spent and still
   available.
2. **Requisitions.** Staff ask for what they need. The principal signs, the
   college secretary costs and approves (which commits the money), the goods
   arrive and the bursar pays.

This is a budget and spending-control system, not accounting software. It does
not keep a general ledger, reconcile the bank or produce statutory accounts.

## Decided (the principal, 2 Oct 2026)

| Question | Decision |
| --- | --- |
| Two kinds of income | **Tuition goes into a general fund**, shared out in advance across Staffing, Power, Food, Maintenance and so on. **Direct charges (swimming, sports, exam entry, ICT, medical) are ring-fenced**: what is collected for a purpose is spent on that purpose. |
| Part-payments | **Pro rata, to start with.** A payment covering part of an invoice is shared across the invoice's funds in proportion to what is still owed to each. |
| Surplus at year end | **Carried forward.** Each fund's unspent balance becomes its opening balance next year. |
| Refunds | **Not generally allowed.** No refund process is built. A rare exception goes through as a requisition against that fund (paid to the parent), so it still needs the principal and the college secretary. |
| Uniform | **Out of scope.** Uniform is bought from the tuck shop. |
| Tuck shop money | **Outside the budget** (follows from the above). Tuck shop top-ups are the students' money held for them, not school income. |

## What exists today (checked against the live database, 2 Oct 2026)

- **Fee items** (`fee_items`, with `category`):
  - Tuition: School Fees Full ₦1,950,000, School Fees old ₦1,500,000, School Fees Staff ₦450,000.
  - Activity: Swimming ₦50,000, Sports Academy ₦30,000, Taekwondo ₦20,000.
  - Medical Charges ₦50,000.
  - Technology: ICT Security ₦50,000.
  - Also Damages & Surcharge, Discount, Tuck Shop Balance and Tuck Shop Recharge.

  Tuition, activity, medical and technology are price-locked and two-person
  approved (migrations 259–261). **There is no exam-entry fee item yet.**
- **Only tuck shop has been invoiced so far.** All 324 invoice lines are Tuck
  Shop Recharge, including 12 negative "paid less than 40000" adjustments
  and 9 top-ups made from a payment (`from_payment_id`). There are 312
  payments, and one fee term ("1st Term").
- **Payments are recorded per invoice, not per line** (`fee_payments.invoice_id`).
  So the share of a payment that belongs to each fund has to be calculated.
  That is what the pro-rata rule decides.
- **Two-person approval already exists** for fee prices (`fee_price_changes`,
  `approve_fee_price_change()`, `holds_staff_role('principal' / 'college_secretary')`).
  Budgets reuse the same pattern.
- **Nothing exists for budgets, cost centres, requisitions or suppliers.**

## Funds and cost centres

Every pound (naira) collected belongs to exactly one **cost centre**, and every
fee item points at one. A cost centre is one of four kinds:

| Kind | Examples | Money in | Can be spent from? |
| --- | --- | --- | --- |
| `general_pool` (exactly one: "General fund") | | Tuition (and Damages, unless decided otherwise) | No. It is shared out by allocation. |
| `allocated` | Staffing, Power, Food, Maintenance, … | Allocations from the general fund | Yes, up to its allocation |
| `ring_fenced` | Swimming, Sports (Sports Academy, Taekwondo), Medical, ICT, Exam entries | Its own fee items | Yes, up to its own income plus carry-forward |
| `held` (exactly one: "Tuck shop, held for students") | | Tuck shop items | No. Outside the budget, shown only for completeness. |

- `fee_items.cost_centre_id` is added and must be filled for every item. Changing
  it changes where future money goes, so it is logged in `change_history`
  ('fees'), and only `/admin/lookups` holders can change it.
- Cost centres are listed and added at `/admin/lookups`. They are archived,
  never deleted, once anything points at them.
- **Discounts** reduce the fund of the line they discount. A "Discount" line
  with no clear target reduces the general fund (see the questions below).

## Income: charged and collected

For each cost centre and academic year:

- **Charged** = the sum of its invoice lines, negative lines included.
- **Collected** = the sum of its shares of payments.

**Pro rata, recorded at payment time.** When a payment is recorded, a trigger
splits it across the invoice's cost centres in proportion to what each is
**still owed at that moment**. It writes one row per cost centre to
`fee_payment_allocations (payment_id, cost_centre_id, amount)`; pennies
left over from rounding go to the largest share. Storing the split, rather
than recalculating it every time, means that adding a line to an invoice
later doesn't silently move money that was collected months ago.

- When a payment is edited or deleted, its split is recalculated.
- Overpayment (more than the invoice owes) goes to the general fund as
  "unallocated credit", unless it is a tuck shop top-up, which already becomes
  a tuck shop line through `from_payment_id`.
- The split is readable by the same people who can read payments (bursar, SMT),
  plus the principal and the college secretary through the budget pages.

## The budget

For each academic year (`academic_years`, which already exists):

- **Allocations**: an amount for each `allocated` cost centre, optionally split
  by term so cash flow can be seen (money arrives mainly in term 2 but is
  spent all year). Allocations are made **in advance**, against expected
  general-fund income, not only against money already collected.
- **Two-person approval**, as for fee prices. A budget, or a change to it, is
  a proposal in `budget_changes`. It is made by the bursar, SMT, the principal
  or the college secretary, and applied only when one holder of `principal`
  and one holder of `college_secretary` have both approved it (two different
  people). The app can't write allocations directly (a guard trigger, like
  `guard_fee_prices()`).
- **Moving money between cost centres** (virement) is a budget change of the
  same kind. A move into or out of a ring-fenced fund is allowed only through
  this route, and shows as such.
- **Opening balances**: at the year switch, each fund's balance (collected +
  opening − spent, with commitments carried as commitments) becomes next
  year's opening balance (`budget_opening_balances`). This applies to the
  general fund's unallocated money too.

### The four numbers on every cost centre

| | Allocated / general | Ring-fenced |
| --- | --- | --- |
| Available to spend | allocation | opening balance + charged (see the questions below) |
| Committed | approved requisitions not yet paid | same |
| Spent | payments recorded | same |
| **Remaining** | available − committed − spent | same |

The general fund also shows: expected income (charged), collected, total
allocated, and **unallocated** (expected − allocated). A warning appears when
allocations exceed expected income, or when spending runs ahead of collected
cash.

## Requisitions

| Step | Status after | Who | What happens |
| --- | --- | --- | --- |
| Raise | `submitted` (from `draft`) | Any staff member | Items, quantities, reason, date needed, suggested cost centre. No prices needed. |
| Sign | `signed` / `rejected` | Principal (`holds_staff_role('principal')`) | Agrees the need, or rejects it with a reason. |
| Cost | `costed` | College secretary | Unit prices, supplier and the final cost centre. Sees the cost centre's remaining balance next to the total. Quotes can be attached. |
| Approve | `approved` / `rejected` | College secretary | **Commits** the total against the cost centre. Refused if it would take the cost centre below zero (see the override question below). |
| Supplied | `part_received` / `received` | The requester, or a receiver named by the college secretary | Records what arrived, item by item, with any shortfall noted. A delivery note can be attached. |
| Paid | `paid` | Bursar | Records the payment (amount, date, method, reference, the supplier's invoice). Can be in parts. Moves the amount from committed to spent. |

- Every step is a `SECURITY DEFINER` function that checks the caller through
  `auth.uid()` and `holds_staff_role()`. The status, prices, totals and
  approvals can't be written from the app; a guard trigger refuses them from
  `authenticated`, as with `applicants_guard()`.
- **Separation of duties**: nobody signs or approves their own requisition, and
  the approver can't record receipt. The college secretary's own requisitions
  are approved by the principal. The principal's own requisitions count as
  signed when raised but still need the college secretary to cost and approve
  them.
- **Payments can't exceed the approved total.** If the supplier charges more,
  the college secretary re-costs it, which re-checks the budget. The approved
  total can't be raised silently at the payment step.
- **Cancelling**: the requester can withdraw a requisition before approval.
  After approval only the college secretary can cancel it, which releases
  whatever is still committed. When a requisition is paid in full, or closed
  with less paid than approved, the rest of the commitment is released.
- **Reference numbers**: `REQ-2026-0001`, numbered per academic year.
- **Notifications**: each step emails whoever is next, through
  `queue_workspace_email()`, with `'reply_to', email_reply_to('requisitions')`
  (new `email_reply_routes` row, proposed cs@). The requester is emailed when
  their requisition is rejected, approved or paid.
- **Logging**: every table here gets `log_change('finance', …)`, as a new
  `change_history` area. Each requisition also keeps its own visible timeline
  (`requisition_events`: who, what, when, comment), shown on the requisition.
- **"Who did it" columns** (`requested_by`, `signed_by`, `costed_by`,
  `approved_by`, `received_by`, `recorded_by`) are stamped by `stamp_actor()` or
  inside the step functions, never taken from the request.

## Spending without a requisition

Payroll isn't requisitioned, and nor are some recurring bills (PHCN or diesel,
for example). Cost centres can be flagged `direct_spend` through a two-person
budget change, and only on those can the bursar record an expenditure with no
requisition: a monthly payroll total, a utility bill. Each entry is logged
like everything else. No other cost centre accepts spending without an
approved requisition.

## Exam entries

Exam entry is pass-through money: charged per student, paid to the board per
entry. Needed:

1. An **Exam Entry** fee item (or one per board: IGCSE, WAEC) pointing at the
   Exam entries cost centre. It may need a price per number of subjects
   rather than one locked price. To decide with the bursar.
2. Later: a list of entries per student and board, so the system can show
   *charged but not entered*, *entered but not charged / not paid*, and the
   board's invoice against what was collected.

## Data (new tables)

All in `public`, with RLS enabled and explicit `grant`s to `authenticated` for
exactly the verbs the policies allow. No `anon`.

- `cost_centres`: name, kind, `direct_spend`, active, sort order.
- `fee_items.cost_centre_id` (new column).
- `fee_payment_allocations`: payment, cost centre, amount (trigger-written only).
- `budget_allocations`: academic year, cost centre, term (nullable), amount.
- `budget_changes` and `budget_change_lines`: proposals and their two approvals.
- `budget_opening_balances`: academic year, cost centre, amount.
- `suppliers`: name, contact, phone, email, notes. Bank details only if wanted;
  readable by the bursar and the college secretary only.
- `requisitions`, `requisition_items`, `requisition_events`,
  `requisition_receipts`.
- `expenditures`: cost centre, amount, date, method, reference, supplier,
  requisition (nullable, only for `direct_spend` centres).
- A private `finance-files` bucket for quotes, supplier invoices and delivery
  notes, readable only through a row, as with `homework-files`.

## Who sees what (proposed)

| Who | Sees |
| --- | --- |
| Any staff member | Their own requisitions and where each one is up to. |
| Principal, college secretary, bursar | All requisitions, the budget, all cost centres. |
| SMT | The budget and all requisitions, read-only. |
| Parents, students | Nothing. |

New resources: `/requisitions` (all staff), `/requisitions/queue` (principal,
college secretary, bursar) and `/finance/budget` (principal, college
secretary, bursar, SMT). Finance pages are set up in `/admin/permissions` as
usual. The step functions check roles themselves, so a page permission alone
can't sign, approve or pay.

## Pages

- `/requisitions`: raise a requisition; my requisitions and their timelines.
- `/requisitions/queue`: "to sign" (principal), "to cost / to approve"
  (college secretary), "to pay" (bursar), "awaiting delivery".
- `/finance/budget`: each cost centre's allocated or available, committed,
  spent and remaining; general fund income against allocations; ring-fenced
  funds' charged and collected; budget changes awaiting approval; CSV export.
- `/finance/suppliers`.
- A top-row dashboard tile for the principal and the college secretary showing
  how many requisitions are waiting for them (`TILE_LISTS`, `sortTiles()`).

## Phases

1. **Cost centres and income**: cost centres, `fee_items.cost_centre_id`, the
   pro-rata payment split (backfilled for existing payments), and the budget
   page showing charged and collected by fund. Nothing to approve yet.
2. **Budgets**: allocations, two-person budget changes, remaining balances.
3. **Requisitions to approval**: raise, sign, cost, approve, commitments and the
   budget check, emails.
4. **Supply and payment**: receipts, payments, attachments, `direct_spend`
   entries for payroll and bills.
5. **Year end and exams**: carry-forward at the year switch, exam-entry
   reconciliation, reports for the auditors.

## Still to decide (proposed answer in bold)

1. **Over budget**: is a requisition that would overspend refused outright, or
   can the principal override it with a written reason? **Refused, unless the
   principal overrides with a reason, which is logged and shown on the budget
   page.**
2. **Department budgets** (e.g. Science inside Teaching materials): **not at
   first**; cost centres can be split later.
3. **Small purchases / petty cash**: **none at first**; everything goes
   through the full chain.
4. **Who records payment**: **the bursar.**
5. **Allocation**: fixed amounts, or percentages of general-fund collections?
   **Fixed amounts**, with the page showing them as percentages of expected
   income.
6. **Ring-fenced spending limit**: can a fund spend against what has been
   charged, or only what has been collected? **Charged**, so term 1 spending
   is possible before the term 2 collection, with a warning when committed
   spending is more than collected.
7. **Damages & Surcharge**: general fund or Maintenance? **Maintenance**
   (ring-fenced in effect).
8. **Discounts**: does a discount reduce only tuition (the general fund), or
   each line it applies to? **Only tuition**, since staff and sibling discounts
   are on school fees.
9. **Sports**: one Sports fund for Sports Academy and Taekwondo, with
   Swimming separate? **Yes.**
10. **Who receives goods**: the requester, or a store keeper role? **The
    requester, or a receiver the college secretary names.**
