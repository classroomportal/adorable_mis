// First route handler in this app — everything else talks to Supabase directly from
// the client (see CLAUDE.md). This one exists because the Anthropic API key can't be
// exposed to the browser, so the draft-comment call has to happen server-side.
//
// Deliberately stateless: it never touches the database itself. The caller (a page
// already authenticated against Supabase, subject to the same RLS as any other read)
// gathers the real data client-side and sends it here; this route only turns that data
// into a short comment. That keeps the prompt's inputs exactly what the teacher already
// sees on screen, with nothing fetched or fabricated server-side.

const MODEL = 'claude-sonnet-5';

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }, { status: 500 });
  }

  const body = await request.json();
  const {
    kind, // 'subject' | 'pastoral'
    studentFirstName,
    subjectName,
    effortGrade,
    latestGrade,
    latestScorePct,
    targetGrade,
    priorComment,
  } = body || {};

  if (!studentFirstName || !kind) {
    return Response.json({ error: 'studentFirstName and kind are required.' }, { status: 400 });
  }

  const facts = [];
  if (kind === 'subject' && subjectName) facts.push(`Subject: ${subjectName}`);
  if (effortGrade) facts.push(`Effort grade: ${effortGrade}`);
  if (latestGrade) facts.push(`Latest result grade: ${latestGrade}`);
  if (typeof latestScorePct === 'number') facts.push(`Latest result: ${latestScorePct}%`);
  if (targetGrade) facts.push(`Target grade: ${targetGrade}`);
  if (priorComment) facts.push(`Teacher's own notes to build from: "${priorComment}"`);

  const prompt = `Write ONE short school report comment (2-3 sentences, professional UK school report register) for a student named ${studentFirstName}.

Known facts — use ONLY these, do not invent any other specific achievement, incident, or detail:
${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '- (no data available — write a generic but professional placeholder comment)'}

Rules:
- Third person ("${studentFirstName} has..."), not second person.
- If latest result is below target, note it constructively, not critically.
- No markdown, no quotation marks around the output, just the comment text itself.
- Do not mention effort grade or scores as raw numbers/labels in the prose — translate them into natural language.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return Response.json({ error: `Anthropic API error: ${errText}` }, { status: 502 });
    }

    const data = await res.json();
    const draft = (data.content || []).map((b) => b.text || '').join('').trim();
    return Response.json({ draft });
  } catch (err) {
    return Response.json({ error: `Request failed: ${err.message}` }, { status: 502 });
  }
}
