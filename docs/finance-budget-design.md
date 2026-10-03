# Budgets and requisitions: design

Status, 3 October 2026: **phase 1 built** (migration 338, `/finance/budget`):
cost centres, each fee item's fund, the pro-rata payment split (backfilled for
every existing payment) and fee income by fund. **Only the principal can see
it while it is being built.** The term forecast (the amount available for a term from student
numbers, migration 339) is built; the rest of phase 2 (allocations) and
phases 3 to 5 are not. All the principal's
decisions are under "Decided" and "Agreed".

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
| Exam entries (3 Oct) | **Billed to parents, then paid out to the British Council.** A ring-fenced pass-through fund whose one supplier is the British Council. |
| Suppliers (3 Oct) | **An approved suppliers list.** A requisition can only be costed and paid to a supplier on it. |
| Overspending (3 Oct) | **Money must be released from contingency.** A cost centre can't go over; the extra has to be released to it from a Contingency fund first. |
| Damages & Surcharge (3 Oct) | **Go to Maintenance.** |
| Discounts (3 Oct) | **Reduce tuition only** (the general fund), never a ring-fenced charge. |
| Nothing is deleted (3 Oct) | **"Deleting is not allowed: cancelling the effect, and recording who did it."** Requisitions, budget changes, releases, suppliers and cost centres are cancelled, rejected or archived, never deleted, and who did it and when are stamped by the database. |
| While it is built (3 Oct) | **Only the principal sees the Budget** ("I want to be the only person seeing the Budget tile while we develop"). |
| Proposals (3 Oct) | **All the proposed answers at the end were agreed.** |
| Starting point (3 Oct) | **The school starts using the budget in Term 2** (January Term 2027, 10 Jan – 28 Mar). "Fees collected would go into our budget fund that would allow cs and myself to plan term 2 expenditure." So budgets are **per term**: the Term 2 budget is the Term 2 fees (tuck shop and anything earlier left out), and each term's unspent money carries forward to the next term. |
| Plan against (3 Oct) | **Invoiced, spend to cash.** Allocations are planned against what has been charged for the term, so the whole term can be planned on day one. Spending is approved only up to the money actually collected, and the page shows how much of each allocation is backed by cash so far. |
| College secretary (3 Oct) | **Not yet.** The principal alone sees the budget until go-live. |
| Term forecast (3 Oct) | **"The fees items need to complete the amount available for the term using the numbers in each year."** Built in migration 339: per term, each fee item × students paying in each year group × approved price, totalled by fund, starting from the live headcount and editable per term by the principal or the college secretary. Term 2 and Term 3 budgets are chosen from the term picker on the Budget page. |
| Term 2 fee term (3 Oct) | **Not created yet.** The principal and bursar are looking at Term 2's invoice items this week; the 2nd Term fee term is set up after that. |

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
| `general_pool` (exactly one: "General fund") | | Tuition, less discounts | No. It is shared out by allocation. |
| `contingency` (exactly one: "Contingency") | | An allocation from the general fund | No. Money is only *released* from it to another cost centre (below). |
| `allocated` | Staffing, Power, Food, Maintenance, … | Allocations from the general fund (Maintenance also gets Damages & Surcharge) | Yes, up to its allocation plus anything released to it |
| `ring_fenced` | Swimming, Sports (Sports Academy, Taekwondo), Medical, ICT, Exam entries | Its own fee items | Yes, up to its own income plus carry-forward |
| `held` (exactly one: "Tuck shop, held for students") | | Tuck shop items | No. Outside the budget, shown only for completeness. |

- `fee_items.cost_centre_id` is filled for every item (seeded by category in
  migration 338). It is set only through `set_fee_item_cost_centre()` by the
  principal or the college secretary, and **can't change once the item has
  been charged** (add a new fee item instead): otherwise the item's charges
  and the money already collected for it would be counted in different
  funds. A new item has no fund until one is chosen; its money shows as "not
  assigned" and moves to the fund when one is chosen. Logged under 'fees'.
- Cost centres are listed, added, renamed and archived on the Budget page, by
  the principal or the college secretary only (where money goes is theirs to
  decide, so not Lookups). Never deleted; archiving stamps who and when.
- **Damages & Surcharge** income goes to Maintenance, on top of its allocation.
- **Discounts reduce tuition only.** A discount line, whatever it is attached
  to, counts against the general fund, never against a ring-fenced charge.
  So a discounted family still pays the full swimming, ICT, medical and exam
  entry charges into those funds.

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

- **Allocations**: an amount for each `allocated` cost centre (and
  Contingency) **per term**, starting with Term 2 (January Term 2027).
  Allocations are planned against what has been charged for the term; money
  can be committed only up to what has been collected (the principal,
  3 Oct 2026: "invoiced, spend to cash"). The page shows, for each
  allocation, how much is backed by cash so far.
- **Two-person approval**, as for fee prices. A budget, or a change to it, is
  a proposal in `budget_changes`. It is made by the bursar, SMT, the principal
  or the college secretary, and applied only when one holder of `principal`
  and one holder of `college_secretary` have both approved it (two different
  people). The app can't write allocations directly (a guard trigger, like
  `guard_fee_prices()`).
- **Contingency**: the budget sets aside an amount in the Contingency cost
  centre. Nothing is spent from it directly.
- **Releasing from contingency** is how a cost centre gets more money (see
  "Overspending" below). A release moves an amount from Contingency to one cost
  centre, with a reason, and is linked to the requisition that needed it.
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
| Cost | `costed` | College secretary | Unit prices, an **approved supplier** and the final cost centre. Sees the cost centre's remaining balance next to the total. Quotes can be attached. |
| Approve | `approved` / `rejected` / `awaiting_release` | College secretary | **Commits** the total against the cost centre. If it would take the cost centre below zero it can't be approved; it waits as `awaiting_release` until enough is released from contingency (below). |
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

## Overspending: release from contingency

A cost centre never goes below zero. When a requisition costs more than its
cost centre has left:

1. The college secretary sees the shortfall ("Maintenance has ₦120,000 left;
   this needs ₦300,000, short by ₦180,000") and asks for a **release from
   contingency** for the shortfall (or more), with a reason. The requisition
   waits as `awaiting_release`.
2. The release is approved (who approves it is question 1 below). The amount
   moves from Contingency to the cost centre, and the requisition can then be
   approved as normal.
3. If Contingency itself hasn't enough, the release can't be made. The money
   has to come from another cost centre first, through an ordinary two-person
   budget change (virement) into Contingency or straight into the cost centre.

The same applies to ring-fenced funds: if, for example, swimming costs more
than swimming income, the gap is released from contingency, and the budget page
shows that general money went into that fund. Every release is listed on the
budget page (date, amount, cost centre, reason, requisition, who approved it),
so the year's use of contingency can be seen at a glance.

## Approved suppliers

- Requisitions can only be costed with, and paid to, a supplier on the
  **approved list** (`suppliers.status = 'approved'`).
- Anyone who can cost requisitions, or the bursar, can **propose** a supplier
  (name, contact, what they supply, bank details).
- A supplier becomes approved only by the approval set in question 2 below.
  **Changing an approved supplier's bank details sends it back for approval**,
  because that is the usual route for payment fraud.
- A supplier can be **suspended** (no new requisitions; any already approved
  can still be received and paid) or **removed** (archived, never deleted
  once used).
- The bank details are readable only by the bursar, the college secretary
  and the principal; everyone else sees just the name.
- The British Council is added as an approved supplier from the start.

## Spending without a requisition

Payroll isn't requisitioned, and nor are some recurring bills (PHCN or diesel,
for example). Cost centres can be flagged `direct_spend` through a two-person
budget change, and only on those can the bursar record an expenditure with no
requisition: a monthly payroll total, a utility bill. Each entry is logged
like everything else. No other cost centre accepts spending without an
approved requisition.

## Exam entries

Exam entries are **billed to parents and then paid out to the British
Council** (the principal, 3 Oct 2026). So it is a pass-through fund: the money
in should match the money out.

1. An **Exam Entry** fee item, pointing at the Exam entries cost centre. Its
   price probably depends on the number of subjects or papers entered rather
   than being one locked price. To settle with the bursar and the exams officer.
2. The payment to the British Council goes through as a requisition against
   Exam entries, with the British Council as the supplier and its invoice
   attached, so it is signed and approved like everything else.
3. Later: a list of entries per student, so the system can show
   *charged but not entered*, *entered but not charged / not paid*, and the
   British Council's invoice against what was collected.
4. If the British Council's invoice is more than was collected (e.g. a parent
   hasn't paid), the gap is released from contingency, as for any other
   overspend.

## Data (new tables)

All in `public`, with RLS enabled and explicit `grant`s to `authenticated` for
exactly the verbs the policies allow. No `anon`.

- `cost_centres`: name, kind, `direct_spend`, active, sort order.
- `fee_items.cost_centre_id` (new column).
- `fee_payment_allocations`: payment, cost centre, amount (trigger-written only).
- `budget_allocations`: academic year, cost centre, term (nullable), amount.
- `budget_changes` and `budget_change_lines`: proposals and their two approvals.
- `budget_opening_balances`: academic year, cost centre, amount.
- `suppliers`: name, contact, phone, email, what they supply, status
  (`proposed` / `approved` / `suspended` / `archived`), approvals. Bank details
  in a separate table readable by the bursar, the college secretary and the
  principal only.
- `contingency_releases`: amount, to cost centre, reason, requisition, approvals.
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
   budget check, contingency releases, the approved suppliers list, emails.
4. **Supply and payment**: receipts, payments, attachments, `direct_spend`
   entries for payroll and bills.
5. **Year end and exams**: carry-forward at the year switch, exam-entry
   reconciliation, reports for the auditors.

## Agreed (the principal accepted these proposals, 3 Oct 2026)

1. **Who approves a release from contingency?** **The principal alone**, so a
   requisition isn't held up waiting for two signatures; the college
   secretary has already costed it and asked for the release, so two people
   are involved anyway. (Alternative: both, like other budget changes.)
2. **Who approves a supplier?** **The principal and the college secretary
   together**, as with fee prices and budgets.
3. **Department budgets** (e.g. Science inside Teaching materials): **not at
   first**; cost centres can be split later.
4. **Small purchases / petty cash**: **none at first**; everything goes
   through the full chain.
5. **Who records payment**: **the bursar.**
6. **Allocation**: fixed amounts, or percentages of general-fund collections?
   **Fixed amounts**, with the page showing them as percentages of expected
   income.
7. **Ring-fenced spending limit**: replaced by "invoiced, spend to cash"
   above (3 Oct): planned against what was charged, spent only up to what
   was collected.
8. **Sports**: one Sports fund for Sports Academy and Taekwondo, with
   Swimming separate? **Yes.**
9. **Who receives goods**: the requester, or a store keeper role? **The
   requester, or a receiver the college secretary names.**
10. **Unused contingency at year end**: carried forward in Contingency, like
    every other surplus? **Yes.**
