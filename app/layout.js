import './globals.css';
import { AuthProvider } from '../lib/AuthContext';
import NavBar from './NavBar';
import BackupModeBanner from './components/BackupModeBanner';
import MissedLessonAlerts from './components/MissedLessonAlerts';
import RegisterReminders from './components/RegisterReminders';

export const metadata = {
  title: 'Formwork',
  description: 'School management information system',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <NavBar />
          <BackupModeBanner />
          <MissedLessonAlerts />
          <RegisterReminders />
          <main style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
