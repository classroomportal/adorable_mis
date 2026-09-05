-- Migration 053: match the resources table to the dashboard reorganization —
-- SIMS one-time imports moved to their own "Initial Setup" section, and the
-- Nova-T import relabeled to make clear it's the ongoing timetable import
-- (as opposed to the old "Import Timetable" label, which was actually the
-- one-time SIMS student-to-class allocation import).

update resources set section = 'Initial Setup', label = 'Import Students'
  where resource_key = '/students/import';

update resources set section = 'Initial Setup', label = 'Import Photos'
  where resource_key = '/students/photos/import';

update resources set section = 'Initial Setup', label = 'Import Student Class Allocations'
  where resource_key = '/admin/import-timetable';

update resources set label = 'Import Nova-T Timetable (Classes/Teacher/Room)'
  where resource_key = '/admin/import-classes';
