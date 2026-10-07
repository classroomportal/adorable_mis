import './globals.css';
import { AuthProvider } from '../lib/AuthContext';
import NavBar from './NavBar';
import BackupModeBanner from './components/BackupModeBanner';
import MissedLessonAlerts from './components/MissedLessonAlerts';
import MissingStudentStaffAlerts from './components/MissingStudentStaffAlerts';
import RegisterReminders from './components/RegisterReminders';
import Stage5CollectionAlerts from './components/Stage5CollectionAlerts';
import WellbeingCheckIn from './components/WellbeingCheckIn';

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
          <Stage5CollectionAlerts />
          <MissingStudentStaffAlerts />
          <RegisterReminders />
          <WellbeingCheckIn />
          <main style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
