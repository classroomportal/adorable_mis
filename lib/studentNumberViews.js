// The six ways the Student Numbers page counts students (the principal,
// 8 Oct 2026: one Student Numbers link, and six choices on the page).
// Each is /admin/student-numbers?view=<key>; all share the resource key
// /admin/student-numbers.
export const STUDENT_NUMBER_VIEWS = [
  { key: 'years', label: 'Year Groups', desc: 'Boys and girls in each year group.' },
  { key: 'mentors', label: 'Mentor Groups', desc: 'Boys and girls in each mentor group, with a subtotal for each year.' },
  { key: 'restaurants', label: 'Restaurants', desc: 'Boys and girls in each restaurant.' },
  { key: 'boarding', label: 'Boarding Houses', desc: 'Boys and girls in each boarding house and room, with the year groups in each room.' },
  { key: 'sports', label: 'Sports Houses', desc: 'Boys and girls in each sports house, with its year groups.' },
  { key: 'classes', label: 'Classes', desc: 'Boys and girls in each class, by subject.' },
];
