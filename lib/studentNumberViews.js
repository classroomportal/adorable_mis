// The Student Numbers page is split into three views (the principal, 8 Oct 2026),
// each its own link on the Administration card: /admin/student-numbers?view=<key>.
// All three share the page's one resource key, /admin/student-numbers.
export const STUDENT_NUMBER_VIEWS = [
  { key: 'years', label: 'Years & Mentor Groups', desc: 'Boys and girls by year group and mentor group.' },
  { key: 'boarding', label: 'Restaurants & Boarding', desc: 'Boys and girls by restaurant and by boarding house and room, with the years in each room.' },
  { key: 'houses', label: 'Sports Houses & Classes', desc: 'Boys and girls by sports house and by class.' },
];
