import './globals.css';
import { AuthProvider } from '../lib/AuthContext';
import NavBar from './NavBar';

export const metadata = {
  title: 'Adorable MIS',
  description: 'School management information system',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <NavBar />
          <main style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
