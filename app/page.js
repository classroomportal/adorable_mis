'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { schoolDateOffset } from '../lib/schoolTime';
import SplashScreen from './components/SplashScreen';
import { ParentPortalInner } from './parent-portal/page';

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

function StatCard({ label, value, icon, accent, href }) {
  return (
    <a className={`stat-card accent-${accent}`} href={href} style={{ textDecoration: 'none' }}>
      <div className="stat-card-icon">{icon}</div>
      <div>
        <div className="stat-card-value">{value ?? '—'}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </a>
  );
}

function DashboardStats({ isDemoAccount }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    async function load() {
      const [{ count: studentCount }, { count: staffCount }, { data: alerts }] = await Promise.all([
        supabase.from('students').select('student_id', { count: 'exact', head: true }).eq('status', 'active').eq('is_demo', !!isDemoAccount),
        supabase.from('staff').select('staff_id', { count: 'exact', head: true }).eq('is_demo', !!isDemoAccount),
        supabase.from('behaviour_events').select('event_id').eq('type', 'negative').eq('is_demo', !!isDemoAccount).gte('event_date', schoolDateOffset(-7)),
      ]);
      setStats({
        students: studentCount ?? 0,
        staff: staffCount ?? 0,
        alerts: (alerts || []).length,
      });
    }
    load();
  }, [isDemoAccount]);

  return (
    <div className="stat-card-row">
      <StatCard label="Active students" value={stats?.students} icon="🎓" accent="myinfo" href="/students" />
      <StatCard label="Staff" value={stats?.staff} icon="🧑‍🏫" accent="school" href="/staff/roles" />
      <StatCard label="Behaviour alerts (7 days)" value={stats?.alerts} icon="⚠️" accent="students" href="/behaviour" />
    </div>
  );
}

// The everyday destinations — timetable, calendar, inbox — as big tiles above
// the stats rather than a module card of their own, since nearly every member
// of staff uses them. My Children only appears for staff who are also parents
// (their login email matches a parent record, as on /parent-portal).
function QuickLinks({ hasAccess }) {
  const { session, profile } = useAuth();
  const [unread, setUnread] = useState(null);
  const [isParent, setIsParent] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    supabase
      .from('message_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', session.user.id)
      .is('read_at', null)
      .then(({ count }) => setUnread(count ?? 0));
  }, [session]);

  useEffect(() => {
    if (!profile?.email) return;
    supabase
      .from('parents')
      .select('parent_id')
      .eq('email', profile.email)
      .maybeSingle()
      .then(({ data }) => setIsParent(!!data));
  }, [profile]);

  const links = [
    { href: '/staff/timetable', label: 'My Timetable', icon: '🗓️', accent: 'myinfo', sub: 'Your lessons, rooms and meetings' },
    { href: '/calendar', label: 'Calendar', icon: '📅', accent: 'school', sub: 'Term dates and school events' },
    {
      href: '/inbox', label: 'Inbox', icon: '✉️', accent: 'family',
      sub: unread == null ? 'Your messages' : unread === 0 ? 'No unread messages' : `${unread} unread`,
    },
    isParent && { href: '/parent-portal', label: 'My Children', icon: '👪', accent: 'students', sub: "Your children's grades and behaviour" },
  ].filter((l) => l && hasAccess(l.href));
  if (links.length === 0) return null;

  return (
    <div className="stat-card-row quick-link-row">
      {links.map((l) => (
        <a key={l.href} className={`stat-card quick-link accent-${l.accent}`} href={l.href}>
          <div className="stat-card-icon">{l.icon}</div>
          <div>
            <div className="quick-link-label">{l.label}</div>
            <div className="stat-card-label">{l.sub}</div>
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
function ModuleCard({ icon, label, accent, description, items, allowedHrefs }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`module-card accent-${accent}`}>
      <div className="module-card-icon">{icon}</div>
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
const TABS = [
  {
    key: 'students', label: 'Students', icon: '🎓', accent: 'students',
    description: 'Core records, behaviour, attendance, results and certificates.',
    items: ({ hasAccess }) => [
      { href: '/students', label: 'Core Data', desc: "Find a student and open their full record." },
      { href: '/behaviour', label: 'Behaviour Log', desc: "Log and look up behaviour points." },
      { href: '/behaviour/review', label: 'Serious Incidents', desc: "Check serious incidents before parents can see them." },
      { href: '/attendance', label: 'Attendance', desc: "Take a register for a lesson or mentor group." },
      { href: '/results', label: 'Results', desc: "Browse weekly results against target grades." },
      { href: '/results/enter', label: 'Enter Results', desc: "Type in marks for a class." },
      // Shares the /results grant rather than having a resource of its own.
      { href: '/results/missing', label: 'Missing Grades', resource: '/results', desc: "Classes that still have marks to enter." },
      { href: '/results/subject-overview', label: 'Subject Overview', desc: "Chart a student's results over time." },
      { href: '/certificates', label: 'Certificates', desc: "Students due a Bronze, Silver or Gold certificate." },
      { href: '/detention', label: 'Detentions', desc: "This week's Friday detention list." },
      { href: '/appeals', label: 'Behaviour Appeals', desc: "Accept or reject students' behaviour appeals." },
    ].filter((it) => hasAccess(it.resource || it.href)),
  },
  {
    key: 'pastoral', label: 'Pastoral', icon: '💛', accent: 'students',
    description: 'Pastoral oversight — behaviour, detentions and mentor groups.',
    // Class Allocation only goes to pastoral/head_of_department in
    // role_permissions — only the pastoral role (plus admin) actually has
    // student_class write access (migration 105), houseparent/smt don't.
    items: ({ hasAccess }) => [
      { href: '/detention', label: 'Detentions', desc: "This week's Friday detention list." },
      { href: '/certificates', label: 'Certificates', desc: "Students due a Bronze, Silver or Gold certificate." },
      { href: '/pastoral/registers-not-done', label: 'Missing Registers', desc: "Today's registers that haven't been taken." },
      { href: '/appeals', label: 'Behaviour Appeals', desc: "Accept or reject students' behaviour appeals." },
      { href: '/staff/mentor-groups', label: 'Mentor Groups', desc: "Assign staff to each mentor group." },
      { href: '/admin/block-allocation', label: 'Class Allocation', desc: "Put students into classes, block by block." },
    ].filter((it) => hasAccess(it.href)),
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
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'comms', label: 'Communication', icon: '💬', accent: 'family',
    description: 'Announcements, read receipts and login emails to staff and parents.',
    items: ({ hasAccess }) => [
      { href: '/comms/compose', label: 'Send Message', desc: "Send a message to parents, groups or staff." },
      { href: '/comms/history', label: 'Sent Messages', desc: "Past messages and who has read them." },
      { href: '/staff/welcome-emails', label: 'Staff Logins', desc: "Email staff their login link." },
      { href: '/parents/welcome-emails', label: 'Parent Logins', desc: "Email parents their login details." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'timetable', label: 'Timetable', icon: '🗓️', accent: 'school',
    description: 'Manage timetables and class allocations.',
    items: ({ hasAccess }) => [
      { href: '/admin/block-allocation', label: 'Class Allocation', desc: "Put students into classes, block by block." },
      // Whole-school Nova-T re-import stays admin-only — HoDs get the tab for
      // Class Allocation, not this.
      { href: '/admin/import-classes', label: 'Import Nova-T', desc: "Upload the Nova-T timetable files." },
      { href: '/admin/import-staff-commitments', label: 'Import Meetings', desc: "Upload staff meetings and non-working periods." },
      { href: '/admin/bell-times', label: 'Bell Times', desc: "Which periods run each day, and their times." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'otherhalf', label: 'The Other Half', icon: '🎭', accent: 'myinfo',
    description: 'Activities in the Other Half slot — your registers, the programme and student choices.',
    items: ({ hasAccess }) => [
      { href: '/other-half', label: 'My Other Half', desc: "Your Other Half activities and registers." },
      { href: '/other-half/activities', label: 'Activities', desc: "Set up each term's Other Half programme." },
      { href: '/other-half/choices', label: 'Student Choices', desc: "See and adjust students' activity choices." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'assessment', label: 'Assessment', icon: '📊', accent: 'school',
    description: 'Import results, target grades and manage grading setup.',
    items: ({ hasAccess }) => [
      { href: '/results/import-gradebook', label: 'Import Results', desc: "Upload the weekly Moodle gradebook." },
      { href: '/target-grades/import', label: 'Import Targets', desc: "Upload students' target grades." },
      { href: '/classes/progress', label: 'Class Progress', desc: "A class's results against their targets." },
      { href: '/admin/grade-boundaries', label: 'Grade Boundaries', desc: "Score cut-offs that turn marks into grades." },
      { href: '/admin/subject-settings', label: 'Subject Settings', desc: "Departments, key stages and subject names." },
      { href: '/assessments/import', label: 'Import CAT4/NGRT', desc: "Upload CAT4 and NGRT scores." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'fees', label: 'Fees & Bills', icon: '💳', accent: 'family',
    description: 'Charges, payments, discounts and the debtors list.',
    items: ({ hasAccess }) => [
      { href: '/bursar/charge-checklist', label: 'Charge Checklist', desc: "Charge a fee to a group of students." },
      { href: '/bursar/fee-items', label: 'Fee Items', desc: "Fee items and their prices." },
      { href: '/bursar/discounts', label: 'Discounts', desc: "Give students fee discounts." },
      { href: '/bursar/payments', label: 'Record a Payment', desc: "Record a fee payment." },
      { href: '/bursar/fees-table', label: 'All Students', desc: "Charged, paid and owed for every student." },
      { href: '/bursar/debtors', label: 'Debtors List', desc: "Students who owe fees, with parent contacts." },
      { href: '/bursar/audit', label: 'Audit', desc: "Recent fee charges, with undo." },
      { href: '/smt/fees-dashboard', label: 'SMT Dashboard', desc: "Fee collection totals, and publishing fees to parents." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'tuckshop', label: 'Tuckshop', icon: '🍭', accent: 'family',
    description: 'Sell items, top up balances and manage stock.',
    items: ({ hasAccess }) => [
      { href: '/tuckshop/purchase', label: 'Sell Items', desc: "Sell items from a student's balance." },
      { href: '/tuckshop/topup', label: 'Top Up Balance', desc: "Add money to tuckshop balances." },
      { href: '/tuckshop/balances', label: 'Balances', desc: "Every student's tuckshop balance." },
      { href: '/tuckshop/preorders', label: 'Preorders', desc: "Student preorders waiting to be handed out." },
      { href: '/tuckshop/items', label: 'Items & Prices', desc: "Tuckshop items and prices." },
      { href: '/tuckshop/order-sheets', label: 'Order Sheets', desc: "Printable order sheets for each tuckshop day." },
      { href: '/tuckshop/ordering', label: 'Ordering On/Off', desc: "Close and reopen student ordering." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'staff', label: 'Staff & Access', icon: '🔐', accent: 'admin',
    description: 'Staff accounts, roles, permissions and parent records.',
    items: ({ hasAccess }) => [
      { href: '/staff/records', label: 'Staff Records', desc: "HR record for each staff member." },
      { href: '/staff/roles', label: 'Staff & Roles', desc: "Give staff their roles." },
      { href: '/staff/import-emails', label: 'Import Emails', desc: "Add staff login emails from a list." },
      { href: '/admin/permissions', label: 'Permissions', desc: "Choose which roles can open which pages." },
      { href: '/admin/lookups', label: 'Lookups', desc: "Drop-down lists such as houses and behaviour types." },
      { href: '/parents', label: 'Parents', desc: "Parent records and their logins." },
      { href: '/parents/import', label: 'Import Parents', desc: "Upload the SIMS parent list." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'administration', label: 'Administration', icon: '⏰', accent: 'admin',
    description: "Register follow-ups, lookups and reporting.",
    items: ({ hasAccess }) => [
      { href: '/admin/register-alerts', label: 'Register Alerts', desc: "Staff who didn't take a register on time." },
      { href: '/behaviour/review', label: 'Serious Incidents', desc: "Check serious incidents before parents can see them." },
      { href: '/admin/lookups', label: 'Lookups', desc: "Drop-down lists such as houses and behaviour types." },
      { href: '/admin/student-numbers', label: 'Student Numbers', desc: "Boys and girls by year, mentor group and class." },
      { href: '/admin/class-lists', label: 'Class Lists', desc: "Print class lists." },
      { href: '/admin/print-timetables', label: 'Print Timetables', desc: "Print student timetables for a year group." },
      { href: '/admin/backup', label: 'Run a Backup', desc: "Take a full backup of the database." },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'setup', label: 'Initial Setup', icon: '📥', accent: 'setup',
    description: 'One-off imports for getting a new school set up.',
    items: ({ hasAccess }) => [
      { href: '/students/import', label: 'Import Students', desc: "Upload a student list." },
      { href: '/students/photos/import', label: 'Import Photos', desc: "Upload student photos." },
      // /admin/import-timetable (SIMS student-class upload) is no longer used:
      // allocations are kept in Formwork, and that upload only ever added
      // students to classes, never took them out. Hidden, not deleted.
    ].filter((it) => hasAccess(it.href)),
  },
];

export default function Home() {
  const { session, profile, staffRoles, hasAccess } = useAuth();
  const isAdmin = profile?.role === 'admin';
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
    return (
      <div>
        <h1>Welcome{profile.student_id ? '' : ' — account not linked yet'}</h1>
        <div className="module-card-grid">
          <ModuleCard
            icon="📚" label="My Info" accent="myinfo"
            description="Your grades, behaviour record and account."
            items={[
              { href: '/portal', label: 'My Grades', desc: "Your grades, targets and behaviour record." },
              { href: '/portal/tuckshop', label: 'Tuckshop', desc: "Order from the tuckshop." },
              { href: '/change-password', label: 'Change Password', desc: "Choose a new password." },
            ]}
          />
          <ModuleCard
            icon="🎭" label="The Other Half" accent="students"
            description="Choose your activities for each Other Half slot."
            items={[
              { href: '/portal/other-half', label: 'Choose Activities', desc: "Pick one activity for each Other Half day." },
            ]}
          />
        </div>
      </div>
    );
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
              items={t.items({ hasAccess })}
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
    const bursarTabs = TABS.filter((t) => t.key === 'fees' || t.key === 'tuckshop');
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
              items={t.items({ hasAccess })}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <QuickLinks hasAccess={hasAccess} />
      <DashboardStats isDemoAccount={profile?.is_demo_account} />
      <div className="module-card-grid">
        {TABS.map((t) => (
          <ModuleCard
            key={t.key}
            icon={t.icon}
            label={t.label}
            accent={t.accent}
            description={t.description}
            items={t.items({ hasAccess })}
          />
        ))}
      </div>
    </div>
  );
}
