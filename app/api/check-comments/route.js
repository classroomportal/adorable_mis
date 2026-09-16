// Batch pre-check for /reports/check. Same stateless pattern as /api/generate-comment:
// the caller sends the data already visible on screen, this route never touches
// Supabase. One call per "Run AI check" click covers every submitted comment on
// screen rather than one round trip per comment.

const MODEL = 'claude-sonnet-5';

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }, { status: 500 });
  }

  const body = await request.json();
  const items = Array.isArray(body?.items) ? body.items.slice(0, 60) : [];
  if (items.length === 0) {
    return Response.json({ results: [] });
  }

  const payload = items.map((it) => ({
    id: it.id,
    student: it.studentFirstName,
    comment: it.comment,
    effortGrade: it.effortGrade || null,
    latestGrade: it.latestGrade || null,
    latestScorePct: typeof it.latestScorePct === 'number' ? it.latestScorePct : null,
    targetGrade: it.targetGrade || null,
  }));

  const prompt = `You are helping a UK school's report-checking team triage school report comments before a human reads them. For each comment in the JSON array below, check for:
1. Spelling or grammar mistakes.
2. Tone problems (unprofessional, too harsh, or too vague to be useful).
3. A mismatch between the comment's sentiment and the student's actual data (e.g. the comment sounds very positive but latestScorePct is well below what targetGrade implies, or vice versa) — only flag this if latestGrade/latestScorePct/targetGrade are present and there's a clear contradiction, not a minor difference.

Comments (JSON):
${JSON.stringify(payload)}

Respond with ONLY a JSON array, one object per input comment, in this exact shape, no other text:
[{"id": <same id as input>, "hasIssues": true|false, "issues": ["short description of each issue found"], "suggestion": "a corrected version of the comment text if hasIssues is true and the fix is a small edit (spelling/grammar), otherwise null"}]

If a comment has no issues, hasIssues is false, issues is an empty array, suggestion is null.`;

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
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return Response.json({ error: `Anthropic API error: ${errText}` }, { status: 502 });
    }

    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || '').join('').trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return Response.json({ error: 'Could not parse a response from the model.' }, { status: 502 });
    }
    const results = JSON.parse(jsonMatch[0]);
    return Response.json({ results });
  } catch (err) {
    return Response.json({ error: `Request failed: ${err.message}` }, { status: 502 });
  }
}
