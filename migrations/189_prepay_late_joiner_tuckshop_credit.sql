-- Migration 189: mark the late joiners' start-of-year tuckshop credit as
-- pre-paid, so it no longer shows as an unpaid bill to their parents.
--
-- Reported on Sat 26 Sep 2026: "When we added 40,000 to some students'
-- tuckshop, we added that as unpaid bill to parents. No bills in the system
-- should be unpaid."
--
-- What happened: a tuckshop balance is funded by 'Tuckshop' line items on
-- the student's fee invoice (get_tuckshop_balance). On 14 Sep every student
-- then on roll got a "Start of year tuck shop credit" line, each matched by a
-- fee_payments row (method 'Pre-paid', reference 'Start of year tuck shop
-- credit', no recorded_by) so the invoice showed as paid. On 25 Sep at 15:40
-- the 30 late joiners got the same credit — "Start of year tuck shop credit
-- (late joiners)", NGN 40,000 each, on a new 1st Term invoice — but without
-- the matching payment, so recalc_invoice_status() left all 30 invoices
-- 'unpaid' (NGN 1,200,000 in total). At the time of writing those were the
-- only unpaid invoices in the system.
--
-- The fix records the same kind of Pre-paid payment the other 261 students
-- have, for exactly each invoice's outstanding amount. The invoice-status
-- trigger on fee_payments then marks each invoice 'paid'. Tuckshop balances
-- don't change: they count credit lines minus purchases, not payments.
--
-- Scoped to invoices that are not paid, have no payment at all, and carry
-- only that late-joiner credit line — so re-running it, or running it after
-- a real unpaid bill has been raised, can't wave that bill through.

insert into fee_payments (invoice_id, amount, method, reference, paid_date, recorded_by)
select si.id,
       sum(li.amount),
       'Pre-paid',
       'Start of year tuck shop credit (late joiners)',
       date '2026-09-25',
       null
from student_invoices si
join invoice_line_items li on li.invoice_id = si.id
where si.status <> 'paid'
  and not exists (select 1 from fee_payments fp where fp.invoice_id = si.id)
  and not exists (
    select 1 from invoice_line_items o
    where o.invoice_id = si.id
      and o.description <> 'Start of year tuck shop credit (late joiners)'
  )
group by si.id
having sum(li.amount) > 0;
