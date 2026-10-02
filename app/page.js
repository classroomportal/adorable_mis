'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { canHandOut } from '../lib/tuckshopHandout';
import SplashScreen from './components/SplashScreen';
import { ParentPortalInner } from './parent-portal/page';
import { findMyParentId } from '../lib/parentByEmail';
import { useTileOrder, sortTiles } from '../lib/tileOrder';
import StudentHome from './components/StudentHome';
import TuckshopOrderingStatus from './components/TuckshopOrderingStatus';

// Every chip is the same fixed-size box, whatever the length of its label, and
// carries a one-line description that pops out on hover or keyboard focus.
function Chip({ href, label, desc, disabled, tipId }) {
  const tip = desc && <span className="module-chip-tip" id={tipId} role="tooltip">{desc}</span>;
  if (disabled) {
    return (
      <span className="module-chip module-chip-soon" title="Not available on the training account yet">
        <span className="module-chip-label">{label}</span>
      </span>
    );
  }
  return (
    <a className="module-chip" href={href} aria-describedby={desc ? tipId : undefined}>
      <span className="module-chip-label">{label}</span>
      {tip}
    </a>
  );
}


// Staff who are also parents: their login is linked to a parent record
// (profiles.parent_id), or failing that their sign-in email matches one.
// profiles.email is empty for most logins, so it can't be relied on; the
// sign-in email comes from the session.
function useIsStaffParent() {
  const { session, profile } = useAuth();
  const [isParent, setIsParent] = useState(false);
  useEffect(() => {
    if (profile?.parent_id) { setIsParent(true); return; }
    findMyParentId().then((id) => setIsParent(!!id));
  }, [profile, session]);
  return isParent;
}

// Row 2: Log behaviour and Inbox (both moved here from row 1 at the
// principal's request, migrations 292 and 294), and Missed Lessons and the
// Homework Monitor for those with the page (migrations 307–308, 311). The numbers that used to sit
// here are on their module cards (292–293). Order set at /admin/tile-order.
function DashboardStats({ hasAccess }) {
  const { session } = useAuth();
  const [unread, setUnread] = useState(null);
  const [missed, setMissed] = useState(null);
  const order = useTileOrder('staff_stats');
  const canSeeMissed = hasAccess('/pastoral/missed-lessons');

  // Students in school today who have missed a lesson (migration 308).
  useEffect(() => {
    if (!canSeeMissed) return undefined;
    const load = () => supabase.rpc('students_missed_lessons').then(({ data }) => setMissed(data?.students?.length ?? null));
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [canSeeMissed]);

  useEffect(() => {
    if (!session?.user) return;
    supabase
      .from('message_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', session.user.id)
      .is('read_at', null)
      .then(({ count }) => setUnread(count ?? 0));
  }, [session]);

  const tiles = sortTiles([
    // Logging behaviour is the thing most staff come here to do, so it has
    // a big tile of its own rather than only a chip on the Students card.
    { key: 'log_behaviour', href: '/behaviour', label: 'Log behaviour', icon: '✍️', accent: 'students', sub: 'Positive or negative, one student or a group' },
    {
      key: 'inbox', href: '/inbox', label: 'Inbox', icon: '✉️', accent: 'family',
      sub: unread == null ? 'Your messages' : unread === 0 ? 'No unread messages' : `${unread} unread`,
    },
    {
      key: 'missed_lessons', href: '/pastoral/missed-lessons', label: 'Missed Lessons', icon: '🚸', accent: 'clinic',
      sub: missed == null ? 'In school today, but missed a lesson'
        : missed === 0 ? 'Nobody has missed a lesson today'
        : `${missed} student${missed === 1 ? '' : 's'} missed a lesson today`,
    },
    // Migration 311: SMT see the homework being set, as students see it.
    { key: 'homework_monitor', href: '/homework/monitor', label: 'Homework Monitor', icon: '📘', accent: 'school', sub: 'Homework set, by year group or student' },
  ].filter((l) => hasAccess(l.href)), order);
  return <TileRow tiles={tiles} />;
}

// Class Progress is a top-row tile for Heads of Department, SMT and admins
// (the principal, 1 Oct 2026, migration 312): an HoD sees their department's
// classes, SMT and admins see every class (my_department_scope()). Everyone
// else with the page (teachers, pastoral, assessment staff) keeps the link on
// the Assessment card instead.
function showsClassProgressTile(hasAccess, staffRoles, isAdmin) {
  const roles = staffRoles || [];
  return hasAccess('/classes/progress') && (isAdmin || roles.includes('smt') || roles.includes('head_of_department'));
}

// Row 1: the everyday destinations, timetable and calendar, My Children
// for staff who are also parents (moved here from row 2 at the principal's
// request, migration 294), and Class Progress for HoDs and SMT (312). Order
// set school-wide at /admin/tile-order.
function QuickLinks({ hasAccess, staffRoles, isAdmin }) {
  const order = useTileOrder('staff');
  const isParent = useIsStaffParent();
  const roles = staffRoles || [];
  const wholeSchool = isAdmin || roles.includes('smt');
  const tiles = sortTiles([
    { key: 'timetable', href: '/staff/timetable', label: 'My Timetable', icon: '🗓️', accent: 'myinfo', sub: 'Your lessons, rooms and meetings' },
    { key: 'calendar', href: '/calendar', label: 'Calendar', icon: '📅', accent: 'school', sub: 'Term dates and school events' },
    isParent && { key: 'my_children', href: '/parent-portal', label: 'My Children', icon: '👪', accent: 'students', sub: "Your children's grades and behaviour" },
    showsClassProgressTile(hasAccess, staffRoles, isAdmin) && {
      key: 'class_progress', href: '/classes/progress', label: 'Class Progress', icon: '📈', accent: 'school',
      sub: wholeSchool ? 'Every class against its targets' : "Your department's classes against their targets",
    },
  ].filter((l) => l && hasAccess(l.href)), order);
  return <TileRow tiles={tiles} className="quick-link-row" />;
}

function TileRow({ tiles, className = '' }) {
  if (tiles.length === 0) return null;
  return (
    <div className={`stat-card-row ${className}`.trim()}>
      {tiles.map((c) => (
        <a key={c.key} className={`stat-card quick-link accent-${c.accent}`} href={c.href}>
          <div className="stat-card-icon">{c.icon}</div>
          <div>
            <div className="quick-link-label">{c.label}</div>
            <div className="stat-card-label">{c.sub}</div>
          </div>
        </a>
      ))}
    </div>
  );
}

// A module card names what it's for, then lists its destinations as pill buttons.
// allowedHrefs, when given, greys out any item not in the set instead of hiding it —
// used by the training account so it can see the full shape of what a real SMT
// member has access to, without being able to actually open the unverified parts.
// Next year's admissions at a glance, beside the Admissions icon: every
// application for the entry year being recruited for (withdrawn ones left
// out), and how many families have accepted a place (accepted, deposit paid
// or enrolled). Only fetched for people who can see applicants (RLS agrees).
function AdmissionsCounts() {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    (async () => {
      const { data: years } = await supabase.from('academic_years').select('academic_year_id, label, status').order('start_date');
      const year = (years || []).find((y) => y.status === 'planning') || (years || []).find((y) => y.status === 'current');
      if (!year) return;
      const base = () => supabase.from('applicants').select('applicant_id', { count: 'exact', head: true })
        .eq('entry_academic_year_id', year.academic_year_id);
      const [{ count: applied }, { count: accepted }] = await Promise.all([
        base().neq('status', 'withdrawn'),
        base().in('status', ['accepted', 'deposit_paid', 'enrolled']),
      ]);
      setCounts({ label: year.label, applied: applied ?? 0, accepted: accepted ?? 0 });
    })();
  }, []);
  if (!counts) return null;
  const box = { textAlign: 'center', minWidth: '4.5rem' };
  return (
    <a href="/admissions" style={{ display: 'flex', gap: '1rem', textDecoration: 'none', color: 'inherit' }} title={`Admissions for ${counts.label}`}>
      <div style={box}>
        <div className="stat-card-value">{counts.applied}</div>
        <div className="stat-card-label">Applications {counts.label}</div>
      </div>
      <div style={box}>
        <div className="stat-card-value">{counts.accepted}</div>
        <div className="stat-card-label">Accepted</div>
      </div>
    </a>
  );
}

// A number beside a module card's icon, linking to where it comes from, in
// the same style as the Admissions counts. They moved off the dashboard's
// second row at the principal's request (migrations 292–293).
//
// All three come from one call to dashboard_card_counts() (migration 316),
// which counts without running every row through RLS: three separate counts
// on every dashboard load were a large part of the 08:00 slowdown. A count is
// null when the caller lacks the card's page, so the card shows none.
const CARD_COUNTS = {
  students: { field: 'students', href: '/students', label: 'Active students', title: 'Find a student' },
  staff: { field: 'staff', href: '/staff/roles', label: 'Staff', title: 'Staff and their roles' },
  pastoral: {
    // The alerts page opens with the /behaviour grant; no role holds a
    // '/behaviour/alerts' key, so checking the href hid the count from
    // everyone except admin logins (cs@ is admin by role, not login).
    field: 'behaviour_alerts', href: '/behaviour/alerts', resource: '/behaviour', label: 'Behaviour alerts (7 days)', title: 'Behaviour alerts',
  },
};

// The cards on one dashboard share a single request.
let cardCountsPromise = null;
function loadCardCounts() {
  if (!cardCountsPromise) {
    cardCountsPromise = supabase.rpc('dashboard_card_counts').then(({ data }) => data || {});
    setTimeout(() => { cardCountsPromise = null; }, 30000);
  }
  return cardCountsPromise;
}

function CardCount({ cardKey }) {
  const spec = CARD_COUNTS[cardKey];
  const [count, setCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadCardCounts().then((counts) => { if (!cancelled) setCount(counts[spec.field] ?? null); });
    return () => { cancelled = true; };
  }, [spec]);
  if (count == null) return null;
  return (
    <a href={spec.href} style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', minWidth: '4.5rem' }} title={spec.title}>
      <div className="stat-card-value">{count}</div>
      <div className="stat-card-label">{spec.label}</div>
    </a>
  );
}

function ModuleCard({ icon, label, accent, description, items, allowedHrefs, extra }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`module-card accent-${accent}`}>
      {extra ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div className="module-card-icon">{icon}</div>
          {extra}
        </div>
      ) : (
        <div className="module-card-icon">{icon}</div>
      )}
      <div className="module-card-title">{label}</div>
      {description && <div className="module-card-desc">{description}</div>}
      <div className="module-card-chips">
        {items.map((it) => (
          <Chip
            key={it.href}
            href={it.href}
            label={it.label}
            desc={it.desc}
            // Some links sit on more than one card, so the card label keeps ids unique.
            tipId={`tip-${label}-${it.href}`.replace(/[^\w-]/g, '-')}
            disabled={allowedHrefs && !allowedHrefs.has(it.href)}
          />
        ))}
      </div>
    </div>
  );
}

// Tab visibility and item filtering both come from hasAccess() (backed by
// the resources/role_permissions tables an admin edits at
// /admin/permissions), instead of the hardcoded adminOnly/roles arrays this
// used to carry. ModuleCard already hides a tab once its items list is
// empty, so a tab with no accessible items just disappears — no separate
// tab-level gate needed.
// A page with a big tile in row 1 or 2 isn't also a link on a card (the
// principal, 1 Oct 2026: the cards had become cluttered): Missed Lessons,
// Homework Monitor, and Class Progress for those who get its tile.
const TABS = [
  {
    key: 'students', label: 'Students', icon: '🎓', accent: 'students',
    description: 'Core records, behaviour, attendance, results and certificates.',
    items: ({ hasAccess }) => [
      { href: '/students', label: 'Core Data', desc: "Find a student and open their full record." },
      { href: '/behaviour/log', label: 'Behaviour Log', resource: '/behaviour', desc: "Look up, open and correct logged behaviour. Log new behaviour from the big tile at the top." },
      { href: '/attendance', label: 'Attendance', desc: "Take a register for a lesson or mentor group." },
      { href: '/results', label: 'Results', desc: "Browse weekly results against target grades." },
      { href: '/results/enter', label: 'Enter Results', desc: "Type in marks for a class." },
      { href: '/homework', label: 'Homework', desc: "Set homework for a class and record grades. Years 10 and 11 for now." },
      // Shares the /results grant rather than having a resource of its own.
      { href: '/results/missing', label: 'Missing Grades', resource: '/results', desc: "Classes that still have marks to enter." },
      { href: '/results/subject-overview', label: 'Review Results', desc: "A student's exam results in each subject against the cohort average." },
      // Detentions, Certificates and Behaviour Appeals live on the Pastoral
      // card only (the principal, 30 Sept 2026: one place for each link).
    ].filter((it) => hasAccess(it.resource || it.href)),
  },
  {
    key: 'pastoral', label: 'Pastoral', icon: '💛', accent: 'students',
    description: 'Behaviour, detentions, registers and mentor groups.',
    // Class Allocation is on the Timetable card only (the principal, 30 Sept
    // 2026: one place for each link); pastoral staff and HoDs with the page
    // still see it there, because a card shows whatever links a person has.
    items: ({ hasAccess }) => [
      { href: '/detention', label: 'Detentions', desc: "This week's Friday detention list." },
      { href: '/certificates', label: 'Certificates', desc: "Students due a Bronze, Silver or Gold certificate." },
      { href: '/behaviour/review', label: 'Behaviour Review', desc: "Check serious incidents (office) and behaviour pictures (SMT) before parents can see them." },
      { href: '/appeals', label: 'Behaviour Appeals', desc: "Accept or reject students' behaviour appeals." },
      { href: '/pastoral/registers-not-done', label: 'Missing Registers', desc: "Today's registers that haven't been taken." },
      { href: '/attendance/planned-absences', label: 'Planned Absences', desc: "Give a student one attendance code for a run of days: illness, holiday, exclusion." },
      { href: '/pastoral/unallocated', label: 'Unallocated Students', desc: "Students with no boarding house, no room, or gaps in their timetable." },
      { href: '/pastoral/birthdays', label: 'Birthdays', desc: "Staff and students with a birthday in the next 7 days." },
      { href: '/admin/register-alerts', label: 'Register Alerts', desc: "Staff who didn't take a register on time." },
      { href: '/staff/mentor-groups', label: 'Mentor Groups', desc: "Assign staff to each mentor group." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'admissions', label: 'Admissions', icon: '📥', accent: 'family',
    description: 'Applications, entrance tests, interviews, offers and letters.',
    items: ({ hasAccess }) => [
      { href: '/admissions', label: 'Applicants', desc: "Every application for an entry year, and where it has got to." },
      { href: '/admissions/new', label: 'New Application', resource: '/admissions', desc: "Record a new application and the family's contacts." },
      { href: '/admissions/projections', label: "Next Year's Numbers", resource: '/admissions', desc: "New places for boys and girls in each year next year, how many are still free, and next year's roll." },
      { href: '/admissions/sessions', label: 'Test Days', desc: "Fix test dates, book applicants on, and enter English, Maths and CAT4." },
      { href: '/admissions/papers', label: 'Test Papers', desc: "The English and Maths paper for each year group, and its maximum mark." },
      { href: '/admissions/letters', label: 'Standard Letters', desc: "The school's letters for test dates, interviews, offers and outcomes." },
      { href: '/admissions/schools', label: 'Previous Schools', desc: "Schools applicants come from; merge duplicates." },
    ].filter((it) => hasAccess(it.resource || it.href)),
  },
  {
    key: 'clinic', label: 'Clinic', icon: '🩺', accent: 'clinic',
    description: 'Sick bay log, height & weight rounds and immunisations.',
    items: ({ hasAccess }) => [
      { href: '/clinic', label: 'Sick Bay Today', desc: "Who is in the sick bay today, and follow-ups." },
      { href: '/clinic/screenings', label: 'Resumption Check', desc: "Start-of-term medical check for boarders." },
      { href: '/clinic/visits', label: 'Sick Bay Log', desc: "Record a sick bay visit and see past visits." },
      { href: '/clinic/measurements', label: 'Height & Weight', desc: "Enter heights and weights for a whole group." },
      { href: '/clinic/immunisations', label: 'Immunisations', desc: "Vaccinations that are due or overdue." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'reports', label: 'Reports', icon: '📝', accent: 'students',
    description: 'Write, check and generate student reports.',
    items: ({ hasAccess }) => [
      { href: '/reports/write-subject-comments', label: 'Subject Comments', desc: "Write report comments for your classes." },
      { href: '/reports/write-pastoral-comments', label: 'Pastoral Comments', desc: "Write the pastoral comment for your mentees." },
      { href: '/reports/check', label: 'Check Reports', desc: "Read, AI-check and approve submitted comments." },
      { href: '/reports/periods', label: 'Report Periods', desc: "Set up report periods and who checks them." },
      { href: '/reports/generate', label: 'Generate Reports', desc: "Produce the finished student reports." },
      { href: '/reports/documents', label: 'Upload Documents', desc: "Publish PDFs from outside Formwork to students' parents." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'comms', label: 'Communication', icon: '💬', accent: 'family',
    description: 'Announcements, read receipts and login emails to staff, parents and students.',
    items: ({ hasAccess }) => [
      { href: '/comms/compose', label: 'Send Message', desc: "Send a message to parents, groups or staff." },
      { href: '/comms/history', label: 'Sent Messages', desc: "Past messages and who has read them." },
      { href: '/staff/welcome-emails', label: 'Staff Logins', desc: "Email staff their login link." },
      { href: '/parents/welcome-emails', label: 'Parent Logins', desc: "Email parents their login details." },
      { href: '/students/welcome-emails', label: 'Student Logins', desc: "Email students who have never signed in their login link." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'timetable', label: 'Timetable', icon: '🗓️', accent: 'school',
    description: 'Timetable imports, bell times, class allocation and printing.',
    items: ({ hasAccess }) => [
      { href: '/admin/block-allocation', label: 'Class Allocation', desc: "Put students into classes, block by block." },
      // Whole-school Nova-T re-import stays admin-only — HoDs get the tab for
      // Class Allocation, not this.
      { href: '/admin/import-classes', label: 'Import Nova-T', desc: "Upload the Nova-T timetable files." },
      { href: '/admin/next-year', label: 'Next Year Setup', desc: "Next year's mentor groups, then its Nova-T timetable, planned without touching this year." },
      { href: '/admin/import-staff-commitments', label: 'Import Meetings', desc: "Upload staff meetings and non-working periods." },
      { href: '/admin/bell-times', label: 'Bell Times', desc: "Which periods run each day, and their times." },
      { href: '/admin/print-timetables', label: 'Print Timetables', desc: "Print student timetables for a year group." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'otherhalf', label: 'The Other Half', icon: '🎭', accent: 'myinfo',
    description: 'Activities in the Other Half slot — your registers, the programme and student choices.',
    items: ({ hasAccess }) => [
      { href: '/other-half', label: 'My Other Half', desc: "Your Other Half activities and registers." },
      { href: '/other-half/activities', label: 'Activities', desc: "Set up each term's Other Half programme." },
      { href: '/other-half/choices', label: 'Student Choices', desc: "See and adjust students' activity choices." },
      { href: '/other-half/absentees', label: 'Absentees', desc: "Everyone missing from the Other Half on a given day." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'assessment', label: 'Assessment', icon: '📊', accent: 'school',
    description: 'Import results, target grades and manage grading setup.',
    // Class Progress is here only for those without its top-row tile.
    items: ({ hasAccess, staffRoles, isAdmin }) => [
      { href: '/results/import-gradebook', label: 'Import Results', desc: "Upload the weekly Moodle gradebook." },
      { href: '/target-grades/import', label: 'Import Targets', desc: "Upload students' target grades." },
      !showsClassProgressTile(hasAccess, staffRoles, isAdmin) && { href: '/classes/progress', label: 'Class Progress', desc: "A class's results against their targets." },
      { href: '/results/top-ten', label: 'Top 10', desc: "Print the top 10 students for a result set." },
      { href: '/admin/grade-boundaries', label: 'Grade Boundaries', desc: "Score cut-offs that turn marks into grades." },
      { href: '/admin/subject-settings', label: 'Subject Settings', desc: "Departments, key stages and subject names." },
      { href: '/assessments/import', label: 'Import CAT4/NGRT', desc: "Upload CAT4 and NGRT scores." },
      { href: '/reading-ages', label: 'Reading Ages', desc: "Reading age against actual age, and how the gap changes over time." },
      { href: '/assessments/grade-history', label: 'Grade History', desc: "Every grade entered, changed or deleted, and who did it." },
    ].filter((it) => it && hasAccess(it.href)),
  },
  {
    key: 'fees', label: 'Fees & Bills', icon: '💳', accent: 'family',
    description: 'Charges, payments, discounts and the debtors list.',
    items: ({ hasAccess }) => [
      { href: '/bursar/fee-approvals', label: 'Fee Approvals', desc: "New fee prices, approved by the principal and the college secretary together." },
      { href: '/bursar/charge-checklist', label: 'Charge Checklist', desc: "Charge a fee to a group of students." },
      { href: '/bursar/fee-items', label: 'Fee Items', desc: "Fee items and their prices." },
      { href: '/bursar/discounts', label: 'Discounts', desc: "Give students fee discounts." },
      { href: '/bursar/payments', label: 'Record a Payment', desc: "Record a fee payment." },
      { href: '/bursar/fees-table', label: 'All Students', desc: "Charged, paid and owed for every student." },
      { href: '/bursar/debtors', label: 'Debtors List', desc: "Students who owe fees, with parent contacts." },
      { href: '/bursar/audit', label: 'Audit', desc: "Recent fee charges, with undo." },
      { href: '/bursar/admission-forms', label: 'Admission Payments', desc: "Admission form fees and deposits from applicants' families." },
      { href: '/smt/fees-dashboard', label: 'SMT Dashboard', desc: "Fee collection totals, and publishing fees to parents." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'tuckshop', label: 'Tuckshop', icon: '🍭', accent: 'family',
    description: 'Sell items, top up balances and manage stock.',
    items: ({ hasAccess, staffRoles }) => [
      { href: '/tuckshop/purchase', label: 'Sell Items', desc: "Sell items from a student's balance." },
      { href: '/tuckshop/topup', label: 'Top Up Balance', desc: "Add money to tuckshop balances." },
      { href: '/bursar/tuckshop-top-up', label: 'Add Paid Top-Up', desc: "Put a payment you've recorded onto a student's tuckshop balance." },
      { href: '/tuckshop/balances', label: 'Balances', desc: "Every student's tuckshop balance." },
      { href: '/tuckshop/preorders', label: 'Preorders', desc: "Student preorders waiting to be handed out." },
      { href: '/tuckshop/items', label: 'Items & Prices', desc: "Tuckshop items and prices." },
      { href: '/tuckshop/order-sheets', label: 'Order Sheets', desc: "Printable order sheets for each tuckshop day." },
      { href: '/tuckshop/hand-out', label: 'Hand Out Orders', desc: "Tick off orders as they're given, by restaurant." },
      { href: '/tuckshop/ordering', label: 'Ordering On/Off', desc: "Close and reopen student ordering." },
    ].filter((it) => (it.href === '/tuckshop/hand-out' ? canHandOut(staffRoles) : hasAccess(it.href))),
  },
  {
    key: 'staff', label: 'Staff & Access', icon: '🔐', accent: 'admin',
    description: 'Staff accounts, roles, permissions and parent records.',
    items: ({ hasAccess }) => [
      { href: '/staff/records', label: 'Staff Records', desc: "HR record for each staff member." },
      { href: '/staff/roles', label: 'Staff & Roles', desc: "Give staff their roles." },
      { href: '/staff/import-emails', label: 'Import Emails', desc: "Add staff login emails from a list." },
      { href: '/admin/permissions', label: 'Permissions', desc: "Choose which roles can open which pages." },
      { href: '/parents', label: 'Parents', desc: "Parent records and their logins." },
      { href: '/parents/view-as', label: 'View as Parent', desc: "See the parent portal as a parent sees it." },
      { href: '/parents/import', label: 'Import Parents', desc: "Upload the SIMS parent list." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'administration', label: 'Administration', icon: '⏰', accent: 'admin',
    description: 'Lookups, student numbers, class lists, imports and backups.',
    items: ({ hasAccess }) => [
      { href: '/admin/lookups', label: 'Lookups', desc: "Drop-down lists such as houses and behaviour types." },
      { href: '/groups', label: 'Student Groups', desc: "Groups of students for activities, marks and messages." },
      { href: '/admin/student-numbers', label: 'Student Numbers', desc: "Boys and girls by year, mentor group and class." },
      { href: '/admin/class-lists', label: 'Class Lists', desc: "Print class lists." },
      { href: '/students/import', label: 'Import Students', desc: "Upload a student list." },
      { href: '/students/photos/import', label: 'Import Photos', desc: "Upload student photos." },
      { href: '/admin/backup', label: 'Run a Backup', desc: "Take a full backup of the database." },
      { href: '/admin/change-history', label: 'Change History', desc: "Changes to registers, fees, behaviour, roles and parent links, and who made them." },
      { href: '/admin/email-replies', label: 'Email Replies', desc: "Who gets the reply when someone answers a Formwork email." },
      { href: '/admin/tile-order', label: 'Arrange Tiles', desc: "The order of the big tiles on students' and staff dashboards, for everyone." },
      // /admin/import-timetable (SIMS student-class upload) is no longer used:
      // allocations are kept in Formwork, and that upload only ever added
      // students to classes, never took them out. Hidden, not deleted.
    ].filter((it) => hasAccess(it.href)),
  },
];

export default function Home() {
  const { session, profile, staffRoles, hasAccess } = useAuth();
  const isAdmin = profile?.role === 'admin';
  // Order of the larger tiles, set at /admin/tile-order (migration 282).
  const moduleOrder = useTileOrder('staff_modules');
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    if (session && !sessionStorage.getItem('splashShown')) {
      setShowSplash(true);
      sessionStorage.setItem('splashShown', '1');
    }
  }, [session]);

  if (showSplash) {
    return <SplashScreen onDone={() => setShowSplash(false)} />;
  }

  if (!session) {
    return (
      <div className="welcome-card">
        <h1>Formwork</h1>
        <p>School management information system for Adorable British College.</p>
        <a href="/login"><button>Sign in</button></a>
      </div>
    );
  }

  if (profile?.role === 'student') {
    return <StudentHome />;
  }

  if (profile?.role === 'parent') {
    return <ParentPortalInner />;
  }

  // Training accounts see the same set of module cards a real staff member with
  // their roles would see — full shape of the app, nothing hidden — but only the
  // links actually verified as demo-data-isolated are clickable. Everything else
  // (Fees & Bills, Communication, Reports, Registers Not Done, Mentor Groups) is
  // shown greyed out: either that module's schema was never captured in this repo
  // so it can't safely be demo-scoped yet, or it touches real, unscoped data
  // (Communication genuinely emails real people — blocked server-side too, see
  // migration 081, so greying it out here is a UX nicety, not the real safeguard).
  if (profile?.is_demo_account) {
    const demoAllowedHrefs = new Set([
      '/staff/timetable', '/calendar', '/inbox',
      '/students', '/behaviour', '/attendance', '/results', '/certificates', '/detention', '/appeals',
    ]);
    return (
      <div>
        <div className="card" style={{ borderLeft: '4px solid #c07d1f', background: '#fff7e0' }}>
          <strong>Training account.</strong> Everything below is fake practice data that resets automatically — nothing you do here affects real students. Greyed-out links aren't available on this account yet.
        </div>
        <h1>Welcome — Training Account</h1>
        <div className="module-card-grid">
          {TABS.map((t) => (
            <ModuleCard
              key={t.key}
              icon={t.icon}
              label={t.label}
              accent={t.accent}
              description={t.description}
              items={t.items({ hasAccess, staffRoles, isAdmin })}
              allowedHrefs={demoAllowedHrefs}
            />
          ))}
        </div>
      </div>
    );
  }

  // Bursar staff get a dedicated finance-only landing page instead of the full
  // multi-role staff dashboard, unless they also hold a broader role (admin).
  if (!isAdmin && (staffRoles || []).includes('bursar')) {
    const bursarTabs = sortTiles(TABS.filter((t) => t.key === 'fees' || t.key === 'tuckshop'), moduleOrder);
    return (
      <div>
        <h1>Welcome — Bursar</h1>
        <div className="module-card-grid">
          {bursarTabs.map((t) => (
            <ModuleCard
              key={t.key}
              icon={t.icon}
              label={t.label}
              accent={t.accent}
              description={t.description}
              items={t.items({ hasAccess, staffRoles, isAdmin })}
              extra={t.key === 'tuckshop' ? <TuckshopOrderingStatus /> : null}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <QuickLinks hasAccess={hasAccess} staffRoles={staffRoles} isAdmin={isAdmin} />
      <DashboardStats hasAccess={hasAccess} />
      <div className="module-card-grid">
        {sortTiles(TABS, moduleOrder).map((t) => (
          <ModuleCard
            key={t.key}
            icon={t.icon}
            label={t.label}
            accent={t.accent}
            description={t.description}
            items={t.items({ hasAccess, staffRoles, isAdmin })}
            extra={t.key === 'admissions' && hasAccess('/admissions') ? <AdmissionsCounts />
              : t.key === 'tuckshop' ? <TuckshopOrderingStatus />
              : CARD_COUNTS[t.key] && hasAccess(CARD_COUNTS[t.key].resource || CARD_COUNTS[t.key].href) ? <CardCount cardKey={t.key} />
              : null}
          />
        ))}
      </div>
    </div>
  );
}
