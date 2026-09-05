'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import SplashScreen from './components/SplashScreen';

function Tile({ href, icon, label }) {
  return (
    <a className="dash-tile" href={href}>
      <span className="dash-tile-icon">{icon}</span>
      <span>{label}</span>
    </a>
  );
}

function Section({ title, children }) {
  return (
    <div className="dash-section">
      <div className="dash-section-title">{title}</div>
      <div className="dash-grid">{children}</div>
    </div>
  );
}

export default function Home() {
  const { session, profile, isPastoralOrSmt } = useAuth();
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
        <Section title="My Info">
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
        <Section title="My Family">
          <Tile href="/parent-portal" icon="👨‍👩‍👧" label="My Children" />
          <Tile href="/change-password" icon="🔑" label="Change Password" />
        </Section>
      </div>
    );
  }

  return (
    <div>
      <h1>Adorable MIS</h1>

      <Section title="Students">
        <Tile href="/staff/timetable" icon="🗓️" label="My Timetable" />
        <Tile href="/parent-portal" icon="👨‍👩‍👧" label="My Children" />
        <Tile href="/students" icon="🎓" label="Core Data" />
        <Tile href="/behaviour" icon="⭐" label="Behaviour" />
        <Tile href="/attendance" icon="✅" label="Attendance" />
        <Tile href="/results" icon="📊" label="Results" />
        <Tile href="/classes/progress" icon="📈" label="Class Progress" />
        <Tile href="/certificates" icon="🏆" label="Certificates" />
        <Tile href="/detention" icon="📋" label="Detention List" />
        {isPastoralOrSmt && <Tile href="/appeals" icon="⚖️" label="Behaviour Appeals" />}
      </Section>

      <Section title="Whole School">
        <Tile href="/calendar" icon="📅" label="Calendar" />
      </Section>

      {isAdmin && (
        <Section title="Admin">
          <Tile href="/staff/roles" icon="🧑‍🏫" label="Staff & Roles" />
          <Tile href="/admin/permissions" icon="🔐" label="Permissions" />
          <Tile href="/staff/welcome-emails" icon="✉️" label="Send Staff Welcome Emails" />
          <Tile href="/admin/block-allocation" icon="🗂️" label="Class Allocation" />
          <Tile href="/parents" icon="👪" label="Parents" />
          <Tile href="/parents/welcome-emails" icon="✉️" label="Send Parent Welcome Emails" />
          <Tile href="/students/import" icon="📥" label="Import Students" />
          <Tile href="/parents/import" icon="📥" label="Import Parents" />
          <Tile href="/results/import-gradebook" icon="📥" label="Import Weekly Results" />
          <Tile href="/target-grades/import" icon="📥" label="Import Target Grades" />
          <Tile href="/admin/grade-boundaries" icon="🎯" label="Grade Boundaries" />
          <Tile href="/admin/subject-settings" icon="🏷️" label="Subject Settings" />
          <Tile href="/students/photos/import" icon="📥" label="Import Photos" />
          <Tile href="/assessments/import" icon="📥" label="Import CAT4/NGRT" />
          <Tile href="/admin/import-timetable" icon="📥" label="Import Timetable" />
          <Tile href="/admin/import-classes" icon="📥" label="Import Class/Teacher/Room" />
        </Section>
      )}
    </div>
  );
}
