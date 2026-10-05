'use client';

// The student's lesson feedback form (migration 365): green / amber / red for
// how well they understood the lesson, then Yes / No for each active question.
// Sent once; give_lesson_feedback() checks the lesson is theirs and still open.

import { useEffect, useRef, useState } from 'react';
import { UNDERSTANDING, loadFeedbackQuestions, giveLessonFeedback } from '../../lib/lessonFeedback';
import { formatUKDate } from '../../lib/formatDate';

export default function LessonFeedbackForm({ lesson, onClose, onSaved }) {
  const ref = useRef(null);
  const [questions, setQuestions] = useState([]);
  const [understanding, setUnderstanding] = useState(null);
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFeedbackQuestions().then(({ questions: q }) => setQuestions(q));
  }, []);

  useEffect(() => {
    setUnderstanding(null);
    setAnswers({});
    setStatus(null);
    if (lesson) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [lesson?.slot_id, lesson?.lesson_date]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lesson) return null;

  const missing = !understanding || questions.some((q) => typeof answers[q.question_id] !== 'boolean');

  async function send() {
    if (missing || saving) return;
    setSaving(true);
    const { error } = await giveLessonFeedback(lesson, understanding, answers);
    setSaving(false);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    onSaved?.(lesson);
  }

  return (
    <div className="hw-detail lf-form" ref={ref}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
        <div>
          <div className="hw-detail-subject">Lesson feedback</div>
          <h3 style={{ margin: '0.1rem 0 0.2rem' }}>{lesson.subject_name}</h3>
          <div style={{ fontSize: '0.85em', color: 'var(--ink-soft)' }}>
            {formatUKDate(lesson.lesson_date, { weekday: true })} · lesson {lesson.period_number}
          </div>
        </div>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
      <p style={{ fontSize: '0.85em', color: 'var(--ink-soft)' }}>
        Your teacher sees a summary of the class&apos;s answers, never your name.
      </p>

      <p className="lf-question">How well did you understand today&apos;s lesson?</p>
      <div className="lf-rag">
        {UNDERSTANDING.map((u) => (
          <button
            key={u.key}
            type="button"
            className={`lf-rag-btn lf-${u.key} ${understanding === u.key ? 'lf-chosen' : ''}`}
            aria-pressed={understanding === u.key}
            onClick={() => setUnderstanding(u.key)}
          >
            <strong>{u.label}</strong>
            <span>{u.desc}</span>
          </button>
        ))}
      </div>

      {questions.map((q) => (
        <div key={q.question_id} className="lf-row">
          <span className="lf-question">{q.question}</span>
          <span className="lf-yesno">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                className={answers[q.question_id] === v ? 'lf-chosen' : 'secondary'}
                aria-pressed={answers[q.question_id] === v}
                onClick={() => setAnswers({ ...answers, [q.question_id]: v })}
              >
                {v ? 'Yes' : 'No'}
              </button>
            ))}
          </span>
        </div>
      ))}

      {status && <p style={{ color: 'red' }}>{status}</p>}
      <p style={{ marginBottom: 0 }}>
        <button type="button" onClick={send} disabled={missing || saving}>
          {saving ? 'Sending…' : 'Send feedback'}
        </button>
        {missing && <span style={{ marginLeft: '0.75rem', fontSize: '0.85em', color: 'var(--ink-soft)' }}>Answer every question to send.</span>}
      </p>
    </div>
  );
}
