import { supabase } from './supabaseClient';

// On-screen card sorts and classwork marks (migration 432).
//
// A student (with a partner on the same laptop) places the cards and presses
// Check once; submit_card_sort() marks it on the server against the answer
// key, which students can never read, and records the same mark for both.
// Teachers see the marks as Classwork columns in the mark sheet, next to
// homework but never counted with it.

const BUCKET = 'lesson-worksheets';

// The card sort and its cards, with short-lived links to the pictures. The
// database returns nothing to a student before their lesson starts.
export async function loadCardSort(worksheetId) {
  const [{ data: sort, error }, { data: cards }] = await Promise.all([
    supabase.from('card_sorts').select('*').eq('worksheet_id', worksheetId).maybeSingle(),
    supabase.from('card_sort_cards').select('letter, body, image_path, image_width, position').eq('worksheet_id', worksheetId).order('position'),
  ]);
  if (error || !sort) return { sort: null, cards: [], error: error || new Error('This card sort isn\'t open yet.') };
  const paths = (cards || []).map((c) => c.image_path).filter(Boolean);
  let urls = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
    urls = Object.fromEntries((signed || []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  }
  return { sort, cards: (cards || []).map((c) => ({ ...c, imageUrl: c.image_path ? urls[c.image_path] : null })), error: null };
}

export async function loadMyCardSortMark(worksheetId, studentId) {
  const { data } = await supabase.from('classwork_marks')
    .select('score, out_of, partner_student_id, used_help, created_at')
    .eq('worksheet_id', worksheetId).eq('student_id', studentId).maybeSingle();
  return data || null;
}

// Classmates who can be picked as a partner (same class, not done it yet).
export async function loadCardSortPartners(worksheetId) {
  const { data } = await supabase.rpc('card_sort_partners', { p_worksheet_id: worksheetId });
  return data || [];
}

// answer: {letter: header} for a header sort, or [[letters], …] for a set sort.
export async function submitCardSort(worksheetId, partnerId, answer, usedHelp) {
  const { data, error } = await supabase.rpc('submit_card_sort', {
    p_worksheet_id: worksheetId, p_partner_id: partnerId || null, p_answer: answer, p_used_help: !!usedHelp,
  });
  return { result: Array.isArray(data) ? data[0] : data, error };
}

// ---- Teachers: classwork columns in the mark sheet ------------------------------

// Every worksheet on the class's lessons between two dates, with the lesson
// it falls on (class_worksheet_columns()).
export async function loadClassworkColumns(classId, from, to) {
  const { data } = await supabase.rpc('class_worksheet_columns', { p_class_id: classId, p_from: from, p_to: to });
  return data || [];
}

export async function loadClassworkMarks(classId, worksheetIds) {
  if (!worksheetIds.length) return [];
  const { data } = await supabase.from('classwork_marks')
    .select('mark_id, worksheet_id, student_id, score, out_of, source, partner_student_id, used_help')
    .eq('class_id', classId).in('worksheet_id', worksheetIds);
  return data || [];
}

export async function setWorksheetMaxMark(worksheetId, max) {
  const { error } = await supabase.rpc('set_worksheet_max_mark', { p_worksheet_id: worksheetId, p_max: max });
  return error;
}

// A teacher's mark for an ordinary worksheet; score '' removes it.
export async function saveClassworkMark({ worksheetId, classId, studentId, existing, score }) {
  if (score === '' || score === null) {
    if (!existing) return null;
    const { error } = await supabase.from('classwork_marks').delete().eq('mark_id', existing.mark_id);
    return error;
  }
  if (existing) {
    const { error } = await supabase.from('classwork_marks').update({ score: Number(score) }).eq('mark_id', existing.mark_id);
    return error;
  }
  const { error } = await supabase.from('classwork_marks').insert({
    worksheet_id: worksheetId, class_id: classId, student_id: studentId, score: Number(score), source: 'teacher',
  });
  return error;
}

// Lets a pair do a card sort again (their mark is removed for both).
export async function resetCardSortMark(mark, partnerMark) {
  const ids = [mark.mark_id, partnerMark?.mark_id].filter(Boolean);
  const { error } = await supabase.from('classwork_marks').delete().in('mark_id', ids);
  return error;
}
