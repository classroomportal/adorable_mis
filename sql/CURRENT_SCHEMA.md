# Formwork — Live Database Schema (Current State)

**This file is a generated snapshot of the actual live Supabase database (introspected via the Supabase MCP connector), not hand-written.** Regenerate it whenever the schema drifts noticeably rather than editing it by hand.

## Why this file exists

A large amount of this schema was built directly against the live Supabase instance over time and was **never captured** in `sql/*.sql` or `migrations/*.sql` — those folders are an incomplete, roughly-chronological history, not a reliable source of truth for "what exists right now". This file fills that gap: it is a full introspected dump (tables, columns, constraints, RLS policies, triggers, views, functions, extensions, scheduled jobs) as of the date below.

**Before assuming a table/view/function doesn't exist, or guessing at its shape, check this file first.** Several real incidents this project has already hit came directly from *not* doing that:
- `student_summary` and `attendance_today` were `SECURITY DEFINER` views that bypassed RLS entirely and leaked every real student's data (including parent phone numbers) to the training/demo account, because nobody knew they existed until a security sweep found them.
- `handle_negative_behaviour()` (a trigger on `behaviour_events`) and `notify_pastoral_on_negative_behaviour()` both existed live, undocumented, and the latter genuinely emails real staff — seeding demo data once accidentally emailed real people before this was discovered.
- `detentions`, `register_alerts`, `house_assignments`, `behaviour_event_audit` all existed as real tables with real foreign keys, invisible until specifically queried for.


Generated: 16 September 2026. Project ref: `drjtcegtucovhbyfdpbx` (Supabase project "adorable_mis").

## Quick facts

- 61 tables, 4 views, 48 functions, 13 triggers, 61 tables with RLS enabled
- Extensions: pg_cron 1.6.4, pg_net 0.20.4, pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1
- Scheduled jobs (`pg_cron`):
  - `capture-register-alerts` — `*/15 * * * *` — `SELECT capture_register_alerts();` (active)
  - `reset-demo-data-nightly` — `0 3 * * *` — `SELECT reset_demo_data();` (active)
- `staff_roles.role_name` values actually in use: admin, assessment_manager, bursar, head_of_department, houseparent, mentor, smt, teacher
  - Note: `mentor` is a live role on some staff records but is **not** in the `ROLE_LABELS` map on `app/staff/roles/page.js` — it can't be assigned/removed from that screen.
  - `hr` and `school_office` exist as roles referenced by RLS policies (e.g. on `register_alerts`) but had zero staff assigned as of this snapshot.

## Known gaps / dead ends (so nobody re-discovers these the hard way)

- **`house_assignments`** — has real FKs (`houseparent_staff_id → staff`) but nothing reads or writes it. Houseparent-to-house scoping actually works through `staff_roles.scope_value` (`scope_type='house'`) read by `my_house_scope()`, mirroring `my_department_scope()` for Heads of Department. Treat `house_assignments` as superseded/dead, not a gap to fill.
- **`behaviour_event_audit`** — has FK wiring (cascades from `behaviour_events`, `profiles`) but nothing inserts into it. Scaffolding for an audit trail that was never finished.
- **`registers_not_done`** (view) and **`message_read_status`** (view) are `SECURITY DEFINER` and bypass RLS like `student_summary`/`attendance_today` did. They aren't behind any currently-enabled demo-account link, but the same class of leak is possible if that ever changes — check before wiring either into a new page without scoping it.
- **Fees module** (`fee_*`, `student_invoices`, `invoice_line_items`, `student_discounts`) RPCs — `apply_fee_charge_batch`, `apply_student_discount`, `undo_fee_charge_batch`, `set_term_published` — are callable by any authenticated user per Supabase's own advisor (SECURITY DEFINER, no extra grant restriction beyond the internal `user_has_staff_role()` check inside each function body).

---

## Views

### `attendance_today`
```sql
CREATE VIEW attendance_today AS SELECT a.student_id,
    a.attend_date,
    a.period_number,
    a.code,
    ac.description,
    a.status,
    (a.status = 'present'::text) AS is_present
   FROM (attendance a
     JOIN attendance_codes ac ON ((ac.code = a.code)))
  WHERE ((a.attend_date = CURRENT_DATE) AND ((a.is_demo = is_demo_account()) OR is_admin()));
```

### `message_read_status`
```sql
CREATE VIEW message_read_status AS SELECT mr.message_id,
    mr.profile_id,
    mr.read_at,
    COALESCE(pr.email, par.email, s.student_email) AS recipient_email,
    COALESCE(((stf.first_name || ' '::text) || stf.last_name), ((s.first_name || ' '::text) || s.last_name), ((par.first_name || ' '::text) || par.last_name)) AS recipient_name
   FROM ((((message_recipients mr
     JOIN profiles pr ON ((pr.id = mr.profile_id)))
     LEFT JOIN staff stf ON ((stf.staff_id = pr.staff_id)))
     LEFT JOIN students s ON ((s.student_id = pr.student_id)))
     LEFT JOIN parents par ON ((par.parent_id = pr.parent_id)));
```

### `registers_not_done`
```sql
CREATE VIEW registers_not_done AS SELECT ts.slot_id,
    c.staff_id,
    ((s.first_name || ' '::text) || s.last_name) AS teacher_name,
    c.class_code,
    ts.period_number,
    ts.start_time,
    (EXTRACT(epoch FROM (now() - ((CURRENT_DATE + ts.start_time))::timestamp with time zone)) / (60)::numeric) AS minutes_since_start
   FROM ((timetable_slots ts
     JOIN classes c ON ((c.class_id = ts.class_id)))
     JOIN staff s ON ((s.staff_id = c.staff_id)))
  WHERE ((ts.day_of_week = to_char((CURRENT_DATE)::timestamp with time zone, 'Dy'::text)) AND (now() > ((CURRENT_DATE + ts.start_time) + '00:15:00'::interval)) AND (now() < ((CURRENT_DATE + ts.start_time) + '03:00:00'::interval)) AND (EXISTS ( SELECT 1
           FROM terms t
          WHERE ((CURRENT_DATE >= t.start_date) AND (CURRENT_DATE <= t.end_date)))) AND (NOT (EXISTS ( SELECT 1
           FROM attendance a
          WHERE ((a.staff_id = c.staff_id) AND (a.period_number = ts.period_number) AND (a.attend_date = CURRENT_DATE))))));
```

### `student_summary`
```sql
CREATE VIEW student_summary AS SELECT s.student_id,
    s.first_name,
    s.last_name,
    s.year_group,
    s.form_class,
    s.status,
    COALESCE(sum(be.points) FILTER (WHERE (be.type = 'positive'::text)), (0)::bigint) AS positive_points,
    COALESCE(sum(be.points) FILTER (WHERE (be.type = 'negative'::text)), (0)::bigint) AS negative_points,
    COALESCE(sum(be.points), (0)::bigint) AS net_behaviour_points,
    max(be.event_date) AS last_behaviour_event_date,
    ( SELECT round(avg(((r.score / NULLIF(r.max_score, (0)::numeric)) * (100)::numeric)), 1) AS round
           FROM results r
          WHERE ((r.student_id = s.student_id) AND (r.week_start_date = ( SELECT max(results.week_start_date) AS max
                   FROM results
                  WHERE (results.student_id = s.student_id))))) AS latest_week_avg_pct,
    ( SELECT max(r.week_start_date) AS max
           FROM results r
          WHERE (r.student_id = s.student_id)) AS latest_results_week,
    ( SELECT ((p.first_name || ' '::text) || p.last_name)
           FROM (student_parent sp
             JOIN parents p ON ((p.parent_id = sp.parent_id)))
          WHERE ((sp.student_id = s.student_id) AND (sp.is_primary_contact = true))
         LIMIT 1) AS primary_contact_name,
    ( SELECT p.phone
           FROM (student_parent sp
             JOIN parents p ON ((p.parent_id = sp.parent_id)))
          WHERE ((sp.student_id = s.student_id) AND (sp.is_primary_contact = true))
         LIMIT 1) AS primary_contact_phone
   FROM (students s
     LEFT JOIN behaviour_events be ON ((be.student_id = s.student_id)))
  WHERE ((s.is_demo = is_demo_account()) OR is_admin())
  GROUP BY s.student_id, s.first_name, s.last_name, s.year_group, s.form_class, s.status;
```

---

## Tables

### `attendance`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `attendance_id` 🔑 | integer | NO | nextval('attendance_attendance_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `attend_date` | date | NO |  |
| `period_number` | integer | YES |  |
| `status` | text | NO |  |
| `staff_id` | integer | YES |  |
| `notes` | text | YES |  |
| `code` | text | YES |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `code` → `attendance_codes.code`, `student_id` → `students.student_id`, `period_number` → `periods.period_number`, `staff_id` → `staff.staff_id`

Triggers:
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.attendance FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `staff_read_attendance` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `staff_update_attendance` (UPDATE) USING (((auth.role() = 'authenticated'::text) AND (is_demo = is_demo_account())))
- `staff_write_attendance` (INSERT) WITH CHECK (((auth.role() = 'authenticated'::text) AND (is_demo = is_demo_account())))


### `attendance_codes`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `code` 🔑 | text | NO |  |
| `description` | text | NO |  |
| `status` | text | NO |  |

RLS policies:
- `admin_write_attendance_codes` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_attendance_codes` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `behaviour_appeals`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `appeal_id` 🔑 | integer | NO | nextval('behaviour_appeals_appeal_id_seq'::regclass) |
| `event_id` | integer | NO |  |
| `student_id` | integer | NO |  |
| `reason` | text | NO |  |
| `status` | text | NO | 'pending'::text |
| `created_at` | timestamp with time zone | NO | now() |
| `reviewed_by` | integer | YES |  |
| `reviewed_at` | timestamp with time zone | YES |  |
| `resolution_notes` | text | YES |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `event_id` → `behaviour_events.event_id`, `reviewed_by` → `staff.staff_id`

Triggers:
- `trg_void_event_on_upheld_appeal`: `CREATE TRIGGER trg_void_event_on_upheld_appeal AFTER UPDATE ON public.behaviour_appeals FOR EACH ROW EXECUTE FUNCTION void_event_on_upheld_appeal()`

RLS policies:
- `pastoral_read_all_appeals` (SELECT) USING ((is_pastoral_or_smt() AND ((is_demo = is_demo_account()) OR is_admin())))
- `pastoral_update_appeals` (UPDATE) USING ((is_pastoral_or_smt() AND (is_demo = is_demo_account())))
- `student_insert_own_appeals` (INSERT) WITH CHECK ((EXISTS ( SELECT 1 FROM (profiles p JOIN behaviour_events be ON (((be.event_id = behaviour_appeals.event_id) AND (be.type = 'negative'::text)))) WHERE ((p.id = auth.uid()) AND (p.student_id = behaviour_appeals.student_id) AND (p.student_id = be.student_id)))))
- `student_read_own_appeals` (SELECT) USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.student_id = behaviour_appeals.student_id)))))


### `behaviour_categories`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `category_id` 🔑 | integer | NO | nextval('behaviour_categories_category_id_seq'::regclass) |
| `name` | text | NO |  |
| `type` | text | NO |  |
| `default_points` | integer | YES |  |

RLS policies:
- `admin_write_behaviour_categories` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_behaviour_categories` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `behaviour_event_audit`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `audit_id` 🔑 | integer | NO | nextval('behaviour_event_audit_audit_id_seq'::regclass) |
| `event_id` | integer | NO |  |
| `changed_by` | uuid | YES |  |
| `changed_at` | timestamp with time zone | NO | now() |
| `old_values` | jsonb | NO |  |
| `new_values` | jsonb | NO |  |

Foreign keys: `event_id` → `behaviour_events.event_id`, `changed_by` → `profiles.id`

**RLS enabled with zero policies — nobody (except superuser) can read or write this table at all.** Either a dead table, or a bug if something expects it to work.


### `behaviour_events`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `event_id` 🔑 | integer | NO | nextval('behaviour_events_event_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `staff_id` | integer | YES |  |
| `event_date` | date | NO |  |
| `event_time` | time without time zone | YES |  |
| `type` | text | NO |  |
| `category` | text | YES |  |
| `points` | integer | YES |  |
| `description` | text | YES |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `staff_id` → `staff.staff_id`

Triggers:
- `trg_negative_behaviour`: `CREATE TRIGGER trg_negative_behaviour AFTER INSERT ON public.behaviour_events FOR EACH ROW WHEN ((new.points < 0)) EXECUTE FUNCTION handle_negative_behaviour()`
- `trg_notify_pastoral_on_negative_behaviour`: `CREATE TRIGGER trg_notify_pastoral_on_negative_behaviour AFTER INSERT ON public.behaviour_events FOR EACH ROW WHEN ((new.type = 'negative'::text)) EXECUTE FUNCTION notify_pastoral_on_negative_behaviour()`
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.behaviour_events FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `admin_delete_behaviour` (DELETE) USING (is_admin())
- `parent_read_own_behaviour` (SELECT) USING ((EXISTS ( SELECT 1 FROM (profiles p JOIN student_parent sp ON ((sp.parent_id = p.parent_id))) WHERE ((p.id = auth.uid()) AND (sp.student_id = behaviour_events.student_id)))))
- `staff_read_behaviour` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `staff_update_behaviour` (UPDATE) USING (((auth.role() = 'authenticated'::text) AND (is_demo = is_demo_account())))
- `staff_write_behaviour` (INSERT) WITH CHECK (((auth.role() = 'authenticated'::text) AND (is_demo = is_demo_account())))
- `student_read_own_behaviour` (SELECT) USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.student_id = behaviour_events.student_id)))))


### `boarding_houses`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `house_id` 🔑 | integer | NO | nextval('boarding_houses_house_id_seq'::regclass) |
| `name` | text | NO |  |

RLS policies:
- `admin_write_boarding_houses` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_boarding_houses` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `calendar_events`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `event_id` 🔑 | integer | NO | nextval('calendar_events_event_id_seq'::regclass) |
| `event_date` | date | NO |  |
| `event_name` | text | NO |  |
| `category` | text | NO |  |
| `year_group_note` | text | YES |  |
| `is_result_set` | boolean | NO | false |

RLS policies:
- `admin_write_calendar_events` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_calendar_events` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `cat4_results`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `cat4_id` 🔑 | integer | NO | nextval('cat4_results_cat4_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `test_date` | date | YES |  |
| `level` | text | YES |  |
| `mean_sas` | numeric | YES |  |
| `verbal_sas` | numeric | YES |  |
| `non_verbal_sas` | numeric | YES |  |
| `quantitative_sas` | numeric | YES |  |
| `spatial_sas` | numeric | YES |  |

Foreign keys: `student_id` → `students.student_id`

RLS policies:
- `admin_write_cat4` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_cat4` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `certificates_awarded`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `milestone` | integer | NO |  |
| `awarded_date` | date | NO | CURRENT_DATE |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`

Triggers:
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.certificates_awarded FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `staff_delete_certificates` (DELETE) USING ((is_staff_or_admin() AND (is_demo = is_demo_account())))
- `staff_insert_certificates` (INSERT) WITH CHECK ((is_staff_or_admin() AND (is_demo = is_demo_account())))
- `staff_read_certificates` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `staff_update_certificates` (UPDATE) USING ((is_staff_or_admin() AND (is_demo = is_demo_account())))


### `classes`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `class_id` 🔑 | integer | NO | nextval('classes_class_id_seq'::regclass) |
| `subject_id` | integer | NO |  |
| `staff_id` | integer | YES |  |
| `year_group` | integer | NO |  |
| `room` | text | YES |  |
| `class_code` | text | YES |  |
| `block_id` | integer | YES |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `staff_id` → `staff.staff_id`, `subject_id` → `subjects.subject_id`, `block_id` → `curriculum_blocks.block_id`

RLS policies:
- `admin_write_classes` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_classes` (SELECT) USING (((auth.role() = 'authenticated'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `curriculum_blocks`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `block_id` 🔑 | integer | NO | nextval('curriculum_blocks_block_id_seq'::regclass) |
| `block_name` | text | NO |  |
| `year_group` | integer | NO |  |
| `band` | text | YES |  |
| `is_compound` | boolean | NO | false |

RLS policies:
- `admin_write_curriculum_blocks` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_curriculum_blocks` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `departments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `department_name` 🔑 | text | NO |  |

RLS policies:
- `departments editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `departments readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `detentions`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `detention_id` 🔑 | integer | NO | nextval('detentions_detention_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `behaviour_event_id` | integer | YES |  |
| `detention_date` | date | NO |  |
| `status` | text | NO | 'scheduled'::text |
| `created_at` | timestamp with time zone | NO | now() |
| `is_demo` | boolean | NO | false |

Foreign keys: `behaviour_event_id` → `behaviour_events.event_id`, `student_id` → `students.student_id`

RLS policies:
- `pastoral_read_detentions` (SELECT) USING ((is_pastoral_or_smt() AND ((is_demo = is_demo_account()) OR is_admin())))
- `pastoral_update_detentions` (UPDATE) USING ((is_pastoral_or_smt() AND ((is_demo = is_demo_account()) OR is_admin())))


### `families`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `family_id` 🔑 | integer | NO | nextval('families_family_id_seq'::regclass) |
| `family_name` | text | YES |  |

RLS policies:
- `admin_write_families` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_families` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `fee_charge_batches`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_charge_batches_id_seq'::regclass) |
| `fee_item_id` | bigint | YES |  |
| `term_id` | bigint | YES |  |
| `description` | text | YES |  |
| `amount` | numeric | NO |  |
| `target_type` | text | NO |  |
| `target_value` | text | YES |  |
| `created_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `fee_item_id` → `fee_items.id`, `term_id` → `fee_terms.id`

RLS policies:
- `Fees staff can insert charge batches` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))
- `Fees staff can read charge batches` (SELECT) USING (user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]))


### `fee_discount_types`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_discount_types_id_seq'::regclass) |
| `name` | text | NO |  |
| `calc_type` | text | NO |  |
| `value` | numeric | NO |  |
| `applies_to` | text | YES | 'tuition'::text |
| `created_at` | timestamp with time zone | YES | now() |

RLS policies:
- `Fee staff can read discount types` (SELECT) USING (user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]))
- `Fee staff can write discount types` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_items_id_seq'::regclass) |
| `name` | text | NO |  |
| `category` | text | YES |  |
| `is_recurring` | boolean | YES | true |
| `default_amount` | numeric | YES |  |
| `created_at` | timestamp with time zone | YES | now() |
| `is_optional` | boolean | YES | false |
| `display_name` | text | YES |  |

RLS policies:
- `Authenticated users can read fee items` (SELECT) USING (true)
- `Fee items readable by all authenticated` (SELECT) USING (true)
- `Fee items updatable by bursar` (UPDATE) USING (user_has_staff_role(ARRAY['bursar'::text]))
- `Fee items writable by bursar` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_payment_plan_installments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_payment_plan_installments_id_seq'::regclass) |
| `plan_id` | bigint | YES |  |
| `due_date` | date | NO |  |
| `amount` | numeric | NO |  |
| `status` | text | YES | 'pending'::text |

Foreign keys: `plan_id` → `fee_payment_plans.id`

RLS policies:
- `Fee staff can read payment plan installments` (SELECT) USING (user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]))
- `Fee staff can write payment plan installments` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_payment_plans`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_payment_plans_id_seq'::regclass) |
| `invoice_id` | bigint | YES |  |
| `approved_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `invoice_id` → `student_invoices.id`

RLS policies:
- `Fee staff can read payment plans` (SELECT) USING (user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]))
- `Fee staff can write payment plans` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_payments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_payments_id_seq'::regclass) |
| `invoice_id` | bigint | YES |  |
| `amount` | numeric | NO |  |
| `method` | text | YES |  |
| `reference` | text | YES |  |
| `paid_date` | date | YES | CURRENT_DATE |
| `recorded_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `invoice_id` → `student_invoices.id`

Triggers:
- `trg_payments_status`: `CREATE TRIGGER trg_payments_status AFTER INSERT OR DELETE OR UPDATE ON public.fee_payments FOR EACH ROW EXECUTE FUNCTION trg_recalc_invoice_status()`

RLS policies:
- `Fees staff and parents can read relevant payments` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) OR (invoice_id IN ( SELECT si.id FROM ((student_invoices si JOIN student_parent sp ON ((sp.student_id = si.student_id))) JOIN fee_terms ft ON ((ft.id = si.term_id))) WHERE ((sp.parent_id IN ( SELECT my_parent_ids() AS my_parent_ids)) AND (ft.published_to_parents = true))))))
- `Fees staff can insert payments` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_terms`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_terms_id_seq'::regclass) |
| `name` | text | NO |  |
| `academic_year` | text | YES |  |
| `start_date` | date | YES |  |
| `is_current` | boolean | YES | false |
| `published_to_parents` | boolean | NO | false |
| `published_at` | timestamp with time zone | YES |  |
| `published_by` | uuid | YES |  |

Foreign keys: `published_by` → `profiles.id`

RLS policies:
- `Authenticated users can read fee terms` (SELECT) USING (true)


### `grade_scale`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `grade` 🔑 | text | NO |  |
| `points` | numeric | NO |  |

RLS policies:
- `admin_write_grade_scale` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_grade_scale` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `house_assignments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `house_assignment_id` 🔑 | integer | NO | nextval('house_assignments_house_assignment_id_seq'::regclass) |
| `house_name` | text | NO |  |
| `houseparent_staff_id` | integer | NO |  |

Foreign keys: `houseparent_staff_id` → `staff.staff_id`

**RLS enabled with zero policies — nobody (except superuser) can read or write this table at all.** Either a dead table, or a bug if something expects it to work.


### `invoice_line_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('invoice_line_items_id_seq'::regclass) |
| `invoice_id` | bigint | YES |  |
| `fee_item_id` | bigint | YES |  |
| `description` | text | YES |  |
| `amount` | numeric | NO |  |
| `is_extra_charge` | boolean | YES | false |
| `batch_id` | bigint | YES |  |
| `added_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `fee_item_id` → `fee_items.id`, `batch_id` → `fee_charge_batches.id`, `invoice_id` → `student_invoices.id`

Triggers:
- `trg_line_items_status`: `CREATE TRIGGER trg_line_items_status AFTER INSERT OR DELETE OR UPDATE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION trg_recalc_invoice_status()`

RLS policies:
- `Fees staff and parents can read relevant line items` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) OR (invoice_id IN ( SELECT si.id FROM ((student_invoices si JOIN student_parent sp ON ((sp.student_id = si.student_id))) JOIN fee_terms ft ON ((ft.id = si.term_id))) WHERE ((sp.parent_id IN ( SELECT my_parent_ids() AS my_parent_ids)) AND (ft.published_to_parents = true))))))
- `Fees staff can delete line items` (DELETE) USING (user_has_staff_role(ARRAY['bursar'::text]))
- `Fees staff can insert line items` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `mentor_groups`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `mentor_group_id` 🔑 | integer | NO | nextval('mentor_groups_mentor_group_id_seq'::regclass) |
| `group_name` | text | NO |  |
| `year_group` | integer | YES |  |
| `description` | text | YES |  |

RLS policies:
- `admin_write_mentor_groups` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_mentor_groups` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `message_recipients`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `message_id` | bigint | YES |  |
| `profile_id` | uuid | YES |  |
| `read_at` | timestamp with time zone | YES |  |

Foreign keys: `profile_id` → `profiles.id`, `message_id` → `messages.id`

RLS policies:
- `message_recipients_own` (SELECT) USING ((profile_id = auth.uid()))


### `messages`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `subject` | text | NO |  |
| `body` | text | NO |  |
| `sent_by` | uuid | YES |  |
| `target_type` | text | NO |  |
| `target_value` | text | YES |  |
| `recipient_count` | integer | NO | 0 |
| `email_sent` | boolean | NO | false |
| `sent_at` | timestamp with time zone | NO | now() |

RLS policies:
- `messages_own_or_sent` (SELECT) USING (((sent_by = auth.uid()) OR (EXISTS ( SELECT 1 FROM message_recipients mr WHERE ((mr.message_id = messages.id) AND (mr.profile_id = auth.uid()))))))


### `ngrt_results`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `ngrt_id` 🔑 | integer | NO | nextval('ngrt_results_ngrt_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `test_date` | date | YES |  |
| `form` | text | YES |  |
| `sas` | numeric | YES |  |
| `pc_stanine` | numeric | YES |  |
| `sc_stanine` | numeric | YES |  |
| `overall_stanine` | numeric | YES |  |
| `reading_age` | text | YES |  |

Foreign keys: `student_id` → `students.student_id`

RLS policies:
- `admin_write_ngrt` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_ngrt` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `parents`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `parent_id` 🔑 | integer | NO | nextval('parents_parent_id_seq'::regclass) |
| `first_name` | text | YES |  |
| `last_name` | text | YES |  |
| `phone` | text | YES |  |
| `email` | text | YES |  |
| `address` | text | YES |  |
| `relationship_type` | text | YES |  |

RLS policies:
- `admin_write_parents` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `parent_read_own_contact` (SELECT) USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.parent_id = parents.parent_id)))))
- `read_parents_pastoral` (SELECT) USING (is_pastoral_or_smt())


### `periods`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `period_number` 🔑 | integer | NO |  |
| `period_name` | text | NO |  |

RLS policies:
- `read_all_periods` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `profiles`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO |  |
| `email` | text | YES |  |
| `role` | text | NO | 'staff'::text |
| `staff_id` | integer | YES |  |
| `parent_id` | integer | YES |  |
| `student_id` | integer | YES |  |
| `is_demo_account` | boolean | NO | false |

Foreign keys: `staff_id` → `staff.staff_id`, `student_id` → `students.student_id`, `parent_id` → `parents.parent_id`

Triggers:
- `trg_link_profile_to_staff`: `CREATE TRIGGER trg_link_profile_to_staff BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION link_profile_to_staff()`

RLS policies:
- `Admins can read all profiles` (SELECT) USING (is_admin())
- `Users can read own profile` (SELECT) USING ((auth.uid() = id))


### `register_alerts`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `register_alert_id` 🔑 | integer | NO | nextval('register_alerts_register_alert_id_seq'::regclass) |
| `timetable_slot_id` | integer | YES |  |
| `staff_id` | integer | YES |  |
| `period_date` | date | NO |  |
| `minutes_late` | integer | NO |  |
| `resolved` | boolean | NO | false |
| `created_at` | timestamp with time zone | NO | now() |
| `is_demo` | boolean | NO | false |

Foreign keys: `staff_id` → `staff.staff_id`

RLS policies:
- `hr_read_register_alerts` (SELECT) USING (((has_staff_role(ARRAY['hr'::text, 'school_office'::text]) OR is_admin()) AND ((is_demo = is_demo_account()) OR is_admin())))
- `hr_update_register_alerts` (UPDATE) USING (((has_staff_role(ARRAY['hr'::text, 'school_office'::text]) OR is_admin()) AND ((is_demo = is_demo_account()) OR is_admin())))


### `report_checkers`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | integer | NO | nextval('report_checkers_id_seq'::regclass) |
| `report_period_id` | integer | YES |  |
| `staff_id` | integer | YES |  |
| `scope_type` | text | YES |  |
| `scope_value` | text | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`, `report_period_id` → `report_periods.report_period_id`

RLS policies:
- `report_checkers_admin` (ALL) USING (user_has_staff_role(ARRAY['admin'::text, 'smt'::text]))


### `report_pastoral_comments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | integer | NO | nextval('report_pastoral_comments_id_seq'::regclass) |
| `report_period_id` | integer | YES |  |
| `student_id` | integer | YES |  |
| `staff_id` | integer | YES |  |
| `comment_type` | text | YES |  |
| `comment` | text | YES |  |
| `status` | text | NO | 'draft'::text |
| `checked_by` | integer | YES |  |
| `checked_at` | timestamp with time zone | YES |  |
| `checker_note` | text | YES |  |
| `updated_at` | timestamp with time zone | YES | now() |

Foreign keys: `checked_by` → `staff.staff_id`, `student_id` → `students.student_id`, `staff_id` → `staff.staff_id`, `report_period_id` → `report_periods.report_period_id`

RLS policies:
- `pastoral_comments_insert` (INSERT) WITH CHECK (((staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid()))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `pastoral_comments_select` (SELECT) USING (((staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM report_checkers rc WHERE ((rc.report_period_id = report_pastoral_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `pastoral_comments_update` (UPDATE) USING ((((staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (status = 'draft'::text)) OR (EXISTS ( SELECT 1 FROM report_checkers rc WHERE ((rc.report_period_id = report_pastoral_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))


### `report_periods`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `report_period_id` 🔑 | integer | NO | nextval('report_periods_report_period_id_seq'::regclass) |
| `term_id` | integer | YES |  |
| `name` | text | NO |  |
| `year_groups` | ARRAY | NO |  |
| `comments_due_date` | date | YES |  |
| `check_due_date` | date | YES |  |
| `is_published` | boolean | YES | false |
| `created_at` | timestamp with time zone | YES | now() |
| `created_by` | uuid | YES |  |
| `calendar_event_id` | integer | YES |  |

Foreign keys: `calendar_event_id` → `calendar_events.event_id`, `term_id` → `terms.term_id`

RLS policies:
- `report_periods_admin` (ALL) USING (user_has_staff_role(ARRAY['admin'::text, 'smt'::text, 'assessment_manager'::text]))


### `report_subject_comments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | integer | NO | nextval('report_subject_comments_id_seq'::regclass) |
| `report_period_id` | integer | YES |  |
| `student_id` | integer | YES |  |
| `subject_id` | integer | YES |  |
| `staff_id` | integer | YES |  |
| `comment` | text | YES |  |
| `effort_grade` | text | YES |  |
| `status` | text | NO | 'draft'::text |
| `checked_by` | integer | YES |  |
| `checked_at` | timestamp with time zone | YES |  |
| `checker_note` | text | YES |  |
| `updated_at` | timestamp with time zone | YES | now() |

Foreign keys: `subject_id` → `subjects.subject_id`, `staff_id` → `staff.staff_id`, `checked_by` → `staff.staff_id`, `report_period_id` → `report_periods.report_period_id`, `student_id` → `students.student_id`

RLS policies:
- `subject_comments_insert` (INSERT) WITH CHECK (((staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid()))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `subject_comments_select` (SELECT) USING (((staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM report_checkers rc WHERE ((rc.report_period_id = report_subject_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `subject_comments_update` (UPDATE) USING ((((staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (status = 'draft'::text)) OR (EXISTS ( SELECT 1 FROM report_checkers rc WHERE ((rc.report_period_id = report_subject_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id FROM profiles WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))


### `resources`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `resource_key` 🔑 | text | NO |  |
| `label` | text | NO |  |
| `section` | text | NO |  |
| `sort_order` | integer | NO | 0 |

RLS policies:
- `resources editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `resources readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `results`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `result_id` 🔑 | integer | NO | nextval('results_result_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `subject_id` | integer | NO |  |
| `week_start_date` | date | NO |  |
| `score` | numeric | YES |  |
| `max_score` | numeric | YES |  |
| `grade` | text | YES |  |
| `staff_id` | integer | YES |  |
| `comments` | text | YES |  |
| `result_type` | text | NO | 'ReLP'::text |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |
| `result_set_event_id` | integer | YES |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `subject_id` → `subjects.subject_id`, `staff_id` → `staff.staff_id`, `result_set_event_id` → `calendar_events.event_id`

Triggers:
- `trg_results_updated_at`: `CREATE TRIGGER trg_results_updated_at BEFORE UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

RLS policies:
- `assessment_update_results` (UPDATE) USING (is_assessment_manager())
- `assessment_write_results` (INSERT) WITH CHECK (is_assessment_manager())
- `parent_read_own_results` (SELECT) USING ((EXISTS ( SELECT 1 FROM (profiles p JOIN student_parent sp ON ((sp.parent_id = p.parent_id))) WHERE ((p.id = auth.uid()) AND (sp.student_id = results.student_id)))))
- `staff_read_results` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_own_results` (SELECT) USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.student_id = results.student_id)))))


### `role_permissions`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `role_name` 🔑 | text | NO |  |
| `resource_key` | text | NO |  |

Foreign keys: `role_name` → `roles.role_name`, `resource_key` → `resources.resource_key`

RLS policies:
- `role_permissions editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `role_permissions readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `roles`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `role_name` 🔑 | text | NO |  |
| `description` | text | YES |  |

RLS policies:
- `roles editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `roles readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `sports_houses`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `house_id` 🔑 | integer | NO | nextval('sports_houses_house_id_seq'::regclass) |
| `name` | text | NO |  |

RLS policies:
- `admin_write_sports_houses` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_sports_houses` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `staff`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `staff_id` 🔑 | integer | NO | nextval('staff_staff_id_seq'::regclass) |
| `first_name` | text | NO |  |
| `last_name` | text | NO |  |
| `subject_specialism` | text | YES |  |
| `staff_code` | text | YES |  |
| `email` | text | YES |  |
| `is_demo` | boolean | NO | false |

RLS policies:
- `admin_write_staff` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_staff` (SELECT) USING (((auth.role() = 'authenticated'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `staff_roles`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `staff_id` 🔑 | integer | NO |  |
| `role_name` | text | NO |  |
| `scope_type` | text | YES |  |
| `scope_value` | text | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`

RLS policies:
- `admin_write_staff_roles` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_staff_roles` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `student_class`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `class_id` | integer | NO |  |
| `block_id` | integer | YES |  |
| `is_compound` | boolean | NO | false |
| `is_demo` | boolean | NO | false |

Foreign keys: `block_id` → `curriculum_blocks.block_id`, `class_id` → `classes.class_id`, `student_id` → `students.student_id`

Triggers:
- `trg_set_student_class_block_id`: `CREATE TRIGGER trg_set_student_class_block_id BEFORE INSERT OR UPDATE OF class_id ON public.student_class FOR EACH ROW EXECUTE FUNCTION set_student_class_block_id()`

RLS policies:
- `admin_write_student_class` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_student_class` (SELECT) USING (((auth.role() = 'authenticated'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `student_discounts`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('student_discounts_id_seq'::regclass) |
| `student_id` | integer | YES |  |
| `discount_type_id` | bigint | YES |  |
| `start_term_id` | bigint | YES |  |
| `end_term_id` | bigint | YES |  |
| `approved_by` | uuid | YES |  |
| `notes` | text | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `student_id` → `students.student_id`, `end_term_id` → `fee_terms.id`, `start_term_id` → `fee_terms.id`, `discount_type_id` → `fee_discount_types.id`

RLS policies:
- `Fee staff can read student discounts` (SELECT) USING (user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]))
- `Fee staff can write student discounts` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `student_invoices`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('student_invoices_id_seq'::regclass) |
| `student_id` | integer | YES |  |
| `term_id` | bigint | YES |  |
| `status` | text | YES | 'unpaid'::text |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `term_id` → `fee_terms.id`, `student_id` → `students.student_id`

RLS policies:
- `Fees staff and parents can read relevant invoices` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) OR ((student_id IN ( SELECT sp.student_id FROM student_parent sp WHERE (sp.parent_id IN ( SELECT my_parent_ids() AS my_parent_ids)))) AND (term_id IN ( SELECT fee_terms.id FROM fee_terms WHERE (fee_terms.published_to_parents = true))))))
- `Fees staff can insert invoices` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `student_parent`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `parent_id` | integer | NO |  |
| `is_primary_contact` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `parent_id` → `parents.parent_id`

RLS policies:
- `admin_write_student_parent` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_student_parent_pastoral` (SELECT) USING (is_pastoral_or_smt())


### `students`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO | nextval('students_student_id_seq'::regclass) |
| `first_name` | text | NO |  |
| `last_name` | text | NO |  |
| `dob` | date | NO |  |
| `year_group` | integer | NO |  |
| `form_class` | text | YES |  |
| `admission_date` | date | YES |  |
| `gender` | text | YES |  |
| `address` | text | YES |  |
| `medical_notes` | text | YES |  |
| `status` | text | NO | 'active'::text |
| `middle_name` | text | YES |  |
| `legal_first_name` | text | YES |  |
| `legal_last_name` | text | YES |  |
| `preferred_name` | text | YES |  |
| `student_email` | text | YES |  |
| `address_line1` | text | YES |  |
| `address_line2` | text | YES |  |
| `city` | text | YES |  |
| `postcode` | text | YES |  |
| `country` | text | YES |  |
| `family_id` | integer | YES |  |
| `nationality` | text | YES |  |
| `religion` | text | YES |  |
| `emergency_contact_name` | text | YES |  |
| `emergency_contact_phone` | text | YES |  |
| `upn` | text | YES |  |
| `boarding_room_number` | text | YES |  |
| `home_town` | text | YES |  |
| `lga` | text | YES |  |
| `national_identity_number` | text | YES |  |
| `neco_exam_number` | text | YES |  |
| `utme_pin` | text | YES |  |
| `utme_profile_code` | text | YES |  |
| `sports_house` | text | YES |  |
| `state_of_origin` | text | YES |  |
| `admitted_letter_date` | date | YES |  |
| `boarding_house` | text | YES |  |
| `leaving_date` | date | YES |  |
| `ethnicity` | text | YES |  |
| `fsm` | text | YES |  |
| `eal` | text | YES |  |
| `send` | text | YES |  |
| `custom1` | text | YES |  |
| `custom2` | text | YES |  |
| `admission_number` | text | YES |  |
| `birth_certificate_seen` | text | YES |  |
| `restaurant` | text | YES |  |
| `swimming_paid` | boolean | YES |  |
| `photo_base64` | text | YES |  |
| `mentor_staff_id` | integer | YES |  |
| `mentor_group_id` | integer | YES |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `family_id` → `families.family_id`, `boarding_house` → `boarding_houses.name`, `sports_house` → `sports_houses.name`, `mentor_staff_id` → `staff.staff_id`, `mentor_group_id` → `mentor_groups.mentor_group_id`

Triggers:
- `trg_auto_set_student_status`: `CREATE TRIGGER trg_auto_set_student_status BEFORE INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION auto_set_student_status()`

RLS policies:
- `admin_write_students` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `parent_read_own_child` (SELECT) USING ((EXISTS ( SELECT 1 FROM (profiles p JOIN student_parent sp ON ((sp.parent_id = p.parent_id))) WHERE ((p.id = auth.uid()) AND (sp.student_id = students.student_id)))))
- `staff_read_students` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_self` (SELECT) USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.student_id = students.student_id)))))


### `subject_aliases`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `alias_name` 🔑 | text | NO |  |
| `subject_id` | integer | YES |  |

Foreign keys: `subject_id` → `subjects.subject_id`

RLS policies:
- `authenticated read subject aliases` (SELECT) USING ((auth.uid() IS NOT NULL))
- `staff manage subject aliases` (ALL) USING (is_staff_or_admin())


### `subject_grade_boundaries`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `subject_id` | integer | YES |  |
| `grade` | text | NO |  |
| `min_score` | numeric | NO |  |
| `max_score` | numeric | NO |  |
| `created_at` | timestamp with time zone | YES | now() |
| `updated_at` | timestamp with time zone | YES | now() |
| `year_group` | integer | NO |  |

Foreign keys: `subject_id` → `subjects.subject_id`

Triggers:
- `trg_sgb_updated_at`: `CREATE TRIGGER trg_sgb_updated_at BEFORE UPDATE ON public.subject_grade_boundaries FOR EACH ROW EXECUTE FUNCTION touch_sgb_updated_at()`

RLS policies:
- `staff manage grade boundaries` (ALL) USING (is_staff_or_admin())
- `students view grade boundaries` (SELECT) USING ((auth.uid() IS NOT NULL))


### `subject_key_stages`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `subject_id` | integer | YES |  |
| `key_stage` | text | NO |  |

Foreign keys: `subject_id` → `subjects.subject_id`

RLS policies:
- `authenticated read subject key stages` (SELECT) USING ((auth.uid() IS NOT NULL))
- `staff manage subject key stages` (ALL) USING (is_staff_or_admin())


### `subjects`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `subject_id` 🔑 | integer | NO | nextval('subjects_subject_id_seq'::regclass) |
| `subject_name` | text | NO |  |
| `subject_code` | text | YES |  |
| `display_name` | text | YES |  |
| `target_fallback_subject_id` | integer | YES |  |
| `department_name` | text | YES |  |

Foreign keys: `department_name` → `departments.department_name`, `target_fallback_subject_id` → `subjects.subject_id`

RLS policies:
- `admin_write_subjects` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_subjects` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `target_grades`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `subject_id` | integer | NO |  |
| `target_grade` | text | NO |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `subject_id` → `subjects.subject_id`, `target_grade` → `grade_scale.grade`

RLS policies:
- `assessment_delete_target_grades` (DELETE) USING ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `assessment_insert_target_grades` (INSERT) WITH CHECK ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `assessment_update_target_grades` (UPDATE) USING ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `parent_read_own_target_grades` (SELECT) USING ((EXISTS ( SELECT 1 FROM (profiles p JOIN student_parent sp ON ((sp.parent_id = p.parent_id))) WHERE ((p.id = auth.uid()) AND (sp.student_id = target_grades.student_id)))))
- `read_all_target_grades` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_own_target_grades` (SELECT) USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.student_id = target_grades.student_id)))))


### `terms`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `term_id` 🔑 | integer | NO | nextval('terms_term_id_seq'::regclass) |
| `term_name` | text | NO |  |
| `start_date` | date | NO |  |
| `end_date` | date | NO |  |

RLS policies:
- `admin_write_terms` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_terms` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `timetable_slots`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `slot_id` 🔑 | integer | NO | nextval('timetable_slots_slot_id_seq'::regclass) |
| `class_id` | integer | NO |  |
| `day_of_week` | text | NO |  |
| `period_number` | integer | NO |  |
| `start_time` | time without time zone | NO |  |
| `end_time` | time without time zone | NO |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `class_id` → `classes.class_id`

RLS policies:
- `admin_write_timetable_slots` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_timetable_slots` (SELECT) USING (((auth.role() = 'authenticated'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `tuckshop_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_items_id_seq'::regclass) |
| `name` | text | NO |  |
| `price` | numeric | NO |  |
| `active` | boolean | NO | true |
| `created_at` | timestamp with time zone | YES | now() |

RLS policies:
- `Tuckshop items readable by all authenticated` (SELECT) USING (true)
- `Tuckshop items writable by tuckshop staff` (ALL) USING (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))


### `tuckshop_preorder_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_preorder_items_id_seq'::regclass) |
| `preorder_id` | bigint | NO |  |
| `tuckshop_item_id` | bigint | NO |  |
| `quantity` | integer | NO |  |

Foreign keys: `preorder_id` → `tuckshop_preorders.id`, `tuckshop_item_id` → `tuckshop_items.id`

RLS policies:
- `Students can add own preorder items` (INSERT) WITH CHECK ((preorder_id IN ( SELECT tp.id FROM tuckshop_preorders tp WHERE (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]) OR (EXISTS ( SELECT 1 FROM profiles pr WHERE ((pr.id = auth.uid()) AND (pr.student_id = tp.student_id))))))))
- `Tuckshop preorder items readable by staff or own family` (SELECT) USING ((preorder_id IN ( SELECT tuckshop_preorders.id FROM tuckshop_preorders WHERE can_view_student_tuckshop(tuckshop_preorders.student_id))))


### `tuckshop_preorders`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_preorders_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `for_date` | date | NO |  |
| `status` | text | NO | 'pending'::text |
| `purchase_id` | bigint | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `student_id` → `students.student_id`, `purchase_id` → `tuckshop_purchases.id`

RLS policies:
- `Students can create own preorders` (INSERT) WITH CHECK ((user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]) OR (EXISTS ( SELECT 1 FROM profiles pr WHERE ((pr.id = auth.uid()) AND (pr.student_id = tuckshop_preorders.student_id))))))
- `Tuckshop preorders readable by staff or own family` (SELECT) USING (can_view_student_tuckshop(student_id))
- `Tuckshop staff can update preorders` (UPDATE) USING (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))


### `tuckshop_purchase_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_purchase_items_id_seq'::regclass) |
| `purchase_id` | bigint | NO |  |
| `tuckshop_item_id` | bigint | NO |  |
| `quantity` | integer | NO |  |
| `unit_price` | integer | YES |  |
| `line_total` | numeric | NO |  |

Foreign keys: `purchase_id` → `tuckshop_purchases.id`, `tuckshop_item_id` → `tuckshop_items.id`

RLS policies:
- `Tuckshop purchase items readable by staff or own family` (SELECT) USING ((purchase_id IN ( SELECT tuckshop_purchases.id FROM tuckshop_purchases WHERE can_view_student_tuckshop(tuckshop_purchases.student_id))))
- `Tuckshop purchase items writable by tuckshop staff` (ALL) USING (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))


### `tuckshop_purchases`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_purchases_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `purchase_date` | date | NO | CURRENT_DATE |
| `total_amount` | numeric | NO |  |
| `created_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `student_id` → `students.student_id`

RLS policies:
- `Tuckshop purchases readable by staff or own family` (SELECT) USING (can_view_student_tuckshop(student_id))
- `Tuckshop purchases writable by tuckshop staff` (ALL) USING (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))


---

## Functions (48)

Full definitions. `SECURITY DEFINER` functions run with the privileges of the function owner regardless of caller — check the body for its own permission checks (e.g. `is_admin()`, `user_has_staff_role(...)`) rather than assuming RLS protects them.

### `apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid)
 RETURNS TABLE(batch_id bigint, students_charged integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_batch_id BIGINT;
  v_student_id INTEGER;
  v_invoice_id BIGINT;
  v_count INTEGER := 0;
BEGIN
  IF p_target_type NOT IN ('individual', 'form_class', 'year_group', 'all') THEN
    RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
  END IF;

  INSERT INTO fee_charge_batches (fee_item_id, term_id, description, amount, target_type, target_value, created_by)
  VALUES (p_fee_item_id, p_term_id, p_description, p_amount, p_target_type, p_target_value, p_created_by)
  RETURNING id INTO v_batch_id;

  FOR v_student_id IN
    SELECT s.student_id FROM students s
    WHERE s.status = 'active'
      AND (
        (p_target_type = 'individual' AND s.student_id = p_target_value::INTEGER)
        OR (p_target_type = 'form_class' AND s.form_class = p_target_value)
        OR (p_target_type = 'year_group' AND s.year_group = p_target_value::INTEGER)
        OR (p_target_type = 'all')
      )
  LOOP
    INSERT INTO student_invoices (student_id, term_id)
    VALUES (v_student_id, p_term_id)
    ON CONFLICT (student_id, term_id) DO NOTHING;

    SELECT id INTO v_invoice_id FROM student_invoices
    WHERE student_id = v_student_id AND term_id = p_term_id;

    INSERT INTO invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, batch_id, added_by)
    VALUES (v_invoice_id, p_fee_item_id, p_description, p_amount, true, v_batch_id, p_created_by);

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_batch_id, v_count;
END;
$function$

```

### `apply_student_discount(p_student_discount_id bigint, p_term_id bigint, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.apply_student_discount(p_student_discount_id bigint, p_term_id bigint, p_created_by uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_discount RECORD;
  v_student_id INTEGER;
  v_invoice_id BIGINT;
  v_discount_item_id BIGINT;
  v_base NUMERIC;
  v_amount NUMERIC;
  v_line_item_id BIGINT;
BEGIN
  IF NOT user_has_staff_role(ARRAY['bursar']) THEN
    RAISE EXCEPTION 'Only bursar/admin can apply discounts';
  END IF;

  SELECT sd.student_id, dt.name, dt.calc_type, dt.value, dt.applies_to
  INTO v_discount
  FROM student_discounts sd
  JOIN fee_discount_types dt ON dt.id = sd.discount_type_id
  WHERE sd.id = p_student_discount_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discount assignment % not found', p_student_discount_id;
  END IF;

  v_student_id := v_discount.student_id;
  SELECT id INTO v_discount_item_id FROM fee_items WHERE name = 'Discount';

  INSERT INTO student_invoices (student_id, term_id)
  VALUES (v_student_id, p_term_id)
  ON CONFLICT (student_id, term_id) DO NOTHING;

  SELECT id INTO v_invoice_id FROM student_invoices
  WHERE student_id = v_student_id AND term_id = p_term_id;

  IF v_discount.calc_type = 'percentage' THEN
    SELECT COALESCE(SUM(li.amount), 0) INTO v_base
    FROM invoice_line_items li
    JOIN fee_items fi ON fi.id = li.fee_item_id
    WHERE li.invoice_id = v_invoice_id
      AND fi.category = v_discount.applies_to;
    v_amount := -ROUND(v_base * v_discount.value / 100, 2);
  ELSE
    v_amount := -v_discount.value;
  END IF;

  INSERT INTO invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, added_by)
  VALUES (v_invoice_id, v_discount_item_id, v_discount.name, v_amount, false, p_created_by)
  RETURNING id INTO v_line_item_id;

  RETURN v_line_item_id;
END;
$function$

```

### `auto_set_student_status()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.auto_set_student_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.leaving_date IS NOT NULL AND NEW.leaving_date <= CURRENT_DATE THEN
        NEW.status := 'left';
    END IF;
    RETURN NEW;
END;
$function$

```

### `can_view_student_tuckshop(p_student_id integer)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_view_student_tuckshop(p_student_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    user_has_staff_role(ARRAY['tuckshop', 'bursar', 'smt'])
    OR EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = auth.uid() AND pr.student_id = p_student_id)
    OR EXISTS (
      SELECT 1 FROM student_parent sp
      WHERE sp.student_id = p_student_id
        AND sp.parent_id IN (SELECT my_parent_ids())
    );
$function$

```

### `capture_register_alerts()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.capture_register_alerts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO register_alerts (timetable_slot_id, staff_id, period_date, minutes_late, resolved, is_demo)
  SELECT rnd.slot_id, rnd.staff_id, current_date, round(rnd.minutes_since_start), false, ts.is_demo
  FROM registers_not_done rnd
  JOIN timetable_slots ts ON ts.slot_id = rnd.slot_id
  WHERE NOT EXISTS (
    SELECT 1 FROM register_alerts ra
    WHERE ra.timetable_slot_id = rnd.slot_id AND ra.period_date = current_date
  );
END;
$function$

```

### `create_parent_logins(only_email text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.create_parent_logins(only_email text DEFAULT NULL::text)
 RETURNS TABLE(parent_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  rec RECORD;
  new_password TEXT;
  new_user_id UUID;
BEGIN
  FOR rec IN
    SELECT p.parent_id, p.first_name, p.last_name, p.email
    FROM parents p
    WHERE p.email IS NOT NULL
      AND (only_email IS NULL OR p.email = only_email)
      AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.parent_id = p.parent_id)
  LOOP
    BEGIN
      new_password := substr(md5(random()::text), 1, 10);
      new_user_id := gen_random_uuid();
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) VALUES ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      INSERT INTO profiles (id, role, parent_id) VALUES (new_user_id, 'parent', rec.parent_id) ON CONFLICT (id) DO UPDATE SET role = 'parent', parent_id = rec.parent_id;
      parent_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      RETURN NEXT;
    EXCEPTION WHEN unique_violation THEN
      parent_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account, likely a shared family email)';
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$

```

### `create_staff_logins(only_email text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.create_staff_logins(only_email text DEFAULT NULL::text)
 RETURNS TABLE(staff_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  rec RECORD;
  new_password TEXT;
  new_user_id UUID;
BEGIN
  FOR rec IN
    SELECT s.staff_id, s.first_name, s.last_name, s.email
    FROM staff s
    WHERE s.email IS NOT NULL
      AND (only_email IS NULL OR s.email = only_email)
      AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.staff_id = s.staff_id)
  LOOP
    BEGIN
      new_password := substr(md5(random()::text), 1, 10);
      new_user_id := gen_random_uuid();
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) VALUES ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      INSERT INTO profiles (id, role, staff_id, email) VALUES (new_user_id, 'staff', rec.staff_id, rec.email) ON CONFLICT (id) DO UPDATE SET role = 'staff', staff_id = rec.staff_id, email = rec.email;
      staff_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      RETURN NEXT;
    EXCEPTION WHEN unique_violation THEN
      staff_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account)';
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$

```

### `create_student_logins(only_upn text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.create_student_logins(only_upn text DEFAULT NULL::text)
 RETURNS TABLE(student_name text, upn text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  rec RECORD;
  new_password TEXT;
  new_user_id UUID;
BEGIN
  FOR rec IN
    SELECT s.student_id, s.first_name, s.last_name, s.upn, s.student_email
    FROM students s
    WHERE s.student_email IS NOT NULL
      AND (only_upn IS NULL OR s.upn = only_upn)
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.student_id = s.student_id)
  LOOP
    new_password := substr(md5(random()::text), 1, 10);
    new_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
      rec.student_email, crypt(new_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), new_user_id, new_user_id::text,
      jsonb_build_object('sub', new_user_id::text, 'email', rec.student_email),
      'email', now(), now(), now()
    );

    INSERT INTO profiles (id, role, student_id)
    VALUES (new_user_id, 'student', rec.student_id)
    ON CONFLICT (id) DO UPDATE SET role = 'student', student_id = rec.student_id;

    student_name := rec.first_name || ' ' || rec.last_name;
    upn := rec.upn;
    email := rec.student_email;
    temp_password := new_password;
    RETURN NEXT;
  END LOOP;
END;
$function$

```

### `fulfill_tuckshop_preorder(p_preorder_id bigint, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.fulfill_tuckshop_preorder(p_preorder_id bigint, p_created_by uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_student_id INTEGER;
  v_items JSONB;
  v_purchase_id BIGINT;
BEGIN
  IF NOT user_has_staff_role(ARRAY['tuckshop', 'bursar']) THEN
    RAISE EXCEPTION 'Only tuckshop staff can fulfil preorders';
  END IF;

  SELECT student_id INTO v_student_id FROM tuckshop_preorders WHERE id = p_preorder_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preorder not found or already handled';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('item_id', tuckshop_item_id, 'quantity', quantity))
  INTO v_items
  FROM tuckshop_preorder_items WHERE preorder_id = p_preorder_id;

  v_purchase_id := record_tuckshop_purchase(v_student_id, v_items, p_created_by);

  UPDATE tuckshop_preorders SET status = 'fulfilled', purchase_id = v_purchase_id WHERE id = p_preorder_id;

  RETURN v_purchase_id;
END;
$function$

```

### `generate_next_upn()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.generate_next_upn()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := 'Z7039398' || to_char(current_date, 'YY') || lpad((nextval('student_upn_seq') % 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM students WHERE upn = candidate);
  END LOOP;
  RETURN candidate;
END;
$function$

```

### `get_tuckshop_balance(p_student_id integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.get_tuckshop_balance(p_student_id integer)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_funded NUMERIC;
  v_spent NUMERIC;
BEGIN
  IF NOT can_view_student_tuckshop(p_student_id) THEN
    RAISE EXCEPTION 'Not authorized to view this student''s tuckshop balance';
  END IF;

  SELECT COALESCE(SUM(li.amount), 0) INTO v_funded
  FROM invoice_line_items li
  JOIN fee_items fi ON fi.id = li.fee_item_id
  JOIN student_invoices si ON si.id = li.invoice_id
  WHERE si.student_id = p_student_id AND fi.category = 'Tuckshop';

  SELECT COALESCE(SUM(total_amount), 0) INTO v_spent
  FROM tuckshop_purchases
  WHERE student_id = p_student_id;

  RETURN v_funded - v_spent;
END;
$function$

```

### `get_tuckshop_balances()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.get_tuckshop_balances()
 RETURNS TABLE(student_id integer, first_name text, last_name text, form_class text, year_group integer, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF NOT user_has_staff_role(ARRAY['tuckshop', 'bursar']) THEN
    RAISE EXCEPTION 'Not authorized to view tuckshop balances';
  END IF;

  RETURN QUERY
  SELECT
    s.student_id,
    s.first_name,
    s.last_name,
    s.form_class,
    s.year_group,
    COALESCE(funded.total, 0) - COALESCE(spent.total, 0) AS balance
  FROM students s
  LEFT JOIN (
    SELECT si.student_id, SUM(li.amount) AS total
    FROM invoice_line_items li
    JOIN fee_items fi ON fi.id = li.fee_item_id
    JOIN student_invoices si ON si.id = li.invoice_id
    WHERE fi.category = 'Tuckshop'
    GROUP BY si.student_id
  ) funded ON funded.student_id = s.student_id
  LEFT JOIN (
    SELECT tp.student_id, SUM(tp.total_amount) AS total
    FROM tuckshop_purchases tp
    GROUP BY tp.student_id
  ) spent ON spent.student_id = s.student_id
  WHERE s.status = 'active'
  ORDER BY s.year_group, s.form_class, s.last_name, s.first_name;
END;
$function$

```

### `handle_negative_behaviour()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.handle_negative_behaviour()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  week_start date;
  week_end date;
  week_total integer;
  detention_friday date;
BEGIN
  IF NEW.points <= -3 THEN
    PERFORM pg_notify('behaviour_escalation', json_build_object(
      'event_id', NEW.event_id,
      'student_id', NEW.student_id,
      'points', NEW.points
    )::text);
  END IF;

  week_start := NEW.event_date - (((EXTRACT(DOW FROM NEW.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;
  detention_friday := week_start + 6;

  IF NEW.points <= -5 THEN
    INSERT INTO detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    SELECT NEW.student_id, NEW.event_id, detention_friday, 'scheduled', NEW.is_demo
    WHERE NOT EXISTS (
      SELECT 1 FROM detentions WHERE behaviour_event_id = NEW.event_id
    );
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO week_total
  FROM behaviour_events
  WHERE student_id = NEW.student_id AND type = 'negative'
    AND event_date BETWEEN week_start AND week_end;

  IF week_total <= -10 THEN
    INSERT INTO detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    SELECT NEW.student_id, null, detention_friday, 'scheduled', NEW.is_demo
    WHERE NOT EXISTS (
      SELECT 1 FROM detentions
      WHERE student_id = NEW.student_id AND detention_date = detention_friday AND behaviour_event_id IS NULL
    );
  END IF;

  RETURN NEW;
END;
$function$

```

### `has_resource_access(p_resource_key text)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.has_resource_access(p_resource_key text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
    or exists (
      select 1
      from profiles p
      join staff_roles sr on sr.staff_id = p.staff_id
      join role_permissions rp on rp.role_name = sr.role_name
      where p.id = auth.uid()
        and rp.resource_key = p_resource_key
    );
$function$

```

### `has_staff_role(role_names text[])` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.has_staff_role(role_names text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN staff_roles sr ON sr.staff_id = p.staff_id
    WHERE p.id = auth.uid() AND sr.role_name = ANY(role_names)
  );
$function$

```

### `is_admin()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$function$

```

### `is_assessment_manager()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_assessment_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT is_admin() OR has_staff_role(ARRAY['assessment_manager']);
$function$

```

### `is_demo_account()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_demo_account()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (select 1 from profiles where id = auth.uid() and is_demo_account = true);
$function$

```

### `is_pastoral_or_smt()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_pastoral_or_smt()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT is_admin() OR has_staff_role(ARRAY['smt','houseparent']);
$function$

```

### `is_staff_or_admin()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','staff'));
$function$

```

### `link_profile_to_staff()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.link_profile_to_staff()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.staff_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT staff_id INTO NEW.staff_id
    FROM staff
    WHERE lower(email) = lower(NEW.email)
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$

```

### `mark_message_read(p_message_id bigint)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.mark_message_read(p_message_id bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  update message_recipients set read_at = now()
  where message_id = p_message_id and profile_id = auth.uid() and read_at is null;
$function$

```

### `merge_subjects(from_id integer, into_id integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.merge_subjects(from_id integer, into_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  update classes set subject_id = into_id where subject_id = from_id;

  update results r
  set subject_id = into_id
  where r.subject_id = from_id
  and not exists (
    select 1 from results r2
    where r2.student_id = r.student_id
    and r2.week_start_date = r.week_start_date
    and r2.subject_id = into_id
  );
  delete from results where subject_id = from_id;

  update target_grades t
  set subject_id = into_id
  where t.subject_id = from_id
  and not exists (
    select 1 from target_grades t2
    where t2.student_id = t.student_id
    and t2.subject_id = into_id
  );
  delete from target_grades where subject_id = from_id;

  update subject_grade_boundaries b
  set subject_id = into_id
  where b.subject_id = from_id
  and not exists (
    select 1 from subject_grade_boundaries b2
    where b2.year_group = b.year_group
    and b2.grade = b.grade
    and b2.subject_id = into_id
  );
  delete from subject_grade_boundaries where subject_id = from_id;

  delete from subjects where subject_id = from_id;
end;
$function$

```

### `my_department_scope()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_department_scope()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select sr.scope_value
  from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p.id = auth.uid()
    and sr.role_name = 'head_of_department'
    and sr.scope_type = 'department'
  limit 1;
$function$

```

### `my_house_scope()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_house_scope()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select sr.scope_value
  from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p.id = auth.uid()
    and sr.role_name = 'houseparent'
    and sr.scope_type = 'house'
  limit 1;
$function$

```

### `my_parent_ids()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_parent_ids()
 RETURNS SETOF integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT parent_id FROM profiles WHERE id = auth.uid() AND parent_id IS NOT NULL
  UNION
  SELECT pr.parent_id FROM parents pr
  JOIN profiles p ON p.email = pr.email
  WHERE p.id = auth.uid();
$function$

```

### `notify_pastoral_on_negative_behaviour()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.notify_pastoral_on_negative_behaviour()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  api_key TEXT;
  student_name TEXT;
  recipients TEXT[];
  subject TEXT;
  body_html TEXT;
  week_start DATE;
  week_end DATE;
  week_total INTEGER;
  reason TEXT;
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW; -- training account data must never trigger real staff alerts
  END IF;

  -- Only escalate for a single severe event (-4 or worse) or a bad Sat-Fri week (-8 or worse total)
  week_start := NEW.event_date - (((EXTRACT(DOW FROM NEW.event_date)::INT - 6 + 7) % 7));
  week_end := week_start + 6;

  SELECT COALESCE(SUM(points), 0) INTO week_total
  FROM behaviour_events
  WHERE student_id = NEW.student_id AND type = 'negative'
    AND event_date BETWEEN week_start AND week_end;

  IF NEW.points <= -4 THEN
    reason := 'A single severe event was logged (' || NEW.points || ' points).';
  ELSIF week_total <= -8 THEN
    reason := 'Their running total for the week (Sat ' || week_start || ' – Fri ' || week_end || ') has reached ' || week_total || ' points.';
  ELSE
    RETURN NEW; -- doesn't meet either threshold, no alert
  END IF;

  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key';
  IF api_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT first_name || ' ' || last_name INTO student_name FROM students WHERE student_id = NEW.student_id;

  SELECT array_agg(DISTINCT st.email) INTO recipients
  FROM staff st
  JOIN staff_roles sr ON sr.staff_id = st.staff_id
  WHERE sr.role_name IN ('smt','houseparent') AND st.email IS NOT NULL;

  IF recipients IS NULL OR array_length(recipients, 1) = 0 THEN
    RETURN NEW;
  END IF;

  subject := 'Behaviour alert: ' || student_name || ' — ' || COALESCE(NEW.category, 'Negative event');
  body_html := '<p><strong>' || student_name || '</strong> has triggered a behaviour alert.</p>' ||
               '<p>' || reason || '</p>' ||
               '<p><strong>Latest event — Category:</strong> ' || COALESCE(NEW.category, '—') || '<br/>' ||
               '<strong>Points:</strong> ' || COALESCE(NEW.points::text, '—') || '<br/>' ||
               '<strong>Date:</strong> ' || NEW.event_date::text || '</p>' ||
               '<p>' || COALESCE(NEW.description, '') || '</p>' ||
               '<p><a href="https://mis.classroomportal.org/students/' || NEW.student_id || '">View student in Adorable MIS</a></p>';

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Adorable MIS Alerts <alerts@alerts.classroomportal.org>',
      'to', to_jsonb(recipients),
      'subject', subject,
      'html', body_html
    )
  );

  RETURN NEW;
END;
$function$

```

### `recalc_invoice_status(p_invoice_id bigint)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.recalc_invoice_status(p_invoice_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_total NUMERIC;
  v_paid NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total
  FROM invoice_line_items WHERE invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM fee_payments WHERE invoice_id = p_invoice_id;

  UPDATE student_invoices
  SET status = CASE
    WHEN v_paid <= 0 THEN 'unpaid'
    WHEN v_paid >= v_total THEN 'paid'
    ELSE 'partial'
  END
  WHERE id = p_invoice_id;
END;
$function$

```

### `record_tuckshop_purchase(p_student_id integer, p_items jsonb, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.record_tuckshop_purchase(p_student_id integer, p_items jsonb, p_created_by uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_purchase_id BIGINT;
  v_total NUMERIC := 0;
  v_item RECORD;
  v_price NUMERIC;
  v_line_total NUMERIC;
BEGIN
  IF NOT user_has_staff_role(ARRAY['tuckshop', 'bursar']) THEN
    RAISE EXCEPTION 'Only tuckshop staff can record purchases';
  END IF;

  INSERT INTO tuckshop_purchases (student_id, total_amount, created_by)
  VALUES (p_student_id, 0, p_created_by)
  RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(item_id BIGINT, quantity INTEGER)
  LOOP
    SELECT price INTO v_price FROM tuckshop_items WHERE id = v_item.item_id;
    v_line_total := v_price * v_item.quantity;
    v_total := v_total + v_line_total;

    INSERT INTO tuckshop_purchase_items (purchase_id, tuckshop_item_id, quantity, unit_price, line_total)
    VALUES (v_purchase_id, v_item.item_id, v_item.quantity, v_price, v_line_total);
  END LOOP;

  UPDATE tuckshop_purchases SET total_amount = v_total WHERE id = v_purchase_id;

  RETURN v_purchase_id;
END;
$function$

```

### `reset_all_parent_passwords()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.reset_all_parent_passwords()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  rec RECORD;
  new_password TEXT;
  out_text TEXT := 'parent_name,email,temp_password' || chr(10);
BEGIN
  FOR rec IN
    SELECT pr.id AS auth_id, p.first_name, p.last_name, p.email
    FROM profiles pr
    JOIN parents p ON p.parent_id = pr.parent_id
    WHERE pr.role = 'parent'
    ORDER BY p.last_name
  LOOP
    new_password := substr(md5(random()::text), 1, 10);
    UPDATE auth.users SET encrypted_password = crypt(new_password, gen_salt('bf')) WHERE id = rec.auth_id;
    out_text := out_text ||
      '"' || COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '') || '",' ||
      rec.email || ',' || new_password || chr(10);
  END LOOP;

  RETURN out_text;
END;
$function$

```

### `reset_demo_data()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.reset_demo_data()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_maths_subject_id integer;
  v_english_subject_id integer;
  v_periods int[];
  v_result_event_id integer;
  v_result_event_date date;
  v_sat date;
begin
  delete from behaviour_appeals where is_demo = true;
  delete from certificates_awarded where is_demo = true;
  delete from target_grades where is_demo = true;
  delete from results where is_demo = true;
  delete from behaviour_events where is_demo = true;
  delete from attendance where is_demo = true;
  delete from student_class where is_demo = true;
  delete from timetable_slots where is_demo = true;
  delete from classes where is_demo = true;
  delete from students where is_demo = true;

  select subject_id into v_maths_subject_id from subjects where subject_name ilike '%math%' limit 1;
  select subject_id into v_english_subject_id from subjects where subject_name ilike '%english%' limit 1;
  select array_agg(period_number order by period_number) into v_periods
    from (select period_number from periods order by period_number limit 4) t;
  select event_id, event_date into v_result_event_id, v_result_event_date
    from calendar_events where is_result_set = true order by event_date desc limit 1;

  v_sat := current_date - ((extract(dow from current_date)::int - 6 + 7) % 7);

  insert into students (student_id, first_name, last_name, dob, year_group, form_class, gender, status, is_demo) values
    (900001, 'Ibrahim',  'Musa',        '2018-03-11', 8, '8-DEMO', 'M', 'active', true),
    (900002, 'Ngozi',    'Nwachukwu',   '2018-06-02', 8, '8-DEMO', 'F', 'active', true),
    (900003, 'Tunde',    'Balogun',     '2018-01-22', 8, '8-DEMO', 'M', 'active', true),
    (900004, 'Chinedu',  'Igwe',        '2018-09-14', 8, '8-DEMO', 'M', 'active', true),
    (900005, 'David',    'Peters',      '2018-04-30', 8, '8-DEMO', 'M', 'active', true),
    (900006, 'Blessing', 'Kalu',        '2018-11-05', 8, '8-DEMO', 'F', 'active', true),
    (900007, 'Emeka',    'Uche',        '2018-02-17', 8, '8-DEMO', 'M', 'active', true),
    (900008, 'Grace',    'Thomas',      '2018-07-09', 8, '8-DEMO', 'F', 'active', true),
    (900009, 'Samuel',   'Danladi',     '2018-05-26', 8, '8-DEMO', 'M', 'active', true),
    (900010, 'Amina',    'Suleiman',    '2018-08-19', 8, '8-DEMO', 'F', 'active', true),
    (900011, 'Victor',   'Okoro',       '2018-10-03', 8, '8-DEMO', 'M', 'active', true),
    (900012, 'Patience', 'Effiong',     '2018-12-27', 8, '8-DEMO', 'F', 'active', true),
    (900013, 'Yusuf',    'Garba',       '2018-01-08', 8, '8-DEMO', 'M', 'active', true),
    (900014, 'Chidera',  'Nnamdi',      '2018-03-31', 8, '8-DEMO', 'F', 'active', true),
    (900015, 'Miriam',   'Okonkwo',     '2018-06-21', 8, '8-DEMO', 'F', 'active', true)
  on conflict (student_id) do nothing;

  if v_maths_subject_id is not null then
    insert into classes (class_id, subject_id, staff_id, year_group, room, class_code, is_demo)
      values (900001, v_maths_subject_id, 900001, 8, 'DEMO1', 'DEMO/Ma1', true)
      on conflict (class_id) do nothing;
  end if;
  if v_english_subject_id is not null then
    insert into classes (class_id, subject_id, staff_id, year_group, room, class_code, is_demo)
      values (900002, v_english_subject_id, 900001, 8, 'DEMO1', 'DEMO/En1', true)
      on conflict (class_id) do nothing;
  end if;

  if v_maths_subject_id is not null and array_length(v_periods, 1) >= 2 then
    insert into timetable_slots (class_id, day_of_week, period_number, start_time, end_time, is_demo) values
      (900001, 'Mon', v_periods[1], '08:55', '09:45', true),
      (900001, 'Wed', v_periods[2], '10:45', '11:35', true);
  end if;
  if v_english_subject_id is not null and array_length(v_periods, 1) >= 4 then
    insert into timetable_slots (class_id, day_of_week, period_number, start_time, end_time, is_demo) values
      (900002, 'Tue', v_periods[3], '09:45', '10:35', true),
      (900002, 'Thu', v_periods[4], '13:15', '14:05', true);
  end if;

  if v_maths_subject_id is not null then
    insert into student_class (student_id, class_id, is_demo)
      select student_id, 900001, true from students where is_demo = true and student_id between 900001 and 900015;
  end if;
  if v_english_subject_id is not null then
    insert into student_class (student_id, class_id, is_demo)
      select student_id, 900002, true from students where is_demo = true and student_id between 900001 and 900015;
  end if;

  if v_maths_subject_id is not null and v_result_event_id is not null then
    insert into results (student_id, subject_id, result_set_event_id, week_start_date, score, max_score, grade, staff_id, result_type, is_demo) values
      (900001, v_maths_subject_id, v_result_event_id, v_result_event_date, 88, 100, 'A',  900001, 'exam_grade', true),
      (900002, v_maths_subject_id, v_result_event_id, v_result_event_date, 95, 100, 'A*', 900001, 'exam_grade', true),
      (900003, v_maths_subject_id, v_result_event_id, v_result_event_date, 72, 100, 'B',  900001, 'exam_grade', true),
      (900004, v_maths_subject_id, v_result_event_id, v_result_event_date, 58, 100, 'D',  900001, 'exam_grade', true),
      (900005, v_maths_subject_id, v_result_event_id, v_result_event_date, 91, 100, 'A*', 900001, 'exam_grade', true),
      (900006, v_maths_subject_id, v_result_event_id, v_result_event_date, 66, 100, 'C',  900001, 'exam_grade', true),
      (900007, v_maths_subject_id, v_result_event_id, v_result_event_date, 45, 100, 'E',  900001, 'exam_grade', true),
      (900008, v_maths_subject_id, v_result_event_id, v_result_event_date, 79, 100, 'B',  900001, 'exam_grade', true)
    on conflict (student_id, subject_id, result_set_event_id) do nothing;
  end if;

  if v_maths_subject_id is not null then
    insert into target_grades (student_id, subject_id, target_grade, is_demo)
      select student_id, v_maths_subject_id, (array['A*','A','B','C','D'])[1 + (student_id % 5)], true
      from students where is_demo = true and student_id between 900001 and 900015
      on conflict (student_id, subject_id) do nothing;
  end if;
  if v_english_subject_id is not null then
    insert into target_grades (student_id, subject_id, target_grade, is_demo)
      select student_id, v_english_subject_id, (array['A','B','C','D'])[1 + (student_id % 4)], true
      from students where is_demo = true and student_id between 900001 and 900015
      on conflict (student_id, subject_id) do nothing;
  end if;

  insert into behaviour_events (student_id, staff_id, event_date, type, category, points, description, is_demo) values
    (900002, 900001, v_sat + 2, 'positive', 'Excellent work',  3,  'Outstanding maths homework.', true),
    (900005, 900001, v_sat + 3, 'positive', 'Helping others',  2,  null, true),
    (900010, 900001, v_sat + 4, 'positive', 'Kindness',        2,  null, true),
    (900007, 900001, v_sat + 1, 'negative', 'Late to lesson',        -1, 'Arrived 10 minutes late.', true),
    (900007, 900001, v_sat + 2, 'negative', 'Disruption in class',   -2, null, true),
    (900007, 900001, v_sat + 3, 'negative', 'Mobile phone misuse',   -2, 'Phone out during the lesson.', true),
    (900007, 900001, v_sat + 4, 'negative', 'Rudeness/disrespect',   -3, null, true),
    (900007, 900001, v_sat + 4, 'negative', 'Truancy',               -3, 'Missed period 3 without a note.', true),
    (900008, 900001, v_sat + 2, 'negative', 'Physical altercation',  -5, 'Pushed another student in the corridor.', true),
    (900009, 900001, v_sat + 3, 'positive', 'Leadership', 110, 'Cumulative term contribution recognised in one training seed row.', true)
  on conflict do nothing;

  insert into behaviour_appeals (event_id, student_id, reason, is_demo)
    select event_id, 900008, 'I was defending myself after being pushed first — please review the corridor camera footage.', true
    from behaviour_events
    where student_id = 900008 and category = 'Physical altercation' and is_demo = true
    order by event_id desc limit 1;

  insert into certificates_awarded (student_id, milestone, is_demo)
    values (900010, 100, true)
  on conflict do nothing;

  if array_length(v_periods, 1) >= 1 then
    insert into attendance (student_id, attend_date, period_number, status, code, staff_id, is_demo)
      select student_id, current_date - 1, v_periods[1], 'present', '/', 900001, true
      from students where is_demo = true and student_id between 900001 and 900013
    on conflict (student_id, attend_date, period_number) do nothing;
    insert into attendance (student_id, attend_date, period_number, status, code, staff_id, is_demo) values
      (900014, current_date - 1, v_periods[1], 'late', 'L', 900001, true),
      (900015, current_date - 1, v_periods[1], 'authorized_absence', 'I', 900001, true)
    on conflict (student_id, attend_date, period_number) do nothing;
  end if;
end;
$function$

```

### `resolve_message_recipients(p_target_type text, p_target_value text)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.resolve_message_recipients(p_target_type text, p_target_value text)
 RETURNS TABLE(profile_id uuid)
 LANGUAGE sql
AS $function$
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'year_group' and s.year_group::text = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'form_class' and s.form_class = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'boarding_house' and s.boarding_house = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'mentor_group' and s.mentor_group_id::text = p_target_value
  union
  select p.id from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p_target_type = 'staff_role' and sr.role_name = p_target_value
  union
  select p.id from profiles p
  where p_target_type = 'all_parents' and p.parent_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'all_students' and p.student_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'all_staff' and p.staff_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'individual'
    and p.id = any(string_to_array(p_target_value, ',')::uuid[]);
$function$

```

### `search_people(p_query text)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.search_people(p_query text)
 RETURNS TABLE(profile_id uuid, display_name text, email text, person_type text)
 LANGUAGE sql
 STABLE
AS $function$
  select p.id, stf.first_name || ' ' || stf.last_name, p.email, 'staff'
  from profiles p
  join staff stf on stf.staff_id = p.staff_id
  where stf.first_name || ' ' || stf.last_name ilike '%' || p_query || '%'
  union all
  select p.id, par.first_name || ' ' || par.last_name, par.email, 'parent'
  from profiles p
  join parents par on par.parent_id = p.parent_id
  where par.first_name || ' ' || par.last_name ilike '%' || p_query || '%'
  union all
  select p.id, s.first_name || ' ' || s.last_name, s.student_email, 'student'
  from profiles p
  join students s on s.student_id = p.student_id
  where s.first_name || ' ' || s.last_name ilike '%' || p_query || '%'
  limit 20;
$function$

```

### `send_message(p_subject text, p_body text, p_target_type text, p_target_value text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_message_id bigint;
  v_count int;
  v_api_key text;
  v_should_email boolean;
BEGIN
  IF is_demo_account() THEN
    RAISE EXCEPTION 'Communication is disabled for the training account — no message was sent.';
  END IF;

  INSERT INTO messages (subject, body, sent_by, target_type, target_value)
  VALUES (p_subject, p_body, auth.uid(), p_target_type, p_target_value)
  RETURNING id INTO v_message_id;

  INSERT INTO message_recipients (message_id, profile_id)
  SELECT v_message_id, profile_id FROM resolve_message_recipients(p_target_type, p_target_value)
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_count FROM message_recipients WHERE message_id = v_message_id;

  v_should_email := (p_target_type = 'individual');

  UPDATE messages SET recipient_count = v_count, email_sent = v_should_email WHERE id = v_message_id;

  IF v_should_email THEN
    SELECT decrypted_secret INTO v_api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key';

    IF v_api_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Adorable MIS <no-reply@mis.classroomportal.org>',
          'to', coalesce(pr.email, par.email, st.student_email),
          'subject', p_subject,
          'text', p_body || E'\n\nView in your portal: https://mis.classroomportal.org/inbox'
        )
      )
      FROM profiles pr
      JOIN message_recipients mr ON mr.profile_id = pr.id
      LEFT JOIN parents par ON par.parent_id = pr.parent_id
      LEFT JOIN students st ON st.student_id = pr.student_id
      WHERE mr.message_id = v_message_id
        AND coalesce(pr.email, par.email, st.student_email) IS NOT NULL;
    END IF;
  END IF;

  RETURN v_message_id;
END;
$function$

```

### `send_parent_welcome_email(p_email text, p_name text, p_temp_password text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  api_key TEXT;
  body_html TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admin can send welcome emails';
  END IF;

  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key';
  IF api_key IS NULL THEN
    RETURN;
  END IF;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>Adorable British College now has an online parent portal, <strong>Adorable MIS</strong>, where you can view your child''s weekly results compared to their target grades, and their behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://mis.classroomportal.org">mis.classroomportal.org</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Adorable British College <mis@alerts.classroomportal.org>',
      'to', jsonb_build_array(p_email),
      'subject', 'Your Adorable MIS parent portal account',
      'html', body_html
    )
  );
END;
$function$

```

### `send_staff_welcome_email(p_email text, p_name text, p_temp_password text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_staff_welcome_email(p_email text, p_name text, p_temp_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  api_key TEXT;
  body_html TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admin can send welcome emails';
  END IF;

  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key';
  IF api_key IS NULL THEN
    RETURN;
  END IF;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>You now have a staff account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your timetable, take attendance registers, enter results, and access student and behaviour records relevant to your role.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://mis.classroomportal.org">mis.classroomportal.org</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Adorable British College <mis@alerts.classroomportal.org>',
      'to', jsonb_build_array(p_email),
      'subject', 'Your Adorable MIS staff account',
      'html', body_html
    )
  );
END;
$function$

```

### `set_is_demo()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_is_demo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  new.is_demo := is_demo_account();
  return new;
end;
$function$

```

### `set_student_class_block_id()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_student_class_block_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    SELECT c.block_id, COALESCE(cb.is_compound, false) INTO NEW.block_id, NEW.is_compound
    FROM classes c LEFT JOIN curriculum_blocks cb ON cb.block_id = c.block_id
    WHERE c.class_id = NEW.class_id;
    RETURN NEW;
END;
$function$

```

### `set_term_published(p_term_id bigint, p_published boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_term_published(p_term_id bigint, p_published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT user_has_staff_role(ARRAY['smt']) THEN
    RAISE EXCEPTION 'Only admin or SMT can publish fees to parents';
  END IF;

  UPDATE fee_terms
  SET published_to_parents = p_published,
      published_at = CASE WHEN p_published THEN now() ELSE NULL END,
      published_by = CASE WHEN p_published THEN auth.uid() ELSE NULL END
  WHERE id = p_term_id;
END;
$function$

```

### `set_updated_at()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```

### `submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_preorder_id BIGINT;
  v_item RECORD;
BEGIN
  IF NOT (
    user_has_staff_role(ARRAY['tuckshop', 'bursar'])
    OR EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = auth.uid() AND pr.student_id = p_student_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to preorder for this student';
  END IF;

  INSERT INTO tuckshop_preorders (student_id, for_date) VALUES (p_student_id, p_for_date)
  RETURNING id INTO v_preorder_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(item_id BIGINT, quantity INTEGER)
  LOOP
    INSERT INTO tuckshop_preorder_items (preorder_id, tuckshop_item_id, quantity)
    VALUES (v_preorder_id, v_item.item_id, v_item.quantity);
  END LOOP;

  RETURN v_preorder_id;
END;
$function$

```

### `top_up_tuckshop_balance(p_student_id integer, p_term_id bigint, p_target_balance numeric, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.top_up_tuckshop_balance(p_student_id integer, p_term_id bigint, p_target_balance numeric, p_created_by uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_current NUMERIC;
  v_topup NUMERIC;
  v_recharge_item_id BIGINT;
BEGIN
  IF NOT user_has_staff_role(ARRAY['bursar', 'tuckshop']) THEN
    RAISE EXCEPTION 'Only bursar/tuckshop staff can top up balances';
  END IF;

  SELECT id INTO v_recharge_item_id FROM fee_items WHERE name = 'Tuck Shop Recharge';
  IF v_recharge_item_id IS NULL THEN
    RAISE EXCEPTION 'No "Tuck Shop Recharge" fee item found';
  END IF;

  v_current := get_tuckshop_balance(p_student_id);
  v_topup := p_target_balance - v_current;

  IF v_topup <= 0 THEN
    RETURN 0;
  END IF;

  PERFORM apply_fee_charge_batch(
    v_recharge_item_id, p_term_id,
    'Tuck Shop Recharge (top-up to ' || p_target_balance || ')',
    v_topup, 'individual', p_student_id::TEXT, p_created_by
  );

  RETURN v_topup;
END;
$function$

```

### `top_up_tuckshop_balance_for_group(p_target_type text, p_target_value text, p_term_id bigint, p_target_balance numeric, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.top_up_tuckshop_balance_for_group(p_target_type text, p_target_value text, p_term_id bigint, p_target_balance numeric, p_created_by uuid)
 RETURNS TABLE(student_id integer, student_name text, topped_up numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_student RECORD;
  v_amount NUMERIC;
BEGIN
  IF NOT user_has_staff_role(ARRAY['bursar', 'tuckshop']) THEN
    RAISE EXCEPTION 'Only bursar/tuckshop staff can top up balances';
  END IF;

  FOR v_student IN
    SELECT s.student_id AS sid, s.first_name, s.last_name FROM students s
    WHERE s.status = 'active'
      AND (
        (p_target_type = 'form_class' AND s.form_class = p_target_value)
        OR (p_target_type = 'year_group' AND s.year_group = p_target_value::INTEGER)
        OR (p_target_type = 'all')
      )
  LOOP
    v_amount := top_up_tuckshop_balance(v_student.sid, p_term_id, p_target_balance, p_created_by);
    student_id := v_student.sid;
    student_name := v_student.first_name || ' ' || v_student.last_name;
    topped_up := v_amount;
    RETURN NEXT;
  END LOOP;
END;
$function$

```

### `touch_sgb_updated_at()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.touch_sgb_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```

### `trg_recalc_invoice_status()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.trg_recalc_invoice_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM recalc_invoice_status(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END;
$function$

```

### `undo_fee_charge_batch(p_batch_id bigint)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.undo_fee_charge_batch(p_batch_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM invoice_line_items WHERE batch_id = p_batch_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$

```

### `user_has_staff_role(role_names text[])` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.user_has_staff_role(role_names text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    LEFT JOIN staff_roles sr ON sr.staff_id = p.staff_id
    WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR sr.role_name = ANY(role_names))
  );
$function$

```

### `void_event_on_upheld_appeal()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.void_event_on_upheld_appeal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.status = 'upheld' AND (OLD.status IS DISTINCT FROM 'upheld') THEN
    UPDATE behaviour_events
    SET points = 0,
        description = COALESCE(description, '') || ' (voided — appeal upheld)'
    WHERE event_id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$function$

```
