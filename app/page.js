'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import SplashScreen from './components/SplashScreen';

function Tile({ href, icon, label }) {
  return (
    <a className="dash-tile" href={href}>
      <span className="dash-tile-icon-badge">
        <span className="dash-tile-icon">{icon}</span>
      </span>
      <span>{label}</span>
    </a>
  );
}

function Section({ title, accent, children }) {
  return (
    <div className={`dash-section accent-${accent || 'default'}`}>
      {title && <div className="dash-section-title">{title}</div>}
      <div className="dash-grid">{children}</div>
    </div>
  );
}

const TABS = [
  {
    key: 'home', label: 'Dashboard', icon: '🏠', accent: 'myinfo',
    render: () => (
      <Section accent="myinfo">
        <Tile href="/staff/timetable" icon="🗓️" label="My Timetable" />
        <Tile href="/parent-portal" icon="👨‍👩‍👧" label="My Children" />
        <Tile href="/calendar" icon="📅" label="Calendar" />
      </Section>
    ),
  },
  {
    key: 'students', label: 'Students', icon: '🎓', accent: 'students',
    render: ({ isPastoralOrSmt }) => (
      <Section accent="students">
        <Tile href="/students" icon="🎓" label="Core Data" />
        <Tile href="/behaviour" icon="⭐" label="Behaviour" />
        <Tile href="/attendance" icon="✅" label="Attendance" />
        <Tile href="/results" icon="📊" label="Results" />
        <Tile href="/classes/progress" icon="📈" label="Class Progress" />
        <Tile href="/certificates" icon="🏆" label="Certificates" />
        <Tile href="/detention" icon="📋" label="Detention List" />
        {isPastoralOrSmt && <Tile href="/appeals" icon="⚖️" label="Behaviour Appeals" />}
      </Section>
    ),
  },
  {
    key: 'timetable', label: 'Timetable', icon: '🗓️', accent: 'school', adminOnly: true,
    render: () => (
      <Section accent="school">
        <Tile href="/staff/timetable" icon="🗓️" label="My Timetable" />
        <Tile href="/admin/block-allocation" icon="🗂️" label="Class Allocation" />
        <Tile href="/admin/import-classes" icon="📥" label="Import Nova-T Timetable (Classes/Teacher/Room)" />
      </Section>
    ),
  },
  {
    key: 'assessment', label: 'Assessment', icon: '📊', accent: 'school', adminOnly: true,
    render: () => (
      <Section accent="school">
        <Tile href="/results/import-gradebook" icon="📥" label="Import Weekly Results" />
        <Tile href="/target-grades/import" icon="📥" label="Import Target Grades" />
        <Tile href="/admin/grade-boundaries" icon="🎯" label="Grade Boundaries" />
        <Tile href="/admin/subject-settings" icon="🏷️" label="Subject Settings" />
        <Tile href="/assessments/import" icon="📥" label="Import CAT4/NGRT" />
      </Section>
    ),
  },
  {
    key: 'fees', label: 'Fees & Bills', icon: '💳', accent: 'family', adminOnly: true,
    render: () => (
      <Section accent="family">
        <div className="dash-tile" style={{ cursor: 'default', opacity: 0.7 }}>
          <span className="dash-tile-icon-badge"><span className="dash-tile-icon">🚧</span></span>
          <span>Coming soon</span>
        </div>
      </Section>
    ),
  },
  {
    key: 'staff', label: 'Staff & Access', icon: '🔐', accent: 'admin', adminOnly: true,
    render: () => (
      <Section accent="admin">
        <Tile href="/staff/roles" icon="🧑‍🏫" label="Staff & Roles" />
        <Tile href="/staff/import-emails" icon="📧" label="Bulk Import Staff Emails" />
        <Tile href="/admin/permissions" icon="🔐" label="Permissions" />
        <Tile href="/staff/welcome-emails" icon="✉️" label="Send Staff Welcome Emails" />
        <Tile href="/parents" icon="👪" label="Parents" />
        <Tile href="/parents/welcome-emails" icon="✉️" label="Send Parent Welcome Emails" />
        <Tile href="/parents/import" icon="📥" label="Import Parents" />
      </Section>
    ),
  },
  {
    key: 'setup', label: 'Initial Setup', icon: '📥', accent: 'setup', adminOnly: true,
    render: () => (
      <Section accent="setup">
        <Tile href="/students/import" icon="📥" label="Import Students" />
        <Tile href="/students/photos/import" icon="📥" label="Import Photos" />
        <Tile href="/admin/import-timetable" icon="📥" label="Import Student Class Allocations" />
      </Section>
    ),
  },
];

export default function Home() {
  const { session, profile, isPastoralOrSmt } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [showSplash, setShowSplash] = useState(false);
  const [activeTab, setActiveTab] = useState('home');

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
      <div>
        <h1>Adorable MIS</h1>
        <p>School management information system for Adorable British College.</p>
        <a href="/login"><button>Sign in</button></a>
      </div>
    );
  }

  if (profile?.role === 'student') {
    return (
      <div>
        <h1>Welcome{profile.student_id ? '' : ' — account not linked yet'}</h1>
        <Section title="My Info" accent="myinfo">
          <Tile href="/portal" icon="📚" label="My Grades & Behaviour" />
          <Tile href="/change-password" icon="🔑" label="Change Password" />
        </Section>
      </div>
    );
  }

  if (profile?.role === 'parent') {
    return (
      <div>
        <h1>Welcome{profile.parent_id ? '' : ' — account not linked yet'}</h1>
        <Section title="My Family" accent="family">
          <Tile href="/parent-portal" icon="👨‍👩‍👧" label="My Children" />
          <Tile href="/change-password" icon="🔑" label="Change Password" />
        </Section>
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const active = visibleTabs.find((t) => t.key === activeTab) || visibleTabs[0];

  return (
    <div>
      <h1>Adorable MIS</h1>

      <div className="module-tabs">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`module-tab ${active.key === t.key ? 'active' : ''} accent-${t.accent}`}
          >
            <span className="module-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {active.render({ isPastoralOrSmt, isAdmin })}
    </div>
  );
}
