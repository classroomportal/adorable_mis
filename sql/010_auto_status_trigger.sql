CREATE OR REPLACE FUNCTION auto_set_student_status() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.leaving_date IS NOT NULL AND NEW.leaving_date <= CURRENT_DATE THEN
        NEW.status := 'left';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_set_student_status ON students;
CREATE TRIGGER trg_auto_set_student_status
    BEFORE INSERT OR UPDATE ON students
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_student_status();

-- One-time catch-up for any existing rows with a leaving_date already in the past
UPDATE students SET status = 'left' WHERE leaving_date IS NOT NULL AND leaving_date <= CURRENT_DATE AND status != 'left';
