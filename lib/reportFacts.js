// The facts an AI report-comment draft is built from, as plain lines.
// Shared by /api/generate-comment (which puts them in the prompt) and the
// report-writing pages (which list them under "What the AI draft is based
// on"), so what the writer is shown is exactly what the AI is given. No
// imports: this runs on both the server and the client.

export const PASTORAL_ROLE = { mentor: 'mentor', houseparent: 'houseparent', smt: 'senior management team' };

const list = (xs) => (Array.isArray(xs) ? xs.filter(Boolean) : []);

// Subject comment: the teacher's three judgements plus the student's grades
// in that subject this year, oldest first.
export function subjectFacts(b) {
  const facts = [];
  if (b.subjectName) facts.push(`Subject: ${b.subjectName}`);
  if (b.effortGrade) facts.push(`Effort: ${b.effortGrade}`);
  if (b.presentationGrade) facts.push(`Presentation of work: ${b.presentationGrade}`);
  if (b.homeworkGrade) facts.push(`Homework: ${b.homeworkGrade}`);
  if (b.targetGrade) facts.push(`Target grade: ${b.targetGrade}`);
  const history = list(b.gradeHistory);
  if (history.length) facts.push(`Grades this year, oldest first: ${history.map((h) => `${h.label} ${h.grade}${h.isExam ? ' (exam)' : ''}`).join(', ')}`);
  if (b.bestGrade) facts.push(`Best result this year: ${b.bestGrade}`);
  if (b.lowestGrade) facts.push(`Lowest result this year: ${b.lowestGrade}`);
  if (b.latestGrade) facts.push(`Most recent result: ${b.latestGrade}`);
  return facts;
}

// Pastoral comment: behaviour this year, best and weakest subjects, and the
// judgements subject teachers have given this report period.
export function pastoralFacts(b) {
  const facts = [];
  const beh = b.behaviour;
  if (beh) {
    const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    facts.push(`Positive behaviour points this year: +${beh.plus} from ${n(beh.plusEvents, 'award')}`);
    facts.push(`Negative behaviour points this year: ${beh.minus} from ${n(beh.minusEvents, 'incident')}`);
    if (list(beh.topPositive).length) facts.push(`Main reasons for positive points: ${list(beh.topPositive).join(', ')}`);
    if (list(beh.topNegative).length) facts.push(`Main reasons for negative points: ${list(beh.topNegative).join(', ')}`);
  }
  if (list(b.bestGrades).length) facts.push(`Strongest subjects (latest grade vs target): ${list(b.bestGrades).join(', ')}`);
  if (list(b.weakestGrades).length) facts.push(`Weakest subjects (latest grade vs target): ${list(b.weakestGrades).join(', ')}`);
  for (const line of list(b.teacherJudgements)) facts.push(line);
  return facts;
}
