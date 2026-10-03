-- Migration 345: naira as whole numbers in text the database writes.
--
-- Why: the principal, 3 Oct 2026, asked for naira to be shown as whole
-- numbers with no decimal places (done in the app's displays and PDFs), "and
-- change the database message too". Two functions wrote naira with ".00":
--   * enforce_locked_fee_price(): the message when a locked fee is charged at
--     the wrong amount ("... for Year 12 in January Term 2027: 3,000,000.00").
--   * render_admission_letter(): the {{form_fee}} and {{deposit}} fields in
--     admissions letters emailed to families.
-- Both now use 'FM999,999,990' (rounds to the naira). Only the wording
-- changes: the price check itself still compares the exact amounts.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.enforce_locked_fee_price()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f fee_items;
  v_year integer;
  v_term integer;
  v_term_name text;
  v_price numeric;
begin
  if new.fee_item_id is null or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.amount is not distinct from old.amount
     and new.fee_item_id is not distinct from old.fee_item_id
     and new.invoice_id is not distinct from old.invoice_id then
    return new;
  end if;
  select * into f from fee_items where id = new.fee_item_id;
  if not coalesce(f.price_locked, false) then
    return new;
  end if;

  select s.year_group, ft.term_id, t.term_name into v_year, v_term, v_term_name
    from student_invoices si
    join students s on s.student_id = si.student_id
    left join fee_terms ft on ft.id = si.term_id
    left join terms t on t.term_id = ft.term_id
   where si.id = new.invoice_id;
  v_price := fee_price_for(f.id, v_year, v_term);

  if v_price is null then
    raise exception '% has no approved price for Year %. It must be approved by the principal and the college secretary before it can be charged.',
      coalesce(f.display_name, f.name), v_year;
  end if;
  if new.amount is distinct from v_price then
    raise exception '% is charged at its approved price for Year %: ₦%. Other amounts need approval first.',
      coalesce(f.display_name, f.name), v_year || coalesce(' in ' || v_term_name, ''),
      to_char(v_price, 'FM999,999,990');
  end if;
  return new;
end;
$$;

create or replace function public.render_admission_letter(p_applicant_id bigint, p_kind text)
returns table (subject text, body text, email text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a applicants;
  t admission_letter_templates;
  v_contact applicant_contacts;
  v_session admission_sessions;
  v_year academic_years;
  v_fields jsonb;
  v_key text;
begin
  if not has_resource_access('/admissions') then
    raise exception 'Only admissions staff can produce admissions letters.';
  end if;

  select * into a from applicants where applicant_id = p_applicant_id;
  select * into t from admission_letter_templates where letter_kind = p_kind;
  if a.applicant_id is null or t.letter_kind is null then
    return;
  end if;
  if coalesce(btrim(t.body), '') = '' then
    return;
  end if;

  select * into v_contact from applicant_contacts c
   where c.applicant_id = p_applicant_id
   order by c.is_primary desc, c.contact_id limit 1;
  select * into v_session from admission_sessions where session_id = a.session_id;
  select * into v_year from academic_years where academic_year_id = a.entry_academic_year_id;

  v_fields := jsonb_build_object(
    'child_first_name', coalesce(nullif(a.preferred_name, ''), a.first_name),
    'child_full_name', concat_ws(' ', a.first_name, nullif(a.middle_name, ''), a.last_name),
    'parent_name', coalesce(v_contact.name, 'Parent/Guardian'),
    'entry_year', v_year.label,
    'year_group', 'Year ' || a.entry_year_group,
    'test_date', coalesce(to_char(v_session.session_date, 'FMDay FMDD FMMonth YYYY'), ''),
    'test_time', coalesce(to_char(v_session.start_time, 'FMHH12:MI am'), ''),
    'test_venue', coalesce(v_session.venue, ''),
    'interview_date', coalesce(to_char(a.interview_at at time zone 'Africa/Lagos', 'FMDay FMDD FMMonth YYYY'), ''),
    'interview_time', coalesce(to_char(a.interview_at at time zone 'Africa/Lagos', 'FMHH12:MI am'), ''),
    'form_fee', coalesce(to_char(v_year.admission_form_fee, 'FM999,999,990'), ''),
    'deposit', coalesce(to_char(v_year.admission_deposit, 'FM999,999,990'), ''),
    'today', to_char(school_today(), 'FMDD FMMonth YYYY'));

  subject := coalesce(nullif(btrim(t.subject), ''), t.label);
  body := t.body;
  for v_key in select jsonb_object_keys(v_fields) loop
    subject := replace(subject, '{{' || v_key || '}}', v_fields->>v_key);
    body := replace(body, '{{' || v_key || '}}', v_fields->>v_key);
  end loop;
  email := case when is_plain_email(lower(btrim(v_contact.email))) then lower(btrim(v_contact.email)) end;
  return next;
end;
$$;
