'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { schoolDateOffset } from '../lib/schoolTime';
import SplashScreen from './components/SplashScreen';
import { ParentPortalInner } from './parent-portal/page';

function Chip({ href, label, disabled }) {
  if (disabled) {
    return (
      <span className="module-chip module-chip-soon" title="Not available on the training account yet">
        {label}
      </span>
    );
  }
  return (
    <a className="module-chip" href={href}>
      {label}
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
          <Chip key={it.href} href={it.href} label={it.label} disabled={allowedHrefs && !allowedHrefs.has(it.href)} />
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
    key: 'home', label: 'Dashboard', icon: '🏠', accent: 'myinfo',
    description: 'Your day-to-day — timetable, family, calendar and messages.',
    items: ({ hasAccess }) => [
      { href: '/staff/timetable', label: 'My Timetable' },
      { href: '/parent-portal', label: 'My Children' },
      { href: '/calendar', label: 'Calendar' },
      { href: '/inbox', label: 'Inbox' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'students', label: 'Students', icon: '🎓', accent: 'students',
    description: 'Core records, behaviour, attendance, results and certificates.',
    items: ({ hasAccess }) => [
      { href: '/students', label: 'Core Data' },
      { href: '/behaviour', label: 'Behaviour Log' },
      { href: '/behaviour/review', label: 'Review Serious Behaviour Events' },
      { href: '/attendance', label: 'Attendance' },
      { href: '/results', label: 'Results' },
      { href: '/results/enter', label: 'Enter Results' },
      { href: '/results/subject-overview', label: 'Subject Overview' },
      { href: '/certificates', label: 'Certificates' },
      { href: '/detention', label: 'Detention List' },
      { href: '/appeals', label: 'Behaviour Appeals' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'pastoral', label: 'Pastoral', icon: '💛', accent: 'students',
    description: 'Pastoral oversight — behaviour, detentions and mentor groups.',
    // Class Allocation only goes to pastoral/head_of_department in
    // role_permissions — only the pastoral role (plus admin) actually has
    // student_class write access (migration 105), houseparent/smt don't.
    items: ({ hasAccess }) => [
      { href: '/detention', label: 'Detentions' },
      { href: '/certificates', label: 'Certificates' },
      { href: '/pastoral/registers-not-done', label: 'Registers Not Done' },
      { href: '/appeals', label: 'Behaviour Appeals' },
      { href: '/staff/mentor-groups', label: 'Mentor Groups' },
      { href: '/admin/block-allocation', label: 'Class Allocation' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'clinic', label: 'Clinic', icon: '🩺', accent: 'clinic',
    description: 'Sick bay log, height & weight rounds and immunisations.',
    items: ({ hasAccess }) => [
      { href: '/clinic', label: 'Sick Bay Dashboard' },
      { href: '/clinic/screenings', label: 'Resumption Screening' },
      { href: '/clinic/visits', label: 'Sick Bay Log' },
      { href: '/clinic/measurements', label: 'Height & Weight Round' },
      { href: '/clinic/immunisations', label: 'Immunisations' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'reports', label: 'Reports', icon: '📝', accent: 'students',
    description: 'Write, check and generate student reports.',
    items: ({ hasAccess }) => [
      { href: '/reports/write-subject-comments', label: 'Write Subject Comments' },
      { href: '/reports/write-pastoral-comments', label: 'Write Pastoral Comments' },
      { href: '/reports/check', label: 'Check Reports' },
      { href: '/reports/periods', label: 'Manage Report Periods' },
      { href: '/reports/generate', label: 'Generate Reports' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'comms', label: 'Communication', icon: '💬', accent: 'family',
    description: 'Send announcements to parents and track read receipts.',
    items: ({ hasAccess }) => [
      { href: '/comms/compose', label: 'Send Announcements to Parents / Groups' },
      { href: '/comms/history', label: 'Message History & Read Receipts' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'timetable', label: 'Timetable', icon: '🗓️', accent: 'school',
    description: 'Manage timetables and class allocations.',
    items: ({ hasAccess }) => [
      { href: '/staff/timetable', label: 'My Timetable' },
      { href: '/admin/block-allocation', label: 'Class Allocation' },
      // Whole-school Nova-T re-import stays admin-only — HoDs get the tab for
      // Class Allocation, not this.
      { href: '/admin/import-classes', label: 'Import Nova-T Timetable' },
      { href: '/admin/import-staff-commitments', label: 'Import Staff Commitments (NCLASS.DAT)' },
      { href: '/admin/bell-times', label: 'Bell Times' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'otherhalf', label: 'The Other Half', icon: '🎭', accent: 'myinfo',
    description: 'Activities in the Other Half slot — your registers, the programme and student choices.',
    items: ({ hasAccess }) => [
      { href: '/other-half', label: 'My Other Half & Registers' },
      { href: '/other-half/activities', label: 'Activity Programme' },
      { href: '/other-half/choices', label: 'Student Choices' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'assessment', label: 'Assessment', icon: '📊', accent: 'school',
    description: 'Import results, target grades and manage grading setup.',
    items: ({ hasAccess }) => [
      { href: '/results/import-gradebook', label: 'Import Weekly Results' },
      { href: '/target-grades/import', label: 'Import Target Grades' },
      { href: '/classes/progress', label: 'Class Progress' },
      { href: '/admin/grade-boundaries', label: 'Grade Boundaries' },
      { href: '/admin/subject-settings', label: 'Subject Settings' },
      { href: '/assessments/import', label: 'Import CAT4/NGRT' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'fees', label: 'Fees & Bills', icon: '💳', accent: 'family',
    description: 'Charges, payments, discounts and the debtors list.',
    items: ({ hasAccess }) => [
      { href: '/bursar/charge-checklist', label: 'Charge Checklist' },
      { href: '/bursar/fee-items', label: 'Fee Items (Prices)' },
      { href: '/bursar/discounts', label: 'Discounts' },
      { href: '/bursar/payments', label: 'Record a Payment' },
      { href: '/bursar/fees-table', label: 'All Students (Table)' },
      { href: '/bursar/debtors', label: 'Debtors List' },
      { href: '/bursar/audit', label: 'Audit' },
      { href: '/smt/fees-dashboard', label: 'SMT Dashboard' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'tuckshop', label: 'Tuckshop', icon: '🍭', accent: 'family',
    description: 'Sell items, top up balances and manage stock.',
    items: ({ hasAccess }) => [
      { href: '/tuckshop/purchase', label: 'Sell Items' },
      { href: '/tuckshop/topup', label: 'Top Up Balance' },
      { href: '/tuckshop/balances', label: 'Balances' },
      { href: '/tuckshop/preorders', label: 'Preorders' },
      { href: '/tuckshop/items', label: 'Items & Prices' },
      { href: '/tuckshop/order-sheets', label: 'Order Sheets' },
      { href: '/tuckshop/ordering', label: 'Open / Close Ordering' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'staff', label: 'Staff & Access', icon: '🔐', accent: 'admin',
    description: 'Staff accounts, roles, permissions and parent records.',
    items: ({ hasAccess }) => [
      { href: '/staff/records', label: 'Staff Records' },
      { href: '/staff/roles', label: 'Staff & Roles' },
      { href: '/staff/import-emails', label: 'Bulk Import Staff Emails' },
      { href: '/admin/permissions', label: 'Permissions' },
      { href: '/admin/lookups', label: 'Lookups' },
      { href: '/staff/welcome-emails', label: 'Send Staff Welcome Emails' },
      { href: '/parents', label: 'Parents' },
      { href: '/parents/welcome-emails', label: 'Send Parent Welcome Emails' },
      { href: '/parents/import', label: 'Import Parents' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'administration', label: 'Administration', icon: '⏰', accent: 'admin',
    description: "Register follow-ups, lookups and reporting.",
    items: ({ hasAccess }) => [
      { href: '/admin/register-alerts', label: 'Register Alerts' },
      { href: '/behaviour/review', label: 'Review Serious Behaviour Events' },
      { href: '/admin/lookups', label: 'Lookups' },
      { href: '/admin/student-numbers', label: 'Student Numbers by Gender' },
      { href: '/admin/class-lists', label: 'Class Lists (Print)' },
      { href: '/admin/print-timetables', label: 'Print Timetables (Print)' },
    ].filter((it) => hasAccess(it.href)),
  },
  {
    key: 'setup', label: 'Initial Setup', icon: '📥', accent: 'setup',
    description: 'One-off imports for getting a new school set up.',
    items: ({ hasAccess }) => [
      { href: '/students/import', label: 'Import Students' },
      { href: '/students/photos/import', label: 'Import Photos' },
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
              { href: '/portal', label: 'My Grades & Behaviour' },
              { href: '/portal/tuckshop', label: 'Tuckshop' },
              { href: '/change-password', label: 'Change Password' },
            ]}
          />
          <ModuleCard
            icon="🎭" label="The Other Half" accent="students"
            description="Choose your activities for each Other Half slot."
            items={[
              { href: '/portal/other-half', label: 'Choose My Activities' },
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
