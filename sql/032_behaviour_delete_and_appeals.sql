-- 032_behaviour_delete_and_appeals.sql
-- Delete permission for behaviour events (admin only — deleting disciplinary records is sensitive)
-- plus the appeals system for item 11 on the to-do list.

CREATE POLICY "admin_delete_behaviour" ON behaviour_events FOR DELETE USING (is_admin());

CREATE TABLE behaviour_appeals (
    appeal_id        SERIAL PRIMARY KEY,
    event_id         INTEGER NOT NULL REFERENCES behaviour_events(event_id),
    student_id       INTEGER NOT NULL REFERENCES students(student_id),
    reason           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'rejected')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by      INTEGER REFERENCES staff(staff_id),
    reviewed_at      TIMESTAMPTZ,
    resolution_notes TEXT
);
ALTER TABLE behaviour_appeals ENABLE ROW LEVEL SECURITY;

-- Students can see and raise appeals only for their own events
CREATE POLICY "student_read_own_appeals" ON behaviour_appeals FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.student_id = behaviour_appeals.student_id)
);
CREATE POLICY "student_insert_own_appeals" ON behaviour_appeals FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN behaviour_events be ON be.event_id = behaviour_appeals.event_id AND be.type = 'negative'
    WHERE p.id = auth.uid() AND p.student_id = behaviour_appeals.student_id AND p.student_id = be.student_id
  )
);

-- Pastoral/SMT/admin review all appeals
CREATE POLICY "pastoral_read_all_appeals" ON behaviour_appeals FOR SELECT USING (is_pastoral_or_smt());
CREATE POLICY "pastoral_update_appeals" ON behaviour_appeals FOR UPDATE USING (is_pastoral_or_smt());
