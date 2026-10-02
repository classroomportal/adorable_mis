-- Migration 322: Years 10 and 11 grade boundaries follow Cambridge IGCSE's
-- June 2026 grade thresholds.
--
-- Why: the principal, 2 Oct 2026. Years 10 and 11 were graded on the flat
-- 90/80/70... boundaries used for Years 7-9, which are much harsher than the
-- IGCSE itself (a C in IGCSE Extended Maths, variant 3, needed 47%, not 60%).
-- Years 10-11 now use the real June 2026 thresholds for the syllabus each
-- subject sits. Years 7-9 keep 90/80/70..., Year 12 (WAEC) is not touched.
--
-- Decisions (the principal):
-- * Extended tier; for the sciences, the Extended route with the alternative
--   to practical (Paper 6). The school sits time-zone variant 3, so every route
--   is the variant 3 one.
-- * Where a subject has more than one route: coursework for English (the
--   school's route), alternative to coursework for Geography and History
--   (the most common), papers 1 + 2 for Literature (the most common).
-- * Each threshold is converted to a percentage of the route's maximum mark,
--   rounded UP to 2 decimal places, so a band never starts below Cambridge's
--   real threshold.
-- * Bands touch with no gap: each band's max_score is 0.01 below the next
--   band's min_score (scores are stored to 2 decimal places), so the
--   min_score <= score <= max_score match on /results/enter always finds
--   exactly one grade. The top band runs to 100.
-- * Below Cambridge's lowest threshold is U (ungraded), from 0, so the
--   lowest grade starts at Cambridge's real threshold. Extended Maths (0580)
--   and Additional Mathematics (0606) stop at E, so they have no F or G
--   bands: below E is U.
-- * Further Maths (0606 Additional Mathematics) had no boundaries; it gets
--   them here.
-- * Graphics, Civics, Government, Religion, Igbo, Computer and GSM Repairs,
--   Fashion, Hb, Mentor and Prep keep their current boundaries, as do subjects
--   not listed below.
-- * Results already saved keep the grade they were given; nothing is
--   regraded.
--
-- Sources (Cambridge IGCSE grade threshold tables, June 2026, syllabus grade
-- thresholds, from
-- https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-upper-secondary/cambridge-igcse/grade-threshold-tables/june-2026/ ):
--
-- * Mathematics (subject 1): 0580 Mathematics, Extended, papers 23 + 43, out of 200:
--   A* 177, A 154, B 124, C 94, D 71, E 49
--   https://www.cambridgeinternational.org/Images/762852-mathematics-without-coursework-0580-june-2026-grade-threshold-table.pdf
-- * English (subject 2): 0500 First Language English, components 03 (coursework) + 13, out of 160:
--   A* 114, A 101, B 88, C 76, D 64, E 53, F 41, G 29
--   https://www.cambridgeinternational.org/Images/762830-first-language-english-oral-endorsement-0500-june-2026-grade-threshold-table.pdf
-- * English Lit (subject 299): 0475 Literature in English, papers 13 + 23, out of 100:
--   A* 69, A 59, B 49, C 39, D 33, E 28, F 24, G 20
--   https://www.cambridgeinternational.org/Images/762824-literature-in-english-0475-june-2026-grade-threshold-table.pdf
-- * Biology (subject 89): 0610 Biology, Extended, papers 23 + 43 + 63 (alternative to practical), out of 200:
--   A* 169, A 145, B 121, C 97, D 85, E 73, F 62, G 51
--   https://www.cambridgeinternational.org/Images/762855-biology-0610-june-2026-grade-threshold-table.pdf
-- * Chemistry (subject 92): 0620 Chemistry, Extended, papers 23 + 43 + 63 (alternative to practical), out of 200:
--   A* 172, A 145, B 117, C 90, D 77, E 65, F 54, G 43
--   https://www.cambridgeinternational.org/Images/762856-chemistry-0620-june-2026-grade-threshold-table.pdf
-- * Physics (subject 123): 0625 Physics, Extended, papers 23 + 43 + 63 (alternative to practical), out of 200:
--   A* 156, A 133, B 110, C 87, D 78, E 69, F 58, G 47
--   https://www.cambridgeinternational.org/Images/762857-physics-0625-june-2026-grade-threshold-table.pdf
-- * Computing (subject 94): 0478 Computer Science, papers 13 + 23, out of 150:
--   A* 115, A 91, B 67, C 43, D 36, E 30, F 24, G 18
--   https://www.cambridgeinternational.org/Images/762825-computer-science-0478-june-2026-grade-threshold-table.pdf
-- * Economics (subject 97): 0455 Economics, papers 13 + 23, out of 150:
--   A* 122, A 103, B 84, C 66, D 57, E 49, F 40, G 31
--   https://www.cambridgeinternational.org/Images/762817-economics-0455-june-2026-grade-threshold-table.pdf
-- * French (subject 104): 0520 French (Foreign Language), components 03 + 13 + 23 + 43, out of 200:
--   A* 168, A 145, B 122, C 100, D 84, E 69, F 53, G 37
--   https://www.cambridgeinternational.org/Images/762841-french-foreign-language-0520-june-2026-grade-threshold-table.pdf
-- * Spanish (subject 128): 0530 Spanish (Foreign Language), components 03 + 13 + 23 + 43, out of 200:
--   A* 164, A 142, B 120, C 99, D 83, E 68, F 54, G 40
--   https://www.cambridgeinternational.org/Images/762844-spanish-foreign-language-0530-june-2026-grade-threshold-table.pdf
-- * Chinese (subject 298): 0547 Mandarin Chinese (Foreign Language), components 03 + 13 + 23 + 43, out of 200:
--   A* 162, A 137, B 112, C 88, D 74, E 60, F 46, G 32
--   https://www.cambridgeinternational.org/Images/762851-mandarin-chinese-foreign-language-0547-june-2026-grade-threshold-table.pdf
-- * Further Maths (subject 309): 0606 Additional Mathematics, papers 13 + 23, out of 160:
--   A* 138, A 117, B 88, C 59, D 46, E 33
--   https://www.cambridgeinternational.org/Images/762853-additional-mathematics-0606-june-2026-grade-threshold-table.pdf
-- * Art (subject 88): 0400 Art and Design, components 01 + 02, out of 200:
--   A* 154, A 134, B 114, C 94, D 76, E 58, F 40, G 22
--   https://www.cambridgeinternational.org/Images/762805-art-and-design-0400-june-2026-grade-threshold-table.pdf
-- * Food and Nutrition (subject 102): 0648 Food and Nutrition, components 02 + 13, out of 200:
--   A* 153, A 135, B 117, C 100, D 87, E 74, F 59, G 44
--   https://www.cambridgeinternational.org/Images/762858-food-and-nutrition-0648-june-2026-grade-threshold-table.pdf
-- * PE (subject 122): 0413 Physical Education, components 02 + 13, out of 200:
--   A* 145, A 129, B 113, C 98, D 81, E 65, F 50, G 35
--   https://www.cambridgeinternational.org/Images/762810-physical-education-0413-june-2026-grade-threshold-table.pdf
-- * Geography (subject 105): 0460 Geography, papers 13 + 23 + 43 (alternative to coursework), out of 220:
--   A* 182, A 160, B 138, C 116, D 98, E 80, F 61, G 42
--   https://www.cambridgeinternational.org/Images/762819-geography-0460-june-2026-grade-threshold-table.pdf
-- * History (subject 112): 0470 History, papers 13 + 23 + 43 (alternative to coursework), out of 150:
--   A* 96, A 81, B 66, C 52, D 46, E 41, F 34, G 27
--   https://www.cambridgeinternational.org/Images/762820-history-0470-june-2026-grade-threshold-table.pdf

set local formwork.change_note = 'Principal (direct)';

create temporary table igcse_june_2026 (
  subject_id integer not null,
  grade text not null,
  min_score numeric not null,
  max_score numeric not null
) on commit drop;

insert into igcse_june_2026 (subject_id, grade, min_score, max_score) values
  -- Mathematics
  (1, 'A*', 88.50, 100.00),
  (1, 'A', 77.00, 88.49),
  (1, 'B', 62.00, 76.99),
  (1, 'C', 47.00, 61.99),
  (1, 'D', 35.50, 46.99),
  (1, 'E', 24.50, 35.49),
  (1, 'U', 0.00, 24.49),
  -- English
  (2, 'A*', 71.25, 100.00),
  (2, 'A', 63.13, 71.24),
  (2, 'B', 55.00, 63.12),
  (2, 'C', 47.50, 54.99),
  (2, 'D', 40.00, 47.49),
  (2, 'E', 33.13, 39.99),
  (2, 'F', 25.63, 33.12),
  (2, 'G', 18.13, 25.62),
  (2, 'U', 0.00, 18.12),
  -- English Lit
  (299, 'A*', 69.00, 100.00),
  (299, 'A', 59.00, 68.99),
  (299, 'B', 49.00, 58.99),
  (299, 'C', 39.00, 48.99),
  (299, 'D', 33.00, 38.99),
  (299, 'E', 28.00, 32.99),
  (299, 'F', 24.00, 27.99),
  (299, 'G', 20.00, 23.99),
  (299, 'U', 0.00, 19.99),
  -- Biology
  (89, 'A*', 84.50, 100.00),
  (89, 'A', 72.50, 84.49),
  (89, 'B', 60.50, 72.49),
  (89, 'C', 48.50, 60.49),
  (89, 'D', 42.50, 48.49),
  (89, 'E', 36.50, 42.49),
  (89, 'F', 31.00, 36.49),
  (89, 'G', 25.50, 30.99),
  (89, 'U', 0.00, 25.49),
  -- Chemistry
  (92, 'A*', 86.00, 100.00),
  (92, 'A', 72.50, 85.99),
  (92, 'B', 58.50, 72.49),
  (92, 'C', 45.00, 58.49),
  (92, 'D', 38.50, 44.99),
  (92, 'E', 32.50, 38.49),
  (92, 'F', 27.00, 32.49),
  (92, 'G', 21.50, 26.99),
  (92, 'U', 0.00, 21.49),
  -- Physics
  (123, 'A*', 78.00, 100.00),
  (123, 'A', 66.50, 77.99),
  (123, 'B', 55.00, 66.49),
  (123, 'C', 43.50, 54.99),
  (123, 'D', 39.00, 43.49),
  (123, 'E', 34.50, 38.99),
  (123, 'F', 29.00, 34.49),
  (123, 'G', 23.50, 28.99),
  (123, 'U', 0.00, 23.49),
  -- Computing
  (94, 'A*', 76.67, 100.00),
  (94, 'A', 60.67, 76.66),
  (94, 'B', 44.67, 60.66),
  (94, 'C', 28.67, 44.66),
  (94, 'D', 24.00, 28.66),
  (94, 'E', 20.00, 23.99),
  (94, 'F', 16.00, 19.99),
  (94, 'G', 12.00, 15.99),
  (94, 'U', 0.00, 11.99),
  -- Economics
  (97, 'A*', 81.34, 100.00),
  (97, 'A', 68.67, 81.33),
  (97, 'B', 56.00, 68.66),
  (97, 'C', 44.00, 55.99),
  (97, 'D', 38.00, 43.99),
  (97, 'E', 32.67, 37.99),
  (97, 'F', 26.67, 32.66),
  (97, 'G', 20.67, 26.66),
  (97, 'U', 0.00, 20.66),
  -- French
  (104, 'A*', 84.00, 100.00),
  (104, 'A', 72.50, 83.99),
  (104, 'B', 61.00, 72.49),
  (104, 'C', 50.00, 60.99),
  (104, 'D', 42.00, 49.99),
  (104, 'E', 34.50, 41.99),
  (104, 'F', 26.50, 34.49),
  (104, 'G', 18.50, 26.49),
  (104, 'U', 0.00, 18.49),
  -- Spanish
  (128, 'A*', 82.00, 100.00),
  (128, 'A', 71.00, 81.99),
  (128, 'B', 60.00, 70.99),
  (128, 'C', 49.50, 59.99),
  (128, 'D', 41.50, 49.49),
  (128, 'E', 34.00, 41.49),
  (128, 'F', 27.00, 33.99),
  (128, 'G', 20.00, 26.99),
  (128, 'U', 0.00, 19.99),
  -- Chinese
  (298, 'A*', 81.00, 100.00),
  (298, 'A', 68.50, 80.99),
  (298, 'B', 56.00, 68.49),
  (298, 'C', 44.00, 55.99),
  (298, 'D', 37.00, 43.99),
  (298, 'E', 30.00, 36.99),
  (298, 'F', 23.00, 29.99),
  (298, 'G', 16.00, 22.99),
  (298, 'U', 0.00, 15.99),
  -- Further Maths
  (309, 'A*', 86.25, 100.00),
  (309, 'A', 73.13, 86.24),
  (309, 'B', 55.00, 73.12),
  (309, 'C', 36.88, 54.99),
  (309, 'D', 28.75, 36.87),
  (309, 'E', 20.63, 28.74),
  (309, 'U', 0.00, 20.62),
  -- Art
  (88, 'A*', 77.00, 100.00),
  (88, 'A', 67.00, 76.99),
  (88, 'B', 57.00, 66.99),
  (88, 'C', 47.00, 56.99),
  (88, 'D', 38.00, 46.99),
  (88, 'E', 29.00, 37.99),
  (88, 'F', 20.00, 28.99),
  (88, 'G', 11.00, 19.99),
  (88, 'U', 0.00, 10.99),
  -- Food and Nutrition
  (102, 'A*', 76.50, 100.00),
  (102, 'A', 67.50, 76.49),
  (102, 'B', 58.50, 67.49),
  (102, 'C', 50.00, 58.49),
  (102, 'D', 43.50, 49.99),
  (102, 'E', 37.00, 43.49),
  (102, 'F', 29.50, 36.99),
  (102, 'G', 22.00, 29.49),
  (102, 'U', 0.00, 21.99),
  -- PE
  (122, 'A*', 72.50, 100.00),
  (122, 'A', 64.50, 72.49),
  (122, 'B', 56.50, 64.49),
  (122, 'C', 49.00, 56.49),
  (122, 'D', 40.50, 48.99),
  (122, 'E', 32.50, 40.49),
  (122, 'F', 25.00, 32.49),
  (122, 'G', 17.50, 24.99),
  (122, 'U', 0.00, 17.49),
  -- Geography
  (105, 'A*', 82.73, 100.00),
  (105, 'A', 72.73, 82.72),
  (105, 'B', 62.73, 72.72),
  (105, 'C', 52.73, 62.72),
  (105, 'D', 44.55, 52.72),
  (105, 'E', 36.37, 44.54),
  (105, 'F', 27.73, 36.36),
  (105, 'G', 19.10, 27.72),
  (105, 'U', 0.00, 19.09),
  -- History
  (112, 'A*', 64.00, 100.00),
  (112, 'A', 54.00, 63.99),
  (112, 'B', 44.00, 53.99),
  (112, 'C', 34.67, 43.99),
  (112, 'D', 30.67, 34.66),
  (112, 'E', 27.34, 30.66),
  (112, 'F', 22.67, 27.33),
  (112, 'G', 18.00, 22.66),
  (112, 'U', 0.00, 17.99);

delete from public.subject_grade_boundaries b
where b.year_group in (10, 11)
  and b.subject_id in (select distinct subject_id from igcse_june_2026);

insert into public.subject_grade_boundaries (subject_id, grade, min_score, max_score, year_group)
select n.subject_id, n.grade, n.min_score, n.max_score, y.year_group
from igcse_june_2026 n
cross join (values (10), (11)) as y(year_group);
