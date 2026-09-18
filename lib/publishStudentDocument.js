import { supabase } from './supabaseClient';

// Uploads a jsPDF document to the private student-documents bucket and
// upserts the matching student_documents row, overwriting any previous copy
// for this (student, document_type, term) rather than keeping history, per
// house decision. A plain upsert(onConflict:...) can't reliably match an
// existing row when term_id is null (NULL never equals NULL for uniqueness
// purposes), so the existing row is looked up and updated explicitly instead.
export async function publishStudentDocument({ doc, studentId, documentType, termId = null, title, pathSuffix }) {
  const blob = doc.output('blob');
  const path = `${studentId}/${documentType}-${pathSuffix ?? (termId || 'all')}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('student-documents')
    .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
  if (uploadError) throw uploadError;

  const { data: { user } } = await supabase.auth.getUser();
  const payload = {
    student_id: studentId,
    document_type: documentType,
    term_id: termId || null,
    title,
    storage_path: path,
    generated_by: user?.id || null,
  };

  let existingQuery = supabase
    .from('student_documents')
    .select('id')
    .eq('student_id', studentId)
    .eq('document_type', documentType);
  existingQuery = termId ? existingQuery.eq('term_id', termId) : existingQuery.is('term_id', null);
  const { data: existingRows } = await existingQuery;

  const { error: dbError } = existingRows?.[0]
    ? await supabase.from('student_documents').update(payload).eq('id', existingRows[0].id)
    : await supabase.from('student_documents').insert(payload);
  if (dbError) throw dbError;

  return path;
}
