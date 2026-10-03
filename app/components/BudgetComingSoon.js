'use client';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';

// A Budget tile link whose page isn't built yet (the principal, 3 Oct 2026:
// "put the links on the tile ready"). It says what the page will do, from
// docs/finance-budget-design.md, so the tile shows the whole process now.
export default function BudgetComingSoon({ resourceKey, title, children }) {
  return (
    <RequireAuth>
      <RequireResource resourceKey={resourceKey}>
        <div>
          <p style={{ margin: 0 }}><a href="/">← Dashboard</a></p>
          <h1>{title}</h1>
          <div className="card" style={{ borderLeft: '4px solid #c07d1f', background: '#fff7e0' }}>
            <strong>Coming next.</strong> This part of the budget isn&apos;t built yet. This is what it will do:
          </div>
          <div className="card">{children}</div>
        </div>
      </RequireResource>
    </RequireAuth>
  );
}
