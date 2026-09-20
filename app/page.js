'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
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
        supabase.from('behaviour_events').select('event_id').eq('type', 'negative').eq('is_demo', !!isDemoAccount).gte('event_date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
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

const TABS = [
  {
    key: 'home', label: 'Dashboard', icon: '🏠', accent: 'myinfo',
    description: 'Your day-to-day — timetable, family, calendar and messages.',
    items: () => [
      { href: '/staff/timetable', label: 'My Timetable' },
      { href: '/parent-portal', label: 'My Children' },
      { href: '/calendar', label: 'Calendar' },
      { href: '/inbox', label: 'Inbox' },
    ],
  },
  {
    key: 'students', label: 'Students', icon: '🎓', accent: 'students',
    description: 'Core records, behaviour, attendance, results and certificates.',
    items: ({ isPastoralOrSmt, isAdmin, staffRoles }) => [
      { href: '/students', label: 'Core Data' },
      { href: '/behaviour', label: 'Behaviour Log' },
      (isAdmin || (staffRoles || []).includes('school_office')) && { href: '/behaviour/review', label: 'Review Serious Behaviour Events' },
      { href: '/attendance', label: 'Attendance' },
      { href: '/results', label: 'Results' },
      { href: '/results/enter', label: 'Enter Results' },
      { href: '/results/subject-overview', label: 'Subject Overview' },
      { href: '/certificates', label: 'Certificates' },
      { href: '/detention', label: 'Detention List' },
      isPastoralOrSmt && { href: '/appeals', label: 'Behaviour Appeals' },
    ].filter(Boolean),
  },
  {
    key: 'pastoral', label: 'Pastoral', icon: '💛', accent: 'students', adminOnly: true, roles: ['pastoral', 'houseparent', 'smt'],
    description: 'Pastoral oversight — behaviour, detentions and mentor groups.',
    // This card is shared with houseparent/smt, but only the pastoral role
    // (plus admin) actually has student_class write access (migration 105) —
    // so Class Allocation only shows for them, not the other two.
    items: ({ isAdmin, staffRoles }) => [
      { href: '/detention', label: 'Detentions' },
      { href: '/certificates', label: 'Certificates' },
      { href: '/pastoral/registers-not-done', label: 'Registers Not Done' },
      { href: '/appeals', label: 'Behaviour Appeals' },
      { href: '/staff/mentor-groups', label: 'Mentor Groups' },
      (isAdmin || (staffRoles || []).includes('pastoral')) && { href: '/admin/block-allocation', label: 'Class Allocation' },
    ].filter(Boolean),
  },
  {
    key: 'reports', label: 'Reports', icon: '📝', accent: 'students',
    description: 'Write, check and generate student reports.',
    items: ({ isAdmin }) => [
      { href: '/reports/write-subject-comments', label: 'Write Subject Comments' },
      { href: '/reports/write-pastoral-comments', label: 'Write Pastoral Comments' },
      { href: '/reports/check', label: 'Check Reports' },
      isAdmin && { href: '/reports/periods', label: 'Manage Report Periods' },
      isAdmin && { href: '/reports/generate', label: 'Generate Reports' },
    ].filter(Boolean),
  },
  {
    key: 'comms', label: 'Communication', icon: '💬', accent: 'family', adminOnly: true, roles: ['smt', 'pastoral', 'school_office'],
    description: 'Send announcements to parents and track read receipts.',
    items: () => [
      { href: '/comms/compose', label: 'Send Announcements to Parents / Groups' },
      { href: '/comms/history', label: 'Message History & Read Receipts' },
    ],
  },
  {
    key: 'timetable', label: 'Timetable', icon: '🗓️', accent: 'school', adminOnly: true, roles: ['head_of_department', 'pastoral'],
    description: 'Manage timetables and class allocations.',
    items: ({ isAdmin }) => [
      { href: '/staff/timetable', label: 'My Timetable' },
      { href: '/admin/block-allocation', label: 'Class Allocation' },
      // Whole-school Nova-T re-import stays admin-only — HoDs get the tab for
      // Class Allocation, not this.
      isAdmin && { href: '/admin/import-classes', label: 'Import Nova-T Timetable' },
      isAdmin && { href: '/admin/import-staff-commitments', label: 'Import Staff Commitments (NCLASS.DAT)' },
    ].filter(Boolean),
  },
  {
    key: 'assessment', label: 'Assessment', icon: '📊', accent: 'school', adminOnly: true,
    description: 'Import results, target grades and manage grading setup.',
    items: () => [
      { href: '/results/import-gradebook', label: 'Import Weekly Results' },
      { href: '/target-grades/import', label: 'Import Target Grades' },
      { href: '/classes/progress', label: 'Class Progress' },
      { href: '/admin/grade-boundaries', label: 'Grade Boundaries' },
      { href: '/admin/subject-settings', label: 'Subject Settings' },
      { href: '/assessments/import', label: 'Import CAT4/NGRT' },
    ],
  },
  {
    key: 'fees', label: 'Fees & Bills', icon: '💳', accent: 'family', adminOnly: true, roles: ['bursar', 'smt'],
    description: 'Charges, payments, discounts and the debtors list.',
    items: () => [
      { href: '/bursar/charge-checklist', label: 'Charge Checklist' },
      { href: '/bursar/fee-items', label: 'Fee Items (Prices)' },
      { href: '/bursar/discounts', label: 'Discounts' },
      { href: '/bursar/payments', label: 'Record a Payment' },
      { href: '/bursar/fees-table', label: 'All Students (Table)' },
      { href: '/bursar/debtors', label: 'Debtors List' },
      { href: '/bursar/audit', label: 'Audit' },
      { href: '/smt/fees-dashboard', label: 'SMT Dashboard' },
    ],
  },
  {
    key: 'tuckshop', label: 'Tuckshop', icon: '🍭', accent: 'family', adminOnly: true, roles: ['tuckshop', 'bursar'],
    description: 'Sell items, top up balances and manage stock.',
    items: () => [
      { href: '/tuckshop/purchase', label: 'Sell Items' },
      { href: '/tuckshop/topup', label: 'Top Up Balance' },
      { href: '/tuckshop/balances', label: 'Balances' },
      { href: '/tuckshop/preorders', label: 'Preorders' },
      { href: '/tuckshop/items', label: 'Items & Prices' },
    ],
  },
  {
    key: 'staff', label: 'Staff & Access', icon: '🔐', accent: 'admin', adminOnly: true,
    description: 'Staff accounts, roles, permissions and parent records.',
    items: () => [
      { href: '/staff/roles', label: 'Staff & Roles' },
      { href: '/staff/import-emails', label: 'Bulk Import Staff Emails' },
      { href: '/admin/permissions', label: 'Permissions' },
      { href: '/admin/lookups', label: 'Lookups' },
      { href: '/staff/welcome-emails', label: 'Send Staff Welcome Emails' },
      { href: '/parents', label: 'Parents' },
      { href: '/parents/welcome-emails', label: 'Send Parent Welcome Emails' },
      { href: '/parents/import', label: 'Import Parents' },
    ],
  },
  {
    key: 'administration', label: 'Administration', icon: '⏰', accent: 'admin', adminOnly: true, roles: ['hr', 'school_office'],
    description: "Register follow-ups, lookups and reporting.",
    items: () => [
      { href: '/admin/register-alerts', label: 'Register Alerts' },
      { href: '/behaviour/review', label: 'Review Serious Behaviour Events' },
      { href: '/admin/lookups', label: 'Lookups' },
      { href: '/admin/student-numbers', label: 'Student Numbers by Gender' },
      { href: '/admin/class-lists', label: 'Class Lists (Print)' },
      { href: '/admin/print-timetables', label: 'Print Timetables (Print)' },
    ],
  },
  {
    key: 'setup', label: 'Initial Setup', icon: '📥', accent: 'setup', adminOnly: true,
    description: 'One-off imports for getting a new school set up.',
    items: () => [
      { href: '/students/import', label: 'Import Students' },
      { href: '/students/photos/import', label: 'Import Photos' },
      { href: '/admin/import-timetable', label: 'Import Student Class Allocations' },
    ],
  },
];

export default function Home() {
  const { session, profile, isPastoralOrSmt, staffRoles } = useAuth();
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
    const demoTabs = TABS.filter((t) =>
      !t.adminOnly || isAdmin || (t.roles && t.roles.some((r) => (staffRoles || []).includes(r)))
    );
    return (
      <div>
        <div className="card" style={{ borderLeft: '4px solid #c07d1f', background: '#fff7e0' }}>
          <strong>Training account.</strong> Everything below is fake practice data that resets automatically — nothing you do here affects real students. Greyed-out links aren't available on this account yet.
        </div>
        <h1>Welcome — Training Account</h1>
        <div className="module-card-grid">
          {demoTabs.map((t) => (
            <ModuleCard
              key={t.key}
              icon={t.icon}
              label={t.label}
              accent={t.accent}
              description={t.description}
              items={t.items({ isPastoralOrSmt, isAdmin, staffRoles })}
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
              items={t.items({ isPastoralOrSmt, isAdmin })}
            />
          ))}
        </div>
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) =>
    !t.adminOnly || isAdmin || (t.roles && t.roles.some((r) => (staffRoles || []).includes(r)))
  );

  return (
    <div>
      <DashboardStats isDemoAccount={profile?.is_demo_account} />
      <div className="module-card-grid">
        {visibleTabs.map((t) => (
          <ModuleCard
            key={t.key}
            icon={t.icon}
            label={t.label}
            accent={t.accent}
            description={t.description}
            items={t.items({ isPastoralOrSmt, isAdmin, staffRoles })}
          />
        ))}
      </div>
    </div>
  );
}
