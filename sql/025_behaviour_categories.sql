-- 025_behaviour_categories.sql
-- Lookup table for behaviour event categories, so staff pick from a consistent list
-- instead of typing free text. Seeded with common categories - edit/add via the admin UI later.

CREATE TABLE behaviour_categories (
    category_id    SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('positive','negative')),
    default_points INTEGER,
    UNIQUE (name, type)
);

ALTER TABLE behaviour_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all_behaviour_categories" ON behaviour_categories FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_behaviour_categories" ON behaviour_categories FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Positive categories
INSERT INTO behaviour_categories (name, type, default_points) VALUES
  ('Excellent work', 'positive', 3),
  ('Effort', 'positive', 2),
  ('Improvement', 'positive', 2),
  ('Homework completed', 'positive', 1),
  ('Helping others', 'positive', 2),
  ('Kindness', 'positive', 2),
  ('Leadership', 'positive', 3),
  ('Attendance/punctuality', 'positive', 1),
  ('Extra-curricular achievement', 'positive', 3),
  ('Representing the school', 'positive', 3);

-- Negative categories
INSERT INTO behaviour_categories (name, type, default_points) VALUES
  ('Uniform infringement', 'negative', -1),
  ('Late to lesson', 'negative', -1),
  ('Homework not completed', 'negative', -1),
  ('Equipment missing', 'negative', -1),
  ('Disruption in class', 'negative', -2),
  ('Failure to follow instructions', 'negative', -2),
  ('Rudeness/disrespect', 'negative', -3),
  ('Mobile phone misuse', 'negative', -2),
  ('Truancy', 'negative', -3),
  ('Physical altercation', 'negative', -5);
