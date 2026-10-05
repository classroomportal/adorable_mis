import { supabase } from './supabaseClient';

// Lesson feedback (migration 365). A student answers the yes/no questions in
// lesson_feedback_questions and picks green / amber / red for how well they
// understood a lesson, from the end of the lesson until the end of the next
// day. The database decides which lessons are open (my_lesson_feedback_lessons())
// and checks everything again in give_lesson_feedback(). Teachers and Heads of
// Department get a summary only, never names (lesson_feedback_summary(), at
// least 3 responses a class); only SMT read the named rows.

export const UNDERSTANDING = [
  { key: 'green', label: 'Green', desc: 'I understood it and could do the work on my own' },
  { key: 'amber', label: 'Amber', desc: "I understood some of it but I'm not sure about parts" },
  { key: 'red', label: 'Red', desc: "I didn't understand it and need help" },
];

// Smallest number of responses before a class's figures are shown to staff
// (lesson_feedback_summary() applies it; this is for the page's wording).
export const MIN_RESPONSES = 3;

export async function loadFeedbackQuestions({ includeRetired = false } = {}) {
  let q = supabase.from('lesson_feedback_questions').select('*').order('position').order('question_id');
  if (!includeRetired) q = q.eq('active', true);
  const { data, error } = await q;
  return { questions: data || [], error };
}

// Today's and yesterday's lessons the signed-in student can give feedback on,
// with given = already done.
export async function loadFeedbackLessons() {
  const { data, error } = await supabase.rpc('my_lesson_feedback_lessons');
  return { lessons: data || [], error };
}

export function feedbackKey(date, periodNumber, classId) {
  return `${date}|${periodNumber}|${classId}`;
}

export async function giveLessonFeedback(lesson, understanding, answers) {
  const { error } = await supabase.rpc('give_lesson_feedback', {
    p_slot_id: lesson.slot_id,
    p_lesson_date: lesson.lesson_date,
    p_understanding: understanding,
    p_answers: answers,
  });
  return { error };
}

// Whether an answer is the good one, the bad one, or neither (good_answer null).
export function answerTone(goodAnswer, answer) {
  if (goodAnswer == null) return 'neutral';
  return goodAnswer === answer ? 'good' : 'bad';
}
