import { supabase } from './supabaseClient';
import { fileTypeFor } from './homework';

// Worksheets on lessons (migration 428, the Maths trial). A teacher adds a
// file to one lesson of a class (class, date and period); students in the
// class see it on their timetable but can open it only from the start of the
// lesson (opens_at, set by the database from the timetable). Files live in
// the private lesson-worksheets bucket under '<class_id>/…' and open through a
// short-lived signed link. The database decides who may add, remove and open
// them; nothing here is the security boundary.

const BUCKET = 'lesson-worksheets';

export function worksheetKey(date, periodNumber, classId) {
  return `${date}|${periodNumber}|${classId}`;
}

// Whether the signed-in user can add worksheets to this class's lessons
// (teaches or leads it, and the subject's department is in the trial).
export async function canAddWorksheets(classId) {
  const { data } = await supabase.rpc('can_add_lesson_worksheet', { p_class_id: Number(classId) });
  return !!data;
}

// The class's lessons between two dates, in term and not on holidays.
export async function loadClassLessons(classId, from, to) {
  const { data, error } = await supabase.rpc('class_lessons_between', { p_class_id: Number(classId), p_from: from, p_to: to });
  return { lessons: data || [], error };
}

// Staff: every worksheet on the class's lessons between two dates.
export async function loadClassWorksheets(classId, from, to) {
  const { data, error } = await supabase.from('lesson_worksheets')
    .select('worksheet_id, class_id, lesson_date, period_number, opens_at, title, storage_path, file_name, size_bytes')
    .eq('class_id', classId)
    .gte('lesson_date', from)
    .lte('lesson_date', to)
    .order('worksheet_id');
  return { worksheets: data || [], error };
}

// Students: their worksheets between two dates. Ones not open yet come back
// with is_open false and no title or file.
export async function loadMyWorksheets(from, to) {
  const { data, error } = await supabase.rpc('my_lesson_worksheets', { p_from: from, p_to: to });
  return { worksheets: data || [], error };
}

// The row first, then the file: the bucket's read rule goes through the row,
// so a file without one could never be opened. If the upload fails, the row
// is taken away again.
export async function addLessonWorksheet(classId, lessonDate, periodNumber, file, title) {
  const type = fileTypeFor(file.name);
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${classId}/${lessonDate}-${periodNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const { data: row, error } = await supabase.from('lesson_worksheets')
    .insert({
      class_id: Number(classId), lesson_date: lessonDate, period_number: periodNumber,
      title: (title || file.name).trim(), storage_path: path,
      file_name: file.name, mime_type: type, size_bytes: file.size,
    })
    .select('worksheet_id').single();
  if (error) return error;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false });
  if (upErr) {
    await supabase.from('lesson_worksheets').delete().eq('worksheet_id', row.worksheet_id);
    return upErr;
  }
  return null;
}

// The file first, then the row, so a failed removal never leaves a file
// that no row points to.
export async function removeLessonWorksheet(ws) {
  const { error } = await supabase.storage.from(BUCKET).remove([ws.storage_path]);
  if (error) return error;
  const { error: rowErr } = await supabase.from('lesson_worksheets').delete().eq('worksheet_id', ws.worksheet_id);
  return rowErr;
}

// Opens a worksheet in a new tab through a signed link valid for ten minutes.
// Refused by the database for a student before the lesson starts.
export async function openLessonWorksheet(ws) {
  // Opened first and pointed at the file afterwards, so the browser doesn't
  // treat it as an unrequested pop-up.
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ws.storage_path, 600);
  if (error || !data?.signedUrl) { tab?.close(); return error || new Error('The worksheet could not be opened.'); }
  if (tab) { tab.opener = null; tab.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
  return null;
}

// "10:20" from opens_at ("2026-10-12T10:20:00", school time).
export function opensAtClock(opensAt) {
  return (opensAt || '').slice(11, 16);
}
