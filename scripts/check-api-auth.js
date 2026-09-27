#!/usr/bin/env node
// Fails the build if any server-side entry point can run without an
// authorisation check. Runs automatically before every `npm run build`
// (the "prebuild" script), which is also what Vercel runs, so a route
// without a check can't be deployed.
//
// The rule (see CLAUDE.md and lib/serverAuth.js): every HTTP handler in an
// app/**/route.js file must be written as
//
//   export async function POST(request) {
//     const auth = await requireResource(request, '/some/resource-key');
//     if (auth.denied) return auth.denied;
//     ...
//
// with those two lines first, and requireResource imported from
// lib/serverAuth. Anything else is rejected rather than guessed at:
// handlers exported as `export const POST = ...`, re-exported with
// `export { POST }`, or the check placed later in the function. Server
// Actions ('use server') and a pages/api folder are rejected outright;
// Formwork doesn't use either, and each would be another way in.
//
// A route that genuinely must work without sign-in goes in PUBLIC_ROUTES
// below, with the reason. That list should stay empty unless the school has
// agreed to it.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_ROUTES = {
  // 'app/api/example/route.js': 'why this must work before sign-in',
};

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
const ANY_HANDLER_EXPORT = new RegExp(
  `export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var)\\s+(${METHODS})\\b`, 'g');
const REEXPORT = new RegExp(`export\\s*\\{[^}]*\\b(${METHODS})\\b[^}]*\\}`);
const GUARDED_HANDLER = new RegExp(
  `export\\s+async\\s+function\\s+(${METHODS})\\s*\\(\\s*request\\b[^)]*\\)\\s*\\{\\s*` +
  `const\\s+auth\\s*=\\s*await\\s+requireResource\\(\\s*request\\s*,[^;]+\\);\\s*` +
  `if\\s*\\(\\s*auth\\.denied\\s*\\)\\s*return\\s+auth\\.denied\\s*;`, 'g');
const IMPORTS_HELPER = /import\s*\{[^}]*\brequireResource\b[^}]*\}\s*from\s*['"][./]*(?:\.\.\/)*lib\/serverAuth(?:\.js)?['"]/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const problems = [];
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

if (walk(path.join(ROOT, 'pages', 'api')).length > 0) {
  problems.push('pages/api: API routes must live in app/**/route.js, where this check covers them.');
}

let checked = 0;
for (const file of [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'lib'))]) {
  const name = rel(file);
  const src = fs.readFileSync(file, 'utf8');

  if (/^\s*['"]use server['"]/m.test(src)) {
    problems.push(`${name}: Server Actions ('use server') aren't allowed; use an app/api route with requireResource().`);
  }

  if (!/\/route\.(js|jsx|ts|tsx|mjs)$/.test(name) || !name.startsWith('app/')) continue;
  if (PUBLIC_ROUTES[name]) continue;
  checked += 1;

  const exported = [...src.matchAll(ANY_HANDLER_EXPORT)].map((m) => m[1]);
  const guarded = new Set([...src.matchAll(GUARDED_HANDLER)].map((m) => m[1]));

  if (REEXPORT.test(src)) {
    problems.push(`${name}: handlers must be declared as \`export async function METHOD(request)\`, not re-exported.`);
  }
  if (exported.length === 0 && !REEXPORT.test(src)) {
    problems.push(`${name}: no HTTP handler found in the expected form \`export async function METHOD(request)\`.`);
  }
  for (const method of exported) {
    if (!guarded.has(method)) {
      problems.push(`${name}: ${method} must start with \`const auth = await requireResource(request, ...); if (auth.denied) return auth.denied;\`.`);
    }
  }
  if (exported.length > 0 && !IMPORTS_HELPER.test(src)) {
    problems.push(`${name}: must import { requireResource } from lib/serverAuth.`);
  }
}

if (problems.length > 0) {
  console.error('\nAuthorisation check failed (scripts/check-api-auth.js):\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nEvery server route must check who is calling it. See lib/serverAuth.js and CLAUDE.md.\n');
  process.exit(1);
}
console.log(`Authorisation check passed: ${checked} route file(s), each handler checks access first.`);
