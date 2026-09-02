'use client';
import { useAuth } from '../lib/AuthContext';

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
  const { session, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  if (!session) {
    return (
      <div>
        <h1>Adorable MIS</h1>
        <p>School management information system for Adorable British College.</p>
        <a href="/login"><button>Sign in</button></a>
      </div>
    );
  }

  return (
    <div>
      <h1>Adorable MIS</h1>

      <Section title="Students">
        <Tile href="/students" icon="🎓" label="Core Data" />
        <Tile href="/behaviour" icon="⭐" label="Behaviour" />
        <Tile href="/attendance" icon="✅" label="Attendance" />
        <Tile href="/results" icon="📊" label="Results" />
      </Section>

      <Section title="Whole School">
        <Tile href="/calendar" icon="📅" label="Calendar" />
      </Section>

      {isAdmin && (
        <Section title="Staff">
          <Tile href="/staff/roles" icon="🧑‍🏫" label="Staff & Roles" />
          <Tile href="/students/import" icon="📥" label="Import Students" />
          <Tile href="/parents/import" icon="📥" label="Import Parents" />
          <Tile href="/results/import" icon="📥" label="Import Results" />
          <Tile href="/assessments/import" icon="📥" label="Import CAT4/NGRT" />
        </Section>
      )}
    </div>
  );
}
