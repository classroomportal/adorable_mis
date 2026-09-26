// Kicks off the nightly-backup workflow on demand, for the Run a Backup tile
// at /admin/backup.
//
// WHY THIS IS A SERVER ROUTE AT ALL: almost nothing in this app goes through
// app/api — pages talk to Supabase directly from the client. This one has to,
// because triggering a GitHub Actions run needs a GitHub token, and a token
// in client code is a token anyone can read and use to push to the repo.
//
// WHY IT REUSES THE WORKFLOW rather than dumping the database itself: the
// nightly workflow is the path that has been running and succeeding every
// night. A second, separate dump implementation would be a second thing to
// get wrong, and the one that only runs when someone presses a button is the
// one whose breakage you discover during an emergency.
//
// Requires two server-side env vars (Vercel > Settings > Environment
// Variables), neither of which is NEXT_PUBLIC_:
//   GITHUB_BACKUP_TOKEN  a fine-grained PAT with Actions: read and write on
//                         this repo only. Nothing else.
//   GITHUB_BACKUP_REPO   optional, defaults to classroomportal/adorable_mis.

const DEFAULT_REPO = 'classroomportal/adorable_mis';
const WORKFLOW_FILE = 'nightly-backup.yml';

// The caller sends their own Supabase session token and we ask the database
// who they are. The route never holds a service-role key, so a bug here
// cannot escalate beyond what the signed-in user could already do.
async function callerIsAdmin(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer /i, '').trim();
  if (!token) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;

  const res = await fetch(`${url}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

function github(path, token, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

export async function POST(request) {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  if (!token) {
    return Response.json(
      { error: 'GITHUB_BACKUP_TOKEN is not configured on the server, so backups cannot be triggered from here.' },
      { status: 500 },
    );
  }
  if (!(await callerIsAdmin(request))) {
    return Response.json({ error: 'Only an admin can trigger a backup.' }, { status: 403 });
  }

  const repo = process.env.GITHUB_BACKUP_REPO || DEFAULT_REPO;

  // Note the time before dispatching. workflow_dispatch returns 204 with no
  // body — it does not tell us which run it created — so the only way to
  // find our run is to look for one that started after this moment.
  const dispatchedAt = new Date(Date.now() - 60_000).toISOString();

  const dispatch = await github(`/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main' }),
  });

  if (!dispatch.ok) {
    const detail = await dispatch.text();
    return Response.json(
      { error: `GitHub refused to start the backup (HTTP ${dispatch.status}).`, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  // GitHub takes a moment to materialise the run. Poll briefly for it rather
  // than handing the page a null id it would have to special-case.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const runs = await github(
      `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5&created=>${dispatchedAt}`,
      token,
    );
    if (!runs.ok) continue;
    const { workflow_runs: workflowRuns = [] } = await runs.json();
    const run = workflowRuns[0];
    if (run) {
      return Response.json({ runId: run.id, status: run.status, url: run.html_url });
    }
  }

  // The dispatch was accepted, so a backup is very likely running; we just
  // could not pin down which run it is. Say exactly that rather than
  // reporting a failure that did not happen.
  return Response.json({
    runId: null,
    status: 'queued',
    url: `https://github.com/${repo}/actions/workflows/${WORKFLOW_FILE}`,
    note: 'The backup was started, but GitHub has not listed the run yet. Check the Actions tab.',
  });
}

export async function GET(request) {
  if (!(await callerIsAdmin(request))) {
    return Response.json({ error: 'Only an admin can check backup status.' }, { status: 403 });
  }

  // With no runId this is the page asking whether a backup can be started at
  // all. It asks before freezing the school, so a missing token shows up as a
  // disabled button rather than as a freeze followed by an error.
  const token = process.env.GITHUB_BACKUP_TOKEN;
  const runId = new URL(request.url).searchParams.get('runId');
  if (!runId) {
    return Response.json({ configured: Boolean(token) });
  }
  if (!token) {
    return Response.json({ error: 'GITHUB_BACKUP_TOKEN is not configured on the server.' }, { status: 500 });
  }

  const repo = process.env.GITHUB_BACKUP_REPO || DEFAULT_REPO;

  const res = await github(`/repos/${repo}/actions/runs/${runId}`, token);
  if (!res.ok) {
    return Response.json({ error: `Could not read the backup run (HTTP ${res.status}).` }, { status: 502 });
  }

  const run = await res.json();
  return Response.json({
    runId: run.id,
    status: run.status,          // queued | in_progress | completed
    conclusion: run.conclusion,  // success | failure | cancelled | null
    url: run.html_url,
    startedAt: run.run_started_at,
  });
}
