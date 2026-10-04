// Which User Manual sections the Help panel shows on each page.
//
// The help itself is built from docs/USER_MANUAL.md by scripts/build-help.js into
// public/help/help.json, one entry per ## or ### heading, keyed by the heading's
// GitHub slug. Each entry here names sections by the start of that slug (the
// heading text without the page path in brackets), so a heading keeps matching if
// its bracketed path changes. The longest matching page prefix wins; '/' is the
// dashboard only. A page with no entry gets its nearest parent's help, or the
// "Getting started" sections.
//
// When the manual gains a section for a page, add it here.

const PAGE_TOPICS = {
  '/': ['the-staff-dashboard', 'roles-and-what-they-open'],

  '/students': ['finding-a-student', 'the-student-profile', 'editing-a-record'],
  '/students/new': ['adding-a-student'],
  '/students/import': ['adding-a-student', 'imports'],
  '/students/photos/import': ['imports'],
  '/students/welcome-emails': ['signing-in', 'the-student-portal'],
  '/parents': ['parents-and-leavers', 'the-parent-portal'],
  '/parents/import': ['parents-and-leavers', 'imports'],
  '/parents/view-as': ['the-parent-portal', 'what-each-portal-shows'],
  '/parents/welcome-emails': ['the-parent-portal', 'signing-in'],

  '/staff/timetable': ['my-timetable', 'the-school-day'],
  '/attendance': ['taking-a-register', 'the-school-day', 'attendance-summaries'],
  '/attendance/planned-absences': ['planned-absences'],
  '/pastoral/registers-not-done': ['registers-not-done'],
  '/pastoral/missed-lessons': ['missed-lessons', 'the-missed-lesson-pop-up'],
  '/pastoral/birthdays': ['boarding-and-mentors'],
  '/pastoral/prep': ['prep-times'],
  '/pastoral/unallocated': ['boarding-and-mentors'],
  '/admin/print-timetables': ['printing', 'timetable-setup'],
  '/admin/bell-times': ['timetable-setup', 'the-school-day'],
  '/admin/import-timetable': ['timetable-setup', 'imports'],
  '/admin/import-classes': ['timetable-setup', 'next-year-setup', 'imports'],
  '/admin/import-staff-commitments': ['timetable-setup', 'imports'],
  '/admin/block-allocation': ['timetable-setup'],
  '/admin/class-lists': ['timetable-setup', 'printing'],
  '/admin/register-alerts': ['registers-not-done', 'the-missed-lesson-pop-up'],

  '/homework': ['who-can-do-what', 'your-classes', 'setting-homework', 'marking-the-mark-book', 'the-mark-sheet', 'student-view'],
  '/homework/monitor': ['homework-monitor', 'how-students-see-homework'],

  '/results': ['browsing-results', 'result-sets', 'other-analysis'],
  '/results/enter': ['entering-results', 'result-sets'],
  '/results/import': ['entering-results', 'imports'],
  '/results/import-gradebook': ['entering-results', 'imports'],
  '/results/missing': ['entering-results', 'other-analysis'],
  '/results/subject-overview': ['other-analysis', 'browsing-results'],
  '/results/top-ten': ['other-analysis'],
  '/classes/progress': ['class-progress'],
  '/admin/grade-boundaries': ['grade-boundaries', 'subjects-and-grading'],
  '/admin/subject-settings': ['subjects-and-grading'],
  '/target-grades': ['targets-cat4-and-ngrt'],
  '/assessments/grade-history': ['grade-history'],
  '/reading-ages': ['reading-ages'],
  '/assessments/import': ['result-sets', 'imports'],

  '/reports/periods': ['report-periods', 'the-reporting-cycle'],
  '/reports/write-subject-comments': ['writing-subject-comments', 'homework-in-reports', 'the-reporting-cycle'],
  '/reports/write-pastoral-comments': ['writing-pastoral-comments', 'the-reporting-cycle'],
  '/reports/check': ['checking', 'the-reporting-cycle'],
  '/reports/generate': ['generating-reports', 'the-reporting-cycle'],
  '/reports/documents': ['uploading-documents'],

  '/behaviour': ['logging-behaviour', 'alerts-and-detentions', 'what-parents-see'],
  '/behaviour/review': ['what-parents-see', 'logging-behaviour'],
  '/behaviour/alerts': ['alerts-and-detentions'],
  '/behaviour/log': ['logging-behaviour', 'alerts-and-detentions'],
  '/detention': ['alerts-and-detentions'],
  '/appeals': ['appeals'],
  '/certificates': ['certificates'],
  '/staff/mentor-groups': ['boarding-and-mentors'],
  '/clinic': ['the-clinic'],
  '/staff/records': ['staff-records'],

  '/other-half': ['the-programme', 'running-an-activity', 'student-choices'],
  '/other-half/activities': ['the-programme', 'student-choices'],
  '/other-half/choices': ['student-choices'],
  '/other-half/register': ['running-an-activity'],
  '/other-half/absentees': ['running-an-activity'],
  '/groups': ['student-groups', 'what-students-and-parents-see'],
  '/groups/build': ['building-a-group-from-a-rule'],

  '/calendar': ['the-calendar', 'the-school-calendar-for-parents'],
  '/comms/compose': ['sending-a-message', 'where-replies-go'],
  '/comms/history': ['sent-messages'],
  '/inbox': ['your-inbox'],
  '/admin/email-replies': ['where-replies-go'],

  '/bursar': ['how-fees-are-built', 'recording-a-payment', 'lists'],
  '/bursar/payments': ['recording-a-payment', 'how-fees-are-built'],
  '/bursar/charge-checklist': ['charging-a-group', 'how-fees-are-built'],
  '/bursar/fee-items': ['fee-items-and-discounts', 'price-approval'],
  '/bursar/discounts': ['fee-items-and-discounts'],
  '/bursar/fees-table': ['lists'],
  '/bursar/debtors': ['lists'],
  '/bursar/audit': ['lists', 'change-history'],
  '/bursar/fee-approvals': ['price-approval'],
  '/bursar/admission-forms': ['admission-payments'],
  '/bursar/tuckshop-top-up': ['items-sales-and-balances'],
  '/smt/fees-dashboard': ['smt-fees-dashboard'],

  '/tuckshop': ['ordering-windows', 'before-the-tuckshop-day', 'items-sales-and-balances'],
  '/tuckshop/hand-out': ['handing-out', 'before-the-tuckshop-day'],
  '/tuckshop/ordering': ['ordering-windows', 'how-students-order'],
  '/tuckshop/preorders': ['before-the-tuckshop-day', 'how-students-order'],
  '/tuckshop/order-sheets': ['before-the-tuckshop-day'],

  '/admissions': ['the-applicants-list', 'stages', 'an-applicants-page'],
  '/admissions/new': ['a-new-application'],
  '/admissions/letters': ['standard-letters'],
  '/admissions/papers': ['test-days-and-papers'],
  '/admissions/sessions': ['test-days-and-papers'],
  '/admissions/projections': ['next-years-numbers'],
  '/admissions/schools': ['a-new-application'],

  '/admin/permissions': ['who-can-open-which-page', 'roles-and-what-they-open'],
  '/staff/roles': ['staff-and-roles', 'roles-and-what-they-open'],
  '/staff/import-emails': ['staff-and-roles', 'imports'],
  '/staff/welcome-emails': ['staff-and-roles', 'signing-in'],
  '/admin/lookups': ['lookups'],
  '/admin/next-year': ['next-year-setup'],
  '/admin/student-numbers': ['next-year-setup', 'next-years-numbers'],
  '/admin/tile-order': ['arrange-tiles'],
  '/admin/change-history': ['change-history', 'the-record-of-changes'],
  '/admin/backup': ['backups'],

  '/change-password': ['signing-in'],
};

const FALLBACK = ['the-staff-dashboard', 'signing-in', 'roles-and-what-they-open'];

// The "How each person uses Formwork" section for a member of staff, by the first
// of their roles that has one.
const ROLE_SECTIONS = [
  [['teacher'], 'teachers'],
  [['head_of_department', 'assessment_manager', 'assessment_user', 'smt', 'principal'], 'leaders'],
  [['mentor', 'houseparent', 'head_of_boarding', 'pastoral', 'attendance_officer'], 'mentors-and-pastoral-staff'],
  [['school_office', 'hr', 'admin'], 'office-hr-and-administrators'],
  [['bursar', 'college_secretary', 'tuckshop', 'tuckshop_owner', 'admissions', 'nurse'], 'specialist-roles'],
];

export function topicPrefixesFor(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/') return PAGE_TOPICS['/'];
  const parts = path.split('/');
  for (let n = parts.length; n > 1; n--) {
    const prefix = parts.slice(0, n).join('/');
    if (PAGE_TOPICS[prefix]) return PAGE_TOPICS[prefix];
  }
  return FALLBACK;
}

// Section ids are unique slugs; a prefix picks the first heading that starts with
// it, in manual order, so the panel lists sections as the manual does.
export function sectionsFor(pathname, sections) {
  const picked = [];
  for (const prefix of topicPrefixesFor(pathname)) {
    const s = sections.find((x) => x.id === prefix || x.id.startsWith(`${prefix}-`));
    if (s && !picked.includes(s)) picked.push(s);
  }
  return picked;
}

export function roleSectionFor(staffRoles, isAdmin, sections) {
  const roles = new Set(staffRoles || []);
  if (isAdmin) roles.add('admin');
  for (const [names, prefix] of ROLE_SECTIONS) {
    if (names.some((r) => roles.has(r))) {
      return sections.find((x) => x.id === prefix || x.id.startsWith(`${prefix}-`)) || null;
    }
  }
  return null;
}
