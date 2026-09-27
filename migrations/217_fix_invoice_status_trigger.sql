-- 217_fix_invoice_status_trigger.sql
--
-- Hotfix for migration 214. That migration stopped the API roles calling
-- recalc_invoice_status(), which anyone could call without signing in. But
-- the trigger that keeps an invoice's paid/partial/unpaid status up to date
-- (trg_recalc_invoice_status, on fee_payments and invoice_line_items) was an
-- ordinary function running as the signed-in bursar, so it needed that
-- permission too: from 214 going live (13:03 UTC, 27 Sep 2026) recording a
-- payment or adding/removing a fee charge failed with "permission denied for
-- function recalc_invoice_status". Caught 40 minutes later while testing
-- migration 218; the database logs show no one but that test hit it.
--
-- The trigger now runs with the database's own rights (SECURITY DEFINER),
-- like the other trusted helpers, so the bursar doesn't need to be able to
-- call recalc_invoice_status() directly, and nobody outside can.

alter function public.trg_recalc_invoice_status() security definer;
revoke execute on function public.trg_recalc_invoice_status() from public, anon, authenticated;
