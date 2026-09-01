import './globals.css';

export const metadata = {
  title: 'Adorable MIS',
  description: 'School management information system',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav style={{ padding: '1rem', borderBottom: '1px solid #ddd', display: 'flex', gap: '1.5rem' }}>
          <a href="/">Home</a>
          <a href="/students">Students</a>
          <a href="/results">Results</a>
          <a href="/behaviour">Behaviour</a>
        </nav>
        <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
