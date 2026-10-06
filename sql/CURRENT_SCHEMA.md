# Formwork — Live Database Schema (Current State)

**This file is a generated snapshot of the actual live Supabase database (introspected via the Supabase MCP connector), not hand-written.** Regenerate it whenever the schema drifts noticeably rather than editing it by hand. `sql/generate_current_schema.sql` holds the queries that produce it.

## Why this file exists

A large amount of this schema was built directly against the live Supabase instance over time and was **never captured** in `sql/*.sql` or `migrations/*.sql` — those folders are an incomplete, roughly-chronological history, not a reliable source of truth for "what exists right now". This file fills that gap: it is a full introspected dump (tables, columns, constraints, RLS policies, triggers, views, functions, extensions, scheduled jobs) as of the date below.

**Before assuming a table/view/function doesn't exist, or guessing at its shape, check this file first.** Several real incidents this project has already hit came directly from *not* doing that:
- `student_summary` and `attendance_today` were `SECURITY DEFINER` views that bypassed RLS entirely and leaked every real student's data (including parent phone numbers) to the training/demo account, because nobody knew they existed until a security sweep found them. Both are now `security_invoker=true` — see "Known gaps" for the one view that still isn't.
- `handle_negative_behaviour()` (a trigger on `behaviour_events`) and `notify_pastoral_on_negative_behaviour()` both existed live, undocumented, and the latter genuinely emails real staff — seeding demo data once accidentally emailed real people before this was discovered.
- `detentions`, `register_alerts`, `house_assignments`, `behaviour_event_audit` all existed as real tables with real foreign keys, invisible until specifically queried for.

Generated: 30 September 2026, after migration 275. Project ref: `drjtcegtucovhbyfdpbx` (Supabase project "adorable_mis").

**Full regeneration.** Every section below was re-introspected on 30 September 2026 (after migration 275) and checked by md5 against the live database: each table and each function individually, then each whole section (views `d768692c3655578a2ea9527693948c50`, tables `01bc072a747bfb34e7af12c2a1e993b1`, functions `175e4d27152a3412a5316dc23e58d7f9`). 223 carriage returns in function bodies are preserved as stored (see `sql/generate_current_schema.sql`). The previous snapshot was dated 22 September 2026 (email section refreshed 27 September).

## Quick facts

- 118 tables, 9 views, 205 functions, 224 triggers, 272 RLS policies. All 118 tables have RLS enabled.
- Extensions: pg_cron 1.6.4, pg_net 0.20.4, pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1
- Scheduled jobs (`pg_cron`), all active:
  - `capture-register-alerts` — `*/15 * * * *` — `SELECT capture_register_alerts();`
  - `process-email-outbox` — `15 seconds` — `select public.process_email_outbox();`
  - `detention-thursday-reminder` — `30 18 * * 4` (UTC) — `select public.send_detention_reminders();`
- `staff_roles.role_name` values actually assigned to staff: admin, admissions, assessment_manager, assessment_user, bursar, college_secretary, head_of_department, houseparent, hr, mentor, nurse, pastoral, principal, school_office, smt, teacher, tuckshop, tuckshop_owner.
- Views: all are `security_invoker=true`. `message_read_status` (since migration 385) is a `security_invoker` view over the `SECURITY DEFINER` function `message_read_status_rows()`, which keeps its access rule (admin, the message's sender, or smt/pastoral/school_office).
- Every table carries the statement-level `a_backup_mode_guard` trigger (added automatically to new tables by the `guard_new_tables()` event trigger), so writes pause while backup mode is on. That trigger is listed under each table below.

## What changed since the 22 September 2026 snapshot

- Tables 67 → 118, views 4 → 9, functions 76 → 205, RLS policies 166 → 272. The main additions, by area (see CLAUDE.md for the rules behind each):
  - **Admissions** (migration 256 on): `academic_years`, `applicants`, `applicant_contacts`, `applicant_interviews`, `applicant_letters`, `admission_*` tables, `previous_schools`, view `applicant_test_summary`.
  - **Fee approvals** (259–261): `fee_price_changes`, `fee_item_year_prices`, `guard_fee_prices()`, `enforce_locked_fee_price()`, `approve_fee_price_change()`.
  - **Next-year planning** (265): `plan_classes`, `plan_curriculum_blocks`, `plan_mentor_groups`, `plan_mentor_assignments`, `plan_student_class`, `plan_timetable_slots`.
  - **Medical** (nurse role): `student_medical`, `student_medical_conditions`, `student_medical_screenings`, `student_screening_findings`, `student_clinic_visits`, `student_immunisations`, `student_growth_measurements`, `bmi_for_age_reference`, view `student_growth_record`.
  - **HR**: `staff_hr_profiles`, `staff_attendance_records`, `staff_training`, `staff_warnings`.
  - **Audit logs**: `grade_history` (215), `change_history` (218); both append-only.
  - **Other Half** (156): `other_half_*` tables, views `other_half_timetable`, `school_day`; `bell_times`.
  - **Behaviour rules and certificates** (262–263): `behaviour_rules`, `certificate_levels`, `behaviour_photos`.
  - **Tuckshop**: special sessions, hand-out saves, order schedule; tuckshop top-ups from recorded payments (273, `invoice_line_items.from_payment_id`).
  - **Backup mode**: `system_backup_mode`, `enforce_backup_mode()`, `start_backup_mode()` / `end_backup_mode()`.
  - **Parent calendar feed** (274): `parent_calendar_feeds`, `my_calendar_feed_token()`, `calendar_feed_events()`.
  - **New students** (275): `school_office_insert_students` is the only insert route into `students`; the admin policy is split into `admin_read_students`, `admin_update_students` and `admin_delete_students`.

## Earlier notes

### Since migration 123 (22 September 2026)

- `attendance` gained `minutes_late` (integer, 0–600, `attendance_minutes_late_check`) and the trigger `trg_clear_minutes_late_unless_late`, which nulls it for any mark that isn't `late`.
- New functions `school_today()` and `school_now()` pin Africa/Lagos. **The database's own `TimeZone` is UTC**, so `current_date`/`now()` are an hour behind the school and name the wrong day between midnight and 01:00 Lagos — use these instead anywhere a timetable, a register or a school day is involved.
- `registers_not_done` now measures against `school_now()`/`school_today()` (it was firing an hour late), and decides a register is done by looking for marks against the class's enrolled students rather than matching `attendance.staff_id` to the class teacher. Nothing had ever written `staff_id`, so every slot counted as un-registered; `/attendance` now writes it, but the view no longer depends on it.
- Migration 124: `registers_not_done` gained `period_name` and **dropped its 3-hour upper bound** — a register nobody ever took used to vanish from the list three hours after the period started. It now stays listed for the rest of the school day. `capture_register_alerts()`'s per-slot-per-day guard means the longer window cannot duplicate alerts.
- Migration 125: `periods.short_label` added (M, L1..L6, OH, EP) — the register page's badges were printing the raw `period_number`, which reads one lesson ahead of what it means. `registers_not_done` also now excludes classes with nobody enrolled: 10 of today's 187 slots had an empty roster and could never clear off the list.
- `capture_register_alerts()` stamps `register_alerts.period_date` with `school_today()` rather than the UTC `current_date`.
- New function `student_attendance_summary(integer)` — today / this week / this academic year counts plus total minutes late for one student, invoker-rights so `attendance` RLS still applies. Backs the Attendance section of `/students/[id]`; counting in the DB avoids PostgREST's 1,000-row page limit, which a year of marks (~1,700 per student) exceeds.

### Email and Reply-To (refreshed 27 September 2026, migrations 177, 225–227)

- **All email goes through one queue.** Functions call `queue_workspace_email(jsonb)`, which inserts into `email_outbox`. The `process-email-outbox` cron job runs every 15 seconds: it posts up to 3 emails at a time to the `send-workspace-email` edge function, records each reply, and retries up to 6 times. Nothing calls the edge function directly. `queue_workspace_email`, `process_email_outbox` and `send_workspace_email_key` can't be executed by API roles.
- **Everything is sent as `mis@abc.sch.ng`**, over Google Workspace SMTP. Password-reset emails are the exception: they come from Supabase Auth's own sender.
- **Every email has a Reply-To**, because nobody reads `mis@`. Where replies go is **set at `/admin/email-replies`** (Administration tile, SMT and admin only), stored in `email_reply_routes`, one row per kind of email. Each row can combine the member of staff behind the email (where there is one), everyone holding the SMT role (looked up when the email is queued), and a list of addresses. The functions call `email_reply_to('<kind>')`; nothing hardcodes an address. As seeded (the principal's choices, 27 Sept 2026):

  | `email_kind` | Function | Seeded to |
  |---|---|---|
  | `message_parent` | `send_message` | `sro@abc.sch.ng` (parent = the recipient's `profiles.parent_id`, never matched on `parents.email`) |
  | `message_staff_student` | `send_message` | the sender's `staff.email` |
  | `parent_welcome` | `send_parent_welcome_email`, `parent_welcome_email_post` | `sro@abc.sch.ng` |
  | `staff_student_welcome` | `send_staff_welcome_email`, `send_student_welcome_email` | `sro@abc.sch.ng` |
  | `behaviour_alert` | `notify_pastoral_on_negative_behaviour` | `guardian.counselling@abc.sch.ng` |
  | `detention` | `send_detention_email`, `notify_student_of_cancelled_detention`, `send_detention_reminders` | SMT |
  | `fallback` | `queue_workspace_email` | `sro@abc.sch.ng` |

  A kind that works out to nobody (e.g. a sender with no email on their staff record) takes the `fallback` row, which a constraint keeps non-empty; `sro@abc.sch.ng` is hardcoded in `queue_workspace_email` only as the last resort behind that.
- **`email_reply_routes` security.** RLS checks the SMT role directly (`user_has_staff_role(array['smt'])`, which admins pass), not `has_resource_access`, so granting the page to another role only shows them the link. API grants are `authenticated` SELECT and UPDATE only (migration 227 revoked the blanket default grants). `email_reply_to()` is not executable by API roles, and the sender is always `auth.uid()`. Changes are logged in `change_history` under the `email` area, and `updated_by` is stamped from `auth.uid()`.
- **Addresses are checked in three places, all using the same pattern:** `is_plain_email()`, used by `tidy_email_reply_route` (the trigger that lowercases and de-duplicates addresses and refuses bad ones) and by `queue_workspace_email`; and the edge function, which writes `reply_to` as a raw `Reply-To` header (denomailer's `replyTo` option takes only one address) and refuses the whole email on an address it doesn't accept. Keep the three in step.
- `email_outbox` has RLS SELECT policies for admin and for smt/pastoral/school_office, but no table grant to `authenticated`. The Sent Messages page reads it through `email_log()`, which never returns the body (it can hold a parent's initial password).

## Known gaps / dead ends (so nobody re-discovers these the hard way)

- ~~`message_read_status` was a `SECURITY DEFINER` view~~ — **closed** by migration 385 (6 Oct 2026, flagged CRITICAL by the Supabase advisor). It is now `security_invoker`, reading `message_read_status_rows()`. Don't just flip a view like this to `security_invoker`: `message_recipients`/`profiles`/`students`/`parents` RLS would have cut Message history's read receipts from 443 rows to 11–46.
- ~~Four `SECURITY DEFINER` functions hardcode a Supabase JWT~~ — **closed** (checked 27 Sept 2026). No function contains a JWT any more. Only `process_email_outbox()` calls the edge function, and it reads the key from Vault through `send_workspace_email_key()` (migration 169).
- **`house_assignments`** — has real FKs (`houseparent_staff_id → staff`) but 0 rows, 0 RLS policies (so RLS-enabled and unreadable), and nothing reads or writes it. Houseparent-to-house scoping actually works through `staff_roles.scope_value` (`scope_type='house'`) read by `my_house_scope()`, mirroring `my_department_scope()` for Heads of Department. Treat `house_assignments` as superseded/dead, not a gap to fill.
- **`behaviour_event_audit`** has no RLS policies, so the app can't read it. `edit_behaviour_event()` writes to it on every edit; the readable record of behaviour changes is `change_history` (area `behaviour`).
- **The demo/training mechanism is dormant, not removed.** `is_demo_account()`, `set_is_demo()`, and the `is_demo` columns on many tables all still exist, but there are 0 demo profiles and 0 demo students, and the nightly reset job is gone. Every `is_demo = is_demo_account()` clause in the RLS policies below therefore reduces to `is_demo = false` in practice. Treat this as historical: don't build new features assuming a demo account is reachable, and if one is reintroduced it needs a fresh design pass rather than resurrecting this.
- **Fees module** (`fee_*`, `student_invoices`, `invoice_line_items`, `student_discounts`) RPCs — `apply_fee_charge_batch`, `apply_student_discount`, `undo_fee_charge_batch`, `set_term_published` — are callable by any authenticated user per Supabase's own advisor (SECURITY DEFINER, no extra grant restriction beyond the internal `user_has_staff_role()` check inside each function body).
- **`target_grades` has no `year_group` or term dimension.** A CAT4 import writes one row per student per subject for every subject the school offers, so a Year 7 carries targets in subjects they won't sit for years. Anything displaying targets must narrow to the subjects the student actually takes — see `visibleTargets()` in `lib/gradeCompare.js`, which filters on timetabled classes.
- **`parent_calendar_feeds`** (migration 274) has RLS on, no policies and no table grants on purpose: it is reached only through `my_calendar_feed_token()` (the signed-in parent's own token) and `calendar_feed_events()` (the one function `anon` can call, for the public calendar feed route). Don't add policies or grants to it.
- **Roles defined but held by nobody:** `head_of_boarding` and `other_half` appear in policies and functions but no one holds them (checked 30 Sept 2026).

---

## Views

### `applicant_test_summary`
```sql
CREATE VIEW applicant_test_summary AS  SELECT a.applicant_id,
    round((((100)::numeric * e.score) / pe.max_score), 1) AS english_pct,
    round((((100)::numeric * m.score) / pm.max_score), 1) AS maths_pct,
        CASE
            WHEN ((e.score IS NOT NULL) AND (m.score IS NOT NULL)) THEN round((((((100)::numeric * e.score) / pe.max_score) + (((100)::numeric * m.score) / pm.max_score)) / (2)::numeric), 1)
            ELSE NULL::numeric
        END AS average_pct,
    ay.admission_pass_mark AS pass_mark,
        CASE
            WHEN ((e.score IS NOT NULL) AND (m.score IS NOT NULL)) THEN ((((((100)::numeric * e.score) / pe.max_score) + (((100)::numeric * m.score) / pm.max_score)) / (2)::numeric) >= ay.admission_pass_mark)
            ELSE NULL::boolean
        END AS passed,
    c.mean_sas,
    ((e.score IS NOT NULL) AND (m.score IS NOT NULL) AND (c.applicant_id IS NOT NULL)) AS complete
   FROM ((((((applicants a
     JOIN academic_years ay ON ((ay.academic_year_id = a.entry_academic_year_id)))
     LEFT JOIN admission_papers pe ON (((pe.academic_year_id = a.entry_academic_year_id) AND (pe.year_group = a.entry_year_group) AND (pe.subject = 'english'::text))))
     LEFT JOIN admission_test_scores e ON (((e.applicant_id = a.applicant_id) AND (e.paper_id = pe.paper_id))))
     LEFT JOIN admission_papers pm ON (((pm.academic_year_id = a.entry_academic_year_id) AND (pm.year_group = a.entry_year_group) AND (pm.subject = 'maths'::text))))
     LEFT JOIN admission_test_scores m ON (((m.applicant_id = a.applicant_id) AND (m.paper_id = pm.paper_id))))
     LEFT JOIN admission_cat4 c ON ((c.applicant_id = a.applicant_id)));
```

### `attendance_today`
```sql
CREATE VIEW attendance_today AS  SELECT a.student_id,
    a.attend_date,
    a.period_number,
    a.code,
    ac.description,
    a.status,
    (a.status = 'present'::text) AS is_present,
    a.minutes_late
   FROM (attendance a
     JOIN attendance_codes ac ON ((ac.code = a.code)))
  WHERE ((a.attend_date = school_today()) AND ((a.is_demo = is_demo_account()) OR is_admin()));
```

### `message_read_status`
```sql
CREATE VIEW message_read_status AS  SELECT mr.message_id,
    mr.profile_id,
    mr.read_at,
    COALESCE(pr.email, par.email, s.student_email) AS recipient_email,
    COALESCE(((stf.first_name || ' '::text) || stf.last_name), ((s.first_name || ' '::text) || s.last_name), ((par.first_name || ' '::text) || par.last_name)) AS recipient_name
   FROM ((((message_recipients mr
     JOIN profiles pr ON ((pr.id = mr.profile_id)))
     LEFT JOIN staff stf ON ((stf.staff_id = pr.staff_id)))
     LEFT JOIN students s ON ((s.student_id = pr.student_id)))
     LEFT JOIN parents par ON ((par.parent_id = pr.parent_id)))
  WHERE (is_admin() OR (EXISTS ( SELECT 1
           FROM messages m
          WHERE ((m.id = mr.message_id) AND ((m.sent_by = auth.uid()) OR user_has_staff_role(ARRAY['smt'::text, 'pastoral'::text, 'school_office'::text]))))));
```

### `other_half_timetable`
```sql
CREATE VIEW other_half_timetable AS  SELECT c.student_id,
    a.activity_id,
    a.term_id,
    a.day_of_week,
    sd.period_number,
    a.activity_name,
    a.room,
    sd.start_time,
    sd.end_time,
    ( SELECT string_agg(((s.first_name || ' '::text) || s.last_name), ', '::text ORDER BY s.last_name) AS string_agg
           FROM (other_half_activity_staff x
             JOIN staff s ON ((s.staff_id = x.staff_id)))
          WHERE (x.activity_id = a.activity_id)) AS staff_names
   FROM ((other_half_choices c
     JOIN other_half_activities a ON ((a.activity_id = c.activity_id)))
     LEFT JOIN school_day sd ON (((sd.day_of_week = a.day_of_week) AND (sd.short_label = 'OH'::text))))
  WHERE (a.term_id = current_other_half_term());
```

### `registers_not_done`
```sql
CREATE VIEW registers_not_done AS  SELECT ts.slot_id,
    COALESCE(ts.staff_id, c.staff_id) AS staff_id,
    ((s.first_name || ' '::text) || s.last_name) AS teacher_name,
    c.class_code,
    ts.period_number,
    p.period_name,
    p.short_label,
    ts.start_time,
    (EXTRACT(epoch FROM (school_now() - (school_today() + ts.start_time))) / (60)::numeric) AS minutes_since_start,
    NULL::bigint AS other_half_activity_id,
    ARRAY[COALESCE(ts.staff_id, c.staff_id)] AS staff_ids
   FROM (((timetable_slots ts
     JOIN classes c ON ((c.class_id = ts.class_id)))
     JOIN staff s ON ((s.staff_id = COALESCE(ts.staff_id, c.staff_id))))
     LEFT JOIN periods p ON ((p.period_number = ts.period_number)))
  WHERE ((ts.day_of_week = to_char((school_today())::timestamp with time zone, 'Dy'::text)) AND (school_now() > ((school_today() + ts.start_time) + '00:15:00'::interval)) AND (EXISTS ( SELECT 1
           FROM terms t
          WHERE ((school_today() >= t.start_date) AND (school_today() <= t.end_date)))) AND (EXISTS ( SELECT 1
           FROM student_class sc
          WHERE (sc.class_id = ts.class_id))) AND (NOT (EXISTS ( SELECT 1
           FROM (attendance a
             JOIN student_class sc ON ((sc.student_id = a.student_id)))
          WHERE ((sc.class_id = ts.class_id) AND (a.period_number = ts.period_number) AND (a.attend_date = school_today()))))))
UNION ALL
 SELECT NULL::integer AS slot_id,
    NULL::integer AS staff_id,
    COALESCE(st.names, 'No staff assigned'::text) AS teacher_name,
    ('Other Half: '::text || a.activity_name) AS class_code,
    sd.period_number,
    sd.period_name,
    sd.short_label,
    sd.start_time,
    (EXTRACT(epoch FROM (school_now() - (school_today() + sd.start_time))) / (60)::numeric) AS minutes_since_start,
    a.activity_id AS other_half_activity_id,
    COALESCE(st.ids, '{}'::integer[]) AS staff_ids
   FROM (((other_half_activities a
     JOIN terms t ON ((t.term_id = a.term_id)))
     JOIN school_day sd ON (((sd.day_of_week = a.day_of_week) AND (sd.short_label = 'OH'::text))))
     LEFT JOIN LATERAL ( SELECT array_agg(s.staff_id ORDER BY s.last_name) AS ids,
            string_agg(((s.first_name || ' '::text) || s.last_name), ', '::text ORDER BY s.last_name) AS names
           FROM (other_half_activity_staff x
             JOIN staff s ON ((s.staff_id = x.staff_id)))
          WHERE (x.activity_id = a.activity_id)) st ON (true))
  WHERE (a.is_active AND (a.day_of_week = to_char((school_today())::timestamp with time zone, 'Dy'::text)) AND ((school_today() >= t.start_date) AND (school_today() <= t.end_date)) AND (school_now() > ((school_today() + sd.start_time) + '00:15:00'::interval)) AND (EXISTS ( SELECT 1
           FROM (other_half_choices c
             JOIN students stu ON ((stu.student_id = c.student_id)))
          WHERE ((c.activity_id = a.activity_id) AND (stu.status = 'active'::text)))) AND (NOT (EXISTS ( SELECT 1
           FROM attendance m
          WHERE ((m.other_half_activity_id = a.activity_id) AND (m.attend_date = school_today()))))));
```

### `school_day`
```sql
CREATE VIEW school_day AS  SELECT b.day_of_week,
    b.period_number,
    COALESCE(b.period_name, p.period_name) AS period_name,
    COALESCE(b.short_label, p.short_label) AS short_label,
    b.start_time,
    b.end_time
   FROM (bell_times b
     JOIN periods p ON ((p.period_number = b.period_number)));
```

### `student_growth_record`
```sql
CREATE VIEW student_growth_record AS  SELECT g.measurement_id,
    g.student_id,
    g.measured_on,
    g.height_cm,
    g.weight_kg,
    g.bmi,
    g.notes,
    g.recorded_by,
    g.created_at,
    s.gender,
    (((EXTRACT(year FROM age((g.measured_on)::timestamp with time zone, (s.dob)::timestamp with time zone)) * (12)::numeric) + EXTRACT(month FROM age((g.measured_on)::timestamp with time zone, (s.dob)::timestamp with time zone))))::integer AS age_months,
    bmi_for_age_z(
        CASE lower(COALESCE(s.gender, ''::text))
            WHEN 'm'::text THEN 'male'::text
            WHEN 'male'::text THEN 'male'::text
            WHEN 'f'::text THEN 'female'::text
            WHEN 'female'::text THEN 'female'::text
            ELSE NULL::text
        END, (((EXTRACT(year FROM age((g.measured_on)::timestamp with time zone, (s.dob)::timestamp with time zone)) * (12)::numeric) + EXTRACT(month FROM age((g.measured_on)::timestamp with time zone, (s.dob)::timestamp with time zone))))::integer, g.bmi) AS bmi_z
   FROM (student_growth_measurements g
     JOIN students s ON ((s.student_id = g.student_id)));
```

### `student_summary`
```sql
CREATE VIEW student_summary AS  SELECT s.student_id,
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

### `target_grade_gaps`
```sql
CREATE VIEW target_grade_gaps AS  SELECT DISTINCT sc.student_id,
    c.subject_id,
    COALESCE(sub.target_fallback_subject_id, c.subject_id) AS read_target_from,
    (NOT (EXISTS ( SELECT 1
           FROM target_grades t2
          WHERE (t2.student_id = sc.student_id)))) AS student_has_no_targets_at_all
   FROM (((student_class sc
     JOIN students st ON (((st.student_id = sc.student_id) AND (st.status = 'active'::text))))
     JOIN classes c ON ((c.class_id = sc.class_id)))
     JOIN subjects sub ON ((sub.subject_id = c.subject_id)))
  WHERE (sub.carries_target_grade AND (NOT (EXISTS ( SELECT 1
           FROM target_grades t
          WHERE ((t.student_id = sc.student_id) AND (t.subject_id = ANY (ARRAY[c.subject_id, sub.target_fallback_subject_id])))))));
```

## Tables

### `academic_years`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `academic_year_id` 🔑 | integer | NO |  |
| `label` | text | NO |  |
| `start_date` | date | NO |  |
| `end_date` | date | NO |  |
| `status` | text | NO | 'planning'::text |
| `admission_form_fee` | numeric(12,2) | YES |  |
| `admission_deposit` | numeric(12,2) | YES |  |
| `admission_pass_mark` | numeric(5,2) | NO | 50 |
| `mentor_structure_confirmed_at` | timestamp with time zone | YES |  |
| `mentor_structure_confirmed_by` | uuid | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.academic_years FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_guard_fee_prices`: `CREATE TRIGGER trg_guard_fee_prices BEFORE INSERT OR UPDATE ON public.academic_years FOR EACH ROW EXECUTE FUNCTION guard_fee_prices()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.academic_years FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'academic_year_id')`

RLS policies:
- `Academic years readable by all authenticated` (SELECT) USING (true)
- `Academic years writable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())


### `admission_cat4`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `applicant_id` 🔑 | bigint | NO |  |
| `test_date` | date | YES |  |
| `level` | text | YES |  |
| `verbal_sas` | numeric(5,1) | YES |  |
| `quantitative_sas` | numeric(5,1) | YES |  |
| `non_verbal_sas` | numeric(5,1) | YES |  |
| `spatial_sas` | numeric(5,1) | YES |  |
| `mean_sas` | numeric(5,1) | YES |  |
| `profile` | text | YES |  |
| `entered_by` | uuid | YES | auth.uid() |
| `entered_at` | timestamp with time zone | NO | now() |

Foreign keys: `applicant_id` → `applicants.applicant_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.admission_cat4 FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_advance_applicant`: `CREATE TRIGGER trg_advance_applicant AFTER INSERT OR UPDATE ON public.admission_cat4 FOR EACH ROW EXECUTE FUNCTION advance_applicant_on_results()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE OR UPDATE ON public.admission_cat4 FOR EACH ROW EXECUTE FUNCTION log_change('admissions', 'applicant_id')`
- `trg_stamp_entered_by`: `CREATE TRIGGER trg_stamp_entered_by BEFORE INSERT OR UPDATE ON public.admission_cat4 FOR EACH ROW EXECUTE FUNCTION stamp_actor('entered_by')`

RLS policies:
- `Admission CAT4 readable and written by admissions` (ALL) USING (has_resource_access('/admissions'::text)) WITH CHECK (has_resource_access('/admissions'::text))


### `admission_letter_templates`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `letter_kind` 🔑 | text | NO |  |
| `label` | text | NO |  |
| `sort_order` | integer | NO |  |
| `subject` | text | YES |  |
| `body` | text | YES |  |
| `updated_by` | uuid | YES |  |
| `updated_at` | timestamp with time zone | NO | now() |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.admission_letter_templates FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_letter_templates_updated_at`: `CREATE TRIGGER trg_letter_templates_updated_at BEFORE UPDATE ON public.admission_letter_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.admission_letter_templates FOR EACH ROW EXECUTE FUNCTION log_change('admissions', 'letter_kind')`
- `trg_stamp_updated_by`: `CREATE TRIGGER trg_stamp_updated_by BEFORE UPDATE ON public.admission_letter_templates FOR EACH ROW EXECUTE FUNCTION stamp_actor('updated_by')`

RLS policies:
- `Letter templates edited on the letters page` (UPDATE) USING (has_resource_access('/admissions/letters'::text)) WITH CHECK (has_resource_access('/admissions/letters'::text))
- `Letter templates readable by admissions` (SELECT) USING (has_resource_access('/admissions'::text))


### `admission_papers`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `paper_id` 🔑 | integer | NO |  |
| `academic_year_id` | integer | NO |  |
| `year_group` | integer | NO |  |
| `subject` | text | NO |  |
| `paper_name` | text | YES |  |
| `max_score` | numeric(6,2) | NO |  |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.admission_papers FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Admission papers readable by admissions` (SELECT) USING (has_resource_access('/admissions'::text))
- `Admission papers written on the papers page` (ALL) USING (has_resource_access('/admissions/papers'::text)) WITH CHECK (has_resource_access('/admissions/papers'::text))


### `admission_places`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `academic_year_id` 🔑 | integer | NO |  |
| `year_group` 🔑 | integer | NO |  |
| `boys_allowed` | integer | YES |  |
| `girls_allowed` | integer | YES |  |
| `updated_by` | uuid | YES | auth.uid() |
| `updated_at` | timestamp with time zone | NO | now() |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.admission_places FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.admission_places FOR EACH ROW EXECUTE FUNCTION log_change('admissions', 'academic_year_id,year_group')`
- `trg_stamp_actor`: `CREATE TRIGGER trg_stamp_actor BEFORE INSERT OR UPDATE ON public.admission_places FOR EACH ROW EXECUTE FUNCTION stamp_actor('updated_by')`
- `trg_touch_admission_places`: `CREATE TRIGGER trg_touch_admission_places BEFORE UPDATE ON public.admission_places FOR EACH ROW EXECUTE FUNCTION touch_admission_places()`

RLS policies:
- `admission_places_delete` (DELETE) USING (has_resource_access('/admissions/places'::text))
- `admission_places_insert` (INSERT) WITH CHECK (has_resource_access('/admissions/places'::text))
- `admission_places_read` (SELECT) USING ((has_resource_access('/admissions'::text) OR has_resource_access('/admissions/places'::text)))
- `admission_places_update` (UPDATE) USING (has_resource_access('/admissions/places'::text)) WITH CHECK (has_resource_access('/admissions/places'::text))


### `admission_sessions`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `session_id` 🔑 | integer | NO |  |
| `academic_year_id` | integer | NO |  |
| `session_date` | date | NO |  |
| `start_time` | time without time zone | YES |  |
| `venue` | text | YES |  |
| `notes` | text | YES |  |
| `created_by` | uuid | YES | auth.uid() |
| `created_at` | timestamp with time zone | NO | now() |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.admission_sessions FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_stamp_created_by`: `CREATE TRIGGER trg_stamp_created_by BEFORE INSERT ON public.admission_sessions FOR EACH ROW EXECUTE FUNCTION stamp_actor('created_by')`

RLS policies:
- `Admission sessions readable by admissions` (SELECT) USING (has_resource_access('/admissions'::text))
- `Admission sessions written on the test days page` (ALL) USING (has_resource_access('/admissions/sessions'::text)) WITH CHECK (has_resource_access('/admissions/sessions'::text))


### `admission_test_scores`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `applicant_id` 🔑 | bigint | NO |  |
| `paper_id` 🔑 | integer | NO |  |
| `score` | numeric(6,2) | NO |  |
| `entered_by` | uuid | YES | auth.uid() |
| `entered_at` | timestamp with time zone | NO | now() |

Foreign keys: `applicant_id` → `applicants.applicant_id`, `paper_id` → `admission_papers.paper_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.admission_test_scores FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_advance_applicant`: `CREATE TRIGGER trg_advance_applicant AFTER INSERT OR UPDATE ON public.admission_test_scores FOR EACH ROW EXECUTE FUNCTION advance_applicant_on_results()`
- `trg_check_admission_score_paper`: `CREATE TRIGGER trg_check_admission_score_paper BEFORE INSERT OR UPDATE ON public.admission_test_scores FOR EACH ROW EXECUTE FUNCTION check_admission_score_paper()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE OR UPDATE ON public.admission_test_scores FOR EACH ROW EXECUTE FUNCTION log_change('admissions', 'applicant_id,paper_id')`
- `trg_stamp_entered_by`: `CREATE TRIGGER trg_stamp_entered_by BEFORE INSERT OR UPDATE ON public.admission_test_scores FOR EACH ROW EXECUTE FUNCTION stamp_actor('entered_by')`

RLS policies:
- `Admission scores readable and written by admissions` (ALL) USING (has_resource_access('/admissions'::text)) WITH CHECK (has_resource_access('/admissions'::text))


### `applicant_contacts`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `contact_id` 🔑 | bigint | NO |  |
| `applicant_id` | bigint | NO |  |
| `name` | text | NO |  |
| `relationship` | text | YES |  |
| `email` | text | YES |  |
| `phone` | text | YES |  |
| `is_primary` | boolean | NO | false |
| `parent_id` | integer | YES |  |

Foreign keys: `applicant_id` → `applicants.applicant_id`, `parent_id` → `parents.parent_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.applicant_contacts FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Applicant contacts readable by admissions` (SELECT) USING (has_resource_access('/admissions'::text))
- `Applicant contacts written by admissions` (ALL) USING (has_resource_access('/admissions'::text)) WITH CHECK (has_resource_access('/admissions'::text))


### `applicant_interviews`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `applicant_id` 🔑 | bigint | NO |  |
| `interviewed_on` | date | NO | school_today() |
| `interviewer_staff_id` | integer | YES |  |
| `reading_age_months` | integer | YES |  |
| `reading_test_name` | text | YES |  |
| `interests` | text[] | NO | '{}'::text[] |
| `interests_other` | text | YES |  |
| `languages_spoken` | text | YES |  |
| `strengths` | text | YES |  |
| `concerns` | text | YES |  |
| `recommendation` | text | YES |  |
| `comments` | text | YES |  |
| `entered_by` | uuid | YES | auth.uid() |
| `entered_at` | timestamp with time zone | NO | now() |

Foreign keys: `applicant_id` → `applicants.applicant_id`, `interviewer_staff_id` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.applicant_interviews FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_advance_applicant`: `CREATE TRIGGER trg_advance_applicant AFTER INSERT OR UPDATE ON public.applicant_interviews FOR EACH ROW EXECUTE FUNCTION advance_applicant_on_results()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE OR UPDATE ON public.applicant_interviews FOR EACH ROW EXECUTE FUNCTION log_change('admissions', 'applicant_id')`
- `trg_stamp_entered_by`: `CREATE TRIGGER trg_stamp_entered_by BEFORE INSERT OR UPDATE ON public.applicant_interviews FOR EACH ROW EXECUTE FUNCTION stamp_actor('entered_by')`

RLS policies:
- `Applicant interviews readable and written by admissions` (ALL) USING (has_resource_access('/admissions'::text)) WITH CHECK (has_resource_access('/admissions'::text))


### `applicant_letters`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `letter_id` 🔑 | bigint | NO |  |
| `applicant_id` | bigint | NO |  |
| `letter_kind` | text | NO |  |
| `subject` | text | NO |  |
| `body` | text | NO |  |
| `sent_by` | uuid | YES |  |
| `sent_at` | timestamp with time zone | NO | now() |
| `emailed_to` | text | YES |  |
| `email_id` | bigint | YES |  |

Foreign keys: `applicant_id` → `applicants.applicant_id`, `letter_kind` → `admission_letter_templates.letter_kind`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.applicant_letters FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Applicant letters readable by admissions` (SELECT) USING (has_resource_access('/admissions'::text))


### `applicants`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `applicant_id` 🔑 | bigint | NO |  |
| `first_name` | text | NO |  |
| `middle_name` | text | YES |  |
| `last_name` | text | NO |  |
| `preferred_name` | text | YES |  |
| `dob` | date | YES |  |
| `gender` | text | YES |  |
| `nationality` | text | YES |  |
| `entry_academic_year_id` | integer | NO |  |
| `entry_year_group` | integer | NO |  |
| `previous_school_id` | integer | YES |  |
| `previous_school_year` | text | YES |  |
| `sibling_student_id` | integer | YES |  |
| `heard_about_us` | text | YES |  |
| `notes` | text | YES |  |
| `application_date` | date | NO | school_today() |
| `status` | text | NO | 'enquiry'::text |
| `form_fee_paid_on` | date | YES |  |
| `form_fee_amount` | numeric(12,2) | YES |  |
| `form_fee_receipt` | text | YES |  |
| `form_fee_recorded_by` | uuid | YES |  |
| `session_id` | integer | YES |  |
| `interview_at` | timestamp with time zone | YES |  |
| `decision_notes` | text | YES |  |
| `decided_by` | uuid | YES |  |
| `decided_at` | timestamp with time zone | YES |  |
| `accepted_at` | timestamp with time zone | YES |  |
| `deposit_paid_on` | date | YES |  |
| `deposit_amount` | numeric(12,2) | YES |  |
| `deposit_receipt` | text | YES |  |
| `deposit_recorded_by` | uuid | YES |  |
| `withdrawn_reason` | text | YES |  |
| `student_id` | integer | YES |  |
| `created_by` | uuid | YES | auth.uid() |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

Foreign keys: `entry_academic_year_id` → `academic_years.academic_year_id`, `previous_school_id` → `previous_schools.school_id`, `sibling_student_id` → `students.student_id`, `session_id` → `admission_sessions.session_id`, `student_id` → `students.student_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.applicants FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_applicants_guard`: `CREATE TRIGGER trg_applicants_guard BEFORE INSERT OR UPDATE ON public.applicants FOR EACH ROW EXECUTE FUNCTION applicants_guard()`
- `trg_applicants_updated_at`: `CREATE TRIGGER trg_applicants_updated_at BEFORE UPDATE ON public.applicants FOR EACH ROW EXECUTE FUNCTION set_updated_at()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE OR UPDATE ON public.applicants FOR EACH ROW EXECUTE FUNCTION log_change('admissions', 'applicant_id')`
- `trg_stamp_created_by`: `CREATE TRIGGER trg_stamp_created_by BEFORE INSERT ON public.applicants FOR EACH ROW EXECUTE FUNCTION stamp_actor('created_by')`

RLS policies:
- `Applicants added by admissions` (INSERT) WITH CHECK ((has_resource_access('/admissions'::text) AND (status = 'enquiry'::text)))
- `Applicants edited by admissions` (UPDATE) USING (has_resource_access('/admissions'::text)) WITH CHECK (has_resource_access('/admissions'::text))
- `Applicants readable by admissions` (SELECT) USING (has_resource_access('/admissions'::text))
- `Unpaid enquiries deleted by admissions` (DELETE) USING ((has_resource_access('/admissions'::text) AND ((status = 'enquiry'::text) OR is_admin())))


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
| `minutes_late` | integer | YES |  |
| `other_half_activity_id` | bigint | YES |  |

Foreign keys: `student_id` → `students.student_id`, `period_number` → `periods.period_number`, `staff_id` → `staff.staff_id`, `code` → `attendance_codes.code`, `other_half_activity_id` → `other_half_activities.activity_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.attendance FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_clear_minutes_late_unless_late`: `CREATE TRIGGER trg_clear_minutes_late_unless_late BEFORE INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION clear_minutes_late_unless_late()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION log_change('registers', 'attendance_id')`
- `trg_reject_future_attendance`: `CREATE TRIGGER trg_reject_future_attendance BEFORE INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION reject_future_attendance()`
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.attendance FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `parent_read_own_attendance` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = attendance.student_id)))))
- `staff_read_attendance` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `staff_update_attendance` (UPDATE) USING ((is_staff_or_admin() AND (is_demo = is_demo_account())))
- `staff_write_attendance` (INSERT) WITH CHECK ((is_staff_or_admin() AND (is_demo = is_demo_account())))


### `attendance_codes`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `code` 🔑 | text | NO |  |
| `description` | text | NO |  |
| `status` | text | NO |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.attendance_codes FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Foreign keys: `student_id` → `students.student_id`, `reviewed_by` → `staff.staff_id`, `event_id` → `behaviour_events.event_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.behaviour_appeals FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_void_event_on_upheld_appeal`: `CREATE TRIGGER trg_void_event_on_upheld_appeal AFTER UPDATE ON public.behaviour_appeals FOR EACH ROW EXECUTE FUNCTION void_event_on_upheld_appeal()`

RLS policies:
- `pastoral_read_all_appeals` (SELECT) USING ((is_pastoral_or_smt() AND ((is_demo = is_demo_account()) OR is_admin())))
- `pastoral_update_appeals` (UPDATE) USING ((is_pastoral_or_smt() AND (is_demo = is_demo_account())))
- `staff_read_resolved_appeals` (SELECT) USING ((is_staff_or_admin() AND (status <> 'pending'::text)))
- `student_insert_own_appeals` (INSERT) WITH CHECK (((status = 'pending'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (resolution_notes IS NULL) AND (EXISTS ( SELECT 1
   FROM (profiles p
     JOIN behaviour_events be ON (((be.event_id = behaviour_appeals.event_id) AND (be.type = 'negative'::text))))
  WHERE ((p.id = auth.uid()) AND (p.student_id = behaviour_appeals.student_id) AND (p.student_id = be.student_id))))))
- `student_read_own_appeals` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = behaviour_appeals.student_id)))))


### `behaviour_categories`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `category_id` 🔑 | integer | NO | nextval('behaviour_categories_category_id_seq'::regclass) |
| `name` | text | NO |  |
| `type` | text | NO |  |
| `default_points` | integer | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.behaviour_categories FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.behaviour_event_audit FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`


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
| `visible_to_parents` | boolean | NO | false |
| `protocol_reviewed_by` | integer | YES |  |
| `protocol_reviewed_at` | timestamp with time zone | YES |  |
| `class_id` | integer | YES |  |
| `voided_at` | timestamp with time zone | YES |  |
| `photo_id` | integer | YES |  |
| `voided_points` | integer | YES |  |

Foreign keys: `student_id` → `students.student_id`, `staff_id` → `staff.staff_id`, `protocol_reviewed_by` → `staff.staff_id`, `class_id` → `classes.class_id`, `photo_id` → `behaviour_photos.photo_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.behaviour_events FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `behaviour_event_default_visibility`: `CREATE TRIGGER behaviour_event_default_visibility BEFORE INSERT ON public.behaviour_events FOR EACH ROW EXECUTE FUNCTION set_behaviour_event_default_visibility()`
- `behaviour_event_logged_by`: `CREATE TRIGGER behaviour_event_logged_by BEFORE INSERT ON public.behaviour_events FOR EACH ROW EXECUTE FUNCTION set_behaviour_event_logged_by()`
- `behaviour_event_points_from_category`: `CREATE TRIGGER behaviour_event_points_from_category BEFORE INSERT OR UPDATE OF points, category, type ON public.behaviour_events FOR EACH ROW EXECUTE FUNCTION set_behaviour_event_points_from_category()`
- `behaviour_event_set_class`: `CREATE TRIGGER behaviour_event_set_class BEFORE INSERT ON public.behaviour_events FOR EACH ROW EXECUTE FUNCTION set_behaviour_event_class()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE OR UPDATE ON public.behaviour_events FOR EACH ROW EXECUTE FUNCTION log_change('behaviour', 'event_id')`
- `trg_negative_behaviour`: `CREATE TRIGGER trg_negative_behaviour AFTER INSERT ON public.behaviour_events FOR EACH ROW WHEN ((new.points < 0)) EXECUTE FUNCTION handle_negative_behaviour()`
- `trg_notify_office_of_behaviour_photos`: `CREATE TRIGGER trg_notify_office_of_behaviour_photos AFTER INSERT ON public.behaviour_events REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_office_of_behaviour_photos()`
- `trg_notify_pastoral_on_negative_behaviour`: `CREATE TRIGGER trg_notify_pastoral_on_negative_behaviour AFTER INSERT ON public.behaviour_events FOR EACH ROW WHEN ((new.type = 'negative'::text)) EXECUTE FUNCTION notify_pastoral_on_negative_behaviour()`
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.behaviour_events FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `admin_delete_behaviour` (DELETE) USING (is_admin())
- `parent_read_own_behaviour` (SELECT) USING (((voided_at IS NULL) AND visible_to_parents AND (EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = behaviour_events.student_id))))))
- `staff_read_behaviour` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `staff_update_behaviour` (UPDATE) USING ((is_staff_or_admin() AND (is_demo = is_demo_account())))
- `staff_write_behaviour` (INSERT) WITH CHECK ((is_staff_or_admin() AND (is_demo = is_demo_account())))
- `student_read_own_behaviour` (SELECT) USING (((voided_at IS NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = behaviour_events.student_id))))))


### `behaviour_photos`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `photo_id` 🔑 | integer | NO | nextval('behaviour_photos_photo_id_seq'::regclass) |
| `image_jpeg_base64` | text | NO |  |
| `status` | text | NO | 'pending'::text |
| `uploaded_by` | integer | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `reviewed_by` | integer | YES |  |
| `reviewed_at` | timestamp with time zone | YES |  |
| `office_notified_at` | timestamp with time zone | YES |  |

Foreign keys: `uploaded_by` → `staff.staff_id`, `reviewed_by` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.behaviour_photos FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `behaviour_photo_defaults`: `CREATE TRIGGER behaviour_photo_defaults BEFORE INSERT ON public.behaviour_photos FOR EACH ROW EXECUTE FUNCTION set_behaviour_photo_defaults()`

RLS policies:
- `admin_delete_behaviour_photos` (DELETE) USING (is_admin())
- `parent_read_approved_behaviour_photos` (SELECT) USING (((status = 'approved'::text) AND (EXISTS ( SELECT 1
   FROM ((behaviour_events e
     JOIN student_parent sp ON ((sp.student_id = e.student_id)))
     JOIN profiles p ON ((p.parent_id = sp.parent_id)))
  WHERE ((e.photo_id = behaviour_photos.photo_id) AND e.visible_to_parents AND (e.voided_at IS NULL) AND (p.id = auth.uid()))))))
- `staff_insert_behaviour_photos` (INSERT) WITH CHECK (is_staff_or_admin())
- `staff_read_behaviour_photos` (SELECT) USING (is_staff_or_admin())
- `student_read_approved_behaviour_photos` (SELECT) USING (((status = 'approved'::text) AND (EXISTS ( SELECT 1
   FROM (behaviour_events e
     JOIN profiles p ON ((p.student_id = e.student_id)))
  WHERE ((e.photo_id = behaviour_photos.photo_id) AND (e.voided_at IS NULL) AND (p.id = auth.uid()))))))


### `behaviour_rules`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | boolean | NO | true |
| `detention_single_event_points` | integer | NO | '-5'::integer |
| `detention_weekly_total_points` | integer | NO | '-10'::integer |
| `alert_weekly_total_points` | integer | NO | '-8'::integer |
| `updated_by` | uuid | YES |  |
| `updated_at` | timestamp with time zone | NO | now() |
| `serious_event_points` | integer | NO | '-5'::integer |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.behaviour_rules FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER UPDATE ON public.behaviour_rules FOR EACH ROW EXECUTE FUNCTION log_change('behaviour', 'id')`

RLS policies:
- `Behaviour rules readable by all authenticated` (SELECT) USING (true)


### `bell_times`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `day_of_week` 🔑 | text | NO |  |
| `period_number` 🔑 | integer | NO |  |
| `start_time` | time without time zone | NO |  |
| `end_time` | time without time zone | NO |  |
| `period_name` | text | YES |  |
| `short_label` | text | YES |  |

Foreign keys: `period_number` → `periods.period_number`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.bell_times FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `bell_times_apply`: `CREATE TRIGGER bell_times_apply AFTER INSERT OR UPDATE ON public.bell_times FOR EACH ROW EXECUTE FUNCTION apply_bell_time()`
- `bell_times_not_in_use`: `CREATE TRIGGER bell_times_not_in_use BEFORE DELETE ON public.bell_times FOR EACH ROW EXECUTE FUNCTION bell_time_not_in_use()`

RLS policies:
- `admin_write_bell_times` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_bell_times` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `bmi_for_age_reference`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `sex` 🔑 | text | NO |  |
| `age_months` 🔑 | integer | NO |  |
| `l` | numeric | NO |  |
| `m` | numeric | NO |  |
| `s` | numeric | NO |  |
| `source` | text | NO | 'WHO 2007 BMI-for-age 5-19'::text |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.bmi_for_age_reference FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `admin_write_bmi_reference` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `anyone_read_bmi_reference` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `boarding_houses`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `house_id` 🔑 | integer | NO | nextval('boarding_houses_house_id_seq'::regclass) |
| `name` | text | NO |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.boarding_houses FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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
| `exam_year_group` | smallint | YES |  |
| `exam_term` | smallint | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.calendar_events FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `read_all_calendar_events` (SELECT) USING ((auth.role() = 'authenticated'::text))
- `smt_write_calendar_events` (ALL) USING (user_has_staff_role(ARRAY['smt'::text])) WITH CHECK (user_has_staff_role(ARRAY['smt'::text]))


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
| `profile` | text | YES |  |

Foreign keys: `student_id` → `students.student_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.cat4_results FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `admin_write_cat4` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `assessment_manager_write_cat4` (ALL) USING (has_staff_role(ARRAY['assessment_manager'::text])) WITH CHECK (has_staff_role(ARRAY['assessment_manager'::text]))
- `parent_read_own_cat4` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = cat4_results.student_id)))))
- `staff_read_cat4` (SELECT) USING (is_staff_or_admin())


### `certificate_levels`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `level_id` 🔑 | integer | NO |  |
| `name` | text | NO |  |
| `points` | integer | NO |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.certificate_levels FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.certificate_levels FOR EACH ROW EXECUTE FUNCTION log_change('behaviour', 'level_id')`

RLS policies:
- `Certificate levels edited on Lookups` (ALL) USING (has_resource_access('/admin/lookups'::text)) WITH CHECK (has_resource_access('/admin/lookups'::text))
- `Certificate levels readable by all authenticated` (SELECT) USING (true)


### `certificates_awarded`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `milestone` 🔑 | integer | NO |  |
| `awarded_date` | date | NO | CURRENT_DATE |
| `is_demo` | boolean | NO | false |
| `level_name` | text | YES |  |

Foreign keys: `student_id` → `students.student_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.certificates_awarded FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.certificates_awarded FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `staff_delete_certificates` (DELETE) USING ((is_staff_or_admin() AND (is_demo = is_demo_account())))
- `staff_insert_certificates` (INSERT) WITH CHECK ((is_staff_or_admin() AND (is_demo = is_demo_account())))
- `staff_read_certificates` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `staff_update_certificates` (UPDATE) USING ((is_staff_or_admin() AND (is_demo = is_demo_account())))


### `change_history`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `area` | text | NO |  |
| `table_name` | text | NO |  |
| `action` | text | NO |  |
| `record_key` | jsonb | NO |  |
| `student_id` | integer | YES |  |
| `changed_fields` | text[] | YES |  |
| `old_row` | jsonb | YES |  |
| `new_row` | jsonb | YES |  |
| `changed_by` | uuid | YES |  |
| `changed_by_staff_id` | integer | YES |  |
| `changed_by_role` | text | YES |  |
| `db_user` | text | NO | CURRENT_USER |
| `changed_at` | timestamp with time zone | NO | now() |
| `changed_by_name` | text | YES |  |
| `note` | text | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.change_history FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_change_history_no_truncate`: `CREATE TRIGGER trg_change_history_no_truncate BEFORE TRUNCATE ON public.change_history FOR EACH STATEMENT EXECUTE FUNCTION change_history_is_append_only()`
- `trg_change_history_no_update_delete`: `CREATE TRIGGER trg_change_history_no_update_delete BEFORE DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION change_history_is_append_only()`

RLS policies:
- `change_history_read` (SELECT) USING (user_has_staff_role(ARRAY['smt'::text]))


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
| `block_group` | text | YES |  |

Foreign keys: `subject_id` → `subjects.subject_id`, `staff_id` → `staff.staff_id`, `block_id` → `curriculum_blocks.block_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.classes FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.curriculum_blocks FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `admin_write_curriculum_blocks` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_curriculum_blocks` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `departments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `department_name` 🔑 | text | NO |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.departments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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
| `student_notified_at` | timestamp with time zone | YES |  |
| `reminded_at` | timestamp with time zone | YES |  |

Foreign keys: `student_id` → `students.student_id`, `behaviour_event_id` → `behaviour_events.event_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.detentions FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_notify_student_of_cancelled_detention`: `CREATE TRIGGER trg_notify_student_of_cancelled_detention AFTER UPDATE ON public.detentions REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_student_of_cancelled_detention()`
- `trg_notify_student_of_detention`: `CREATE TRIGGER trg_notify_student_of_detention BEFORE INSERT ON public.detentions FOR EACH ROW EXECUTE FUNCTION notify_student_of_detention()`

RLS policies:
- `detention_page_read_detentions` (SELECT) USING ((has_resource_access('/detention'::text) AND ((is_demo = is_demo_account()) OR is_admin())))
- `detention_page_update_detentions` (UPDATE) USING ((has_resource_access('/detention'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `email_outbox`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `email_id` 🔑 | bigint | NO |  |
| `payload` | jsonb | NO |  |
| `recipient` | text | YES |  |
| `subject` | text | YES |  |
| `status` | text | NO | 'queued'::text |
| `attempts` | integer | NO | 0 |
| `next_attempt_at` | timestamp with time zone | NO | now() |
| `request_id` | bigint | YES |  |
| `last_error` | text | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `sent_at` | timestamp with time zone | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.email_outbox FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `admin_read_email_outbox` (SELECT) USING (is_admin())
- `staff_comms_read_email_outbox` (SELECT) USING (user_has_staff_role(ARRAY['smt'::text, 'pastoral'::text, 'school_office'::text]))


### `email_reply_routes`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `email_kind` 🔑 | text | NO |  |
| `label` | text | NO |  |
| `description` | text | NO |  |
| `sender_label` | text | YES |  |
| `sort_order` | integer | NO |  |
| `reply_to_sender` | boolean | NO | false |
| `reply_to_smt` | boolean | NO | false |
| `addresses` | text[] | NO | '{}'::text[] |
| `updated_at` | timestamp with time zone | NO | now() |
| `updated_by` | uuid | YES |  |

Foreign keys: `updated_by` → `users.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.email_reply_routes FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `log_email_reply_routes`: `CREATE TRIGGER log_email_reply_routes AFTER INSERT OR DELETE OR UPDATE ON public.email_reply_routes FOR EACH ROW EXECUTE FUNCTION log_change('email', 'email_kind')`
- `stamp_email_reply_route_updated_by`: `CREATE TRIGGER stamp_email_reply_route_updated_by BEFORE INSERT OR UPDATE ON public.email_reply_routes FOR EACH ROW EXECUTE FUNCTION stamp_actor('updated_by')`
- `tidy_email_reply_route`: `CREATE TRIGGER tidy_email_reply_route BEFORE INSERT OR UPDATE ON public.email_reply_routes FOR EACH ROW EXECUTE FUNCTION tidy_email_reply_route()`

RLS policies:
- `smt_read_email_reply_routes` (SELECT) USING (user_has_staff_role(ARRAY['smt'::text]))
- `smt_update_email_reply_routes` (UPDATE) USING (user_has_staff_role(ARRAY['smt'::text])) WITH CHECK (user_has_staff_role(ARRAY['smt'::text]))


### `families`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `family_id` 🔑 | integer | NO | nextval('families_family_id_seq'::regclass) |
| `family_name` | text | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.families FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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
| `amount` | numeric(12,2) | NO |  |
| `target_type` | text | NO |  |
| `target_value` | text | YES |  |
| `created_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `fee_item_id` → `fee_items.id`, `term_id` → `fee_terms.id`, `created_by` → `users.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_charge_batches FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_stamp_created_by`: `CREATE TRIGGER trg_stamp_created_by BEFORE INSERT ON public.fee_charge_batches FOR EACH ROW EXECUTE FUNCTION stamp_actor('created_by')`

RLS policies:
- `Fees staff can insert charge batches` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))
- `Fees staff can read charge batches` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) AND (NOT is_demo_account())))


### `fee_discount_types`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_discount_types_id_seq'::regclass) |
| `name` | text | NO |  |
| `calc_type` | text | NO |  |
| `value` | numeric(12,2) | NO |  |
| `applies_to` | text | YES | 'tuition'::text |
| `created_at` | timestamp with time zone | YES | now() |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_discount_types FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.fee_discount_types FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'id')`

RLS policies:
- `Fee staff can read discount types` (SELECT) USING (user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]))
- `Fee staff can write discount types` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_item_year_prices`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `fee_item_id` 🔑 | bigint | NO |  |
| `year_group` 🔑 | integer | NO |  |
| `amount` | numeric(12,2) | NO |  |
| `approved_change_id` | bigint | YES |  |

Foreign keys: `fee_item_id` → `fee_items.id`, `approved_change_id` → `fee_price_changes.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_item_year_prices FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.fee_item_year_prices FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'fee_item_id,year_group')`

RLS policies:
- `Fee item year prices readable by fee staff and approvers` (SELECT) USING (can_propose_fee_prices())


### `fee_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_items_id_seq'::regclass) |
| `name` | text | NO |  |
| `category` | text | YES |  |
| `is_recurring` | boolean | YES | true |
| `default_amount` | numeric(12,2) | YES |  |
| `created_at` | timestamp with time zone | YES | now() |
| `is_optional` | boolean | YES | false |
| `display_name` | text | YES |  |
| `price_locked` | boolean | NO | false |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_guard_fee_prices`: `CREATE TRIGGER trg_guard_fee_prices BEFORE INSERT OR UPDATE ON public.fee_items FOR EACH ROW EXECUTE FUNCTION guard_fee_prices()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.fee_items FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'id')`

RLS policies:
- `Fee items updatable by bursar` (UPDATE) USING (user_has_staff_role(ARRAY['bursar'::text]))
- `Fee items writable by bursar` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))
- `Fee staff and parents can read fee items` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) OR (EXISTS ( SELECT 1
   FROM my_parent_ids() my_parent_ids(my_parent_ids)))))


### `fee_payment_plan_installments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_payment_plan_installments_id_seq'::regclass) |
| `plan_id` | bigint | YES |  |
| `due_date` | date | NO |  |
| `amount` | numeric(12,2) | NO |  |
| `status` | text | YES | 'pending'::text |

Foreign keys: `plan_id` → `fee_payment_plans.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_payment_plan_installments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Fee staff can read payment plan installments` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) AND (NOT is_demo_account())))
- `Fee staff can write payment plan installments` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_payment_plans`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_payment_plans_id_seq'::regclass) |
| `invoice_id` | bigint | YES |  |
| `approved_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `invoice_id` → `student_invoices.id`, `approved_by` → `users.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_payment_plans FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Fee staff can read payment plans` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) AND (NOT is_demo_account())))
- `Fee staff can write payment plans` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_payments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('fee_payments_id_seq'::regclass) |
| `invoice_id` | bigint | YES |  |
| `amount` | numeric(12,2) | NO |  |
| `method` | text | YES |  |
| `reference` | text | YES |  |
| `paid_date` | date | YES | CURRENT_DATE |
| `recorded_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `invoice_id` → `student_invoices.id`, `recorded_by` → `users.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_payments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE OR UPDATE ON public.fee_payments FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'id')`
- `trg_payments_status`: `CREATE TRIGGER trg_payments_status AFTER INSERT OR DELETE OR UPDATE ON public.fee_payments FOR EACH ROW EXECUTE FUNCTION trg_recalc_invoice_status()`
- `trg_stamp_recorded_by`: `CREATE TRIGGER trg_stamp_recorded_by BEFORE INSERT ON public.fee_payments FOR EACH ROW EXECUTE FUNCTION stamp_actor('recorded_by')`

RLS policies:
- `Fees staff and parents can read relevant payments` (SELECT) USING (((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) AND (NOT is_demo_account())) OR (invoice_id IN ( SELECT si.id
   FROM ((student_invoices si
     JOIN student_parent sp ON ((sp.student_id = si.student_id)))
     JOIN fee_terms ft ON ((ft.id = si.term_id)))
  WHERE ((sp.parent_id IN ( SELECT my_parent_ids() AS my_parent_ids)) AND (ft.published_to_parents = true))))))
- `Fees staff can insert payments` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `fee_price_changes`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `kind` | text | NO |  |
| `academic_year_id` | integer | YES |  |
| `fee_item_id` | bigint | YES |  |
| `old_values` | jsonb | NO |  |
| `new_values` | jsonb | NO |  |
| `reason` | text | YES |  |
| `status` | text | NO | 'pending'::text |
| `requested_by` | uuid | YES |  |
| `requested_at` | timestamp with time zone | NO | now() |
| `principal_approved_by` | uuid | YES |  |
| `principal_approved_at` | timestamp with time zone | YES |  |
| `secretary_approved_by` | uuid | YES |  |
| `secretary_approved_at` | timestamp with time zone | YES |  |
| `closed_by` | uuid | YES |  |
| `closed_at` | timestamp with time zone | YES |  |
| `close_note` | text | YES |  |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`, `fee_item_id` → `fee_items.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_price_changes FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.fee_price_changes FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'id')`

RLS policies:
- `Fee price changes readable by fee staff and approvers` (SELECT) USING (can_propose_fee_prices())


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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.fee_terms FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Fee staff, tuckshop and parents can read fee terms` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text, 'tuckshop'::text]) OR (EXISTS ( SELECT 1
   FROM my_parent_ids() my_parent_ids(my_parent_ids)))))


### `grade_history`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `table_name` | text | NO |  |
| `action` | text | NO |  |
| `student_id` | integer | YES |  |
| `subject_id` | integer | YES |  |
| `record_key` | jsonb | NO |  |
| `old_grade` | text | YES |  |
| `new_grade` | text | YES |  |
| `old_score` | numeric | YES |  |
| `new_score` | numeric | YES |  |
| `old_row` | jsonb | YES |  |
| `new_row` | jsonb | YES |  |
| `changed_by` | uuid | YES |  |
| `changed_by_staff_id` | integer | YES |  |
| `changed_by_role` | text | YES |  |
| `db_user` | text | NO | CURRENT_USER |
| `changed_at` | timestamp with time zone | NO | now() |
| `changed_by_name` | text | YES |  |
| `note` | text | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.grade_history FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_grade_history_no_truncate`: `CREATE TRIGGER trg_grade_history_no_truncate BEFORE TRUNCATE ON public.grade_history FOR EACH STATEMENT EXECUTE FUNCTION grade_history_is_append_only()`
- `trg_grade_history_no_update_delete`: `CREATE TRIGGER trg_grade_history_no_update_delete BEFORE DELETE OR UPDATE ON public.grade_history FOR EACH ROW EXECUTE FUNCTION grade_history_is_append_only()`

RLS policies:
- `grade_history_read` (SELECT) USING (user_has_staff_role(ARRAY['smt'::text, 'assessment_manager'::text]))


### `grade_scale`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `grade` 🔑 | text | NO |  |
| `points` | numeric | NO |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.grade_scale FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.house_assignments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`


### `invoice_line_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('invoice_line_items_id_seq'::regclass) |
| `invoice_id` | bigint | YES |  |
| `fee_item_id` | bigint | YES |  |
| `description` | text | YES |  |
| `amount` | numeric(12,2) | NO |  |
| `is_extra_charge` | boolean | YES | false |
| `batch_id` | bigint | YES |  |
| `added_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | YES | now() |
| `from_payment_id` | bigint | YES |  |

Foreign keys: `invoice_id` → `student_invoices.id`, `fee_item_id` → `fee_items.id`, `batch_id` → `fee_charge_batches.id`, `added_by` → `users.id`, `from_payment_id` → `fee_payments.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.invoice_line_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_enforce_locked_fee_price`: `CREATE TRIGGER trg_enforce_locked_fee_price BEFORE INSERT OR UPDATE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION enforce_locked_fee_price()`
- `trg_line_items_status`: `CREATE TRIGGER trg_line_items_status AFTER INSERT OR DELETE OR UPDATE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION trg_recalc_invoice_status()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'id')`

RLS policies:
- `Fees staff and parents can read relevant line items` (SELECT) USING (((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) AND (NOT is_demo_account())) OR (invoice_id IN ( SELECT si.id
   FROM ((student_invoices si
     JOIN student_parent sp ON ((sp.student_id = si.student_id)))
     JOIN fee_terms ft ON ((ft.id = si.term_id)))
  WHERE ((sp.parent_id IN ( SELECT my_parent_ids() AS my_parent_ids)) AND (ft.published_to_parents = true))))))
- `Fees staff can delete line items` (DELETE) USING (user_has_staff_role(ARRAY['bursar'::text]))
- `Fees staff can insert line items` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `mentor_groups`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `mentor_group_id` 🔑 | integer | NO | nextval('mentor_groups_mentor_group_id_seq'::regclass) |
| `group_name` | text | NO |  |
| `year_group` | integer | YES |  |
| `description` | text | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.mentor_groups FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Foreign keys: `message_id` → `messages.id`, `profile_id` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.message_recipients FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Foreign keys: `sent_by` → `users.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.messages FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `messages_automatic_staff_read` (SELECT) USING (((sent_by IS NULL) AND user_has_staff_role(ARRAY['smt'::text, 'pastoral'::text, 'school_office'::text])))
- `messages_own_or_sent` (SELECT) USING (((sent_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM message_recipients mr
  WHERE ((mr.message_id = messages.id) AND (mr.profile_id = auth.uid()))))))


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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.ngrt_results FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `admin_write_ngrt` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `assessment_manager_write_ngrt` (ALL) USING (has_staff_role(ARRAY['assessment_manager'::text])) WITH CHECK (has_staff_role(ARRAY['assessment_manager'::text]))
- `parent_read_own_ngrt` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = ngrt_results.student_id)))))
- `staff_read_ngrt` (SELECT) USING (is_staff_or_admin())


### `other_half_activities`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `activity_id` 🔑 | bigint | NO | nextval('other_half_activities_activity_id_seq'::regclass) |
| `term_id` | integer | NO |  |
| `day_of_week` | text | NO |  |
| `activity_name` | text | NO |  |
| `description` | text | YES |  |
| `room` | text | YES |  |
| `year_groups` | integer[] | NO |  |
| `capacity` | integer | YES |  |
| `is_active` | boolean | NO | true |
| `created_at` | timestamp with time zone | NO | now() |
| `created_by` | uuid | YES | auth.uid() |

Foreign keys: `term_id` → `terms.term_id`, `created_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.other_half_activities FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `manage_other_half_activities` (ALL) USING (can_manage_other_half()) WITH CHECK (can_manage_other_half())
- `read_other_half_activities` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `other_half_activity_staff`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `activity_id` 🔑 | bigint | NO |  |
| `staff_id` 🔑 | integer | NO |  |

Foreign keys: `activity_id` → `other_half_activities.activity_id`, `staff_id` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.other_half_activity_staff FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `manage_other_half_activity_staff` (ALL) USING (can_manage_other_half()) WITH CHECK (can_manage_other_half())
- `read_other_half_activity_staff` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `other_half_choices`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `choice_id` 🔑 | bigint | NO | nextval('other_half_choices_choice_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `activity_id` | bigint | NO |  |
| `term_id` | integer | NO |  |
| `day_of_week` | text | NO |  |
| `chosen_at` | timestamp with time zone | NO | now() |
| `chosen_by` | uuid | YES | auth.uid() |

Foreign keys: `student_id` → `students.student_id`, `activity_id` → `other_half_activities.activity_id`, `chosen_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.other_half_choices FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_other_half_choice_from_activity`: `CREATE TRIGGER trg_other_half_choice_from_activity BEFORE INSERT OR UPDATE OF activity_id ON public.other_half_choices FOR EACH ROW EXECUTE FUNCTION other_half_choice_from_activity()`

RLS policies:
- `manage_other_half_choices` (ALL) USING (can_manage_other_half()) WITH CHECK (can_manage_other_half())
- `parent_read_own_other_half_choices` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = other_half_choices.student_id)))))
- `staff_read_other_half_choices` (SELECT) USING (is_staff_or_admin())
- `student_read_own_other_half_choices` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = other_half_choices.student_id)))))


### `other_half_terms`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `term_id` 🔑 | integer | NO |  |
| `choices_open` | boolean | NO | false |
| `choices_close_at` | timestamp with time zone | YES |  |
| `updated_at` | timestamp with time zone | NO | now() |

Foreign keys: `term_id` → `terms.term_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.other_half_terms FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_other_half_terms_updated_at`: `CREATE TRIGGER trg_other_half_terms_updated_at BEFORE UPDATE ON public.other_half_terms FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

RLS policies:
- `manage_other_half_terms` (ALL) USING (can_manage_other_half()) WITH CHECK (can_manage_other_half())
- `read_other_half_terms` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `parent_calendar_feeds`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `parent_id` 🔑 | integer | NO |  |
| `token` | text | NO |  |
| `created_at` | timestamp with time zone | NO | now() |

Foreign keys: `parent_id` → `parents.parent_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.parent_calendar_feeds FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`


### `parent_welcome_sends`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `parent_id` 🔑 | integer | NO |  |
| `email` | text | NO |  |
| `sent_at` | timestamp with time zone | NO | now() |
| `sent_by` | uuid | YES | auth.uid() |
| `resend_count` | integer | NO | 0 |
| `last_sent_at` | timestamp with time zone | YES |  |

Foreign keys: `parent_id` → `parents.parent_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.parent_welcome_sends FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `parent_welcome_sends readable by admin` (SELECT) USING (is_admin())


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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.parents FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `admin_write_parents` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `parent_read_own_contact` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.parent_id = parents.parent_id)))))
- `read_parents_pastoral` (SELECT) USING (is_pastoral_or_smt())
- `school_office_insert_parents` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['school_office'::text]))
- `school_office_read_parents` (SELECT) USING (user_has_staff_role(ARRAY['school_office'::text]))
- `school_office_update_parents` (UPDATE) USING (user_has_staff_role(ARRAY['school_office'::text])) WITH CHECK (user_has_staff_role(ARRAY['school_office'::text]))


### `periods`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `period_number` 🔑 | integer | NO |  |
| `period_name` | text | NO |  |
| `short_label` | text | NO |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.periods FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `read_all_periods` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `plan_classes`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `class_id` 🔑 | integer | NO |  |
| `academic_year_id` | integer | NO |  |
| `subject_id` | integer | NO |  |
| `staff_id` | integer | YES |  |
| `year_group` | integer | NO |  |
| `room` | text | YES |  |
| `class_code` | text | YES |  |
| `block_id` | integer | YES |  |
| `block_group` | text | YES |  |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`, `subject_id` → `subjects.subject_id`, `staff_id` → `staff.staff_id`, `block_id` → `plan_curriculum_blocks.block_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.plan_classes FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_plan_class_needs_mentor_structure`: `CREATE TRIGGER trg_plan_class_needs_mentor_structure BEFORE INSERT ON public.plan_classes FOR EACH ROW EXECUTE FUNCTION plan_class_needs_mentor_structure()`

RLS policies:
- `Plan classes edited in next year setup` (ALL) USING (can_edit_next_year()) WITH CHECK (can_edit_next_year())
- `Plan classes readable by staff` (SELECT) USING (is_staff_or_admin())


### `plan_curriculum_blocks`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `block_id` 🔑 | integer | NO |  |
| `academic_year_id` | integer | NO |  |
| `block_name` | text | NO |  |
| `year_group` | integer | NO |  |
| `band` | text | YES |  |
| `is_compound` | boolean | NO | false |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.plan_curriculum_blocks FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Plan blocks edited in next year setup` (ALL) USING (can_edit_next_year()) WITH CHECK (can_edit_next_year())
- `Plan blocks readable by staff` (SELECT) USING (is_staff_or_admin())


### `plan_mentor_assignments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `academic_year_id` 🔑 | integer | NO |  |
| `group_name` 🔑 | text | NO |  |
| `staff_id` 🔑 | integer | NO |  |

Foreign keys: `staff_id` → `staff.staff_id`, `academic_year_id, group_name` → `plan_mentor_groups.academic_year_id, group_name`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.plan_mentor_assignments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Plan mentor assignments edited in next year setup` (ALL) USING (has_resource_access('/admin/next-year'::text)) WITH CHECK (has_resource_access('/admin/next-year'::text))
- `Plan mentor assignments readable by staff` (SELECT) USING (is_staff_or_admin())


### `plan_mentor_groups`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `plan_mentor_group_id` 🔑 | integer | NO |  |
| `academic_year_id` | integer | NO |  |
| `group_name` | text | NO |  |
| `year_group` | integer | NO |  |
| `description` | text | YES |  |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.plan_mentor_groups FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Plan mentor groups edited in next year setup` (ALL) USING (has_resource_access('/admin/next-year'::text)) WITH CHECK (has_resource_access('/admin/next-year'::text))
- `Plan mentor groups readable by staff` (SELECT) USING (is_staff_or_admin())


### `plan_student_class`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `class_id` 🔑 | integer | NO |  |
| `academic_year_id` | integer | YES |  |
| `block_id` | integer | YES |  |
| `is_compound` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `class_id` → `plan_classes.class_id`, `academic_year_id` → `academic_years.academic_year_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.plan_student_class FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_plan_row_from_class`: `CREATE TRIGGER trg_plan_row_from_class BEFORE INSERT OR UPDATE OF class_id ON public.plan_student_class FOR EACH ROW EXECUTE FUNCTION plan_row_from_class()`

RLS policies:
- `Plan enrolments edited by allocators` (ALL) USING ((can_edit_next_year() OR can_allocate_classes())) WITH CHECK ((can_edit_next_year() OR can_allocate_classes()))
- `Plan enrolments readable by staff` (SELECT) USING (is_staff_or_admin())


### `plan_timetable_slots`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `slot_id` 🔑 | integer | NO |  |
| `academic_year_id` | integer | YES |  |
| `class_id` | integer | NO |  |
| `day_of_week` | text | NO |  |
| `period_number` | integer | NO |  |
| `start_time` | time without time zone | NO |  |
| `end_time` | time without time zone | NO |  |
| `staff_id` | integer | YES |  |
| `room` | text | YES |  |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`, `class_id` → `plan_classes.class_id`, `staff_id` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.plan_timetable_slots FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `plan_timetable_slots_take_bell_time`: `CREATE TRIGGER plan_timetable_slots_take_bell_time BEFORE INSERT ON public.plan_timetable_slots FOR EACH ROW EXECUTE FUNCTION timetable_slot_takes_bell_time()`
- `trg_plan_row_from_class`: `CREATE TRIGGER trg_plan_row_from_class BEFORE INSERT OR UPDATE OF class_id ON public.plan_timetable_slots FOR EACH ROW EXECUTE FUNCTION plan_row_from_class()`

RLS policies:
- `Plan lessons edited in next year setup` (ALL) USING (can_edit_next_year()) WITH CHECK (can_edit_next_year())
- `Plan lessons readable by staff` (SELECT) USING (is_staff_or_admin())


### `previous_schools`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `school_id` 🔑 | integer | NO |  |
| `name` | text | NO |  |
| `town` | text | YES |  |
| `state` | text | YES |  |
| `country` | text | NO | 'Nigeria'::text |
| `curriculum` | text | YES |  |
| `created_by` | uuid | YES | auth.uid() |
| `created_at` | timestamp with time zone | NO | now() |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.previous_schools FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_stamp_created_by`: `CREATE TRIGGER trg_stamp_created_by BEFORE INSERT ON public.previous_schools FOR EACH ROW EXECUTE FUNCTION stamp_actor('created_by')`

RLS policies:
- `Previous schools added by admissions` (INSERT) WITH CHECK (has_resource_access('/admissions'::text))
- `Previous schools edited on the schools page` (UPDATE) USING (has_resource_access('/admissions/schools'::text)) WITH CHECK (has_resource_access('/admissions/schools'::text))
- `Previous schools readable by admissions` (SELECT) USING (has_resource_access('/admissions'::text))
- `Unused previous schools deleted on the schools page` (DELETE) USING (has_resource_access('/admissions/schools'::text))


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
| `must_change_password` | boolean | NO | false |

Foreign keys: `id` → `users.id`, `staff_id` → `staff.staff_id`, `parent_id` → `parents.parent_id`, `student_id` → `students.student_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_link_profile_to_staff`: `CREATE TRIGGER trg_link_profile_to_staff BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION link_profile_to_staff()`
- `trg_lock_login_for_left_student`: `CREATE TRIGGER trg_lock_login_for_left_student AFTER INSERT OR UPDATE OF student_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION lock_login_when_student_leaves()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION log_change('access', 'id')`
- `trg_unban_parent_login`: `CREATE TRIGGER trg_unban_parent_login AFTER INSERT OR UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION unban_parent_login()`

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
| `other_half_activity_id` | bigint | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`, `other_half_activity_id` → `other_half_activities.activity_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.register_alerts FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Foreign keys: `report_period_id` → `report_periods.report_period_id`, `staff_id` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.report_checkers FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `report_checkers_admin` (ALL) USING (user_has_staff_role(ARRAY['admin'::text, 'smt'::text]))
- `report_checkers_read_own` (SELECT) USING ((staff_id = ( SELECT profiles.staff_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))))


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

Foreign keys: `report_period_id` → `report_periods.report_period_id`, `student_id` → `students.student_id`, `staff_id` → `staff.staff_id`, `checked_by` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.report_pastoral_comments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `pastoral_comments_insert` (INSERT) WITH CHECK (((staff_id = ( SELECT profiles.staff_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `pastoral_comments_select` (SELECT) USING (((staff_id = ( SELECT profiles.staff_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM report_checkers rc
  WHERE ((rc.report_period_id = report_pastoral_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `pastoral_comments_update` (UPDATE) USING ((((staff_id = ( SELECT profiles.staff_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (status = 'draft'::text)) OR (EXISTS ( SELECT 1
   FROM report_checkers rc
  WHERE ((rc.report_period_id = report_pastoral_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))


### `report_periods`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `report_period_id` 🔑 | integer | NO | nextval('report_periods_report_period_id_seq'::regclass) |
| `term_id` | integer | YES |  |
| `name` | text | NO |  |
| `year_groups` | integer[] | NO |  |
| `comments_due_date` | date | YES |  |
| `check_due_date` | date | YES |  |
| `is_published` | boolean | YES | false |
| `created_at` | timestamp with time zone | YES | now() |
| `created_by` | uuid | YES |  |
| `calendar_event_id` | integer | YES |  |
| `joined_from` | date | YES |  |

Foreign keys: `term_id` → `terms.term_id`, `calendar_event_id` → `calendar_events.event_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.report_periods FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `report_periods_admin` (ALL) USING (user_has_staff_role(ARRAY['admin'::text, 'smt'::text, 'assessment_manager'::text]))
- `report_periods_staff_read` (SELECT) USING (is_staff_or_admin())


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
| `presentation_grade` | text | YES |  |
| `homework_grade` | text | YES |  |

Foreign keys: `report_period_id` → `report_periods.report_period_id`, `student_id` → `students.student_id`, `subject_id` → `subjects.subject_id`, `staff_id` → `staff.staff_id`, `checked_by` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.report_subject_comments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `subject_comments_insert` (INSERT) WITH CHECK (((staff_id = ( SELECT profiles.staff_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `subject_comments_select` (SELECT) USING (((staff_id = ( SELECT profiles.staff_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM report_checkers rc
  WHERE ((rc.report_period_id = report_subject_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))
- `subject_comments_update` (UPDATE) USING ((((staff_id = ( SELECT profiles.staff_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (status = 'draft'::text)) OR (EXISTS ( SELECT 1
   FROM report_checkers rc
  WHERE ((rc.report_period_id = report_subject_comments.report_period_id) AND (rc.staff_id = ( SELECT profiles.staff_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))) OR user_has_staff_role(ARRAY['admin'::text, 'smt'::text])))


### `resources`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `resource_key` 🔑 | text | NO |  |
| `label` | text | NO |  |
| `section` | text | NO |  |
| `sort_order` | integer | NO | 0 |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.resources FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.results FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_grade_change`: `CREATE TRIGGER trg_log_grade_change AFTER INSERT OR DELETE OR UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION log_grade_change()`
- `trg_results_updated_at`: `CREATE TRIGGER trg_results_updated_at BEFORE UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

RLS policies:
- `assessment_update_results` (UPDATE) USING (is_assessment_manager())
- `assessment_user_insert_results` (INSERT) WITH CHECK (has_staff_role(ARRAY['assessment_user'::text]))
- `assessment_user_update_results` (UPDATE) USING (has_staff_role(ARRAY['assessment_user'::text]))
- `assessment_write_results` (INSERT) WITH CHECK (is_assessment_manager())
- `delete_own_class_department_or_any_results` (DELETE) USING (can_delete_result(student_id, subject_id))
- `parent_read_own_results` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = results.student_id)))))
- `staff_read_results` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_own_results` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = results.student_id)))))
- `teacher_insert_own_class_results` (INSERT) WITH CHECK (teaches_student_for_subject(student_id, subject_id))
- `teacher_update_own_class_results` (UPDATE) USING (teaches_student_for_subject(student_id, subject_id)) WITH CHECK (teaches_student_for_subject(student_id, subject_id))


### `role_permissions`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `role_name` 🔑 | text | NO |  |
| `resource_key` 🔑 | text | NO |  |

Foreign keys: `role_name` → `roles.role_name`, `resource_key` → `resources.resource_key`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.role_permissions FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION log_change('access', 'role_name,resource_key')`

RLS policies:
- `role_permissions editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `role_permissions readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `roles`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `role_name` 🔑 | text | NO |  |
| `description` | text | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.roles FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `roles editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `roles readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `sports_houses`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `house_id` 🔑 | integer | NO | nextval('sports_houses_house_id_seq'::regclass) |
| `name` | text | NO |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.sports_houses FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.staff FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_staff_auto_login`: `CREATE TRIGGER trg_staff_auto_login AFTER INSERT OR UPDATE OF email ON public.staff FOR EACH ROW EXECUTE FUNCTION trg_provision_staff_login()`

RLS policies:
- `admin_write_staff` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `hr_insert_staff` (INSERT) WITH CHECK (can_manage_staff_hr())
- `hr_update_staff` (UPDATE) USING (can_manage_staff_hr()) WITH CHECK (can_manage_staff_hr())
- `read_all_staff` (SELECT) USING (((auth.role() = 'authenticated'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `staff_attendance_records`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `staff_id` | integer | NO |  |
| `record_type` | text | NO |  |
| `start_date` | date | NO |  |
| `end_date` | date | YES |  |
| `days` | numeric(4,1) | YES |  |
| `minutes_late` | integer | YES |  |
| `reason` | text | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `created_by` | uuid | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`, `created_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.staff_attendance_records FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `hr_read_staff_attendance_records` (SELECT) USING (can_read_staff_hr())
- `hr_write_staff_attendance_records` (ALL) USING (can_manage_staff_hr()) WITH CHECK (can_manage_staff_hr())


### `staff_commitments`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `commitment_id` 🔑 | integer | NO | nextval('staff_commitments_commitment_id_seq'::regclass) |
| `staff_id` | integer | NO |  |
| `day_of_week` | text | NO |  |
| `period_number` | integer | NO |  |
| `label` | text | NO |  |
| `is_demo` | boolean | NO | false |
| `created_at` | timestamp with time zone | NO | now() |

Foreign keys: `staff_id` → `staff.staff_id`, `period_number` → `periods.period_number`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.staff_commitments FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.staff_commitments FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `admin_write_commitments` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `staff_read_commitments` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))


### `staff_hr_profiles`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `staff_id` 🔑 | integer | NO |  |
| `photo_base64` | text | YES |  |
| `job_title` | text | YES |  |
| `department` | text | YES |  |
| `employment_type` | text | YES |  |
| `date_of_appointment` | date | YES |  |
| `probation_end_date` | date | YES |  |
| `leaving_date` | date | YES |  |
| `annual_leave_days` | numeric(4,1) | YES |  |
| `date_of_birth` | date | YES |  |
| `gender` | text | YES |  |
| `nationality` | text | YES |  |
| `phone` | text | YES |  |
| `personal_email` | text | YES |  |
| `address` | text | YES |  |
| `next_of_kin_name` | text | YES |  |
| `next_of_kin_relationship` | text | YES |  |
| `next_of_kin_phone` | text | YES |  |
| `police_clearance_date` | date | YES |  |
| `police_clearance_reference` | text | YES |  |
| `police_clearance_renewal_date` | date | YES |  |
| `qualifications` | text | YES |  |
| `notes` | text | YES |  |
| `updated_at` | timestamp with time zone | NO | now() |
| `updated_by` | uuid | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`, `updated_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.staff_hr_profiles FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_staff_hr_profiles_updated_at`: `CREATE TRIGGER trg_staff_hr_profiles_updated_at BEFORE UPDATE ON public.staff_hr_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

RLS policies:
- `hr_read_staff_hr_profiles` (SELECT) USING (can_read_staff_hr())
- `hr_write_staff_hr_profiles` (ALL) USING (can_manage_staff_hr()) WITH CHECK (can_manage_staff_hr())


### `staff_roles`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `staff_id` 🔑 | integer | NO |  |
| `role_name` 🔑 | text | NO |  |
| `scope_type` | text | YES |  |
| `scope_value` | text | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`, `role_name` → `roles.role_name`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.staff_roles FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.staff_roles FOR EACH ROW EXECUTE FUNCTION log_change('access', 'staff_id,role_name')`

RLS policies:
- `admin_write_staff_roles` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `hr_manage_staff_roles` (ALL) USING ((user_has_staff_role(ARRAY['hr'::text]) AND (role_name <> 'admin'::text))) WITH CHECK ((user_has_staff_role(ARRAY['hr'::text]) AND (role_name <> 'admin'::text)))
- `read_all_staff_roles` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `staff_training`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `staff_id` | integer | NO |  |
| `title` | text | NO |  |
| `provider` | text | YES |  |
| `completed_on` | date | YES |  |
| `expires_on` | date | YES |  |
| `certificate_reference` | text | YES |  |
| `notes` | text | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `created_by` | uuid | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`, `created_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.staff_training FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `hr_read_staff_training` (SELECT) USING (can_read_staff_hr())
- `hr_write_staff_training` (ALL) USING (can_manage_staff_hr()) WITH CHECK (can_manage_staff_hr())


### `staff_warnings`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `staff_id` | integer | NO |  |
| `issued_on` | date | NO |  |
| `level` | text | NO |  |
| `reason` | text | NO |  |
| `issued_by` | text | YES |  |
| `expires_on` | date | YES |  |
| `notes` | text | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `created_by` | uuid | YES |  |

Foreign keys: `staff_id` → `staff.staff_id`, `created_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.staff_warnings FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `hr_read_staff_warnings` (SELECT) USING (can_read_staff_hr())
- `hr_write_staff_warnings` (ALL) USING (can_manage_staff_hr()) WITH CHECK (can_manage_staff_hr())


### `student_class`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `class_id` 🔑 | integer | NO |  |
| `block_id` | integer | YES |  |
| `is_compound` | boolean | NO | false |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `class_id` → `classes.class_id`, `block_id` → `curriculum_blocks.block_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_class FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_set_student_class_block_id`: `CREATE TRIGGER trg_set_student_class_block_id BEFORE INSERT OR UPDATE OF class_id ON public.student_class FOR EACH ROW EXECUTE FUNCTION set_student_class_block_id()`

RLS policies:
- `admin_write_student_class` (ALL) USING (can_allocate_classes()) WITH CHECK (can_allocate_classes())
- `read_all_student_class` (SELECT) USING (((auth.role() = 'authenticated'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `student_clinic_visits`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `visit_id` 🔑 | bigint | NO | nextval('student_clinic_visits_visit_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `visited_at` | timestamp with time zone | NO | school_now() |
| `category` | text | YES |  |
| `reason` | text | NO |  |
| `temperature_c` | numeric(4,1) | YES |  |
| `observations` | text | YES |  |
| `treatment` | text | YES |  |
| `medication_given` | text | YES |  |
| `dose_given` | text | YES |  |
| `outcome` | text | YES |  |
| `parent_notified` | boolean | NO | false |
| `parent_notified_at` | timestamp with time zone | YES |  |
| `follow_up_needed` | boolean | NO | false |
| `recorded_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | NO | now() |

Foreign keys: `student_id` → `students.student_id`, `recorded_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_clinic_visits FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `medical_staff_manage_clinic_visits` (ALL) USING (is_medical_staff()) WITH CHECK (is_medical_staff())


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

Foreign keys: `student_id` → `students.student_id`, `discount_type_id` → `fee_discount_types.id`, `start_term_id` → `fee_terms.id`, `end_term_id` → `fee_terms.id`, `approved_by` → `users.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_discounts FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.student_discounts FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'id')`

RLS policies:
- `Fee staff can read student discounts` (SELECT) USING ((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) AND (NOT is_demo_account())))
- `Fee staff can write student discounts` (ALL) USING (user_has_staff_role(ARRAY['bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `student_documents`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('student_documents_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `document_type` | text | NO |  |
| `term_id` | integer | YES |  |
| `title` | text | NO |  |
| `storage_path` | text | NO |  |
| `generated_at` | timestamp with time zone | NO | now() |
| `generated_by` | uuid | YES |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `term_id` → `terms.term_id`, `generated_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_documents FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.student_documents FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `parent_read_own_student_documents` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = student_documents.student_id)))))
- `staff_manage_student_documents` (ALL) USING ((user_has_staff_role(ARRAY['admin'::text, 'smt'::text, 'assessment_manager'::text]) AND (NOT is_demo_account()))) WITH CHECK ((user_has_staff_role(ARRAY['admin'::text, 'smt'::text, 'assessment_manager'::text]) AND (NOT is_demo_account())))
- `staff_read_student_documents` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_own_student_documents` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = student_documents.student_id)))))


### `student_field_permissions`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `role_name` 🔑 | text | NO |  |
| `field_name` 🔑 | text | NO |  |

Foreign keys: `role_name` → `roles.role_name`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_field_permissions FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `student_field_permissions editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `student_field_permissions readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `student_growth_measurements`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `measurement_id` 🔑 | bigint | NO | nextval('student_growth_measurements_measurement_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `measured_on` | date | NO | school_today() |
| `height_cm` | numeric(5,1) | YES |  |
| `weight_kg` | numeric(5,1) | YES |  |
| `bmi` | numeric(5,2) | YES | 
CASE
    WHEN ((height_cm IS NOT NULL) AND (weight_kg IS NOT NULL) AND (height_cm > (0)::numeric)) THEN round((weight_kg / power((height_cm / 100.0), (2)::numeric)), 2)
    ELSE NULL::numeric
END |
| `notes` | text | YES |  |
| `recorded_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | NO | now() |

Foreign keys: `student_id` → `students.student_id`, `recorded_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_growth_measurements FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `medical_staff_manage_growth` (ALL) USING (is_medical_staff()) WITH CHECK (is_medical_staff())


### `student_immunisations`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `immunisation_id` 🔑 | bigint | NO | nextval('student_immunisations_immunisation_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `vaccine` | text | NO |  |
| `dose_label` | text | YES |  |
| `given_on` | date | YES |  |
| `next_due_on` | date | YES |  |
| `batch_number` | text | YES |  |
| `administered_by` | text | YES |  |
| `notes` | text | YES |  |
| `recorded_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | NO | now() |

Foreign keys: `student_id` → `students.student_id`, `recorded_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_immunisations FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `medical_staff_manage_immunisations` (ALL) USING (is_medical_staff()) WITH CHECK (is_medical_staff())


### `student_invoices`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('student_invoices_id_seq'::regclass) |
| `student_id` | integer | YES |  |
| `term_id` | bigint | YES |  |
| `status` | text | YES | 'unpaid'::text |
| `created_at` | timestamp with time zone | YES | now() |

Foreign keys: `student_id` → `students.student_id`, `term_id` → `fee_terms.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_invoices FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER DELETE ON public.student_invoices FOR EACH ROW EXECUTE FUNCTION log_change('fees', 'id')`

RLS policies:
- `Fees staff and parents can read relevant invoices` (SELECT) USING (((user_has_staff_role(ARRAY['bursar'::text, 'smt'::text]) AND (NOT is_demo_account())) OR ((student_id IN ( SELECT sp.student_id
   FROM student_parent sp
  WHERE (sp.parent_id IN ( SELECT my_parent_ids() AS my_parent_ids)))) AND (term_id IN ( SELECT fee_terms.id
   FROM fee_terms
  WHERE (fee_terms.published_to_parents = true))))))
- `Fees staff can insert invoices` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['bursar'::text]))


### `student_medical`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `blood_group` | text | YES |  |
| `genotype` | text | YES |  |
| `gp_name` | text | YES |  |
| `gp_phone` | text | YES |  |
| `preferred_hospital` | text | YES |  |
| `preferred_hospital_phone` | text | YES |  |
| `health_insurance_provider` | text | YES |  |
| `health_insurance_number` | text | YES |  |
| `consent_first_aid` | boolean | NO | false |
| `consent_simple_analgesia` | boolean | NO | false |
| `consent_emergency_treatment` | boolean | NO | false |
| `carries_own_medication` | boolean | NO | false |
| `dietary_requirements` | text | YES |  |
| `sport_restrictions` | text | YES |  |
| `notes` | text | YES |  |
| `last_reviewed_on` | date | YES |  |
| `last_reviewed_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

Foreign keys: `student_id` → `students.student_id`, `last_reviewed_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_medical FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_student_medical_updated_at`: `CREATE TRIGGER trg_student_medical_updated_at BEFORE UPDATE ON public.student_medical FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

RLS policies:
- `medical_staff_manage_student_medical` (ALL) USING (is_medical_staff()) WITH CHECK (is_medical_staff())


### `student_medical_conditions`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `condition_id` 🔑 | bigint | NO | nextval('student_medical_conditions_condition_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `kind` | text | NO |  |
| `label` | text | NO |  |
| `severity` | text | YES |  |
| `management` | text | YES |  |
| `dose` | text | YES |  |
| `frequency` | text | YES |  |
| `diagnosed_on` | date | YES |  |
| `active` | boolean | NO | true |
| `created_at` | timestamp with time zone | NO | now() |
| `created_by` | uuid | YES |  |

Foreign keys: `student_id` → `students.student_id`, `created_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_medical_conditions FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `medical_staff_manage_conditions` (ALL) USING (is_medical_staff()) WITH CHECK (is_medical_staff())


### `student_medical_screenings`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `screening_id` 🔑 | bigint | NO | nextval('student_medical_screenings_screening_id_seq'::regclass) |
| `student_id` | integer | NO |  |
| `term_id` | integer | NO |  |
| `screening_type` | text | NO | 'resumption'::text |
| `screened_on` | date | NO | school_today() |
| `temperature_c` | numeric(4,1) | YES |  |
| `pulse_bpm` | integer | YES |  |
| `respiratory_rate` | integer | YES |  |
| `bp_systolic` | integer | YES |  |
| `bp_diastolic` | integer | YES |  |
| `pcv_percent` | numeric(4,1) | YES |  |
| `malaria_test` | text | YES |  |
| `urinalysis` | text | YES |  |
| `other_tests` | text | YES |  |
| `parent_form_received` | boolean | NO | false |
| `holiday_illness` | text | YES |  |
| `current_medication` | text | YES |  |
| `medication_handed_in` | boolean | NO | false |
| `medication_handed_in_detail` | text | YES |  |
| `allergies_confirmed` | boolean | NO | false |
| `blood_group_confirmed` | boolean | NO | false |
| `genotype_confirmed` | boolean | NO | false |
| `immunisations_up_to_date` | boolean | NO | false |
| `fitness` | text | NO | 'pending'::text |
| `restrictions` | text | YES |  |
| `referral_needed` | boolean | NO | false |
| `referral_detail` | text | YES |  |
| `recommendations` | text | YES |  |
| `notes` | text | YES |  |
| `screened_by` | uuid | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

Foreign keys: `student_id` → `students.student_id`, `term_id` → `terms.term_id`, `screened_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_medical_screenings FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_student_medical_screenings_updated_at`: `CREATE TRIGGER trg_student_medical_screenings_updated_at BEFORE UPDATE ON public.student_medical_screenings FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

RLS policies:
- `medical_staff_manage_screenings` (ALL) USING (is_medical_staff()) WITH CHECK (is_medical_staff())


### `student_parent`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `parent_id` 🔑 | integer | NO |  |
| `is_primary_contact` | boolean | NO | false |
| `relationship` | text | YES |  |

Foreign keys: `student_id` → `students.student_id`, `parent_id` → `parents.parent_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_parent FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_change`: `CREATE TRIGGER trg_log_change AFTER INSERT OR DELETE OR UPDATE ON public.student_parent FOR EACH ROW EXECUTE FUNCTION log_change('parent_links', 'student_id,parent_id')`

RLS policies:
- `admin_write_student_parent` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `parent_read_own_links` (SELECT) USING (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.parent_id = student_parent.parent_id)))) AND (student_id IN ( SELECT my_current_child_ids() AS my_current_child_ids))))
- `read_student_parent_pastoral` (SELECT) USING (is_pastoral_or_smt())
- `school_office_write_student_parent` (ALL) USING (user_has_staff_role(ARRAY['school_office'::text])) WITH CHECK (user_has_staff_role(ARRAY['school_office'::text]))


### `student_screening_findings`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `finding_id` 🔑 | bigint | NO | nextval('student_screening_findings_finding_id_seq'::regclass) |
| `screening_id` | bigint | NO |  |
| `system` | text | NO |  |
| `status` | text | NO | 'not_examined'::text |
| `note` | text | YES |  |

Foreign keys: `screening_id` → `student_medical_screenings.screening_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.student_screening_findings FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `medical_staff_manage_screening_findings` (ALL) USING (is_medical_staff()) WITH CHECK (is_medical_staff())


### `students`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO | nextval('students_student_id_seq'::regclass) |
| `first_name` | text | NO |  |
| `last_name` | text | NO |  |
| `dob` | date | NO |  |
| `year_group` | integer | NO |  |
| `form_class` | text | YES |  |
| `admission_date` | date | NO |  |
| `gender` | text | NO |  |
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

Foreign keys: `family_id` → `families.family_id`, `mentor_staff_id` → `staff.staff_id`, `mentor_group_id` → `mentor_groups.mentor_group_id`, `boarding_house` → `boarding_houses.name`, `sports_house` → `sports_houses.name`, `form_class` → `mentor_groups.group_name`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.students FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_a_check_student_field_edit`: `CREATE TRIGGER trg_a_check_student_field_edit BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION check_student_field_edit()`
- `trg_assign_admission_number`: `CREATE TRIGGER trg_assign_admission_number BEFORE INSERT OR UPDATE OF admission_number ON public.students FOR EACH ROW EXECUTE FUNCTION assign_admission_number()`
- `trg_auto_set_student_status`: `CREATE TRIGGER trg_auto_set_student_status BEFORE INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION auto_set_student_status()`
- `trg_default_admission_date`: `CREATE TRIGGER trg_default_admission_date BEFORE INSERT ON public.students FOR EACH ROW EXECUTE FUNCTION default_admission_date()`
- `trg_lock_login_when_student_leaves`: `CREATE TRIGGER trg_lock_login_when_student_leaves AFTER UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION lock_login_when_student_leaves()`
- `trg_remove_class_links_on_student_leave`: `CREATE TRIGGER trg_remove_class_links_on_student_leave AFTER UPDATE OF status ON public.students FOR EACH ROW EXECUTE FUNCTION remove_class_links_on_student_leave()`
- `trg_student_auto_login`: `CREATE TRIGGER trg_student_auto_login AFTER INSERT OR UPDATE OF student_email ON public.students FOR EACH ROW EXECUTE FUNCTION trg_provision_student_login()`
- `trg_sync_mentor_group_from_form_class`: `CREATE TRIGGER trg_sync_mentor_group_from_form_class BEFORE INSERT OR UPDATE OF form_class ON public.students FOR EACH ROW EXECUTE FUNCTION sync_mentor_group_from_form_class()`

RLS policies:
- `admin_delete_students` (DELETE) USING (is_admin())
- `admin_read_students` (SELECT) USING (is_admin())
- `admin_update_students` (UPDATE) USING (is_admin()) WITH CHECK (is_admin())
- `field_editors_update_students` (UPDATE) USING (can_edit_any_student_field()) WITH CHECK (can_edit_any_student_field())
- `parent_read_own_child` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = students.student_id)))))
- `school_office_insert_students` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['school_office'::text]))
- `school_office_update_students` (UPDATE) USING (user_has_staff_role(ARRAY['school_office'::text])) WITH CHECK (user_has_staff_role(ARRAY['school_office'::text]))
- `staff_read_students` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_self` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = students.student_id)))))


### `subject_aliases`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `alias_name` 🔑 | text | NO |  |
| `subject_id` | integer | YES |  |

Foreign keys: `subject_id` → `subjects.subject_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.subject_aliases FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.subject_grade_boundaries FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.subject_key_stages FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

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
| `carries_target_grade` | boolean | NO | true |
| `on_grade_report` | boolean | NO | true |

Foreign keys: `target_fallback_subject_id` → `subjects.subject_id`, `department_name` → `departments.department_name`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.subjects FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `admin_write_subjects` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_subjects` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `system_backup_mode`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | boolean | NO | true |
| `active` | boolean | NO | false |
| `started_at` | timestamp with time zone | YES |  |
| `started_by` | uuid | YES |  |
| `expires_at` | timestamp with time zone | YES |  |
| `reason` | text | YES |  |
| `run_reference` | text | YES |  |
| `updated_at` | timestamp with time zone | NO | now() |

Foreign keys: `started_by` → `profiles.id`

RLS policies:
- `read_backup_mode` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `system_settings`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | boolean | NO | true |
| `parent_emails_paused` | boolean | NO | false |
| `parent_emails_paused_note` | text | YES |  |
| `updated_at` | timestamp with time zone | NO | now() |
| `tuckshop_ordering_closed_until` | date | YES |  |
| `tuckshop_ordering_closed_note` | text | YES |  |
| `detention_room` | text | NO | 'CG4'::text |
| `detention_time` | text | NO | 'after lesson 7'::text |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.system_settings FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `system_settings editable by admin` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `system_settings readable by all authenticated` (SELECT) USING ((auth.role() = 'authenticated'::text))


### `target_grades`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `subject_id` 🔑 | integer | NO |  |
| `target_grade` | text | NO |  |
| `is_demo` | boolean | NO | false |

Foreign keys: `student_id` → `students.student_id`, `subject_id` → `subjects.subject_id`, `target_grade` → `grade_scale.grade`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.target_grades FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_grade_change`: `CREATE TRIGGER trg_log_grade_change AFTER INSERT OR DELETE OR UPDATE ON public.target_grades FOR EACH ROW EXECUTE FUNCTION log_grade_change()`

RLS policies:
- `assessment_delete_target_grades` (DELETE) USING ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `assessment_insert_target_grades` (INSERT) WITH CHECK ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `assessment_update_target_grades` (UPDATE) USING ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `assessment_user_insert_target_grades` (INSERT) WITH CHECK (has_staff_role(ARRAY['assessment_user'::text]))
- `assessment_user_update_target_grades` (UPDATE) USING (has_staff_role(ARRAY['assessment_user'::text]))
- `parent_read_own_target_grades` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = target_grades.student_id)))))
- `read_all_target_grades` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_own_target_grades` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = target_grades.student_id)))))


### `terms`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `term_id` 🔑 | integer | NO | nextval('terms_term_id_seq'::regclass) |
| `term_name` | text | NO |  |
| `start_date` | date | NO |  |
| `end_date` | date | NO |  |
| `academic_year_id` | integer | YES |  |

Foreign keys: `academic_year_id` → `academic_years.academic_year_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.terms FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_fill_term_academic_year`: `CREATE TRIGGER trg_fill_term_academic_year BEFORE INSERT OR UPDATE OF start_date, academic_year_id ON public.terms FOR EACH ROW EXECUTE FUNCTION fill_term_academic_year()`

RLS policies:
- `admin_write_terms` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_terms` (SELECT) USING ((auth.role() = 'authenticated'::text))
- `smt_insert_terms` (INSERT) WITH CHECK (user_has_staff_role(ARRAY['smt'::text]))
- `smt_update_terms` (UPDATE) USING (user_has_staff_role(ARRAY['smt'::text])) WITH CHECK (user_has_staff_role(ARRAY['smt'::text]))


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
| `staff_id` | integer | YES |  |
| `room` | text | YES |  |

Foreign keys: `class_id` → `classes.class_id`, `staff_id` → `staff.staff_id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.timetable_slots FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `timetable_slots_take_bell_time`: `CREATE TRIGGER timetable_slots_take_bell_time BEFORE INSERT ON public.timetable_slots FOR EACH ROW EXECUTE FUNCTION timetable_slot_takes_bell_time()`

RLS policies:
- `admin_write_timetable_slots` (ALL) USING (is_admin()) WITH CHECK (is_admin())
- `read_all_timetable_slots` (SELECT) USING (((auth.role() = 'authenticated'::text) AND ((is_demo = is_demo_account()) OR is_admin())))


### `transcript_grades`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `student_id` 🔑 | integer | NO |  |
| `subject_id` 🔑 | integer | NO |  |
| `year_group` 🔑 | smallint | NO |  |
| `term_number` 🔑 | smallint | NO |  |
| `grade` | text | NO |  |
| `is_demo` | boolean | NO | false |
| `updated_at` | timestamp with time zone | NO | now() |
| `updated_by` | uuid | YES |  |

Foreign keys: `student_id` → `students.student_id`, `subject_id` → `subjects.subject_id`, `grade` → `grade_scale.grade`, `updated_by` → `profiles.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.transcript_grades FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_log_grade_change`: `CREATE TRIGGER trg_log_grade_change AFTER INSERT OR DELETE OR UPDATE ON public.transcript_grades FOR EACH ROW EXECUTE FUNCTION log_grade_change()`
- `trg_set_is_demo`: `CREATE TRIGGER trg_set_is_demo BEFORE INSERT ON public.transcript_grades FOR EACH ROW EXECUTE FUNCTION set_is_demo()`

RLS policies:
- `assessment_delete_transcript_grades` (DELETE) USING ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `assessment_insert_transcript_grades` (INSERT) WITH CHECK ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `assessment_update_transcript_grades` (UPDATE) USING ((is_assessment_manager() AND (is_demo = is_demo_account())))
- `parent_read_own_transcript_grades` (SELECT) USING ((EXISTS ( SELECT 1
   FROM (profiles p
     JOIN student_parent sp ON ((sp.parent_id = p.parent_id)))
  WHERE ((p.id = auth.uid()) AND (sp.student_id = transcript_grades.student_id)))))
- `read_all_transcript_grades` (SELECT) USING ((is_staff_or_admin() AND ((is_demo = is_demo_account()) OR is_admin())))
- `student_read_own_transcript_grades` (SELECT) USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.student_id = transcript_grades.student_id)))))


### `tuckshop_handout_saves`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `for_date` | date | NO |  |
| `restaurant` | text | NO | ''::text |
| `given_count` | integer | NO |  |
| `not_given_count` | integer | NO |  |
| `given_value` | numeric | NO |  |
| `saved_at` | timestamp with time zone | NO | now() |
| `saved_by` | uuid | YES |  |
| `unlocked_at` | timestamp with time zone | YES |  |
| `unlocked_by` | uuid | YES |  |

Foreign keys: `saved_by` → `users.id`, `unlocked_by` → `users.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_handout_saves FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_stamp_saved_by`: `CREATE TRIGGER trg_stamp_saved_by BEFORE INSERT ON public.tuckshop_handout_saves FOR EACH ROW EXECUTE FUNCTION stamp_actor('saved_by')`
- `trg_stamp_unlocked_by`: `CREATE TRIGGER trg_stamp_unlocked_by BEFORE UPDATE OF unlocked_at ON public.tuckshop_handout_saves FOR EACH ROW EXECUTE FUNCTION stamp_actor('unlocked_by')`

RLS policies:
- `Tuckshop staff read hand-out saves` (SELECT) USING (has_staff_role(ARRAY['tuckshop'::text, 'tuckshop_owner'::text]))


### `tuckshop_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_items_id_seq'::regclass) |
| `name` | text | NO |  |
| `price` | numeric | NO |  |
| `active` | boolean | NO | true |
| `created_at` | timestamp with time zone | YES | now() |
| `is_food` | boolean | NO | false |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Tuckshop items readable by all authenticated` (SELECT) USING (true)
- `Tuckshop items writable by tuckshop staff` (ALL) USING (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))


### `tuckshop_order_schedule`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `service_dow` 🔑 | smallint | NO |  |
| `opens_dow` | smallint | NO |  |
| `opens_time` | time without time zone | NO |  |
| `closes_dow` | smallint | NO |  |
| `closes_time` | time without time zone | NO |  |
| `updated_at` | timestamp with time zone | NO | now() |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_order_schedule FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Tuckshop schedule readable by all authenticated` (SELECT) USING (true)
- `Tuckshop schedule writable by tuckshop staff` (ALL) USING ((is_admin() OR user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))) WITH CHECK ((is_admin() OR user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])))


### `tuckshop_preorder_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_preorder_items_id_seq'::regclass) |
| `preorder_id` | bigint | NO |  |
| `tuckshop_item_id` | bigint | NO |  |
| `quantity` | integer | NO |  |

Foreign keys: `preorder_id` → `tuckshop_preorders.id`, `tuckshop_item_id` → `tuckshop_items.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_preorder_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Tuckshop preorder items readable by staff or own family` (SELECT) USING ((preorder_id IN ( SELECT tuckshop_preorders.id
   FROM tuckshop_preorders
  WHERE can_view_student_tuckshop(tuckshop_preorders.student_id))))


### `tuckshop_preorder_trim_backup_180`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `line_id` | bigint | YES |  |
| `preorder_id` | bigint | YES |  |
| `tuckshop_item_id` | bigint | YES |  |
| `original_quantity` | integer | YES |  |
| `student_id` | integer | YES |  |
| `for_date` | date | YES |  |
| `order_created_at` | timestamp with time zone | YES |  |
| `backed_up_at` | timestamp with time zone | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_preorder_trim_backup_180 FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`


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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_preorders FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Tuckshop preorders readable by staff or own family` (SELECT) USING (can_view_student_tuckshop(student_id))


### `tuckshop_purchase_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO | nextval('tuckshop_purchase_items_id_seq'::regclass) |
| `purchase_id` | bigint | NO |  |
| `tuckshop_item_id` | bigint | NO |  |
| `quantity` | integer | NO |  |
| `unit_price` | integer | NO |  |
| `line_total` | numeric | NO |  |

Foreign keys: `purchase_id` → `tuckshop_purchases.id`, `tuckshop_item_id` → `tuckshop_items.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_purchase_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Tuckshop purchase items readable by staff or own family` (SELECT) USING ((purchase_id IN ( SELECT tuckshop_purchases.id
   FROM tuckshop_purchases
  WHERE can_view_student_tuckshop(tuckshop_purchases.student_id))))
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

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_purchases FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_stamp_created_by`: `CREATE TRIGGER trg_stamp_created_by BEFORE INSERT ON public.tuckshop_purchases FOR EACH ROW EXECUTE FUNCTION stamp_actor('created_by')`

RLS policies:
- `Tuckshop purchases readable by staff or own family` (SELECT) USING (can_view_student_tuckshop(student_id))
- `Tuckshop purchases writable by tuckshop staff` (ALL) USING (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])) WITH CHECK (user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))


### `tuckshop_special_session_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `session_id` 🔑 | bigint | NO |  |
| `tuckshop_item_id` 🔑 | bigint | NO |  |

Foreign keys: `session_id` → `tuckshop_special_sessions.id`, `tuckshop_item_id` → `tuckshop_items.id`

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_special_session_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`

RLS policies:
- `Special tuckshop session items readable by all authenticated` (SELECT) USING (true)
- `Special tuckshop session items writable by tuckshop staff` (ALL) USING ((is_admin() OR user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))) WITH CHECK ((is_admin() OR user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])))


### `tuckshop_special_sessions`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` 🔑 | bigint | NO |  |
| `name` | text | NO |  |
| `for_date` | date | NO |  |
| `opens_at` | timestamp with time zone | NO |  |
| `closes_at` | timestamp with time zone | NO |  |
| `created_at` | timestamp with time zone | NO | now() |
| `created_by` | uuid | YES | auth.uid() |
| `max_per_item` | smallint | NO | 2 |
| `max_food` | smallint | NO | 2 |
| `max_other` | smallint | YES |  |

Triggers:
- `a_backup_mode_guard`: `CREATE TRIGGER a_backup_mode_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tuckshop_special_sessions FOR EACH STATEMENT EXECUTE FUNCTION enforce_backup_mode()`
- `trg_stamp_created_by`: `CREATE TRIGGER trg_stamp_created_by BEFORE INSERT ON public.tuckshop_special_sessions FOR EACH ROW EXECUTE FUNCTION stamp_actor('created_by')`

RLS policies:
- `Special tuckshop sessions readable by all authenticated` (SELECT) USING (true)
- `Special tuckshop sessions writable by tuckshop staff` (ALL) USING ((is_admin() OR user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text]))) WITH CHECK ((is_admin() OR user_has_staff_role(ARRAY['tuckshop'::text, 'bursar'::text])))


## Functions (205)

Full definitions. `SECURITY DEFINER` functions run with the privileges of the function owner regardless of caller — check the body for its own permission checks (e.g. `is_admin()`, `user_has_staff_role(...)`) rather than assuming RLS protects them.

### `add_next_academic_year()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.add_next_academic_year()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_start_year integer;
  v_label text;
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can add academic years.';
  end if;
  select coalesce(max(extract(year from start_date)::int), extract(year from school_today())::int - 1) + 1
    into v_start_year from academic_years;
  v_label := v_start_year || '/' || lpad(((v_start_year + 1) % 100)::text, 2, '0');
  if exists (select 1 from academic_years where end_date >= make_date(v_start_year, 9, 1)) then
    raise exception 'The latest year ends after 1 September %; correct its dates first.', v_start_year;
  end if;
  insert into academic_years (label, start_date, end_date, status)
  values (v_label, make_date(v_start_year, 9, 1), make_date(v_start_year + 1, 8, 31), 'planning');
  return v_label;
end;
$function$

```

### `add_tuckshop_top_up_from_payment(p_payment_id bigint, p_amount numeric)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.add_tuckshop_top_up_from_payment(p_payment_id bigint, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p fee_payments;
  v_student_id integer;
  v_item_id bigint;
  v_used numeric;
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can add tuckshop top-ups.';
  end if;

  select * into p from fee_payments where id = p_payment_id for update;
  if p.id is null then
    raise exception 'Payment not found.';
  end if;

  select si.student_id into v_student_id
  from student_invoices si
  join students s on s.student_id = si.student_id
  where si.id = p.invoice_id and s.status = 'active';
  if v_student_id is null then
    raise exception 'That payment isn''t for a student currently at the school.';
  end if;

  select coalesce(sum(amount), 0) into v_used
  from invoice_line_items where from_payment_id = p.id;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount to add (more than zero).';
  end if;
  if v_used + p_amount > p.amount then
    raise exception 'Only NGN % of this payment is left to add to the tuckshop.', p.amount - v_used;
  end if;

  select id into v_item_id from fee_items where name = 'Tuck Shop Recharge' and category = 'Tuckshop';
  if v_item_id is null then
    raise exception 'No "Tuck Shop Recharge" fee item found.';
  end if;

  insert into invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, added_by, from_payment_id)
  values (
    p.invoice_id, v_item_id,
    'Tuck shop top-up (paid ' || to_char(p.paid_date, 'DD Mon YYYY')
      || coalesce(', ' || nullif(btrim(p.reference), ''), '') || ')',
    p_amount, true, auth.uid(), p.id
  );

  return get_tuckshop_balance(v_student_id);
end;
$function$

```

### `admission_fee_list(p_academic_year_id integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.admission_fee_list(p_academic_year_id integer)
 RETURNS TABLE(applicant_id bigint, child_name text, entry_year_group integer, status text, contact_name text, contact_phone text, contact_email text, form_fee_paid_on date, form_fee_amount numeric, form_fee_receipt text, accepted_at timestamp with time zone, deposit_paid_on date, deposit_amount numeric, deposit_receipt text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not (user_has_staff_role(array['bursar']) or has_resource_access('/admissions')) then
    raise exception 'Only the bursar and admissions staff can see admission payments.';
  end if;
  return query
  select a.applicant_id,
         concat_ws(' ', a.first_name, a.last_name),
         a.entry_year_group, a.status,
         c.name, c.phone, c.email,
         a.form_fee_paid_on, a.form_fee_amount, a.form_fee_receipt,
         a.accepted_at,
         a.deposit_paid_on, a.deposit_amount, a.deposit_receipt
    from applicants a
    left join lateral (
      select * from applicant_contacts ac
       where ac.applicant_id = a.applicant_id
       order by ac.is_primary desc, ac.contact_id limit 1) c on true
   where a.entry_academic_year_id = p_academic_year_id
   order by a.last_name, a.first_name;
end;
$function$

```

### `advance_applicant_on_results()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.advance_applicant_on_results()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id bigint := new.applicant_id;
begin
  if tg_table_name = 'applicant_interviews' then
    update applicants set status = 'interviewed'
     where applicant_id = v_id and status = 'invited_to_interview';
  elsif exists (select 1 from applicant_test_summary s where s.applicant_id = v_id and s.complete) then
    update applicants set status = 'tested'
     where applicant_id = v_id and status = 'test_booked';
  end if;
  return new;
end;
$function$

```

### `applicants_guard()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.applicants_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- The functions below run as their owner, and the SQL editor as postgres;
  -- only requests from the app arrive as 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'enquiry'
       or new.form_fee_paid_on is not null or new.form_fee_amount is not null
       or new.form_fee_receipt is not null or new.form_fee_recorded_by is not null
       or new.session_id is not null or new.interview_at is not null
       or new.decided_by is not null or new.decided_at is not null or new.decision_notes is not null
       or new.accepted_at is not null
       or new.deposit_paid_on is not null or new.deposit_amount is not null
       or new.deposit_receipt is not null or new.deposit_recorded_by is not null
       or new.withdrawn_reason is not null or new.student_id is not null then
      raise exception 'A new application starts as an enquiry, with nothing paid, booked or decided.';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.form_fee_paid_on is distinct from old.form_fee_paid_on
     or new.form_fee_amount is distinct from old.form_fee_amount
     or new.form_fee_receipt is distinct from old.form_fee_receipt
     or new.form_fee_recorded_by is distinct from old.form_fee_recorded_by
     or new.session_id is distinct from old.session_id
     or new.interview_at is distinct from old.interview_at
     or new.decision_notes is distinct from old.decision_notes
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.accepted_at is distinct from old.accepted_at
     or new.deposit_paid_on is distinct from old.deposit_paid_on
     or new.deposit_amount is distinct from old.deposit_amount
     or new.deposit_receipt is distinct from old.deposit_receipt
     or new.deposit_recorded_by is distinct from old.deposit_recorded_by
     or new.withdrawn_reason is distinct from old.withdrawn_reason
     or new.student_id is distinct from old.student_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.entry_academic_year_id is distinct from old.entry_academic_year_id and old.status <> 'enquiry'
     or new.entry_year_group is distinct from old.entry_year_group and old.session_id is not null then
    raise exception 'Status, test date, fees, deposit and decisions are changed with the buttons on the applicant''s page, not by editing the record.';
  end if;
  return new;
end;
$function$

```

### `apply_bell_time()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.apply_bell_time()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  update timetable_slots
     set start_time = new.start_time,
         end_time   = new.end_time
   where day_of_week = new.day_of_week
     and period_number = new.period_number
     and (start_time, end_time) is distinct from (new.start_time, new.end_time);
  return new;
end;
$function$

```

### `apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid)
 RETURNS TABLE(batch_id bigint, students_charged integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_batch_id bigint;
  v_student_id integer;
  v_invoice_id bigint;
  v_count integer := 0;
begin
  if is_demo_account() then
    raise exception 'Fee charges are disabled for the training account.';
  end if;

  if not user_has_staff_role(array['bursar', 'smt']) then
    raise exception 'Only bursar/SMT can apply fee charges';
  end if;

  if p_target_type not in ('individual', 'form_class', 'year_group', 'all') then
    raise exception 'Invalid target_type: %', p_target_type;
  end if;

  insert into fee_charge_batches (fee_item_id, term_id, description, amount, target_type, target_value, created_by)
  values (p_fee_item_id, p_term_id, p_description, p_amount, p_target_type, p_target_value, p_created_by)
  returning id into v_batch_id;

  for v_student_id in
    select s.student_id from students s
    where s.status = 'active'
      and (
        (p_target_type = 'individual' and s.student_id = p_target_value::integer)
        or (p_target_type = 'form_class' and s.form_class = p_target_value)
        or (p_target_type = 'year_group' and s.year_group = p_target_value::integer)
        or (p_target_type = 'all')
      )
  loop
    insert into student_invoices (student_id, term_id)
    values (v_student_id, p_term_id)
    on conflict (student_id, term_id) do nothing;

    select id into v_invoice_id from student_invoices
    where student_id = v_student_id and term_id = p_term_id;

    insert into invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, batch_id, added_by)
    values (v_invoice_id, p_fee_item_id, p_description, p_amount, true, v_batch_id, p_created_by);

    v_count := v_count + 1;
  end loop;

  return query select v_batch_id, v_count;
end;
$function$

```

### `apply_student_discount(p_student_discount_id bigint, p_term_id bigint, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.apply_student_discount(p_student_discount_id bigint, p_term_id bigint, p_created_by uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

### `approve_fee_price_change(p_id bigint)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.approve_fee_price_change(p_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c fee_price_changes;
  v_principal boolean := holds_staff_role('principal');
  v_secretary boolean := holds_staff_role('college_secretary');
  v_yg integer;
  v_amount numeric;
begin
  if not (v_principal or v_secretary) then
    raise exception 'Only the principal and the college secretary can approve fee prices.';
  end if;
  select * into c from fee_price_changes where id = p_id for update;
  if c.id is null then
    raise exception 'Not found.';
  end if;
  if c.status <> 'pending' then
    raise exception 'This change is already %.', c.status;
  end if;
  if auth.uid() in (c.principal_approved_by, c.secretary_approved_by) then
    raise exception 'You have already approved this. It needs the other approver.';
  end if;

  if v_principal and c.principal_approved_by is null then
    update fee_price_changes set principal_approved_by = auth.uid(), principal_approved_at = now() where id = p_id;
  elsif v_secretary and c.secretary_approved_by is null then
    update fee_price_changes set secretary_approved_by = auth.uid(), secretary_approved_at = now() where id = p_id;
  else
    raise exception 'Your approval is already in; it needs the other approver.';
  end if;

  select * into c from fee_price_changes where id = p_id;
  if c.principal_approved_by is null or c.secretary_approved_by is null then
    return 'waiting';
  end if;

  if c.kind = 'admission_fees' then
    update academic_years
       set admission_form_fee = (c.new_values->>'form_fee')::numeric,
           admission_deposit = (c.new_values->>'deposit')::numeric
     where academic_year_id = c.academic_year_id;
  elsif c.kind = 'fee_item' then
    update fee_items set default_amount = (c.new_values->>'amount')::numeric where id = c.fee_item_id;
  else
    for v_yg in 7..12 loop
      v_amount := (c.new_values->>v_yg::text)::numeric;
      if v_amount is null then
        delete from fee_item_year_prices where fee_item_id = c.fee_item_id and year_group = v_yg;
      else
        insert into fee_item_year_prices (fee_item_id, year_group, amount, approved_change_id)
        values (c.fee_item_id, v_yg, v_amount, c.id)
        on conflict (fee_item_id, year_group)
        do update set amount = excluded.amount, approved_change_id = excluded.approved_change_id;
      end if;
    end loop;
  end if;
  update fee_price_changes set status = 'approved', closed_at = now() where id = p_id;
  return 'applied';
end;
$function$

```

### `assign_admission_number()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.assign_admission_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  candidate text;
begin
  if new.admission_number is not null and btrim(new.admission_number) <> '' then
    new.admission_number := btrim(new.admission_number);
    return new;
  end if;

  if tg_op = 'UPDATE' and old.admission_number is not null then
    new.admission_number := old.admission_number;
    return new;
  end if;

  loop
    candidate := lpad(nextval('public.students_admission_number_seq')::text, 6, '0');
    exit when not exists (select 1 from public.students where admission_number = candidate);
  end loop;
  new.admission_number := candidate;
  return new;
end;
$function$

```

### `attach_backup_mode_guard(p_table text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.attach_backup_mode_guard(p_table text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_table = 'system_backup_mode' then
    return;
  end if;
  execute format(
    'drop trigger if exists a_backup_mode_guard on public.%I', p_table);
  execute format(
    'create trigger a_backup_mode_guard before insert or update or delete '
    'on public.%I for each statement execute function public.enforce_backup_mode()',
    p_table);
end;
$function$

```

### `auto_set_student_status()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.auto_set_student_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.leaving_date IS NOT NULL AND NEW.leaving_date <= CURRENT_DATE THEN
        NEW.status := 'left';
    END IF;
    RETURN NEW;
END;
$function$

```

### `bell_time_not_in_use()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.bell_time_not_in_use()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  n integer;
begin
  select count(*) into n
    from timetable_slots
   where day_of_week = old.day_of_week and period_number = old.period_number;
  if n > 0 then
    raise exception '% class lesson(s) are still timetabled on % in period %; move them before taking this lesson off the day',
      n, old.day_of_week, old.period_number;
  end if;
  return old;
end;
$function$

```

### `bmi_for_age_z(p_sex text, p_age_months integer, p_bmi numeric)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.bmi_for_age_z(p_sex text, p_age_months integer, p_bmi numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Standard LMS transform: z = ((BMI/M)^L - 1) / (L*S), or ln(BMI/M)/S
  -- when L is zero.
  select case
           when r.l = 0 then round(ln(p_bmi / r.m) / r.s, 2)
           else round((power(p_bmi / r.m, r.l) - 1) / (r.l * r.s), 2)
         end
  from bmi_for_age_reference r
  where r.sex = lower(p_sex)
    and r.age_months = p_age_months
    and p_bmi is not null
    and p_bmi > 0;
$function$

```

### `book_admission_test(p_applicant_id bigint, p_session_id integer, p_send_email boolean DEFAULT true)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.book_admission_test(p_applicant_id bigint, p_session_id integer, p_send_email boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a applicants;
  s admission_sessions;
begin
  if not has_resource_access('/admissions') then
    raise exception 'Only admissions staff can book test dates.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  select * into s from admission_sessions where session_id = p_session_id;
  if a.applicant_id is null or s.session_id is null then
    raise exception 'Applicant or test day not found.';
  end if;
  if a.status not in ('form_paid', 'test_booked') then
    raise exception 'A test date can only be fixed once the admission form is paid for, and before the test has been sat (status now: %).', a.status;
  end if;
  if s.academic_year_id <> a.entry_academic_year_id then
    raise exception 'That test day is for a different entry year.';
  end if;

  update applicants set session_id = p_session_id, status = 'test_booked'
   where applicant_id = p_applicant_id;

  return jsonb_build_object('status', 'test_booked')
         || issue_admission_letter(p_applicant_id, 'test_date', p_send_email);
end;
$function$

```

### `calendar_feed_events(p_token text)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.calendar_feed_events(p_token text)
 RETURNS TABLE(event_id integer, event_date date, event_name text, category text, year_group_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select e.event_id, e.event_date, e.event_name, e.category, e.year_group_note
  from calendar_events e
  where exists (
      select 1
      from parent_calendar_feeds f
      join student_parent sp on sp.parent_id = f.parent_id
      join students s on s.student_id = sp.student_id
      where f.token = p_token
        and s.status = 'active'
    )
    and e.category not in ('teacher_assessment', 'report_period')
    and e.event_date >= coalesce(
      (select y.start_date from academic_years y where y.status = 'current'),
      current_date - 365)
  order by e.event_date, e.event_id;
$function$

```

### `can_allocate_classes()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_allocate_classes()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT is_admin() OR has_staff_role(ARRAY['head_of_department', 'pastoral']);
$function$

```

### `can_delete_result(p_student_id integer, p_subject_id integer)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_delete_result(p_student_id integer, p_subject_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select is_assessment_manager()
    or teaches_student_for_subject(p_student_id, p_subject_id)
    or exists (
      select 1
      from profiles p
      join staff_roles sr on sr.staff_id = p.staff_id
      join subjects s on s.department_name = sr.scope_value
      where p.id = auth.uid()
        and sr.role_name = 'head_of_department'
        and sr.scope_type = 'department'
        and s.subject_id = p_subject_id
    );
$function$

```

### `can_edit_any_student_field()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_edit_any_student_field()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select cardinality(my_editable_student_fields()) > 0;
$function$

```

### `can_edit_next_year()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_edit_next_year()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select has_resource_access('/admin/next-year') or has_resource_access('/admin/import-classes');
$function$

```

### `can_manage_other_half()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_manage_other_half()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ select user_has_staff_role(array['smt', 'other_half']); $function$

```

### `can_manage_staff_hr()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_manage_staff_hr()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select user_has_staff_role(array['hr']);
$function$

```

### `can_propose_fee_prices()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_propose_fee_prices()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select user_has_staff_role(array['bursar', 'smt', 'principal', 'college_secretary'])
      or has_resource_access('/admin/lookups');
$function$

```

### `can_read_staff_hr()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_read_staff_hr()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select user_has_staff_role(array['hr', 'smt']);
$function$

```

### `can_view_student_tuckshop(p_student_id integer)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.can_view_student_tuckshop(p_student_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    user_has_staff_role(array['tuckshop', 'bursar', 'smt'])
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.student_id = p_student_id)
    or p_student_id in (select my_current_child_ids());
$function$

```

### `cancel_fee_price_change(p_id bigint)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.cancel_fee_price_change(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update fee_price_changes
     set status = 'cancelled', closed_by = auth.uid(), closed_at = now()
   where id = p_id and status = 'pending'
     and (requested_by = auth.uid() or holds_staff_role('principal') or holds_staff_role('college_secretary'));
  if not found then
    raise exception 'Only whoever proposed it (or an approver) can cancel a change still waiting for approval.';
  end if;
end;
$function$

```

### `capture_register_alerts()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.capture_register_alerts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into register_alerts (timetable_slot_id, staff_id, period_date, minutes_late, resolved, is_demo)
  select rnd.slot_id, rnd.staff_id, school_today(), round(rnd.minutes_since_start), false, ts.is_demo
    from registers_not_done rnd
    join timetable_slots ts on ts.slot_id = rnd.slot_id
   where not exists (
     select 1 from register_alerts ra
      where ra.timetable_slot_id = rnd.slot_id and ra.period_date = school_today()
   );

  insert into register_alerts (other_half_activity_id, staff_id, period_date, minutes_late, resolved, is_demo)
  select rnd.other_half_activity_id, sid, school_today(), round(rnd.minutes_since_start), false, false
    from registers_not_done rnd
   cross join lateral unnest(rnd.staff_ids) as sid
   where rnd.other_half_activity_id is not null
     and not exists (
       select 1 from register_alerts ra
        where ra.other_half_activity_id = rnd.other_half_activity_id
          and ra.staff_id = sid
          and ra.period_date = school_today()
     );
end;
$function$

```

### `change_history_is_append_only()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.change_history_is_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'change_history is a permanent record: rows cannot be changed or deleted'
    using errcode = 'insufficient_privilege';
end;
$function$

```

### `check_admission_score_paper()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.check_admission_score_paper()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ok boolean;
  v_max numeric;
begin
  select (p.academic_year_id = a.entry_academic_year_id and p.year_group = a.entry_year_group), p.max_score
    into v_ok, v_max
    from admission_papers p, applicants a
   where p.paper_id = new.paper_id and a.applicant_id = new.applicant_id;
  if not coalesce(v_ok, false) then
    raise exception 'That paper is not the one for this applicant''s entry year and year group.';
  end if;
  if new.score > v_max then
    raise exception 'A score of % is more than the paper''s maximum of %.', new.score, v_max;
  end if;
  return new;
end;
$function$

```

### `check_student_field_edit()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.check_student_field_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  allowed text[];
  blocked text[];
begin
  if current_user <> 'authenticated' or is_admin() then
    return new;
  end if;

  allowed := my_editable_student_fields();
  select array_agg(f order by f) into blocked
  from unnest(student_core_fields()) f
  where (n -> f) is distinct from (o -> f)
    and not (f = any (allowed));

  if blocked is not null then
    raise exception 'You do not have permission to change: %. Ask an admin to grant it at /admin/permissions.',
      array_to_string(blocked, ', ')
      using errcode = 'insufficient_privilege';
  end if;

  if not user_has_staff_role(array['school_office'])
     and (n - student_core_fields()) is distinct from (o - student_core_fields()) then
    raise exception 'You can only change the student fields your role has been given at /admin/permissions.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$function$

```

### `choose_other_half_activity(p_activity_id bigint)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.choose_other_half_activity(p_activity_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student integer;
  v_year integer;
  a other_half_activities%rowtype;
  n integer;
begin
  select student_id into v_student
    from profiles where id = auth.uid() and role = 'student';
  if v_student is null then
    raise exception 'Only a student account can choose an Other Half activity';
  end if;
  if not in_evening_prep() then
    raise exception 'You can only change your Other Half choices during Evening Prep';
  end if;

  -- Locking the activity row serialises everyone choosing it at once, so
  -- the capacity count below can't be raced past.
  select * into a from other_half_activities where activity_id = p_activity_id for update;
  if not found or not a.is_active then
    raise exception 'That activity is not available';
  end if;
  if not other_half_choices_open(a.term_id) then
    raise exception 'Other Half choices are closed';
  end if;

  select year_group into v_year from students where student_id = v_student and status = 'active';
  if v_year is null or not (v_year = any (a.year_groups)) then
    raise exception 'That activity is not open to your year group';
  end if;

  if a.capacity is not null then
    select count(*) into n from other_half_choices
     where activity_id = a.activity_id and student_id <> v_student;
    if n >= a.capacity then
      raise exception 'Sorry, % is full', a.activity_name;
    end if;
  end if;

  insert into other_half_choices (student_id, activity_id, chosen_by)
  values (v_student, a.activity_id, auth.uid())
  on conflict (student_id, term_id, day_of_week)
  do update set activity_id = excluded.activity_id,
                chosen_at = now(),
                chosen_by = excluded.chosen_by;
end;
$function$

```

### `clear_minutes_late_unless_late()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.clear_minutes_late_unless_late()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status is distinct from 'late' then
    new.minutes_late := null;
  end if;
  return new;
end;
$function$

```

### `clear_must_change_password()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.clear_must_change_password()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update profiles set must_change_password = false where id = auth.uid();
end;
$function$

```

### `confirm_mentor_structure(p_academic_year_id integer, p_confirmed boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.confirm_mentor_structure(p_academic_year_id integer, p_confirmed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not has_resource_access('/admin/next-year') then
    raise exception 'Only staff with Next Year Setup can confirm the mentor structure.';
  end if;
  if not exists (select 1 from academic_years where academic_year_id = p_academic_year_id and status = 'planning') then
    raise exception 'Only a year being planned can be set up.';
  end if;
  if p_confirmed and not exists (select 1 from plan_mentor_groups where academic_year_id = p_academic_year_id) then
    raise exception 'Add next year''s mentor groups first.';
  end if;
  update academic_years
     set mentor_structure_confirmed_at = case when p_confirmed then now() end,
         mentor_structure_confirmed_by = case when p_confirmed then auth.uid() end
   where academic_year_id = p_academic_year_id;
end;
$function$

```

### `create_parent_login(p_parent_id integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.create_parent_login(p_parent_id integer)
 RETURNS TABLE(login_email text, temp_password text, emailed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  rec record;
  v_email text;
  new_password text;
  new_user_id uuid;
begin
  if not user_has_staff_role(array['school_office']) then
    raise exception 'Only the school office or admin can create parent logins'
      using errcode = 'insufficient_privilege';
  end if;

  select p.parent_id, p.first_name, p.last_name, p.email
    into rec
    from parents p
   where p.parent_id = p_parent_id
     for update;

  if not found then
    raise exception 'Parent not found';
  end if;

  v_email := lower(trim(rec.email));
  if v_email is null or v_email = '' then
    raise exception 'Add an email address for this parent first — it becomes their login.';
  end if;

  if exists (select 1 from profiles pr where pr.parent_id = p_parent_id) then
    raise exception 'This parent already has a portal login.';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'The email % already belongs to another login (often a shared family email). Give this parent their own email address to create a separate login.', v_email;
  end if;

  new_password := substr(md5(random()::text), 1, 10);
  new_user_id := gen_random_uuid();
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', v_email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
  exception when unique_violation then
    raise exception 'The email % already belongs to another login.', v_email;
  end;
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', v_email), 'email', now(), now(), now());
  insert into profiles (id, role, parent_id) values (new_user_id, 'parent', p_parent_id)
    on conflict (id) do update set role = 'parent', parent_id = p_parent_id;

  login_email := v_email;
  if parent_emails_paused() then
    temp_password := new_password;
    emailed := false;
  else
    perform parent_welcome_email_post(v_email, trim(coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '')), new_password);
    insert into parent_welcome_sends (parent_id, email) values (p_parent_id, v_email)
      on conflict (parent_id) do nothing;
    temp_password := null;
    emailed := true;
  end if;
  return next;
end;
$function$

```

### `create_parent_logins(only_email text DEFAULT NULL::text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.create_parent_logins(only_email text DEFAULT NULL::text)
 RETURNS TABLE(parent_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admin can create parent logins';
  end if;

  for rec in
    select p.parent_id, p.first_name, p.last_name, p.email
    from parents p
    where p.email is not null
      and (only_email is null or p.email = only_email)
      and not exists (select 1 from profiles pr where pr.parent_id = p.parent_id)
  loop
    begin
      new_password := coalesce(parent_first_password(rec.parent_id), substr(md5(random()::text), 1, 10));
      new_user_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      insert into profiles (id, role, parent_id, must_change_password) values (new_user_id, 'parent', rec.parent_id, true)
        on conflict (id) do update set role = 'parent', parent_id = rec.parent_id, must_change_password = true;
      parent_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      return next;
    exception when unique_violation then
      parent_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account, likely a shared family email)';
      return next;
    end;
  end loop;
end;
$function$

```

### `create_staff_logins(only_email text DEFAULT NULL::text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.create_staff_logins(only_email text DEFAULT NULL::text)
 RETURNS TABLE(staff_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can create staff logins';
  end if;

  for rec in
    select s.staff_id, s.first_name, s.last_name, s.email
    from staff s
    where s.email is not null
      and (only_email is null or s.email = only_email)
      and not exists (select 1 from profiles pr where pr.staff_id = s.staff_id)
  loop
    begin
      new_password := substr(md5(random()::text), 1, 10);
      new_user_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      insert into profiles (id, role, staff_id, email) values (new_user_id, 'staff', rec.staff_id, rec.email) on conflict (id) do update set role = 'staff', staff_id = rec.staff_id, email = rec.email;
      staff_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      return next;
    exception when unique_violation then
      staff_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account)';
      return next;
    end;
  end loop;
end;
$function$

```

### `create_student_logins(only_upn text DEFAULT NULL::text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.create_student_logins(only_upn text DEFAULT NULL::text)
 RETURNS TABLE(student_name text, upn text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can create student logins';
  end if;

  for rec in
    select s.student_id, s.first_name, s.last_name, s.upn, s.student_email
    from students s
    where s.student_email is not null
      and (only_upn is null or s.upn = only_upn)
      and not exists (select 1 from profiles p where p.student_id = s.student_id)
  loop
    new_password := substr(md5(random()::text), 1, 10);
    new_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
      rec.student_email, crypt(new_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), new_user_id, new_user_id::text,
      jsonb_build_object('sub', new_user_id::text, 'email', rec.student_email),
      'email', now(), now(), now()
    );

    insert into profiles (id, role, student_id)
    values (new_user_id, 'student', rec.student_id)
    on conflict (id) do update set role = 'student', student_id = rec.student_id;

    student_name := rec.first_name || ' ' || rec.last_name;
    upn := rec.upn;
    email := rec.student_email;
    temp_password := new_password;
    return next;
  end loop;
end;
$function$

```

### `current_other_half_term()` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.current_other_half_term()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ select term_id from terms where end_date >= school_today() order by start_date limit 1; $function$

```

### `default_admission_date()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.default_admission_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.admission_date is null then
    new.admission_date := school_today();
  end if;
  return new;
end;
$function$

```

### `delete_academic_year(p_academic_year_id integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.delete_academic_year(p_academic_year_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  y academic_years;
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can remove academic years.';
  end if;
  select * into y from academic_years where academic_year_id = p_academic_year_id;
  if y.academic_year_id is null then
    raise exception 'Academic year not found.';
  end if;
  if y.status <> 'planning' then
    raise exception 'Only a year still being planned can be removed.';
  end if;
  if exists (select 1 from applicants where entry_academic_year_id = p_academic_year_id)
     or exists (select 1 from admission_sessions where academic_year_id = p_academic_year_id)
     or exists (select 1 from admission_papers where academic_year_id = p_academic_year_id)
     or exists (select 1 from fee_price_changes where academic_year_id = p_academic_year_id)
     or exists (select 1 from terms where academic_year_id = p_academic_year_id) then
    raise exception '% already has applicants, test days, papers, fee changes or terms, so it can''t be removed.', y.label;
  end if;
  delete from academic_years where academic_year_id = p_academic_year_id;
end;
$function$

```

### `detention_reason(p_detention_id integer)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.detention_reason(p_detention_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when d.behaviour_event_id is null
    then 'reaching 10 or more negative behaviour points this week'
    else 'a serious behaviour event: ' || coalesce(e.category, 'negative event')
         || ' on ' || to_char(e.event_date, 'FMDay FMDD FMMonth')
  end
  from detentions d
  left join behaviour_events e on e.event_id = d.behaviour_event_id
  where d.detention_id = p_detention_id;
$function$

```

### `drop_other_half_choice(p_term_id integer, p_day_of_week text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.drop_other_half_choice(p_term_id integer, p_day_of_week text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student integer;
begin
  select student_id into v_student
    from profiles where id = auth.uid() and role = 'student';
  if v_student is null then
    raise exception 'Only a student account can change its own Other Half choice';
  end if;
  if not in_evening_prep() then
    raise exception 'You can only change your Other Half choices during Evening Prep';
  end if;
  if not other_half_choices_open(p_term_id) then
    raise exception 'Other Half choices are closed';
  end if;
  delete from other_half_choices
   where student_id = v_student and term_id = p_term_id and day_of_week = p_day_of_week;
end;
$function$

```

### `edit_behaviour_event(p_event_id integer, p_category text, p_description text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.edit_behaviour_event(p_event_id integer, p_category text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event behaviour_events%rowtype;
  v_my_staff_id integer;
  v_category text := coalesce(nullif(btrim(p_category), ''), null);
  v_description text := nullif(btrim(p_description), '');
  v_points integer;
  v_week_start date;
  v_friday date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_week_total integer;
  v_added integer := 0;
  v_cancelled integer := 0;
  v_n integer;
  r behaviour_rules;
begin
  select * into r from behaviour_rules where id;
  select * into v_event from behaviour_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;
  if v_event.voided_at is not null then
    raise exception 'This event was withdrawn on appeal and can no longer be edited.';
  end if;

  select staff_id into v_my_staff_id from profiles where id = auth.uid();
  if not (is_pastoral_or_smt()
          or has_staff_role(array['school_office'])
          or (v_my_staff_id is not null and v_my_staff_id = v_event.staff_id)) then
    raise exception 'Only the member of staff who logged this event, pastoral/SMT or the school office can edit it.'
      using errcode = 'insufficient_privilege';
  end if;

  v_category := coalesce(v_category, v_event.category);
  select default_points into v_points
  from behaviour_categories where name = v_category and type = v_event.type;
  if v_points is null then
    raise exception 'Choose a % behaviour category.', v_event.type;
  end if;
  if v_points <= r.serious_event_points and v_description is null then
    raise exception 'A serious event (% points or worse) needs an explanation of what happened.', r.serious_event_points;
  end if;

  if v_category is not distinct from v_event.category
     and v_description is not distinct from v_event.description then
    return jsonb_build_object('changed', false, 'detentions_added', 0, 'detentions_cancelled', 0);
  end if;

  update behaviour_events
  set category = v_category, points = v_points, description = v_description
  where event_id = p_event_id;

  insert into behaviour_event_audit (event_id, changed_by, old_values, new_values)
  values (p_event_id, auth.uid(),
          jsonb_build_object('category', v_event.category, 'points', v_event.points, 'description', v_event.description),
          jsonb_build_object('category', v_category, 'points', v_points, 'description', v_description));

  if v_event.type = 'negative' and v_points is distinct from v_event.points then
    v_week_start := v_event.event_date - ((extract(dow from v_event.event_date)::int - 6 + 7) % 7);
    v_friday := v_week_start + 6;

    if v_points <= r.detention_single_event_points then
      if v_friday >= v_today then
        update detentions set status = 'scheduled'
        where behaviour_event_id = p_event_id and status = 'cancelled';
        get diagnostics v_n = row_count;
        if v_n = 0 and not exists (select 1 from detentions where behaviour_event_id = p_event_id) then
          insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
          values (v_event.student_id, p_event_id, v_friday, 'scheduled', v_event.is_demo);
          v_n := 1;
        end if;
        v_added := v_added + v_n;
      end if;
    else
      update detentions set status = 'cancelled'
      where behaviour_event_id = p_event_id and status = 'scheduled';
      get diagnostics v_n = row_count;
      v_cancelled := v_cancelled + v_n;
    end if;

    select coalesce(sum(points), 0) into v_week_total
    from behaviour_events
    where student_id = v_event.student_id and type = 'negative' and voided_at is null
      and event_date between v_week_start and v_friday;

    if v_week_total <= r.detention_weekly_total_points then
      if v_friday >= v_today then
        update detentions set status = 'scheduled'
        where student_id = v_event.student_id and detention_date = v_friday
          and behaviour_event_id is null and status = 'cancelled';
        get diagnostics v_n = row_count;
        if v_n = 0 and not exists (
          select 1 from detentions
          where student_id = v_event.student_id and detention_date = v_friday and behaviour_event_id is null
        ) then
          insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
          values (v_event.student_id, null, v_friday, 'scheduled', v_event.is_demo);
          v_n := 1;
        end if;
        v_added := v_added + v_n;
      end if;
    else
      update detentions set status = 'cancelled'
      where student_id = v_event.student_id and detention_date = v_friday
        and behaviour_event_id is null and status = 'scheduled';
      get diagnostics v_n = row_count;
      v_cancelled := v_cancelled + v_n;
    end if;
  end if;

  return jsonb_build_object(
    'changed', true,
    'points', v_points,
    'detention_date', v_friday,
    'detentions_added', v_added,
    'detentions_cancelled', v_cancelled
  );
end;
$function$

```

### `edit_behaviour_event_comment(p_event_id integer, p_description text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.edit_behaviour_event_comment(p_event_id integer, p_description text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform edit_behaviour_event(p_event_id, null, p_description);
end;
$function$

```

### `email_log(p_limit integer DEFAULT 2000)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.email_log(p_limit integer DEFAULT 2000)
 RETURNS TABLE(email_id bigint, recipient text, subject text, status text, attempts integer, last_error text, created_at timestamp with time zone, sent_at timestamp with time zone, audience text, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select o.email_id, o.recipient, o.subject, o.status, o.attempts, o.last_error, o.created_at, o.sent_at,
         case
           when exists (select 1 from staff s where lower(s.email) = a.addr) then 'staff'
           when exists (select 1 from students s where lower(s.student_email) = a.addr) then 'students'
           when exists (select 1 from parents p where lower(p.email) = a.addr) then 'parents'
           else 'other'
         end as audience,
         case when position(':' in coalesce(o.subject, '')) > 0
           then split_part(o.subject, ':', 1)
           else coalesce(o.subject, '(no subject)')
         end as kind
  from email_outbox o
  cross join lateral (
    select lower(trim(split_part(split_part(coalesce(o.recipient, ''), ',', 1), ' (cc:', 1))) as addr
  ) a
  where is_admin() or user_has_staff_role(array['smt', 'pastoral', 'school_office'])
  order by o.created_at desc
  limit p_limit;
$function$

```

### `email_reply_smt_preview()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.email_reply_smt_preview()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not user_has_staff_role(array['smt']) then
    raise exception 'You do not have access to email reply settings.' using errcode = 'insufficient_privilege';
  end if;
  return smt_reply_to_addresses();
end;
$function$

```

### `email_reply_to(p_kind text)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.email_reply_to(p_kind text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(distinct a), '[]'::jsonb)
  from email_reply_routes r
  cross join lateral (
    select unnest(r.addresses) as a
    union all
    select lower(trim(st.email))
      from profiles me
      join staff st on st.staff_id = me.staff_id
     where r.reply_to_sender and me.id = auth.uid()
    union all
    select unnest(smt_reply_to_addresses()) where r.reply_to_smt
  ) x
  where r.email_kind = p_kind and is_plain_email(a);
$function$

```

### `end_backup_mode()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.end_backup_mode()
 RETURNS system_backup_mode
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result public.system_backup_mode;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can take the system out of backup mode.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.system_backup_mode
     set active     = false,
         expires_at = null,
         updated_at = now()
   where id
  returning * into result;

  return result;
end;
$function$

```

### `enforce_abc_domain_login()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.enforce_abc_domain_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A sign-in through Google (or any other outside provider) can only link
  -- to a login Formwork already made; it may never create one.
  if coalesce(new.raw_app_meta_data->>'provider', 'email') <> 'email' then
    raise exception 'formwork_no_account: % has no Formwork login', coalesce(new.email, 'this account')
      using errcode = 'insufficient_privilege';
  end if;

  if new.email is not null and new.email not ilike '%@abc.sch.ng' then
    new.banned_until := 'infinity';
  end if;
  return new;
end;
$function$

```

### `enforce_backup_mode()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.enforce_backup_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if session_user in ('postgres', 'supabase_admin') then
    return null;
  end if;

  if not public.is_backup_mode_active() then
    return null;
  end if;

  if exists (
    select 1 from public.system_backup_mode
     where id and started_by is not null and started_by = auth.uid()
  ) then
    return null;
  end if;

  raise exception
    using errcode = 'read_only_sql_transaction',
          message = 'The system is in backup mode, so changes are paused while a backup is taken.',
          hint    = 'This clears on its own within the hour. Try again in a few minutes, or ask an admin.';
end;
$function$

```

### `enforce_locked_fee_price()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.enforce_locked_fee_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f fee_items;
  v_year integer;
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

  select s.year_group into v_year
    from student_invoices si join students s on s.student_id = si.student_id
   where si.id = new.invoice_id;
  select amount into v_price from fee_item_year_prices
   where fee_item_id = f.id and year_group = v_year;
  v_price := coalesce(v_price, f.default_amount);

  if v_price is null then
    raise exception '% has no approved price for Year %. It must be approved by the principal and the college secretary before it can be charged.',
      coalesce(f.display_name, f.name), v_year;
  end if;
  if new.amount is distinct from v_price then
    raise exception '% is charged at its approved price for Year %: %. Other amounts need approval first.',
      coalesce(f.display_name, f.name), v_year, to_char(v_price, 'FM999,999,990.00');
  end if;
  return new;
end;
$function$

```

### `fee_price_change_list()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.fee_price_change_list()
 RETURNS TABLE(id bigint, kind text, academic_year_id integer, year_label text, fee_item_id bigint, fee_item_name text, old_values jsonb, new_values jsonb, reason text, status text, requested_at timestamp with time zone, requested_by_name text, principal_approved_at timestamp with time zone, principal_name text, secretary_approved_at timestamp with time zone, secretary_name text, closed_at timestamp with time zone, closed_by_name text, close_note text, mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t see fee approvals.';
  end if;
  return query
  select c.id, c.kind, c.academic_year_id, y.label,
         c.fee_item_id, coalesce(f.display_name, f.name), c.old_values, c.new_values,
         c.reason, c.status, c.requested_at, profile_display_name(c.requested_by),
         c.principal_approved_at, profile_display_name(c.principal_approved_by),
         c.secretary_approved_at, profile_display_name(c.secretary_approved_by),
         c.closed_at, profile_display_name(c.closed_by), c.close_note,
         c.requested_by = auth.uid()
    from fee_price_changes c
    left join academic_years y on y.academic_year_id = c.academic_year_id
    left join fee_items f on f.id = c.fee_item_id
   order by (c.status = 'pending') desc, c.requested_at desc
   limit 200;
end;
$function$

```

### `fill_term_academic_year()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.fill_term_academic_year()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.academic_year_id is null then
    select ay.academic_year_id into new.academic_year_id
      from academic_years ay
     where new.start_date between ay.start_date and ay.end_date;
  end if;
  return new;
end;
$function$

```

### `fulfill_tuckshop_preorder(p_preorder_id bigint, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.fulfill_tuckshop_preorder(p_preorder_id bigint, p_created_by uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student_id integer;
  v_for_date date;
  v_items jsonb;
  v_purchase_id bigint;
begin
  if not user_has_staff_role(array['tuckshop', 'bursar', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can fulfil preorders';
  end if;

  select student_id, for_date into v_student_id, v_for_date
  from tuckshop_preorders where id = p_preorder_id and status = 'pending';
  if not found then
    raise exception 'Preorder not found or already handled';
  end if;

  if tuckshop_handout_locked(v_student_id, v_for_date) then
    raise exception 'This student''s restaurant list for that day has been saved. Only the tuckshop owner can unlock it.';
  end if;

  select jsonb_agg(jsonb_build_object('item_id', tuckshop_item_id, 'quantity', quantity))
  into v_items
  from tuckshop_preorder_items where preorder_id = p_preorder_id;

  v_purchase_id := record_tuckshop_purchase(v_student_id, v_items, p_created_by);

  update tuckshop_preorders set status = 'fulfilled', purchase_id = v_purchase_id where id = p_preorder_id;

  return v_purchase_id;
end;
$function$

```

### `generate_next_upn()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.generate_next_upn()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
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
 SET search_path TO 'public', 'pg_temp'
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
 SET search_path TO 'public', 'pg_temp'
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

### `give_tuckshop_order_edited(p_student_id integer, p_for_date date, p_items jsonb)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.give_tuckshop_order_edited(p_student_id integer, p_for_date date, p_items jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order record;
  v_bad text;
  v_items jsonb;
  v_purchase_id bigint;
  v_first_order bigint;
begin
  if not has_staff_role(array['tuckshop', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can hand out orders';
  end if;

  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);
  if tuckshop_handout_locked(p_student_id, p_for_date) then
    raise exception 'This list has been saved, so it can''t be changed. Only the tuckshop owner can unlock it.';
  end if;

  select min(id) into v_first_order
  from tuckshop_preorders
  where student_id = p_student_id and for_date = p_for_date and status in ('pending', 'fulfilled');
  if v_first_order is null then
    raise exception 'This student has no order for that day';
  end if;

  with given as (
    select (x->>'item_id')::bigint as item_id, sum((x->>'quantity')::integer) as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x
    group by 1
  ),
  ordered as (
    select i.tuckshop_item_id as item_id, sum(i.quantity) as quantity
    from tuckshop_preorder_items i
    join tuckshop_preorders o on o.id = i.preorder_id
    where o.student_id = p_student_id and o.for_date = p_for_date and o.status in ('pending', 'fulfilled')
    group by 1
  )
  select coalesce(ti.name, 'item ' || g.item_id)
  into v_bad
  from given g
  left join ordered o on o.item_id = g.item_id
  left join tuckshop_items ti on ti.id = g.item_id
  where g.quantity is null or g.quantity < 0 or g.quantity > coalesce(o.quantity, 0)
  limit 1;
  if v_bad is not null then
    raise exception 'You can only give up to what was ordered (%)', v_bad;
  end if;

  select jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity) order by item_id)
  into v_items
  from (
    select (x->>'item_id')::bigint as item_id, sum((x->>'quantity')::integer) as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x
    group by 1
  ) g
  where quantity > 0;

  for v_order in
    select id, purchase_id from tuckshop_preorders
    where student_id = p_student_id and for_date = p_for_date and status = 'fulfilled'
  loop
    update tuckshop_preorders set status = 'pending', purchase_id = null where id = v_order.id;
    if v_order.purchase_id is not null then
      delete from tuckshop_purchase_items where purchase_id = v_order.purchase_id;
      delete from tuckshop_purchases where id = v_order.purchase_id;
    end if;
  end loop;

  if v_items is not null then
    v_purchase_id := record_tuckshop_purchase(p_student_id, v_items, auth.uid());
  end if;

  update tuckshop_preorders
  set status = 'fulfilled',
      purchase_id = case when id = v_first_order then v_purchase_id end
  where student_id = p_student_id and for_date = p_for_date and status = 'pending';

  return v_purchase_id;
end;
$function$

```

### `grade_history_is_append_only()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.grade_history_is_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'grade_history is a permanent record: rows cannot be changed or deleted'
    using errcode = 'insufficient_privilege';
end;
$function$

```

### `guard_fee_prices()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.guard_fee_prices()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_table_name = 'academic_years' then
    if tg_op = 'INSERT' and (new.admission_form_fee is not null or new.admission_deposit is not null)
       or tg_op = 'UPDATE' and (new.admission_form_fee is distinct from old.admission_form_fee
                                or new.admission_deposit is distinct from old.admission_deposit) then
      raise exception 'Admission fees change only when the principal and the college secretary have both approved. Propose the change at Fee Approvals.';
    end if;
  elsif tg_table_name = 'fee_items' then
    if tg_op = 'INSERT' and new.default_amount is not null
       or tg_op = 'UPDATE' and new.default_amount is distinct from old.default_amount then
      raise exception 'Fee prices change only when the principal and the college secretary have both approved. Propose the price at Fee Approvals.';
    end if;
    if tg_op = 'INSERT' and new.price_locked
       or tg_op = 'UPDATE' and new.price_locked is distinct from old.price_locked then
      raise exception 'Whether a fee is locked to its approved price is set by the principal, not from this page.';
    end if;
    if tg_op = 'UPDATE' and old.price_locked and new.category is distinct from old.category then
      raise exception 'A locked fee item''s category can''t be changed from this page.';
    end if;
  end if;
  return new;
end;
$function$

```

### `guard_new_tables()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.guard_new_tables()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
  loop
    if obj.object_type = 'table' and obj.schema_name = 'public' then
      perform public.attach_backup_mode_guard(split_part(obj.object_identity, '.', 2));
    end if;
  end loop;
end;
$function$

```

### `handle_negative_behaviour()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.handle_negative_behaviour()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  week_start date;
  week_end date;
  week_total integer;
  detention_friday date;
  r behaviour_rules;
begin
  select * into r from behaviour_rules where id;

  if new.points <= -3 then
    perform pg_notify('behaviour_escalation', json_build_object(
      'event_id', new.event_id,
      'student_id', new.student_id,
      'points', new.points
    )::text);
  end if;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;
  detention_friday := week_start + 6;

  if new.points <= r.detention_single_event_points then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, new.event_id, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions where behaviour_event_id = new.event_id
    );
  end if;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if week_total <= r.detention_weekly_total_points then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, null, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions
      where student_id = new.student_id and detention_date = detention_friday and behaviour_event_id is null
    );
  end if;

  return new;
end;
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
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN staff_roles sr ON sr.staff_id = p.staff_id
    WHERE p.id = auth.uid() AND sr.role_name = ANY(role_names)
  );
$function$

```

### `holds_staff_role(p_role text)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.holds_staff_role(p_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid() and sr.role_name = p_role);
$function$

```

### `in_evening_prep()` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.in_evening_prep()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from school_day sd
     where sd.short_label = 'EP'
       and sd.day_of_week = to_char(school_now(), 'Dy')
       and school_now()::time >= sd.start_time
       and school_now()::time < sd.end_time);
$function$

```

### `is_admin()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT is_admin() OR has_staff_role(ARRAY['assessment_manager']);
$function$

```

### `is_backup_mode_active()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_backup_mode_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select active and expires_at is not null and expires_at > now()
       from public.system_backup_mode where id),
    false
  );
$function$

```

### `is_birthday_on(p_dob date, p_day date)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_birthday_on(p_dob date, p_day date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_dob is not null and (
    to_char(p_dob, 'MMDD') = to_char(p_day, 'MMDD')
    or (
      to_char(p_dob, 'MMDD') = '0229'
      and to_char(p_day, 'MMDD') = '0228'
      and to_char(p_day + 1, 'MMDD') = '0301'  -- not a leap year
    )
  );
$function$

```

### `is_demo_account()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_demo_account()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from profiles where id = auth.uid() and is_demo_account = true);
$function$

```

### `is_medical_staff()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_medical_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select user_has_staff_role(array['nurse']);
$function$

```

### `is_pastoral_or_smt()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_pastoral_or_smt()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select is_admin() or has_staff_role(array['smt', 'houseparent', 'head_of_boarding', 'pastoral']);
$function$

```

### `is_plain_email(p text)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_plain_email(p text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p ~ '^[^\s@<>(),;:"\[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';
$function$

```

### `is_staff_or_admin()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','staff'));
$function$

```

### `is_tuckshop_owner()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.is_tuckshop_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from profiles p join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid() and sr.role_name = 'tuckshop_owner'
  );
$function$

```

### `issue_admission_letter(p_applicant_id bigint, p_kind text, p_send_email boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.issue_admission_letter(p_applicant_id bigint, p_kind text, p_send_email boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_letter_id bigint;
  v_email_id bigint;
  v_html text;
  v_note text;
begin
  select * into r from render_admission_letter(p_applicant_id, p_kind);
  if r.body is null then
    return jsonb_build_object('letter_id', null, 'note', 'No standard letter is set up for this step yet, so none was produced.');
  end if;

  if p_send_email and r.email is not null and not parent_emails_paused() then
    v_html := '<p>' || replace(replace(
                replace(replace(replace(r.body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                E'\n\n', '</p><p>'), E'\n', '<br>') || '</p>';
    v_email_id := queue_workspace_email(jsonb_build_object(
      'to', r.email,
      'subject', r.subject,
      'html', v_html,
      'reply_to', email_reply_to('admissions')));
  elsif p_send_email and r.email is null then
    v_note := 'Not emailed: the main contact has no usable email address. Print the letter instead.';
  elsif p_send_email then
    v_note := 'Not emailed: emails to parents are paused. Print the letter instead.';
  end if;

  insert into applicant_letters (applicant_id, letter_kind, subject, body, sent_by, emailed_to, email_id)
  values (p_applicant_id, p_kind, r.subject, r.body, auth.uid(),
          case when v_email_id is not null then r.email end, v_email_id)
  returning letter_id into v_letter_id;

  return jsonb_build_object('letter_id', v_letter_id, 'emailed_to',
                            case when v_email_id is not null then r.email end, 'note', v_note);
end;
$function$

```

### `link_profile_to_staff()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.link_profile_to_staff()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
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

### `lock_login_when_student_leaves()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.lock_login_when_student_leaves()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_table_name = 'students' then
    if new.status is distinct from old.status then
      perform public.set_student_login_lock(new.student_id, new.status <> 'active');
    end if;
  elsif new.student_id is not null then
    -- profiles: a login just made (or re-pointed) for a student who has left
    if exists (select 1 from public.students s
                where s.student_id = new.student_id and s.status <> 'active') then
      perform public.set_student_login_lock(new.student_id, true);
    end if;
  end if;
  return new;
end;
$function$

```

### `log_change()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.log_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_key jsonb := '{}'::jsonb;
  v_col text;
  v_student integer;
  v_staff_id integer;
  v_role text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_new) k
    where k not in ('updated_at')
      and v_old->k is distinct from v_new->k;
    if v_changed is null then
      return new;
    end if;
  end if;

  foreach v_col in array string_to_array(tg_argv[1], ',') loop
    v_key := v_key || jsonb_build_object(v_col, v_row->v_col);
  end loop;

  -- A login row: say whose login it is (profiles holds no name, and its
  -- email column is often empty; the sign-in email lives in auth.users).
  if tg_table_name = 'profiles' then
    v_key := v_key || jsonb_build_object(
      'name', profile_display_name((v_row->>'id')::uuid),
      'email', (select u.email from auth.users u where u.id = (v_row->>'id')::uuid));
  end if;

  v_student := (v_row->>'student_id')::integer;
  if v_student is null and v_row ? 'invoice_id' then
    select si.student_id into v_student from student_invoices si where si.id = (v_row->>'invoice_id')::bigint;
  end if;

  select p.staff_id, p.role into v_staff_id, v_role from profiles p where p.id = auth.uid();

  insert into change_history (
    area, table_name, action, record_key, student_id, changed_fields,
    old_row, new_row, changed_by, changed_by_staff_id, changed_by_role, changed_by_name, note
  ) values (
    tg_argv[0], tg_table_name, tg_op, v_key, v_student, v_changed,
    v_old, v_new, auth.uid(), v_staff_id, v_role, profile_display_name(auth.uid()),
    case when auth.uid() is null then nullif(current_setting('formwork.change_note', true), '') end
  );

  return coalesce(new, old);
end;
$function$

```

### `log_grade_change()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.log_grade_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_grade_col text := case tg_table_name when 'target_grades' then 'target_grade' else 'grade' end;
  v_key jsonb;
  v_staff_id integer;
  v_role text;
begin
  -- An update that changes nothing but bookkeeping columns isn't a change.
  if tg_op = 'UPDATE'
     and (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
    return new;
  end if;

  v_key := case tg_table_name
    when 'results' then jsonb_build_object('result_id', v_row->'result_id')
    when 'transcript_grades' then jsonb_build_object(
      'student_id', v_row->'student_id', 'subject_id', v_row->'subject_id',
      'year_group', v_row->'year_group', 'term_number', v_row->'term_number')
    else jsonb_build_object('student_id', v_row->'student_id', 'subject_id', v_row->'subject_id')
  end;

  select p.staff_id, p.role into v_staff_id, v_role from profiles p where p.id = auth.uid();

  insert into grade_history (
    table_name, action, student_id, subject_id, record_key,
    old_grade, new_grade, old_score, new_score, old_row, new_row,
    changed_by, changed_by_staff_id, changed_by_role, changed_by_name, note
  ) values (
    tg_table_name, tg_op,
    (v_row->>'student_id')::integer, (v_row->>'subject_id')::integer, v_key,
    v_old->>v_grade_col, v_new->>v_grade_col,
    (v_old->>'score')::numeric, (v_new->>'score')::numeric,
    v_old, v_new,
    auth.uid(), v_staff_id, v_role, profile_display_name(auth.uid()),
    case when auth.uid() is null then nullif(current_setting('formwork.change_note', true), '') end
  );

  return coalesce(new, old);
end;
$function$

```

### `mark_message_read(p_message_id bigint)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.mark_message_read(p_message_id bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update message_recipients set read_at = now()
  where message_id = p_message_id and profile_id = auth.uid() and read_at is null;
$function$

```

### `merge_previous_schools(p_from integer, p_into integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.merge_previous_schools(p_from integer, p_into integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not has_resource_access('/admissions/schools') then
    raise exception 'Only admissions staff can merge schools.';
  end if;
  if p_from = p_into then
    raise exception 'Choose two different schools.';
  end if;
  if not exists (select 1 from previous_schools where school_id = p_into) then
    raise exception 'School not found.';
  end if;
  update applicants set previous_school_id = p_into where previous_school_id = p_from;
  delete from previous_schools where school_id = p_from;
end;
$function$

```

### `merge_subjects(from_id integer, into_id integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.merge_subjects(from_id integer, into_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not is_admin() then
    raise exception 'Only admin can merge subjects';
  end if;

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

### `missing_grades_by_class(p_event_id integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.missing_grades_by_class(p_event_id integer)
 RETURNS TABLE(class_id integer, class_code text, subject_name text, year_group integer, teacher text, expected integer, entered integer, missing_students jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_date date;
  v_years integer[];
  v_joined_from date;
begin
  if not is_staff_or_admin() then
    raise exception 'Staff only' using errcode = 'insufficient_privilege';
  end if;

  select event_date into v_date from calendar_events where event_id = p_event_id and is_result_set;
  if v_date is null then
    raise exception 'Result set % not found', p_event_id;
  end if;

  select rp.year_groups, rp.joined_from into v_years, v_joined_from
  from report_periods rp
  where rp.calendar_event_id = p_event_id and rp.joined_from is not null
  order by rp.report_period_id
  limit 1;

  return query
  with set_results as (
    select r.student_id, r.subject_id
    from results r
    where not r.is_demo
      and (r.result_set_event_id = p_event_id
           or (r.result_set_event_id is null and r.week_start_date = v_date))
  ),
  assessed as (
    select distinct sr.subject_id, s.year_group
    from set_results sr join students s on s.student_id = sr.student_id
  ),
  roster as (
    select c.class_id, c.subject_id, st.student_id, st.first_name, st.last_name,
           exists (select 1 from set_results sr
                   where sr.student_id = st.student_id and sr.subject_id = c.subject_id) as has_mark
    from classes c
    join assessed a on a.subject_id = c.subject_id and a.year_group = c.year_group
    join subjects sub on sub.subject_id = c.subject_id and sub.on_grade_report
    join student_class sc on sc.class_id = c.class_id
    join students st on st.student_id = sc.student_id and st.status = 'active'
    where not c.is_demo
      and (v_joined_from is null
           or (st.year_group = any (v_years) and st.admission_date >= v_joined_from))
  )
  select c.class_id, c.class_code, coalesce(sub.display_name, sub.subject_name), c.year_group,
         nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), ''),
         count(*)::integer,
         count(*) filter (where ro.has_mark)::integer,
         coalesce(
           jsonb_agg(jsonb_build_object('student_id', ro.student_id, 'first_name', ro.first_name, 'last_name', ro.last_name)
                     order by ro.last_name, ro.first_name)
             filter (where not ro.has_mark),
           '[]'::jsonb)
  from roster ro
  join classes c on c.class_id = ro.class_id
  join subjects sub on sub.subject_id = c.subject_id
  left join staff t on t.staff_id = c.staff_id
  group by c.class_id, c.class_code, sub.display_name, sub.subject_name, c.year_group, t.first_name, t.last_name;
end;
$function$

```

### `my_calendar_feed_token(p_reset boolean DEFAULT false)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.my_calendar_feed_token(p_reset boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_parent_id integer;
  v_token text;
begin
  select p.parent_id into v_parent_id from profiles p where p.id = auth.uid();
  if v_parent_id is null then
    raise exception 'Only a parent login has a calendar subscription link.';
  end if;

  if p_reset then
    delete from parent_calendar_feeds where parent_id = v_parent_id;
  end if;

  insert into parent_calendar_feeds (parent_id, token)
  values (v_parent_id, encode(gen_random_bytes(16), 'hex'))
  on conflict (parent_id) do nothing;

  select f.token into v_token from parent_calendar_feeds f where f.parent_id = v_parent_id;
  return v_token;
end;
$function$

```

### `my_current_child_ids()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_current_child_ids()
 RETURNS SETOF integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select sp.student_id
  from profiles p
  join student_parent sp on sp.parent_id = p.parent_id
  join students s on s.student_id = sp.student_id
  where p.id = auth.uid()
    and s.status = 'active';
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

### `my_editable_student_fields()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_editable_student_fields()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when is_admin() then student_core_fields()
  else coalesce((
    select array_agg(distinct sfp.field_name)
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    join student_field_permissions sfp on sfp.role_name = sr.role_name
    where p.id = auth.uid()
  ), '{}') end;
$function$

```

### `my_fee_approver_roles()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_fee_approver_roles()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array_remove(array[
    case when holds_staff_role('principal') then 'principal' end,
    case when holds_staff_role('college_secretary') then 'college_secretary' end], null);
$function$

```

### `my_house_access()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_house_access()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'house', my_house_scope(),
    'exclusive', coalesce(my_house_scope_is_exclusive(), false)
  );
$function$

```

### `my_house_scope()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_house_scope()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

### `my_house_scope_is_exclusive()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_house_scope_is_exclusive()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid()
      and sr.role_name = 'houseparent'
      and sr.scope_type = 'house'
  )
  and not exists (
    select 1
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid()
      and sr.role_name in (
        'admin', 'smt', 'hr', 'pastoral', 'teacher', 'head_of_department',
        'head_of_boarding', 'mentor', 'assessment_manager', 'assessment_user',
        'school_office', 'admissions'
      )
  )
  and not exists (
    select 1
    from profiles p
    join classes c on c.staff_id = p.staff_id
    where p.id = auth.uid()
  )
  and not exists (
    select 1 from my_mentee_ids()
  );
$function$

```

### `my_mentee_ids()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_mentee_ids()
 RETURNS SETOF integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select distinct sc.student_id
  from profiles p
  join classes c on c.staff_id = p.staff_id
  join curriculum_blocks b on b.block_id = c.block_id and b.block_name = 'Mentor'
  join student_class sc on sc.class_id = c.class_id
  where p.id = auth.uid();
$function$

```

### `my_parent_ids()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.my_parent_ids()
 RETURNS SETOF integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT parent_id FROM profiles WHERE id = auth.uid() AND parent_id IS NOT NULL
  UNION
  SELECT pr.parent_id FROM parents pr
  JOIN profiles p ON p.email = pr.email
  WHERE p.id = auth.uid();
$function$

```

### `notify_office_of_behaviour_photos()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.notify_office_of_behaviour_photos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_recipients uuid[];
  v_count integer;
  v_names text;
  v_uploader text;
  v_subject text;
  v_html text;
begin
  select array_agg(distinct p.id) into v_recipients
  from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where sr.role_name = 'smt';
  if v_recipients is null then
    select array_agg(id) into v_recipients from profiles where role = 'admin';
  end if;

  for r in
    select n.photo_id,
           min(n.category) as category,
           min(n.points) as points,
           min(n.event_date) as event_date,
           min(n.type) as type
    from new_rows n
    join behaviour_photos ph on ph.photo_id = n.photo_id
    where n.photo_id is not null
      and not n.is_demo
      and ph.status = 'pending'
      and ph.office_notified_at is null
    group by n.photo_id
  loop
    select count(*) into v_count from behaviour_events where photo_id = r.photo_id;

    -- A whole boarding house can be 50+ students: name the first ten.
    select string_agg(name, ', ' order by last_name) into v_names
    from (
      select s.first_name || ' ' || s.last_name as name, s.last_name
      from behaviour_events e
      join students s on s.student_id = e.student_id
      where e.photo_id = r.photo_id
      order by s.last_name
      limit 10
    ) x;
    if v_count > 10 then
      v_names := v_names || ' and ' || (v_count - 10) || ' more';
    end if;

    select st.first_name || ' ' || st.last_name into v_uploader
    from behaviour_photos ph join staff st on st.staff_id = ph.uploaded_by
    where ph.photo_id = r.photo_id;

    v_subject := 'Picture to check: ' || coalesce(r.category, 'Behaviour event') || ' — ' ||
      case when v_count = 1 then v_names else v_count || ' students' end;

    v_html := '<p>' || coalesce(v_uploader, 'A member of staff') ||
              ' added a picture to a behaviour event. Parents can''t see it until SMT approve it.</p>' ||
              '<p><strong>Category:</strong> ' || coalesce(r.category, '—') ||
              ' (' || case when r.points > 0 then '+' else '' end || coalesce(r.points::text, '—') || ')<br/>' ||
              '<strong>Date:</strong> ' || to_char(r.event_date, 'Dy DD Mon YYYY') || '<br/>' ||
              '<strong>' || case when v_count = 1 then 'Student' else 'Students (' || v_count || ')' end ||
              ':</strong> ' || coalesce(v_names, '—') || '</p>' ||
              '<p>Review it: https://misform.work/behaviour/review</p>';

    perform post_inbox_notice(v_recipients, v_subject, v_html, 'behaviour_photo');
    update behaviour_photos set office_notified_at = now() where photo_id = r.photo_id;
  end loop;

  return null;
end;
$function$

```

### `notify_pastoral_on_negative_behaviour()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.notify_pastoral_on_negative_behaviour()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  alert_to constant text := 'cs@abc.sch.ng';
  student_name text;
  cc_list text[];
  subject text;
  body_html text;
  week_start date;
  week_end date;
  week_total integer;
  reason text;
  v_key text;
  r behaviour_rules;
begin
  if new.is_demo then
    return new;
  end if;
  select * into r from behaviour_rules where id;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if new.points <= r.detention_single_event_points then
    reason := 'A single severe event was logged (' || new.points || ' points).';
  elsif week_total <= r.alert_weekly_total_points then
    reason := 'Their running total for the week (Sat ' || week_start || ' – Fri ' || week_end || ') has reached ' || week_total || ' points.';
  else
    return new;
  end if;

  select first_name || ' ' || last_name into student_name from students where student_id = new.student_id;

  select array_agg(distinct lower(e)) into cc_list
  from (
    select st.email as e
    from staff st
    join staff_roles sr on sr.staff_id = st.staff_id
    where sr.role_name = 'smt' and st.email is not null and length(trim(st.email)) > 0
    union
    select 'sro@abc.sch.ng'
  ) x
  where lower(e) <> alert_to;

  subject := 'Behaviour alert: ' || student_name || ' — ' || coalesce(new.category, 'Negative event');
  body_html := '<p><strong>' || student_name || '</strong> has triggered a behaviour alert.</p>' ||
               '<p>' || reason || '</p>' ||
               '<p><strong>Latest event — Category:</strong> ' || coalesce(new.category, '—') || '<br/>' ||
               '<strong>Points:</strong> ' || coalesce(new.points::text, '—') || '<br/>' ||
               '<strong>Date:</strong> ' || new.event_date::text || '</p>' ||
               '<p>' || coalesce(new.description, '') || '</p>';

  perform post_inbox_notice(
    (select array_agg(p.id)
       from profiles p
       join staff st on st.staff_id = p.staff_id
      where lower(st.email) = any (array_append(coalesce(cc_list, array[]::text[]), alert_to))),
    subject,
    body_html || '<p>Student record: https://misform.work/students/' || new.student_id || '</p>',
    'behaviour_alert');

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return new;
  end if;

  perform public.queue_workspace_email(jsonb_build_object(
      'to', alert_to,
      'cc', to_jsonb(coalesce(cc_list, array[]::text[])),
      'subject', subject,
      'html', body_html || '<p><a href="https://misform.work/students/' || new.student_id || '">View student in Adorable MIS</a></p>',
      'reply_to', email_reply_to('behaviour_alert')
    )
  );

  return new;
end;
$function$

```

### `notify_student_of_cancelled_detention()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.notify_student_of_cancelled_detention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  r record;
  v_day text;
  v_remaining text;
  v_room text;
  v_time text;
  v_html text;
begin
  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');

  for r in
    select n.student_id, n.detention_date, s.first_name, s.student_email,
           string_agg(detention_reason(n.detention_id), '; ' order by n.detention_id) as reasons
    from new_rows n
    join old_rows o on o.detention_id = n.detention_id
    join students s on s.student_id = n.student_id
    where o.status = 'scheduled' and n.status = 'cancelled'
      and not n.is_demo
      and n.detention_date >= school_today()
    group by n.student_id, n.detention_date, s.first_name, s.student_email
  loop
    if not exists (
      select 1 from detentions
      where student_id = r.student_id and detention_date = r.detention_date
        and student_notified_at is not null
    ) then
      continue;
    end if;

    v_day := to_char(r.detention_date, 'FMDay FMDD FMMonth YYYY');

    select string_agg(detention_reason(detention_id), '; ' order by detention_id) into v_remaining
    from detentions
    where student_id = r.student_id and detention_date = r.detention_date and status = 'scheduled';

    v_html := '<p>Your detention on <strong>' || v_day || '</strong> has been <strong>cancelled</strong>. ' ||
              'It had been given for ' || r.reasons || '.</p>';
    if v_remaining is null then
      v_html := v_html || '<p>You do not need to attend detention that day.</p>';
    else
      v_html := v_html || '<p>You still have a detention that day, given for ' || v_remaining ||
                '. Report to <strong>' || v_room || '</strong> ' || v_time || ' as before.</p>';
    end if;

    perform post_student_notice(r.student_id, 'Detention cancelled: ' || v_day, v_html);

    if r.student_email is not null and length(trim(r.student_email)) > 0 then
      perform public.queue_workspace_email(jsonb_build_object(
        'to', r.student_email,
        'subject', 'Detention cancelled: ' || v_day,
        'html', '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' || v_html || '<p>Adorable British College</p>',
        'reply_to', email_reply_to('detention')
      ));
    end if;
  end loop;

  return null;
end;
$function$

```

### `notify_student_of_detention()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.notify_student_of_detention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_reason text;
  v_room text;
  v_time text;
  v_day text;
  v_emailed boolean;
  v_posted boolean;
begin
  if new.is_demo or new.status <> 'scheduled' or new.detention_date < school_today() then
    return new;
  end if;

  if exists (
    select 1 from detentions
    where student_id = new.student_id
      and detention_date = new.detention_date
      and student_notified_at is not null
  ) then
    return new;
  end if;

  if new.behaviour_event_id is not null then
    select 'a serious behaviour event: ' || coalesce(category, 'negative event') || ' (' || points || ' points) on ' || to_char(event_date, 'FMDay FMDD FMMonth')
      into v_reason
    from behaviour_events where event_id = new.behaviour_event_id;
  end if;
  v_reason := coalesce(v_reason, 'reaching 10 or more negative behaviour points this week');

  v_emailed := send_detention_email(new.student_id, new.detention_date, v_reason);

  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');
  v_day := to_char(new.detention_date, 'FMDay FMDD FMMonth YYYY');

  v_posted := post_student_notice(new.student_id,
    'Detention: ' || v_day || ', ' || v_room || ' ' || v_time,
    '<p>You have a detention on ' || v_day || '.</p>' ||
    '<p>Report to ' || v_room || ' ' || v_time || '.</p>' ||
    '<p>This detention was given for ' || v_reason || '.</p>' ||
    '<p>If you have a question about it, speak to your form tutor or houseparent before Friday.</p>');

  if v_emailed or v_posted then
    new.student_notified_at := now();
  end if;
  return new;
end;
$function$

```

### `other_half_choice_from_activity()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.other_half_choice_from_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  select a.term_id, a.day_of_week into new.term_id, new.day_of_week
    from other_half_activities a where a.activity_id = new.activity_id;
  return new;
end;
$function$

```

### `other_half_choices_open(p_term_id integer)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.other_half_choices_open(p_term_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select w.choices_open and (w.choices_close_at is null or now() < w.choices_close_at)
      from other_half_terms w where w.term_id = p_term_id), false);
$function$

```

### `other_half_period()` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.other_half_period()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ select period_number from periods where short_label = 'OH' order by period_number limit 1; $function$

```

### `other_half_places_taken(p_term_id integer)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.other_half_places_taken(p_term_id integer)
 RETURNS TABLE(activity_id bigint, taken integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.activity_id, count(*)::integer from other_half_choices c where c.term_id = p_term_id group by c.activity_id;
$function$

```

### `parent_emails_paused()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.parent_emails_paused()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((select parent_emails_paused from system_settings limit 1), false);
$function$

```

### `parent_first_password(p_parent_id integer)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.parent_first_password(p_parent_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select to_char(min(s.dob), 'DDMMYYYY')
  from student_parent sp
  join students s on s.student_id = sp.student_id
  where sp.parent_id = p_parent_id
    and s.status = 'active';
$function$

```

### `parent_login_status(p_parent_ids integer[])` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.parent_login_status(p_parent_ids integer[])
 RETURNS TABLE(parent_id integer, has_login boolean, email_in_use boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.parent_id,
         exists (select 1 from profiles pr where pr.parent_id = p.parent_id),
         p.email is not null and exists (
           select 1 from auth.users u where lower(u.email) = lower(trim(p.email))
         )
    from parents p
   where p.parent_id = any(p_parent_ids)
     and user_has_staff_role(array['school_office']);
$function$

```

### `parent_welcome_candidates()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.parent_welcome_candidates()
 RETURNS TABLE(parent_id integer, parent_name text, email text, children text, years integer[], status text, sent_at timestamp with time zone, last_sign_in_at timestamp with time zone, resend_count integer, last_sent_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails' using errcode = 'insufficient_privilege';
  end if;

  return query
  with kids as (
    select sp.parent_id,
           array_agg(distinct s.year_group order by s.year_group) as years,
           string_agg(distinct s.first_name || ' ' || s.last_name || ' (Y' || s.year_group || ')', ', ') as children
    from student_parent sp
    join students s on s.student_id = sp.student_id
    where s.status = 'active'
    group by sp.parent_id
  )
  select p.parent_id,
         nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         case
           when u.last_sign_in_at is null then coalesce(nullif(lower(trim(p.email)), ''), u.email::text)
           else u.email::text
         end,
         k.children,
         k.years,
         case
           when ws.parent_id is not null then 'sent'
           when u.last_sign_in_at is not null then 'signed_in'
           when u.id is null and coalesce(trim(p.email), '') = '' then 'no_email'
           when parent_first_password(p.parent_id) is null then 'no_dob'
           when u.id is null and exists (
             select 1 from auth.users x where lower(x.email) = lower(trim(p.email))
           ) then 'email_shared'
           else 'ready'
         end,
         ws.sent_at,
         u.last_sign_in_at,
         coalesce(ws.resend_count, 0),
         ws.last_sent_at
  from parents p
  join kids k on k.parent_id = p.parent_id
  left join lateral (
    select pr.id from profiles pr
    where pr.parent_id = p.parent_id and pr.role = 'parent'
    limit 1
  ) login on true
  left join auth.users u on u.id = login.id
  left join parent_welcome_sends ws on ws.parent_id = p.parent_id
  order by p.last_name, p.first_name;
end;
$function$

```

### `parent_welcome_email_post(p_email text, p_name text, p_temp_password text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.parent_welcome_email_post(p_email text, p_name text, p_temp_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  body_html text;
  safe_name text := replace(replace(replace(coalesce(p_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
begin
  body_html := '<p>Dear ' || safe_name || ',</p>' ||
    '<p>Adorable British College now has an online parent portal, <strong>Adorable MIS</strong>, where you can view your child''s weekly results compared to their target grades, and their behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS parent portal account',
      'html', body_html,
      'reply_to', email_reply_to('parent_welcome')
    )
  );
end;
$function$

```

### `plan_class_needs_mentor_structure()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.plan_class_needs_mentor_structure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from academic_years
                  where academic_year_id = new.academic_year_id
                    and status = 'planning' and mentor_structure_confirmed_at is not null) then
    raise exception 'Set up and confirm next year''s mentor structure before importing its timetable.';
  end if;
  return new;
end;
$function$

```

### `plan_row_from_class()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.plan_row_from_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_table_name = 'plan_student_class' then
    select c.academic_year_id, c.block_id, coalesce(b.is_compound, false)
      into new.academic_year_id, new.block_id, new.is_compound
      from plan_classes c left join plan_curriculum_blocks b on b.block_id = c.block_id
     where c.class_id = new.class_id;
  else
    select c.academic_year_id into new.academic_year_id from plan_classes c where c.class_id = new.class_id;
  end if;
  return new;
end;
$function$

```

### `post_admission_decision(p_applicant_id bigint, p_status text, p_notes text DEFAULT NULL::text, p_interview_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_send_email boolean DEFAULT true)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.post_admission_decision(p_applicant_id bigint, p_status text, p_notes text DEFAULT NULL::text, p_interview_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_send_email boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a applicants;
  v_allowed text[];
  v_kind text;
  v_interviewed boolean;
begin
  if not has_resource_access('/admissions') then
    raise exception 'Only admissions staff can change an applicant''s status.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  if a.applicant_id is null then
    raise exception 'Applicant not found.';
  end if;
  if p_status in ('form_paid', 'deposit_paid', 'test_booked', 'enrolled', 'enquiry') then
    raise exception 'That step is recorded elsewhere (the bursar records payments; test dates are booked on the test day).';
  end if;

  v_allowed := case a.status
    when 'enquiry'              then array['withdrawn']
    when 'form_paid'            then array['withdrawn']
    when 'test_booked'          then array['tested', 'withdrawn']
    when 'tested'               then array['invited_to_interview', 'waitlisted', 'rejected', 'withdrawn']
    when 'invited_to_interview' then array['interviewed', 'rejected', 'withdrawn']
    when 'interviewed'          then array['offered', 'waitlisted', 'rejected', 'withdrawn']
    when 'waitlisted'           then array['invited_to_interview', 'offered', 'rejected', 'withdrawn']
    when 'offered'              then array['accepted', 'withdrawn']
    when 'accepted'             then array['withdrawn']
    when 'deposit_paid'         then array['withdrawn']
    else array[]::text[]
  end;
  if not (p_status = any (v_allowed) or is_admin()) then
    raise exception 'An applicant who is % can''t be moved to %.', replace(a.status, '_', ' '), replace(p_status, '_', ' ');
  end if;
  if p_status = 'invited_to_interview' and p_interview_at is null then
    raise exception 'Give the interview date and time.';
  end if;
  if p_status = 'withdrawn' and coalesce(btrim(p_notes), '') = '' then
    raise exception 'Say why the application was withdrawn.';
  end if;

  -- Which standard letter goes with this move. Waiting list and rejection
  -- letters depend on whether the child has had the interview yet.
  v_interviewed := exists (select 1 from applicant_interviews i where i.applicant_id = a.applicant_id);
  v_kind := case
    when p_status = 'invited_to_interview' then 'invite_to_interview'
    when p_status = 'offered' then 'offer'
    when p_status = 'waitlisted' and v_interviewed then 'waitlist_after_interview'
    when p_status = 'waitlisted' then 'waitlist_after_test'
    when p_status = 'rejected' and v_interviewed then 'reject_after_interview'
    when p_status = 'rejected' then 'reject_after_test'
  end;

  update applicants set
    status = p_status,
    interview_at = case when p_status = 'invited_to_interview' then p_interview_at else interview_at end,
    decision_notes = case when p_status in ('invited_to_interview', 'waitlisted', 'rejected', 'offered')
                          then nullif(btrim(p_notes), '') else decision_notes end,
    decided_by = case when p_status in ('invited_to_interview', 'waitlisted', 'rejected', 'offered')
                      then auth.uid() else decided_by end,
    decided_at = case when p_status in ('invited_to_interview', 'waitlisted', 'rejected', 'offered')
                      then now() else decided_at end,
    accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
    withdrawn_reason = case when p_status = 'withdrawn' then btrim(p_notes) else withdrawn_reason end
  where applicant_id = p_applicant_id;

  if v_kind is null then
    return jsonb_build_object('status', p_status);
  end if;
  return jsonb_build_object('status', p_status)
         || issue_admission_letter(p_applicant_id, v_kind, p_send_email);
end;
$function$

```

### `post_inbox_notice(p_profile_ids uuid[], p_subject text, p_html text, p_kind text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.post_inbox_notice(p_profile_ids uuid[], p_subject text, p_html text, p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_message_id bigint;
  v_count integer;
  v_body text;
begin
  if p_profile_ids is null or cardinality(p_profile_ids) = 0 then
    return false;
  end if;

  v_body := btrim(regexp_replace(
    regexp_replace(replace(replace(p_html, '</p>', E'\n\n'), '<br/>', E'\n'), '<[^>]+>', '', 'g'),
    E'\n{3,}', E'\n\n', 'g'), E' \n');

  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, v_body, null, 'automatic', p_kind)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select distinct v_message_id, unnest(p_profile_ids)
  on conflict do nothing;

  get diagnostics v_count = row_count;
  update messages set recipient_count = v_count where id = v_message_id;
  return v_count > 0;
end;
$function$

```

### `post_student_notice(p_student_id integer, p_subject text, p_html text)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.post_student_notice(p_student_id integer, p_subject text, p_html text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select post_inbox_notice(
    (select array_agg(id) from profiles where student_id = p_student_id),
    p_subject, p_html, 'detention');
$function$

```

### `process_email_outbox()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.process_email_outbox()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  max_in_flight constant integer := 3;
  max_attempts constant integer := 6;
  rec record;
  v_free integer;
  v_request bigint;
begin
  for rec in
    select o.email_id, o.attempts, r.status_code, r.timed_out,
           coalesce(r.error_msg, left(r.content, 500)) as detail
    from email_outbox o
    join net._http_response r on r.id = o.request_id
    where o.status = 'sending'
  loop
    if rec.status_code between 200 and 299 then
      update email_outbox set status = 'sent', sent_at = now(), last_error = null
      where email_id = rec.email_id;
    else
      update email_outbox
         set status = case when rec.attempts >= max_attempts then 'failed' else 'queued' end,
             next_attempt_at = now() + make_interval(mins => rec.attempts),
             last_error = coalesce(rec.status_code::text, case when rec.timed_out then 'timeout' end, 'error')
                          || ': ' || coalesce(rec.detail, '')
       where email_id = rec.email_id;
    end if;
  end loop;

  update email_outbox
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         last_error = 'no reply recorded'
   where status = 'sending' and next_attempt_at < now() - interval '10 minutes';

  select max_in_flight - count(*) into v_free from email_outbox where status = 'sending';
  if v_free <= 0 then
    return;
  end if;

  for rec in
    select email_id, payload from email_outbox
    where status = 'queued' and next_attempt_at <= now()
    order by next_attempt_at, email_id
    limit v_free
    for update skip locked
  loop
    select net.http_post(
      url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
      body := rec.payload,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(public.send_workspace_email_key(), ''),
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 60000
    ) into v_request;

    update email_outbox
       set status = 'sending', request_id = v_request, attempts = attempts + 1, next_attempt_at = now()
     where email_id = rec.email_id;
  end loop;
end;
$function$

```

### `profile_display_name(p_profile_id uuid)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.profile_display_name(p_profile_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    nullif(trim(coalesce(st.first_name, '') || ' ' || coalesce(st.last_name, '')), ''),
    nullif(trim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, '')), ''),
    nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''),
    u.email
  )
  from profiles p
  left join staff st on st.staff_id = p.staff_id
  left join parents pa on pa.parent_id = p.parent_id
  left join students s on s.student_id = p.student_id
  left join auth.users u on u.id = p.id
  where p.id = p_profile_id;
$function$

```

### `propose_admission_fees(p_academic_year_id integer, p_form_fee numeric, p_deposit numeric, p_reason text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.propose_admission_fees(p_academic_year_id integer, p_form_fee numeric, p_deposit numeric, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  y academic_years;
  v_id bigint;
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t propose fee changes.';
  end if;
  select * into y from academic_years where academic_year_id = p_academic_year_id;
  if y.academic_year_id is null then
    raise exception 'Academic year not found.';
  end if;
  if p_form_fee < 0 or p_deposit < 0 then
    raise exception 'Amounts can''t be negative.';
  end if;
  if p_form_fee is not distinct from y.admission_form_fee and p_deposit is not distinct from y.admission_deposit then
    raise exception 'Those are already the amounts.';
  end if;
  if exists (select 1 from fee_price_changes where kind = 'admission_fees' and academic_year_id = p_academic_year_id and status = 'pending') then
    raise exception 'A change to % admission fees is already waiting for approval. Approve, reject or cancel it first.', y.label;
  end if;

  insert into fee_price_changes (kind, academic_year_id, old_values, new_values, reason, requested_by)
  values ('admission_fees', p_academic_year_id,
          jsonb_build_object('form_fee', y.admission_form_fee, 'deposit', y.admission_deposit),
          jsonb_build_object('form_fee', p_form_fee, 'deposit', p_deposit),
          nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$

```

### `propose_fee_item_price(p_fee_item_id bigint, p_amount numeric, p_reason text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.propose_fee_item_price(p_fee_item_id bigint, p_amount numeric, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f fee_items;
  v_id bigint;
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t propose fee changes.';
  end if;
  select * into f from fee_items where id = p_fee_item_id;
  if f.id is null then
    raise exception 'Fee item not found.';
  end if;
  if p_amount < 0 then
    raise exception 'Amounts can''t be negative.';
  end if;
  if p_amount is not distinct from f.default_amount then
    raise exception 'That is already the price.';
  end if;
  if exists (select 1 from fee_price_changes where kind = 'fee_item' and fee_item_id = p_fee_item_id and status = 'pending') then
    raise exception 'A price change for % is already waiting for approval. Approve, reject or cancel it first.', coalesce(f.display_name, f.name);
  end if;

  insert into fee_price_changes (kind, fee_item_id, old_values, new_values, reason, requested_by)
  values ('fee_item', p_fee_item_id,
          jsonb_build_object('amount', f.default_amount),
          jsonb_build_object('amount', p_amount),
          nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$

```

### `propose_fee_item_year_prices(p_fee_item_id bigint, p_prices jsonb, p_reason text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.propose_fee_item_year_prices(p_fee_item_id bigint, p_prices jsonb, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f fee_items;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_yg integer;
  v_amount numeric;
  v_id bigint;
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t propose fee changes.';
  end if;
  select * into f from fee_items where id = p_fee_item_id;
  if f.id is null then
    raise exception 'Fee item not found.';
  end if;
  if not f.price_locked then
    raise exception '% isn''t charged by year-group price.', coalesce(f.display_name, f.name);
  end if;
  for v_yg in 7..12 loop
    v_amount := nullif(p_prices->>v_yg::text, '')::numeric;
    if v_amount < 0 then
      raise exception 'Amounts can''t be negative.';
    end if;
    v_new := v_new || jsonb_build_object(v_yg::text, v_amount);
    v_old := v_old || jsonb_build_object(v_yg::text,
      (select amount from fee_item_year_prices where fee_item_id = p_fee_item_id and year_group = v_yg));
  end loop;
  if v_new = v_old then
    raise exception 'Those are already the prices.';
  end if;
  if exists (select 1 from fee_price_changes where kind = 'fee_item_prices' and fee_item_id = p_fee_item_id and status = 'pending') then
    raise exception 'Year prices for % are already waiting for approval. Approve, reject or cancel them first.', coalesce(f.display_name, f.name);
  end if;

  insert into fee_price_changes (kind, fee_item_id, old_values, new_values, reason, requested_by)
  values ('fee_item_prices', p_fee_item_id, v_old, v_new, nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$

```

### `queue_workspace_email(p_body jsonb)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.queue_workspace_email(p_body jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with reply as (
    select coalesce(jsonb_agg(distinct a),
                    nullif(email_reply_to('fallback'), '[]'::jsonb),
                    '["sro@abc.sch.ng"]'::jsonb) as addresses
    from (
      select lower(trim(x)) as a
      from jsonb_array_elements_text(
        case jsonb_typeof(p_body -> 'reply_to')
          when 'array' then p_body -> 'reply_to'
          when 'string' then jsonb_build_array(p_body -> 'reply_to')
          else '[]'::jsonb
        end) x
    ) r
    where is_plain_email(a)
  ),
  body as (
    select p_body || jsonb_build_object('reply_to', reply.addresses) as b
    from reply
  )
  insert into email_outbox (payload, recipient, subject)
  select
    b,
    case jsonb_typeof(b -> 'to')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(b -> 'to') x)
      else b ->> 'to'
    end
    || coalesce(' (cc: ' || case jsonb_typeof(b -> 'cc')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(b -> 'cc') x)
      else b ->> 'cc'
    end || ')', ''),
    b ->> 'subject'
  from body
  returning email_id;
$function$

```

### `recalc_invoice_status(p_invoice_id bigint)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.recalc_invoice_status(p_invoice_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

### `recent_db_backups(p_limit integer DEFAULT 20)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.recent_db_backups(p_limit integer DEFAULT 20)
 RETURNS TABLE(name text, created_at timestamp with time zone, size_bytes bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
  select o.name,
         o.created_at,
         (o.metadata->>'size')::bigint
    from storage.objects o
   where o.bucket_id = 'db-backups'
     and public.is_admin()
   order by o.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$function$

```

### `record_admission_deposit(p_applicant_id bigint, p_paid_on date, p_amount numeric, p_receipt text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.record_admission_deposit(p_applicant_id bigint, p_paid_on date, p_amount numeric, p_receipt text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a applicants;
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can record deposits.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  if a.applicant_id is null then
    raise exception 'Applicant not found.';
  end if;
  if a.status not in ('accepted', 'deposit_paid') then
    raise exception 'A deposit is recorded once the family has accepted the offer (status now: %).', replace(a.status, '_', ' ');
  end if;
  if p_paid_on is null or p_paid_on > school_today() then
    raise exception 'Give the date the deposit was paid (not in the future).';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount paid.';
  end if;

  update applicants set
    deposit_paid_on = p_paid_on,
    deposit_amount = p_amount,
    deposit_receipt = nullif(btrim(p_receipt), ''),
    deposit_recorded_by = auth.uid(),
    status = 'deposit_paid'
  where applicant_id = p_applicant_id;
end;
$function$

```

### `record_admission_form_fee(p_applicant_id bigint, p_paid_on date, p_receipt text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.record_admission_form_fee(p_applicant_id bigint, p_paid_on date, p_receipt text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a applicants;
  v_fee numeric;
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can record admission form payments.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  if a.applicant_id is null then
    raise exception 'Applicant not found.';
  end if;
  if a.status in ('withdrawn') then
    raise exception 'This application has been withdrawn.';
  end if;
  if p_paid_on is null or p_paid_on > school_today() then
    raise exception 'Give the date the form was paid for (not in the future).';
  end if;
  select admission_form_fee into v_fee from academic_years where academic_year_id = a.entry_academic_year_id;
  if v_fee is null then
    raise exception 'Set the admission form fee for this entry year first.';
  end if;

  update applicants set
    form_fee_paid_on = p_paid_on,
    form_fee_amount = coalesce(a.form_fee_amount, v_fee),
    form_fee_receipt = nullif(btrim(p_receipt), ''),
    form_fee_recorded_by = auth.uid(),
    status = case when a.status = 'enquiry' then 'form_paid' else a.status end
  where applicant_id = p_applicant_id;
end;
$function$

```

### `record_tuckshop_purchase(p_student_id integer, p_items jsonb, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.record_tuckshop_purchase(p_student_id integer, p_items jsonb, p_created_by uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_purchase_id bigint;
  v_total numeric := 0;
  v_item record;
  v_price numeric;
  v_line_total numeric;
begin
  if not user_has_staff_role(array['tuckshop', 'bursar', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can record purchases';
  end if;

  insert into tuckshop_purchases (student_id, total_amount, created_by)
  values (p_student_id, 0, p_created_by)
  returning id into v_purchase_id;

  for v_item in select * from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  loop
    select price into v_price from tuckshop_items where id = v_item.item_id;
    v_line_total := v_price * v_item.quantity;
    v_total := v_total + v_line_total;

    insert into tuckshop_purchase_items (purchase_id, tuckshop_item_id, quantity, unit_price, line_total)
    values (v_purchase_id, v_item.item_id, v_item.quantity, v_price, v_line_total);
  end loop;

  update tuckshop_purchases set total_amount = v_total where id = v_purchase_id;

  return v_purchase_id;
end;
$function$

```

### `reject_fee_price_change(p_id bigint, p_note text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.reject_fee_price_change(p_id bigint, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not (holds_staff_role('principal') or holds_staff_role('college_secretary')) then
    raise exception 'Only the principal and the college secretary can reject fee prices.';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why it is rejected.';
  end if;
  update fee_price_changes
     set status = 'rejected', closed_by = auth.uid(), closed_at = now(), close_note = btrim(p_note)
   where id = p_id and status = 'pending';
  if not found then
    raise exception 'Only a change still waiting for approval can be rejected.';
  end if;
end;
$function$

```

### `reject_future_attendance()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.reject_future_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.attend_date > school_today() then
    raise exception 'Cannot save a register for % — that date has not happened yet (today is %).',
      to_char(new.attend_date, 'Dy DD Mon YYYY'), to_char(school_today(), 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$

```

### `remove_class_links_on_student_leave()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.remove_class_links_on_student_leave()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status <> 'active' and (old.status is distinct from new.status) then
    delete from student_class where student_id = new.student_id;
  end if;
  return new;
end;
$function$

```

### `render_admission_letter(p_applicant_id bigint, p_kind text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.render_admission_letter(p_applicant_id bigint, p_kind text)
 RETURNS TABLE(subject text, body text, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'form_fee', coalesce(to_char(v_year.admission_form_fee, 'FM999,999,990.00'), ''),
    'deposit', coalesce(to_char(v_year.admission_deposit, 'FM999,999,990.00'), ''),
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
$function$

```

### `report_pastoral_grades(p_report_period_id integer, p_student_ids integer[])` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.report_pastoral_grades(p_report_period_id integer, p_student_ids integer[])
 RETURNS TABLE(student_id integer, subject_id integer, subject_name text, effort_grade text, presentation_grade text, homework_grade text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select rsc.student_id, rsc.subject_id,
         coalesce(sub.display_name, sub.subject_name),
         rsc.effort_grade, rsc.presentation_grade, rsc.homework_grade
  from report_subject_comments rsc
  join subjects sub on sub.subject_id = rsc.subject_id
  join students s on s.student_id = rsc.student_id
  where rsc.report_period_id = p_report_period_id
    and rsc.student_id = any (p_student_ids)
    and (
      user_has_staff_role(array['admin', 'smt'])
      or rsc.student_id in (select my_mentee_ids())
      or (s.boarding_house is not null and s.boarding_house = my_house_scope())
    );
$function$

```

### `report_week_assessments(p_student_id integer, p_from date, p_to date)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.report_week_assessments(p_student_id integer, p_from date, p_to date)
 RETURNS TABLE(subject_id integer, week_start_date date, enrolled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not (
    is_staff_or_admin()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.student_id = p_student_id)
    or p_student_id in (select my_current_child_ids())
  ) then
    raise exception 'Not allowed to view this student''s report' using errcode = 'insufficient_privilege';
  end if;

  return query
  select distinct r.subject_id, r.week_start_date,
         exists (
           select 1 from student_class sc join classes c on c.class_id = sc.class_id
           where sc.student_id = p_student_id and c.subject_id = r.subject_id
         ) as enrolled
  from results r
  join students s on s.student_id = r.student_id
  where s.year_group = (select year_group from students where student_id = p_student_id)
    and r.week_start_date between p_from and p_to
    and not r.is_demo
  union
  select distinct c.subject_id, null::date, true
  from student_class sc
  join classes c on c.class_id = sc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  where sc.student_id = p_student_id
    and sub.on_grade_report;
end;
$function$

```

### `resend_parent_welcome_batch(p_parent_ids integer[])` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.resend_parent_welcome_batch(p_parent_ids integer[])
 RETURNS TABLE(parent_id integer, email text, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_id integer;
  rec record;
  v_login uuid;
  v_signed_in timestamptz;
  v_email text;
  v_name text;
  v_pw text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails' using errcode = 'insufficient_privilege';
  end if;

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent.';
  end if;

  if coalesce(array_length(p_parent_ids, 1), 0) > 500 then
    raise exception 'Send at most 500 parents at a time.';
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_parent_ids) x)
  loop
    parent_id := v_id;
    email := null;
    begin
      select p.parent_id, p.first_name, p.last_name into rec
      from parents p where p.parent_id = v_id
      for update;
      if not found then
        outcome := 'Skipped: parent not found';
        return next; continue;
      end if;

      if not exists (select 1 from parent_welcome_sends ws where ws.parent_id = v_id) then
        outcome := 'Skipped: never sent the letter (send it from "Not sent yet")';
        return next; continue;
      end if;

      select pr.id, u.last_sign_in_at, u.email into v_login, v_signed_in, v_email
      from profiles pr join auth.users u on u.id = pr.id
      where pr.parent_id = v_id and pr.role = 'parent'
      limit 1;
      if not found then
        outcome := 'Skipped: no login';
        return next; continue;
      end if;

      email := v_email;
      if v_signed_in is not null then
        outcome := 'Skipped: has already signed in';
        return next; continue;
      end if;

      v_pw := parent_first_password(v_id);
      if v_pw is null then
        outcome := 'Skipped: no date of birth on file for a current child';
        return next; continue;
      end if;

      v_email := sync_parent_login_email(v_id, v_login);
      email := v_email;
      update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now()
      where id = v_login;
      update profiles set must_change_password = true where id = v_login;

      v_name := coalesce(nullif(trim(coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '')), ''), 'Parent');
      perform send_parent_welcome_email(v_email, v_name, v_pw);
      update parent_welcome_sends ws
        set resend_count = ws.resend_count + 1, last_sent_at = now(), email = v_email
      where ws.parent_id = v_id;
      outcome := 'Sent';
      return next;
    exception when others then
      outcome := 'Error: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$function$

```

### `reset_all_parent_passwords()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.reset_all_parent_passwords()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  rec record;
  new_password text;
  out_text text := 'parent_name,email,temp_password' || chr(10);
begin
  if not is_admin() then
    raise exception 'Only admin can reset parent passwords';
  end if;

  for rec in
    select pr.id as auth_id, p.first_name, p.last_name, p.email
    from profiles pr
    join parents p on p.parent_id = pr.parent_id
    where pr.role = 'parent'
    order by p.last_name
  loop
    new_password := substr(md5(random()::text), 1, 10);
    update auth.users set encrypted_password = crypt(new_password, gen_salt('bf')) where id = rec.auth_id;
    out_text := out_text ||
      '"' || coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '') || '",' ||
      rec.email || ',' || new_password || chr(10);
  end loop;

  return out_text;
end;
$function$

```

### `reset_all_student_passwords(new_password text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.reset_all_student_passwords(new_password text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  affected integer;
begin
  if not is_admin() then
    raise exception 'Only admin can reset student passwords';
  end if;

  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf'))
  where id in (
    select pr.id from profiles pr
    join students st on st.student_id = pr.student_id
    where pr.role = 'student' and st.status = 'active'
  );
  get diagnostics affected = row_count;

  update profiles
  set must_change_password = true
  where id in (
    select pr.id from profiles pr
    join students st on st.student_id = pr.student_id
    where pr.role = 'student' and st.status = 'active'
  );

  return affected;
end;
$function$

```

### `reset_parent_passwords_to_dob()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.reset_parent_passwords_to_dob()
 RETURNS TABLE(parent_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  rec record;
begin
  if not is_admin() then
    raise exception 'Only admin can reset parent passwords';
  end if;

  for rec in
    select pr.id as profile_id, u.email as login_email, p.first_name, p.last_name,
           parent_first_password(p.parent_id) as pw
    from profiles pr
    join parents p on p.parent_id = pr.parent_id
    join auth.users u on u.id = pr.id
    where pr.role = 'parent'
      and u.last_sign_in_at is null
  loop
    continue when rec.pw is null;

    update auth.users set encrypted_password = crypt(rec.pw, gen_salt('bf')), updated_at = now()
    where id = rec.profile_id;
    update profiles set must_change_password = true where id = rec.profile_id;

    parent_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
    email := rec.login_email;
    temp_password := rec.pw;
    return next;
  end loop;
end;
$function$

```

### `resolve_message_recipients(p_target_type text, p_target_value text)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.resolve_message_recipients(p_target_type text, p_target_value text)
 RETURNS TABLE(profile_id uuid)
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'year_group' and s.status = 'active' and s.year_group::text = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'form_class' and s.status = 'active' and s.form_class = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'boarding_house' and s.status = 'active' and s.boarding_house = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'mentor_group' and s.status = 'active' and s.mentor_group_id::text = p_target_value
  union
  select p.id from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p_target_type = 'staff_role' and sr.role_name = p_target_value
  union
  select p.id from profiles p
  where p_target_type = 'all_parents' and p.parent_id is not null
    and exists (
      select 1 from student_parent sp
      join students s on s.student_id = sp.student_id
      where sp.parent_id = p.parent_id and s.status = 'active'
    )
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'all_students' and s.status = 'active'
  union
  select p.id from profiles p
  where p_target_type = 'all_staff' and p.staff_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'individual'
    and p.id = any(string_to_array(p_target_value, ',')::uuid[]);
$function$

```

### `review_behaviour_for_parents(p_event_ids integer[], p_send_text boolean, p_send_picture boolean, p_protocol_confirmed boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.review_behaviour_for_parents(p_event_ids integer[], p_send_text boolean, p_send_picture boolean, p_protocol_confirmed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_reviewer integer;
  v_found integer;
  r behaviour_rules;
begin
  if p_event_ids is null or cardinality(p_event_ids) = 0 then
    raise exception 'No behaviour events given.';
  end if;
  select * into r from behaviour_rules where id;

  if exists (select 1 from behaviour_events where event_id = any(p_event_ids) and photo_id is not null) then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can send a behaviour event to parents'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_found
  from behaviour_events
  where event_id = any(p_event_ids) and voided_at is null;
  if v_found <> cardinality(array(select distinct unnest(p_event_ids))) then
    raise exception 'Behaviour event not found, or it has been withdrawn.';
  end if;

  if p_send_text and not coalesce(p_protocol_confirmed, false) then
    raise exception 'Protocol confirmation is required before sending the text to parents';
  end if;

  if p_send_text and exists (
    select 1 from behaviour_events
    where event_id = any(p_event_ids)
      and type = 'negative' and points > r.serious_event_points and photo_id is null
  ) then
    raise exception 'Only serious (% point) events, or events with a picture, can be sent to parents from the review', r.serious_event_points;
  end if;

  if p_send_picture is not null and exists (
    select 1 from behaviour_events where event_id = any(p_event_ids) and photo_id is null
  ) then
    raise exception 'This behaviour event has no picture.';
  end if;

  select staff_id into v_reviewer from profiles where id = auth.uid();

  if p_send_text is not null then
    update behaviour_events
    set visible_to_parents = p_send_text,
        protocol_reviewed_by = v_reviewer,
        protocol_reviewed_at = now()
    where event_id = any(p_event_ids)
      and type = 'negative';
  end if;

  if p_send_picture is not null then
    update behaviour_photos
    set status = case when p_send_picture then 'approved' else 'rejected' end,
        reviewed_by = v_reviewer,
        reviewed_at = now()
    where photo_id in (
      select photo_id from behaviour_events where event_id = any(p_event_ids)
    );
  end if;
end;
$function$

```

### `review_behaviour_photo(p_photo_id integer, p_approve boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.review_behaviour_photo(p_photo_id integer, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_reviewer integer;
begin
  if not (is_admin() or has_staff_role(array['smt'])) then
    raise exception 'Only SMT or admin can review a behaviour picture'
      using errcode = 'insufficient_privilege';
  end if;

  select staff_id into v_reviewer from profiles where id = auth.uid();

  update behaviour_photos
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = v_reviewer,
      reviewed_at = now()
  where photo_id = p_photo_id;

  if not found then
    raise exception 'Behaviour picture % not found.', p_photo_id;
  end if;
end;
$function$

```

### `review_serious_behaviour_event(p_event_id integer, p_visible_to_parents boolean, p_protocol_confirmed boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.review_serious_behaviour_event(p_event_id integer, p_visible_to_parents boolean, p_protocol_confirmed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event behaviour_events%rowtype;
  v_reviewer_staff_id integer;
  r behaviour_rules;
begin
  if not (is_admin() or has_staff_role(array['school_office', 'smt'])) then
    raise exception 'Only school office staff, SMT or admin can review a behaviour event';
  end if;
  select * into r from behaviour_rules where id;

  select * into v_event from behaviour_events where event_id = p_event_id;
  if not found then
    raise exception 'Behaviour event % not found', p_event_id;
  end if;

  if v_event.photo_id is not null then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can review a behaviour event';
  end if;

  if v_event.type <> 'negative' or v_event.points > r.serious_event_points then
    raise exception 'Only serious (negative, % point) events go through this review', r.serious_event_points;
  end if;

  if p_visible_to_parents and not p_protocol_confirmed then
    raise exception 'Protocol confirmation is required before releasing this event to parents';
  end if;

  select staff_id into v_reviewer_staff_id from profiles where id = auth.uid();

  update behaviour_events
  set visible_to_parents = p_visible_to_parents,
      protocol_reviewed_by = v_reviewer_staff_id,
      protocol_reviewed_at = now()
  where event_id = p_event_id;
end;
$function$

```

### `save_tuckshop_handout(p_for_date date, p_restaurant text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.save_tuckshop_handout(p_for_date date, p_restaurant text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id bigint;
  v_given integer;
  v_not_given integer;
  v_value numeric;
begin
  if not has_staff_role(array['tuckshop', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can save hand-out lists';
  end if;

  p_restaurant := coalesce(p_restaurant, '');

  if exists (select 1 from tuckshop_handout_saves
             where for_date = p_for_date and restaurant = p_restaurant and unlocked_at is null) then
    raise exception 'This list has already been saved. Only the tuckshop owner can unlock it.';
  end if;

  select count(distinct o.student_id) filter (where o.status = 'fulfilled'),
         count(distinct o.student_id) filter (where o.status = 'pending'),
         coalesce(sum(tp.total_amount) filter (where o.status = 'fulfilled'), 0)
  into v_given, v_not_given, v_value
  from tuckshop_preorders o
  join students s on s.student_id = o.student_id
  left join tuckshop_purchases tp on tp.id = o.purchase_id
  where o.for_date = p_for_date and coalesce(s.restaurant, '') = p_restaurant
    and o.status in ('pending', 'fulfilled');

  insert into tuckshop_handout_saves (for_date, restaurant, given_count, not_given_count, given_value, saved_by)
  values (p_for_date, p_restaurant, v_given, v_not_given, v_value, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$

```

### `save_tuckshop_order(p_student_id integer, p_for_date date, p_items jsonb)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.save_tuckshop_order(p_student_id integer, p_for_date date, p_items jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_is_staff boolean;
  v_keep bigint;
  v_bad record;
  v_food integer;
  v_win record;
  v_special bigint;
  v_per_item integer := 2;
  v_max_food integer := 2;
  v_max_other integer;
  v_other integer;
begin
  v_is_staff := user_has_staff_role(array['tuckshop', 'bursar']);

  if not (
    v_is_staff
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.student_id = p_student_id)
  ) then
    raise exception 'Not authorized to order for this student';
  end if;

  select id, max_per_item, max_food, max_other
  into v_special, v_per_item, v_max_food, v_max_other
  from tuckshop_special_sessions where for_date = p_for_date;
  if v_special is null then
    v_per_item := 2;
    v_max_food := 2;
    v_max_other := null;
  end if;

  if not v_is_staff then
    if v_special is null and tuckshop_ordering_closed() then
      raise exception 'Tuckshop ordering is closed at the moment — it reopens on %.',
        to_char((select tuckshop_ordering_closed_until from system_settings limit 1), 'FMDay FMDD FMMonth');
    end if;
    select * into v_win from tuckshop_order_window(p_for_date);
    if not found then
      raise exception 'There is no tuckshop on %.', to_char(p_for_date, 'FMDay FMDD FMMonth');
    end if;
    if now() < v_win.opens_at then
      raise exception 'Ordering for % opens at %.',
        to_char(p_for_date, 'FMDay FMDD FMMonth'),
        to_char(v_win.opens_at at time zone 'Africa/Lagos', 'FMHH12:MIam "on" FMDay FMDD FMMonth');
    end if;
    if now() >= v_win.closes_at then
      raise exception 'Orders for % closed at %, so they can no longer be placed, changed or cancelled.',
        to_char(p_for_date, 'FMDay FMDD FMMonth'),
        to_char(v_win.closes_at at time zone 'Africa/Lagos', 'FMHH12:MIam "on" FMDay FMDD FMMonth');
    end if;
  end if;

  p_items := coalesce(p_items, '[]'::jsonb);

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    where x.item_id is null or x.quantity is null or x.quantity < 1
  ) then
    raise exception 'Each item needs a quantity of at least 1';
  end if;

  select x.item_id into v_bad
  from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  left join tuckshop_items t on t.id = x.item_id
  where t.id is null
     or (not v_is_staff and v_special is null and not t.active)
     or (not v_is_staff and v_special is not null and not exists (
           select 1 from tuckshop_special_session_items si
           where si.session_id = v_special and si.tuckshop_item_id = x.item_id))
  limit 1;
  if found then
    raise exception 'One of the items in this order is not on sale for this tuckshop day — remove it and try again';
  end if;

  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);

  with basket as (
    select x.item_id, x.quantity
    from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    union all
    select i.tuckshop_item_id, i.quantity
    from tuckshop_preorders p
    join tuckshop_preorder_items i on i.preorder_id = p.id
    where p.student_id = p_student_id
      and p.for_date = p_for_date
      and p.status not in ('pending', 'cancelled')
  )
  select t.name, sum(b.quantity) as total into v_bad
  from basket b join tuckshop_items t on t.id = b.item_id
  group by t.name, b.item_id
  having sum(b.quantity) > v_per_item
  limit 1;
  if found then
    raise exception 'You can order at most % of each item for one tuckshop day — that would make % %.',
      v_per_item, v_bad.total, v_bad.name;
  end if;

  with basket as (
    select x.item_id, x.quantity
    from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    union all
    select i.tuckshop_item_id, i.quantity
    from tuckshop_preorders p
    join tuckshop_preorder_items i on i.preorder_id = p.id
    where p.student_id = p_student_id
      and p.for_date = p_for_date
      and p.status not in ('pending', 'cancelled')
  )
  select coalesce(sum(b.quantity) filter (where t.is_food), 0),
         coalesce(sum(b.quantity) filter (where not t.is_food), 0)
  into v_food, v_other
  from basket b join tuckshop_items t on t.id = b.item_id;
  if v_food > v_max_food then
    raise exception 'You can order at most % snack%/drink% in total for one tuckshop day — that would make %.',
      v_max_food, case when v_max_food = 1 then '' else 's' end, case when v_max_food = 1 then '' else 's' end, v_food;
  end if;
  if v_max_other is not null and v_other > v_max_other then
    raise exception 'You can order at most % other item% (not snacks or drinks) for this tuckshop day — that would make %.',
      v_max_other, case when v_max_other = 1 then '' else 's' end, v_other;
  end if;

  if jsonb_array_length(p_items) = 0 then
    update tuckshop_preorders
    set status = 'cancelled'
    where student_id = p_student_id
      and for_date = p_for_date
      and status = 'pending';
    return null;
  end if;

  select id into v_keep
  from tuckshop_preorders
  where student_id = p_student_id and for_date = p_for_date and status = 'pending'
  order by created_at, id
  limit 1;

  delete from tuckshop_preorder_items
  where preorder_id in (
    select id from tuckshop_preorders
    where student_id = p_student_id and for_date = p_for_date and status = 'pending'
  );

  if v_keep is null then
    insert into tuckshop_preorders (student_id, for_date) values (p_student_id, p_for_date)
    returning id into v_keep;
  else
    delete from tuckshop_preorders
    where student_id = p_student_id and for_date = p_for_date and status = 'pending'
      and id <> v_keep;
  end if;

  insert into tuckshop_preorder_items (preorder_id, tuckshop_item_id, quantity)
  select v_keep, x.item_id, sum(x.quantity)::integer
  from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  group by x.item_id;

  return v_keep;
end;
$function$

```

### `school_now()` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.school_now()
 RETURNS timestamp without time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (now() at time zone 'Africa/Lagos');
$function$

```

### `school_today()` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.school_today()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (now() at time zone 'Africa/Lagos')::date;
$function$

```

### `search_people(p_query text)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.search_people(p_query text)
 RETURNS TABLE(profile_id uuid, display_name text, email text, person_type text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.id, stf.first_name || ' ' || stf.last_name, p.email, 'staff'
  from profiles p
  join staff stf on stf.staff_id = p.staff_id
  where stf.first_name || ' ' || stf.last_name ilike '%' || p_query || '%'
  union all
  select p.id, par.first_name || ' ' || par.last_name, coalesce(p.email, par.email), 'parent'
  from profiles p
  join parents par on par.parent_id = p.parent_id
  where (par.first_name || ' ' || par.last_name ilike '%' || p_query || '%'
         or p.email ilike '%' || trim(p_query) || '%'
         or par.email ilike '%' || trim(p_query) || '%')
    and exists (
      select 1 from student_parent sp
      join students s on s.student_id = sp.student_id
      where sp.parent_id = p.parent_id and s.status = 'active'
    )
  union all
  select p.id, s.first_name || ' ' || s.last_name, s.student_email, 'student'
  from profiles p
  join students s on s.student_id = p.student_id
  where s.status = 'active'
    and s.first_name || ' ' || s.last_name ilike '%' || p_query || '%'
  limit 20;
$function$

```

### `send_detention_email(p_student_id integer, p_detention_date date, p_reason text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_detention_email(p_student_id integer, p_detention_date date, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_key text;
  v_first_name text;
  v_email text;
  v_room text;
  v_time text;
  v_day text;
  body_html text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return false;
  end if;

  select first_name, student_email into v_first_name, v_email
  from students where student_id = p_student_id;
  if v_email is null or length(trim(v_email)) = 0 then
    return false;
  end if;

  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');

  v_day := to_char(p_detention_date, 'FMDay FMDD FMMonth YYYY');

  body_html := '<p>Dear ' || coalesce(v_first_name, 'student') || ',</p>' ||
               '<p>You have a detention on <strong>' || v_day || '</strong>.</p>' ||
               '<p>Report to <strong>' || v_room || '</strong> ' || v_time || '.</p>' ||
               '<p>This detention was given for ' || p_reason || '.</p>' ||
               '<p>If you have a question about it, speak to your form tutor or houseparent before Friday.</p>' ||
               '<p>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', v_email,
      'subject', 'Detention: ' || v_day || ', ' || v_room || ' ' || v_time,
      'html', body_html,
      'reply_to', email_reply_to('detention')
    )
  );
  return true;
end;
$function$

```

### `send_detention_reminders()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_detention_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_date date := school_today() + 1;
  v_day text := to_char(school_today() + 1, 'FMDay FMDD FMMonth YYYY');
  v_room text;
  v_time text;
  v_sent integer := 0;
  v_subject text;
  v_html text;
  v_posted boolean;
  r record;
begin
  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');
  v_subject := 'Reminder - detention tomorrow: ' || v_day || ', ' || v_room || ' ' || v_time;

  for r in
    select d.student_id, s.first_name, s.student_email,
           array_agg(d.detention_id) as detention_ids,
           string_agg(detention_reason(d.detention_id), '; ' order by d.detention_id) as reasons
    from detentions d
    join students s on s.student_id = d.student_id
    where d.detention_date = v_date
      and d.status = 'scheduled'
      and d.reminded_at is null
      and not d.is_demo
    group by d.student_id, s.first_name, s.student_email
  loop
    v_html := '<p>This is a reminder that you have a detention tomorrow, <strong>' || v_day || '</strong>.</p>' ||
              '<p>Report to <strong>' || v_room || '</strong> ' || v_time || '.</p>' ||
              '<p>It was given for ' || r.reasons || '.</p>';

    v_posted := post_student_notice(r.student_id, v_subject, v_html);

    if r.student_email is not null and length(trim(r.student_email)) > 0 then
      perform public.queue_workspace_email(jsonb_build_object(
        'to', r.student_email,
        'subject', v_subject,
        'html', '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' || v_html || '<p>Adorable British College</p>',
        'reply_to', email_reply_to('detention')
      ));
    elsif not v_posted then
      continue;
    end if;

    update detentions set reminded_at = now() where detention_id = any (r.detention_ids);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$

```

### `send_message(p_subject text, p_body text, p_target_type text, p_target_value text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_message_id bigint;
  v_count int;
  v_should_email boolean;
begin
  if is_demo_account() then
    raise exception 'Communication is disabled for the training account — no message was sent.';
  end if;

  if not user_has_staff_role(array['smt', 'pastoral', 'school_office']) then
    raise exception 'You do not have permission to send messages.';
  end if;

  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, p_body, auth.uid(), p_target_type, p_target_value)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, profile_id from resolve_message_recipients(p_target_type, p_target_value)
  on conflict do nothing;

  select count(*) into v_count from message_recipients where message_id = v_message_id;

  v_should_email := (p_target_type = 'individual');

  update messages set recipient_count = v_count, email_sent = v_should_email where id = v_message_id;

  if v_should_email then
    -- Where replies go is set at /admin/email-replies (migration 226).
    perform public.queue_workspace_email( jsonb_build_object(
        'to', coalesce(pr.email, par.email, st.student_email),
        'subject', p_subject,
        'text', p_body || E'\n\nView in your portal: https://misform.work/inbox',
        'reply_to', email_reply_to(case when pr.parent_id is not null then 'message_parent' else 'message_staff_student' end)
      )
    )
    from profiles pr
    join message_recipients mr on mr.profile_id = pr.id
    left join parents par on par.parent_id = pr.parent_id
    left join students st on st.student_id = pr.student_id
    where mr.message_id = v_message_id
      and coalesce(pr.email, par.email, st.student_email) is not null
      and not (pr.parent_id is not null and parent_emails_paused());
  end if;

  return v_message_id;
end;
$function$

```

### `send_parent_welcome_batch(p_parent_ids integer[])` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_parent_welcome_batch(p_parent_ids integer[])
 RETURNS TABLE(parent_id integer, email text, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_id integer;
  rec record;
  v_login uuid;
  v_signed_in timestamptz;
  v_email text;
  v_name text;
  v_pw text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails' using errcode = 'insufficient_privilege';
  end if;

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent.';
  end if;

  if coalesce(array_length(p_parent_ids, 1), 0) > 500 then
    raise exception 'Send at most 500 parents at a time.';
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_parent_ids) x)
  loop
    parent_id := v_id;
    email := null;
    begin
      select p.parent_id, p.first_name, p.last_name, p.email into rec
      from parents p where p.parent_id = v_id
      for update;
      if not found then
        outcome := 'Skipped: parent not found';
        return next; continue;
      end if;

      if exists (select 1 from parent_welcome_sends ws where ws.parent_id = v_id) then
        outcome := 'Skipped: already sent';
        return next; continue;
      end if;

      select pr.id, u.last_sign_in_at, u.email into v_login, v_signed_in, v_email
      from profiles pr join auth.users u on u.id = pr.id
      where pr.parent_id = v_id and pr.role = 'parent'
      limit 1;
      if not found then
        v_login := null; v_signed_in := null; v_email := null;
      end if;

      if v_signed_in is not null then
        outcome := 'Skipped: has already signed in';
        email := v_email;
        return next; continue;
      end if;

      v_pw := parent_first_password(v_id);
      if v_pw is null then
        outcome := 'Skipped: no date of birth on file for a current child';
        return next; continue;
      end if;

      if v_login is null then
        v_email := nullif(lower(trim(rec.email)), '');
        email := v_email;
        if v_email is null then
          outcome := 'Skipped: no email address';
          return next; continue;
        end if;
        if exists (select 1 from auth.users u where lower(u.email) = v_email) then
          outcome := 'Skipped: email already used by another parent''s login';
          return next; continue;
        end if;

        v_login := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
        values ('00000000-0000-0000-0000-000000000000', v_login, 'authenticated', 'authenticated', v_email, crypt(v_pw, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), v_login, v_login::text, jsonb_build_object('sub', v_login::text, 'email', v_email), 'email', now(), now(), now());
        insert into profiles (id, role, parent_id, must_change_password) values (v_login, 'parent', v_id, true)
          on conflict (id) do update set role = 'parent', parent_id = v_id, must_change_password = true;
      else
        v_email := sync_parent_login_email(v_id, v_login);
        update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now()
        where id = v_login;
        update profiles set must_change_password = true where id = v_login;
      end if;

      email := v_email;
      v_name := coalesce(nullif(trim(coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '')), ''), 'Parent');
      perform send_parent_welcome_email(v_email, v_name, v_pw);
      insert into parent_welcome_sends (parent_id, email) values (v_id, v_email);
      outcome := 'Sent';
      return next;
    exception when others then
      outcome := 'Error: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$function$

```

### `send_parent_welcome_email(p_email text, p_name text, p_temp_password text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  body_html text;
  password_html text;
  v_parent_id integer;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent. Re-enable with: update system_settings set parent_emails_paused = false;';
  end if;

  -- Resolve through the login, not parents.email: 47 emails are shared by
  -- more than one parent row, but each login belongs to exactly one parent.
  select pr.parent_id into v_parent_id
  from auth.users u
  join profiles pr on pr.id = u.id
  where lower(u.email) = lower(p_email) and pr.role = 'parent'
  limit 1;

  if p_temp_password is not distinct from parent_first_password(v_parent_id) then
    password_html := '<strong>Password:</strong> ' || p_temp_password || '</p>' ||
      '<p>Your password is your oldest child''s date of birth, written as 8 numbers: day, month, year, ' ||
      'with no spaces or slashes. For example, a child born on 24 March 2012 would be <strong>24032012</strong>.</p>';
  else
    password_html := '<strong>Password:</strong> ' || p_temp_password || '</p>';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p><strong>Introducing Formwork, our new school information system</strong></p>' ||
    '<p>Adorable British College has introduced a new online system called <strong>Formwork</strong>. ' ||
    'It gives you a parent account where you can follow your child''s school life in one place, ' ||
    'at any time, from a phone, tablet or computer.</p>' ||

    '<p><strong>Formwork is separate from SIMS</strong></p>' ||
    '<p>You may already be familiar with SIMS, including the SIMS Parent app. Formwork is a completely ' ||
    'separate system that runs on a different server from SIMS. This means:</p>' ||
    '<ul>' ||
      '<li>Your SIMS username and password will <strong>not</strong> work on Formwork. Please use the new login details below.</li>' ||
      '<li>Formwork has its own web address, <a href="https://misform.work">misform.work</a>. It is not reached through the SIMS Parent app or the SIMS website.</li>' ||
      '<li>Changing your password in one system does not change it in the other.</li>' ||
    '</ul>' ||

    '<p><strong>What you can see in Formwork</strong></p>' ||
    '<p>For each of your children:</p>' ||
    '<ul>' ||
      '<li>their timetable</li>' ||
      '<li>their results compared with their target grades</li>' ||
      '<li>their behaviour record</li>' ||
      '<li>their attendance, including today lesson by lesson</li>' ||
      '<li>school fees and payment history</li>' ||
      '<li>their tuckshop balance and spending</li>' ||
      '<li>messages from the school in your inbox</li>' ||
    '</ul>' ||

    '<p><strong>Your login details</strong></p>' ||
    '<p><strong>Web address:</strong> <a href="https://misform.work">misform.work</a><br/>' ||
    '<strong>Login email:</strong> ' || p_email || '<br/>' ||
    password_html ||
    '<p>The first time you sign in, Formwork will ask you to choose your own new password ' ||
    '(at least 8 characters). After that, use the new password you chose. ' ||
    'Keep it private: the school will never ask you for it.</p>' ||

    '<p><strong>Need help?</strong></p>' ||
    '<p>If you cannot sign in, or something about your child looks wrong, please contact the school office ' ||
    'and we will be happy to help.</p>' ||

    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Introducing Formwork: your new parent account (separate from SIMS)',
      'html', body_html,
      'reply_to', email_reply_to('parent_welcome')
    )
  );
end;
$function$

```

### `send_staff_welcome_email(p_email text, p_name text, p_temp_password text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_staff_welcome_email(p_email text, p_name text, p_temp_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  body_html text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>You now have a staff account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your timetable, take attendance registers, enter results, and access student and behaviour records relevant to your role.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS staff account',
      'html', body_html,
      'reply_to', email_reply_to('staff_student_welcome')
    )
  );
end;
$function$

```

### `send_student_welcome_email(p_email text, p_name text, p_temp_password text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.send_student_welcome_email(p_email text, p_name text, p_temp_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  body_html text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>You now have a student account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your results, target grades, timetable and behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS student account',
      'html', body_html,
      'reply_to', email_reply_to('staff_student_welcome')
    )
  );
end;
$function$

```

### `send_workspace_email_key()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.send_workspace_email_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_temp'
AS $function$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'send_workspace_email_key';
$function$

```

### `set_academic_year_dates(p_academic_year_id integer, p_start date, p_end date)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_academic_year_dates(p_academic_year_id integer, p_start date, p_end date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  y academic_years;
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change academic years.';
  end if;
  select * into y from academic_years where academic_year_id = p_academic_year_id;
  if y.academic_year_id is null then
    raise exception 'Academic year not found.';
  end if;
  if y.status = 'closed' then
    raise exception 'A closed year can''t be changed.';
  end if;
  if p_start is null or p_end is null or p_start >= p_end then
    raise exception 'The year must start before it ends.';
  end if;
  if exists (select 1 from academic_years
             where academic_year_id <> p_academic_year_id
               and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'Those dates overlap another academic year.';
  end if;

  update academic_years set start_date = p_start, end_date = p_end
   where academic_year_id = p_academic_year_id;

  update terms t
     set academic_year_id = (select ay.academic_year_id from academic_years ay
                              where t.start_date between ay.start_date and ay.end_date);
end;
$function$

```

### `set_backup_run_reference(p_reference text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_backup_run_reference(p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can record a backup run reference.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.system_backup_mode
     set run_reference = p_reference, updated_at = now()
   where id;
end;
$function$

```

### `set_behaviour_event_class()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_behaviour_event_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ids integer[];
begin
  if new.class_id is not null and not exists (
    select 1 from student_class sc
    where sc.class_id = new.class_id and sc.student_id = new.student_id
  ) then
    new.class_id := null;
  end if;

  if new.class_id is not null or new.staff_id is null then
    return new;
  end if;

  select array_agg(c.class_id) into v_ids
  from classes c
  join student_class sc on sc.class_id = c.class_id
  left join curriculum_blocks cb on cb.block_id = c.block_id
  where c.staff_id = new.staff_id
    and sc.student_id = new.student_id
    and cb.block_name is distinct from 'Mentor';

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    select array_agg(c.class_id) into v_ids
    from classes c
    join student_class sc on sc.class_id = c.class_id
    join curriculum_blocks cb on cb.block_id = c.block_id
    where c.staff_id = new.staff_id
      and sc.student_id = new.student_id
      and cb.block_name = 'Mentor';
  end if;

  if array_length(v_ids, 1) = 1 then
    new.class_id := v_ids[1];
  end if;
  return new;
end;
$function$

```

### `set_behaviour_event_default_visibility()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_behaviour_event_default_visibility()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.type = 'positive' and new.visible_to_parents is not true then
    new.visible_to_parents := true;
  end if;
  return new;
end;
$function$

```

### `set_behaviour_event_logged_by()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_behaviour_event_logged_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_staff_id integer;
begin
  if auth.uid() is not null then
    select staff_id into v_staff_id from profiles where id = auth.uid();
    new.staff_id := v_staff_id;
  end if;
  return new;
end;
$function$

```

### `set_behaviour_event_points_from_category()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_behaviour_event_points_from_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_points integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.category is not distinct from old.category
     and new.type is not distinct from old.type then
    if new.points is distinct from old.points and new.points is distinct from 0 then
      raise exception 'Behaviour points are set by the category and cannot be changed';
    end if;
    return new;
  end if;

  select default_points into v_points
  from behaviour_categories
  where name = new.category and type = new.type;

  if v_points is null then
    raise exception 'Choose a % behaviour category — points are set by the category', new.type;
  end if;

  new.points := v_points;
  return new;
end;
$function$

```

### `set_behaviour_photo_defaults()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_behaviour_photo_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.office_notified_at := null;
  new.created_at := now();
  if auth.uid() is not null then
    select staff_id into new.uploaded_by from profiles where id = auth.uid();
  end if;
  return new;
end;
$function$

```

### `set_behaviour_rules(p_detention_single_event_points integer, p_detention_weekly_total_points integer, p_alert_weekly_total_points integer, p_detention_room text, p_detention_time text, p_serious_event_points integer)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_behaviour_rules(p_detention_single_event_points integer, p_detention_weekly_total_points integer, p_alert_weekly_total_points integer, p_detention_room text, p_detention_time text, p_serious_event_points integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change behaviour rules.';
  end if;
  if p_detention_single_event_points >= 0 or p_detention_weekly_total_points >= 0
     or p_alert_weekly_total_points >= 0 or p_serious_event_points >= 0 then
    raise exception 'Behaviour thresholds are negative points (e.g. -5).';
  end if;

  update behaviour_rules set
    detention_single_event_points = p_detention_single_event_points,
    detention_weekly_total_points = p_detention_weekly_total_points,
    alert_weekly_total_points = p_alert_weekly_total_points,
    serious_event_points = p_serious_event_points,
    updated_by = auth.uid(),
    updated_at = now()
  where id;

  update system_settings set
    detention_room = nullif(btrim(p_detention_room), ''),
    detention_time = nullif(btrim(p_detention_time), '');
end;
$function$

```

### `set_behaviour_rules(p_detention_single_event_points integer, p_detention_weekly_total_points integer, p_alert_weekly_total_points integer, p_detention_room text, p_detention_time text)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.set_behaviour_rules(p_detention_single_event_points integer, p_detention_weekly_total_points integer, p_alert_weekly_total_points integer, p_detention_room text, p_detention_time text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select set_behaviour_rules(p_detention_single_event_points, p_detention_weekly_total_points,
    p_alert_weekly_total_points, p_detention_room, p_detention_time,
    (select serious_event_points from behaviour_rules where id));
$function$

```

### `set_is_demo()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_is_demo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.is_demo is distinct from true then
    new.is_demo := is_demo_account();
  end if;
  return new;
end;
$function$

```

### `set_parent_emails_paused(p_paused boolean, p_note text DEFAULT NULL::text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_parent_emails_paused(p_paused boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_who text;
  v_stamp text;
begin
  if not is_admin() then
    raise exception 'Only admin can pause or resume parent emails' using errcode = 'insufficient_privilege';
  end if;

  select nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), '')
    into v_who
  from profiles pr left join staff s on s.staff_id = pr.staff_id
  where pr.id = auth.uid();

  v_stamp := case when p_paused then 'Paused' else 'Resumed' end
    || ' ' || to_char(school_now(), 'FMDD Mon YYYY, HH24:MI')
    || coalesce(' by ' || v_who, '');

  update system_settings
     set parent_emails_paused = p_paused,
         parent_emails_paused_note = v_stamp || coalesce(' — ' || nullif(trim(p_note), ''), ''),
         updated_at = now()
   where id = true;
end;
$function$

```

### `set_student_class_block_id()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_student_class_block_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    SELECT c.block_id, COALESCE(cb.is_compound, false) INTO NEW.block_id, NEW.is_compound
    FROM classes c LEFT JOIN curriculum_blocks cb ON cb.block_id = c.block_id
    WHERE c.class_id = NEW.class_id;
    RETURN NEW;
END;
$function$

```

### `set_student_login_lock(p_student_id integer, p_locked boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_student_login_lock(p_student_id integer, p_locked boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_locked then
    update auth.users u
       set banned_until = 'infinity'
      from public.profiles p
     where p.id = u.id
       and p.student_id = p_student_id
       and u.banned_until is distinct from 'infinity';

    delete from auth.sessions s
     using public.profiles p
     where p.id = s.user_id
       and p.student_id = p_student_id;
  else
    update auth.users u
       set banned_until = null
      from public.profiles p
     where p.id = u.id
       and p.student_id = p_student_id
       and u.banned_until = 'infinity'
       and u.email ilike '%@abc.sch.ng';
  end if;
end;
$function$

```

### `set_term_published(p_term_id bigint, p_published boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_term_published(p_term_id bigint, p_published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if is_demo_account() then
    raise exception 'Publishing fee terms is disabled for the training account.';
  end if;

  if not user_has_staff_role(array['smt']) then
    raise exception 'Only admin or SMT can publish fees to parents';
  end if;

  update fee_terms
  set published_to_parents = p_published,
      published_at = case when p_published then now() else null end,
      published_by = case when p_published then auth.uid() else null end
  where id = p_term_id;
end;
$function$

```

### `set_tuckshop_ordering(p_closed_until date, p_note text DEFAULT NULL::text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_tuckshop_ordering(p_closed_until date, p_note text DEFAULT NULL::text)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if not (is_admin() or user_has_staff_role(array['tuckshop', 'bursar'])) then
    raise exception 'Only tuckshop, bursar or admin staff can open or close tuckshop ordering';
  end if;

  if p_closed_until is not null and p_closed_until <= v_today then
    raise exception 'Reopen date must be after today (%). To reopen now, clear the date instead.', v_today;
  end if;

  update system_settings
  set tuckshop_ordering_closed_until = p_closed_until,
      tuckshop_ordering_closed_note = p_note,
      updated_at = now()
  where id = true;

  return p_closed_until;
end;
$function$

```

### `set_tuckshop_orders_given(p_student_ids integer[], p_for_date date, p_given boolean)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_tuckshop_orders_given(p_student_ids integer[], p_for_date date, p_given boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order record;
  v_count integer := 0;
  v_student integer;
begin
  if not has_staff_role(array['tuckshop', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can mark orders as given';
  end if;

  -- Same lock as save_tuckshop_order(), so an order can't be changed while
  -- it's being charged.
  for v_student in select distinct s from unnest(coalesce(p_student_ids, '{}')) as s order by s
  loop
    perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), v_student);
    if tuckshop_handout_locked(v_student, p_for_date) then
      raise exception 'This list has been saved, so it can''t be changed. Only the tuckshop owner can unlock it.';
    end if;
  end loop;

  if p_given then
    for v_order in
      select id from tuckshop_preorders
      where student_id = any(p_student_ids) and for_date = p_for_date and status = 'pending'
      order by id
    loop
      perform fulfill_tuckshop_preorder(v_order.id, auth.uid());
      v_count := v_count + 1;
    end loop;
  else
    for v_order in
      select id, purchase_id from tuckshop_preorders
      where student_id = any(p_student_ids) and for_date = p_for_date and status = 'fulfilled'
      order by id
    loop
      update tuckshop_preorders set status = 'pending', purchase_id = null where id = v_order.id;
      if v_order.purchase_id is not null then
        delete from tuckshop_purchase_items where purchase_id = v_order.purchase_id;
        delete from tuckshop_purchases where id = v_order.purchase_id;
      end if;
      v_count := v_count + 1;
    end loop;
  end if;

  return v_count;
end;
$function$

```

### `set_updated_at()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```

### `smt_reply_to_addresses()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.smt_reply_to_addresses()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(array_agg(distinct lower(trim(st.email))), array[]::text[])
  from staff st
  join staff_roles sr on sr.staff_id = st.staff_id
  where sr.role_name = 'smt'
    and st.email is not null and length(trim(st.email)) > 0;
$function$

```

### `staff_never_signed_in()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.staff_never_signed_in()
 RETURNS TABLE(staff_id integer, staff_name text, email text, account_created timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can list staff who have never signed in';
  end if;

  return query
    select s.staff_id,
           trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
           s.email,
           u.created_at
    from staff s
    join profiles p on p.staff_id = s.staff_id
    join auth.users u on u.id = p.id
    where s.email is not null
      and u.last_sign_in_at is null
    order by u.created_at, s.last_name;
end;
$function$

```

### `stamp_actor()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.stamp_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- TG_ARGV[0] is the column to stamp. auth.uid() is null for cron jobs and
  -- other database-side callers, which keep the value they passed.
  if auth.uid() is not null then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], auth.uid()));
  end if;
  return new;
end;
$function$

```

### `start_backup_mode(p_reason text DEFAULT NULL::text, p_minutes integer DEFAULT 30)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.start_backup_mode(p_reason text DEFAULT NULL::text, p_minutes integer DEFAULT 30)
 RETURNS system_backup_mode
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result public.system_backup_mode;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can put the system into backup mode.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'Backup mode must expire between 1 and 60 minutes from now (got %).', p_minutes
      using errcode = 'invalid_parameter_value';
  end if;

  update public.system_backup_mode
     set active        = true,
         started_at    = now(),
         started_by    = auth.uid(),
         expires_at    = now() + make_interval(mins => p_minutes),
         reason        = p_reason,
         run_reference = null,
         updated_at    = now()
   where id
  returning * into result;

  return result;
end;
$function$

```

### `student_attendance_summary(p_student_id integer)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.student_attendance_summary(p_student_id integer)
 RETURNS TABLE(scope text, window_start date, sessions bigint, present bigint, late bigint, authorized_absence bigint, absent bigint, late_minutes bigint, late_with_minutes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with bounds as (
    select
      school_today() as today,
      school_today() - (extract(isodow from school_today())::int - 1) as week_start,
      case
        when extract(month from school_today()) >= 8
          then make_date(extract(year from school_today())::int, 8, 1)
        else make_date(extract(year from school_today())::int - 1, 8, 1)
      end as august
  ),
  window_starts as (
    select
      b.today,
      b.week_start,
      coalesce(
        (select min(t.start_date) from terms t
          where t.start_date >= b.august and t.start_date < b.august + interval '1 year'),
        b.august
      ) as year_start
    from bounds b
  ),
  marks as (
    select a.attend_date, a.status, a.minutes_late
    from attendance a, window_starts w
    where a.student_id = p_student_id
      and a.attend_date >= w.year_start
      and a.attend_date <= w.today
  ),
  scopes as (
    select * from (values ('today', 1), ('week', 2), ('year', 3)) as v(scope, ord)
  )
  select
    sc.scope,
    case sc.scope when 'today' then w.today when 'week' then w.week_start else w.year_start end,
    count(m.attend_date),
    count(*) filter (where m.status = 'present'),
    count(*) filter (where m.status = 'late'),
    count(*) filter (where m.status = 'authorized_absence'),
    count(*) filter (where m.status = 'absent'),
    coalesce(sum(m.minutes_late), 0),
    count(*) filter (where m.status = 'late' and m.minutes_late is not null)
  from scopes sc
  cross join window_starts w
  left join marks m on (
    (sc.scope = 'today' and m.attend_date = w.today) or
    (sc.scope = 'week' and m.attend_date >= w.week_start) or
    (sc.scope = 'year')
  )
  group by sc.scope, sc.ord, w.today, w.week_start, w.year_start
  order by sc.ord;
$function$

```

### `student_core_fields()` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.student_core_fields()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select array['first_name', 'middle_name', 'last_name', 'preferred_name', 'legal_first_name', 'legal_last_name', 'upn', 'student_email', 'dob', 'year_group', 'form_class', 'admission_date', 'admitted_letter_date', 'gender', 'nationality', 'state_of_origin', 'lga', 'home_town', 'religion', 'boarding_house', 'boarding_room_number', 'sports_house', 'restaurant', 'national_identity_number', 'neco_exam_number', 'utme_pin', 'utme_profile_code', 'address_line1', 'address_line2', 'city', 'postcode', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'medical_notes', 'leaving_date', 'status', 'photo_base64']::text[];
$function$

```

### `student_never_signed_in()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.student_never_signed_in()
 RETURNS TABLE(student_id integer, student_name text, year_group integer, email text, account_created timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can list students who have never signed in';
  end if;

  return query
    select s.student_id,
           trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
           s.year_group,
           s.student_email,
           u.created_at
    from students s
    join profiles p on p.student_id = s.student_id
    join auth.users u on u.id = p.id
    where s.status = 'active'
      and s.student_email is not null
      and u.last_sign_in_at is null
    order by s.year_group, s.last_name, s.first_name;
end;
$function$

```

### `student_siblings(p_student_id integer)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.student_siblings(p_student_id integer)
 RETURNS TABLE(student_id integer, first_name text, last_name text, year_group integer, form_class text, status text, leaving_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.student_id, s.first_name, s.last_name, s.year_group, s.form_class, s.status::text, s.leaving_date
  from students s
  where public.is_staff_or_admin()
    and s.student_id <> p_student_id
    and (
      exists (
        select 1
        from student_parent mine
        join student_parent theirs on theirs.parent_id = mine.parent_id
        join parents p on p.parent_id = mine.parent_id
        where mine.student_id = p_student_id
          and theirs.student_id = s.student_id
          and lower(trim(coalesce(mine.relationship, p.relationship_type, ''))) <> 'other'
          and lower(trim(coalesce(theirs.relationship, p.relationship_type, ''))) <> 'other'
      )
      or s.family_id = (select me.family_id from students me where me.student_id = p_student_id)
    )
  order by (s.status = 'active') desc, s.year_group desc, s.last_name, s.first_name;
$function$

```

### `students_with_parent_login(p_student_ids integer[])` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.students_with_parent_login(p_student_ids integer[])
 RETURNS SETOF integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not has_resource_access('/reports/documents') then
    raise exception 'Not allowed';
  end if;
  return query
    select distinct sp.student_id
    from student_parent sp
    join profiles p on p.parent_id = sp.parent_id
    where sp.student_id = any(p_student_ids);
end;
$function$

```

### `submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_merged jsonb;
begin
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(item_id bigint, quantity integer)
    where x.item_id is null or x.quantity is null or x.quantity < 1
  ) then
    raise exception 'Each item needs a quantity of at least 1';
  end if;

  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);

  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', qty)), '[]'::jsonb)
  into v_merged
  from (
    select item_id, sum(quantity)::integer as qty
    from (
      select x.item_id, x.quantity
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(item_id bigint, quantity integer)
      union all
      select i.tuckshop_item_id, i.quantity
      from tuckshop_preorders p
      join tuckshop_preorder_items i on i.preorder_id = p.id
      where p.student_id = p_student_id and p.for_date = p_for_date and p.status = 'pending'
    ) u
    group by item_id
  ) m;

  return save_tuckshop_order(p_student_id, p_for_date, v_merged);
end;
$function$

```

### `sync_mentor_group_from_form_class()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.sync_mentor_group_from_form_class()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.form_class IS NULL THEN
    NEW.mentor_group_id := NULL;
  ELSE
    SELECT mentor_group_id INTO NEW.mentor_group_id
    FROM mentor_groups WHERE group_name = NEW.form_class;
  END IF;
  RETURN NEW;
END;
$function$

```

### `sync_parent_login_email(p_parent_id integer, p_login uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.sync_parent_login_email(p_parent_id integer, p_login uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_current text;
  v_signed_in timestamptz;
  v_new text;
begin
  select u.email, u.last_sign_in_at into v_current, v_signed_in
  from auth.users u where u.id = p_login;

  select nullif(lower(trim(p.email)), '') into v_new
  from parents p where p.parent_id = p_parent_id;

  if v_signed_in is not null or v_new is null or v_new = lower(v_current) then
    return v_current;
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_new and u.id <> p_login) then
    raise exception 'new email % is already used by another login', v_new;
  end if;

  update auth.users set email = v_new, updated_at = now() where id = p_login;
  update auth.identities
    set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new)), updated_at = now()
  where user_id = p_login and provider = 'email';
  update profiles set email = v_new where id = p_login and email is not null;

  return v_new;
end;
$function$

```

### `teaches_student_for_subject(p_student_id integer, p_subject_id integer)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.teaches_student_for_subject(p_student_id integer, p_subject_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from profiles p
    join classes c on c.staff_id = p.staff_id
    join student_class sc on sc.class_id = c.class_id
    where p.id = auth.uid()
      and p.staff_id is not null
      and c.subject_id = p_subject_id
      and sc.student_id = p_student_id
  );
$function$

```

### `tidy_email_reply_route()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.tidy_email_reply_route()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_bad text;
begin
  new.addresses := coalesce(array(
    select distinct lower(trim(a)) from unnest(new.addresses) a
    where length(trim(a)) > 0 order by 1), '{}');
  select string_agg(a, ', ') into v_bad from unnest(new.addresses) a where not is_plain_email(a);
  if v_bad is not null then
    raise exception 'Not an email address: %', v_bad;
  end if;
  new.updated_at := now();
  return new;
end;
$function$

```

### `timetable_slot_takes_bell_time()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.timetable_slot_takes_bell_time()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  b bell_times%rowtype;
begin
  select * into b from bell_times
   where day_of_week = new.day_of_week and period_number = new.period_number;
  if found then
    new.start_time := b.start_time;
    new.end_time := b.end_time;
  end if;
  return new;
end;
$function$

```

### `todays_birthdays()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.todays_birthdays()
 RETURNS TABLE(person_type text, first_name text, last_name text, form_class text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select 'student', s.first_name, s.last_name, s.form_class
  from students s
  where is_birthday_on(s.dob, school_today())
    and s.status = 'active'
    and not s.is_demo
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'student'))
  union all
  select 'staff', st.first_name, st.last_name, null
  from staff st
  join staff_hr_profiles h on h.staff_id = st.staff_id
  where is_birthday_on(h.date_of_birth, school_today())
    and not st.is_demo
    and (h.leaving_date is null or h.leaving_date >= school_today())
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'student'))
  order by 1 desc, 3, 2;
$function$

```

### `top_up_tuckshop_balance(p_student_id integer, p_term_id bigint, p_target_balance numeric, p_created_by uuid)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.top_up_tuckshop_balance(p_student_id integer, p_term_id bigint, p_target_balance numeric, p_created_by uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
 SET search_path TO 'public', 'pg_temp'
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

### `touch_admission_places()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.touch_admission_places()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$

```

### `touch_sgb_updated_at()` — SECURITY INVOKER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.touch_sgb_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```

### `trg_provision_staff_login()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.trg_provision_staff_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  new_password text;
  new_user_id uuid;
  staff_name text;
begin
  if new.email is null then
    return new;
  end if;
  if exists (select 1 from profiles where staff_id = new.staff_id) then
    return new;
  end if;

  new_password := substr(md5(random()::text), 1, 10);
  new_user_id := gen_random_uuid();

  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', new.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', new.email), 'email', now(), now(), now());

    insert into profiles (id, role, staff_id, email)
    values (new_user_id, 'staff', new.staff_id, new.email);
  exception when unique_violation then
    -- Email already used by another auth account - leave it for a human to sort out.
    return new;
  end;

  staff_name := coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '');
  begin
    perform send_staff_welcome_email(new.email, staff_name, new_password);
  exception when others then
    raise notice 'Welcome email failed for %: %', new.email, sqlerrm;
  end;

  return new;
end;
$function$

```

### `trg_provision_student_login()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.trg_provision_student_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  new_password text;
  new_user_id uuid;
  student_name text;
  v_login uuid;
  v_current text;
  v_signed_in timestamptz;
  v_new text;
begin
  if new.student_email is null then
    return new;
  end if;

  select p.id into v_login from profiles p where p.student_id = new.student_id limit 1;
  if found then
    v_new := nullif(lower(trim(new.student_email)), '');
    if tg_op <> 'UPDATE' or v_new is null
       or v_new = lower(trim(coalesce(old.student_email, ''))) then
      return new;
    end if;

    select u.email, u.last_sign_in_at into v_current, v_signed_in
    from auth.users u where u.id = v_login;
    if v_signed_in is not null or v_new = lower(v_current) then
      return new;
    end if;

    if exists (select 1 from auth.users u where lower(u.email) = v_new and u.id <> v_login) then
      raise exception 'The email % is already used by another login, so it can''t be given to this student.', v_new;
    end if;

    update auth.users set email = v_new, updated_at = now() where id = v_login;
    update auth.identities
      set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new)), updated_at = now()
    where user_id = v_login and provider = 'email';
    update profiles set email = v_new where id = v_login and email is not null;
    return new;
  end if;

  new_password := substr(md5(random()::text), 1, 10);
  new_user_id := gen_random_uuid();

  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', new.student_email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', new.student_email), 'email', now(), now(), now());

    insert into profiles (id, role, student_id, email)
    values (new_user_id, 'student', new.student_id, new.student_email);
  exception when unique_violation then
    return new;
  end;

  student_name := coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '');
  begin
    perform send_student_welcome_email(new.student_email, student_name, new_password);
  exception when others then
    raise notice 'Welcome email failed for %: %', new.student_email, sqlerrm;
  end;

  return new;
end;
$function$

```

### `trg_recalc_invoice_status()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.trg_recalc_invoice_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM recalc_invoice_status(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END;
$function$

```

### `tuckshop_handout_locked(p_student_id integer, p_for_date date)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.tuckshop_handout_locked(p_student_id integer, p_for_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from tuckshop_handout_saves h
    join students s on coalesce(s.restaurant, '') = h.restaurant
    where s.student_id = p_student_id and h.for_date = p_for_date and h.unlocked_at is null
  );
$function$

```

### `tuckshop_next_order_date()` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.tuckshop_next_order_date()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select for_date from tuckshop_order_windows(14)
  order by is_open desc, closes_at
  limit 1;
$function$

```

### `tuckshop_order_window(p_for_date date)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.tuckshop_order_window(p_for_date date)
 RETURNS TABLE(opens_at timestamp with time zone, closes_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select ss.opens_at, ss.closes_at
  from tuckshop_special_sessions ss
  where ss.for_date = p_for_date
  union all
  select ((p_for_date - ((s.service_dow - s.opens_dow + 7) % 7)) + s.opens_time) at time zone 'Africa/Lagos',
         ((p_for_date - ((s.service_dow - s.closes_dow + 7) % 7)) + s.closes_time) at time zone 'Africa/Lagos'
  from tuckshop_order_schedule s
  where s.service_dow = extract(isodow from p_for_date)
    and not exists (select 1 from tuckshop_special_sessions ss where ss.for_date = p_for_date);
$function$

```

### `tuckshop_order_windows(p_days integer DEFAULT 14)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.tuckshop_order_windows(p_days integer DEFAULT 14)
 RETURNS TABLE(for_date date, opens_at timestamp with time zone, closes_at timestamp with time zone, is_open boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d::date, w.opens_at, w.closes_at, now() >= w.opens_at and now() < w.closes_at
  from generate_series(
         (now() at time zone 'Africa/Lagos')::date,
         (now() at time zone 'Africa/Lagos')::date + p_days,
         interval '1 day'
       ) as d
  cross join lateral tuckshop_order_window(d::date) w
  where w.closes_at > now()
  order by w.closes_at;
$function$

```

### `tuckshop_ordering_closed()` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.tuckshop_ordering_closed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (now() at time zone 'Africa/Lagos')::date
      < (select tuckshop_ordering_closed_until from system_settings limit 1),
    false
  );
$function$

```

### `tuckshop_preorder_cutoff(p_for_date date)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.tuckshop_preorder_cutoff(p_for_date date)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select closes_at from tuckshop_order_window(p_for_date);
$function$

```

### `tuckshop_preorder_locked(p_for_date date)` — SECURITY INVOKER, sql
```sql
CREATE OR REPLACE FUNCTION public.tuckshop_preorder_locked(p_for_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(now() >= tuckshop_preorder_cutoff(p_for_date), true);
$function$

```

### `unban_parent_login()` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.unban_parent_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.role = 'parent' then
    update auth.users
       set banned_until = null
     where id = new.id
       and banned_until = 'infinity';
  end if;
  return new;
end;
$function$

```

### `undo_fee_charge_batch(p_batch_id bigint)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.undo_fee_charge_batch(p_batch_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_count integer;
begin
  if is_demo_account() then
    raise exception 'Fee charges are disabled for the training account.';
  end if;

  if not user_has_staff_role(array['bursar', 'smt']) then
    raise exception 'Only bursar/SMT can undo fee charge batches';
  end if;

  delete from invoice_line_items where batch_id = p_batch_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$

```

### `unlock_tuckshop_handout(p_for_date date, p_restaurant text)` — SECURITY DEFINER, plpgsql
```sql
CREATE OR REPLACE FUNCTION public.unlock_tuckshop_handout(p_for_date date, p_restaurant text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not is_tuckshop_owner() then
    raise exception 'Only the tuckshop owner can unlock a saved hand-out list';
  end if;

  update tuckshop_handout_saves
  set unlocked_at = now(), unlocked_by = auth.uid()
  where for_date = p_for_date and restaurant = coalesce(p_restaurant, '') and unlocked_at is null;

  if not found then
    raise exception 'That list isn''t locked';
  end if;
end;
$function$

```

### `upcoming_birthdays(p_days integer DEFAULT 7)` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.upcoming_birthdays(p_days integer DEFAULT 7)
 RETURNS TABLE(person_type text, person_id integer, first_name text, last_name text, year_group integer, form_class text, staff_code text, birthday date, days_until integer, turning_age integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with days as (
    select d::date as day, (d::date - school_today()) as days_until
    from generate_series(
      school_today(),
      school_today() + greatest(least(coalesce(p_days, 7), 31), 1) - 1,
      interval '1 day'
    ) d
  )
  select 'student', s.student_id, s.first_name, s.last_name, s.year_group,
         s.form_class, null::text, d.day, d.days_until,
         (extract(year from d.day) - extract(year from s.dob))::integer
  from students s
  join days d on is_birthday_on(s.dob, d.day)
  where s.status = 'active'
    and not s.is_demo
    and has_resource_access('/pastoral/birthdays')
  union all
  select 'staff', st.staff_id, st.first_name, st.last_name, null, null,
         st.staff_code, d.day, d.days_until, null
  from staff st
  join staff_hr_profiles h on h.staff_id = st.staff_id
  join days d on is_birthday_on(h.date_of_birth, d.day)
  where not st.is_demo
    and (h.leaving_date is null or h.leaving_date >= school_today())
    and has_resource_access('/pastoral/birthdays')
  order by 9, 1, 4, 3;
$function$

```

### `user_has_staff_role(role_names text[])` — SECURITY DEFINER, sql
```sql
CREATE OR REPLACE FUNCTION public.user_has_staff_role(role_names text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event behaviour_events%rowtype;
  v_week_start date;
  v_week_total integer;
begin
  if new.status = 'upheld' and (old.status is distinct from 'upheld') then
    update behaviour_events
    set voided_points = points,
        points = 0,
        voided_at = coalesce(new.reviewed_at, now())
    where event_id = new.event_id and voided_at is null
    returning * into v_event;

    if v_event.event_id is not null then
      v_week_start := v_event.event_date - (((extract(dow from v_event.event_date)::int - 6 + 7) % 7));

      select coalesce(sum(points), 0) into v_week_total
      from behaviour_events
      where student_id = v_event.student_id and type = 'negative' and voided_at is null
        and event_date between v_week_start and v_week_start + 6;

      update detentions set status = 'cancelled'
      where status = 'scheduled'
        and (
          behaviour_event_id = v_event.event_id
          or (v_week_total > -10
              and student_id = v_event.student_id
              and detention_date = v_week_start + 6
              and behaviour_event_id is null)
        );
    end if;
  end if;
  return new;
end;
$function$

```
