// Works out what a staff role can do to each table — view, add, edit,
// delete — from the live Row Level Security policies, for /admin/permissions.
//
// The policies come from role_access_policies() (migration 327), so the page
// reads the database's own rules rather than a hand-kept list that drifts.
// Each policy's condition is split into its AND/OR parts, and each part is
// judged for someone holding only the chosen role:
//   'yes'  — always true for that role (e.g. user_has_staff_role(['bursar']))
//   'no'   — never true for it (another role, or a parent/student-only check)
//   'some' — depends on the row (their own classes, events they logged, …)
// The parts are then combined (AND/OR), and a table's permissive policies
// are OR'd per action. Anything not recognised counts as 'some', so the
// page never claims more access than the rule gives.
//
// Things this can't see: changes made through SECURITY DEFINER functions
// (fee approvals, admissions decisions, …), which check the caller
// themselves, and per-field rules like student Core Data (set below the
// pages on /admin/permissions). The page says so.

// Helper functions whose whole answer depends only on the caller's roles.
// Kept in step with their bodies in the database (see sql/CURRENT_SCHEMA.md).
const ROLE_HELPERS = {
  is_staff_or_admin: () => 'yes',
  is_admin: (ctx) => (ctx.isAdmin ? 'yes' : 'no'),
  is_medical_staff: (ctx) => anyRole(ctx, ['nurse'], true),
  can_manage_staff_hr: (ctx) => anyRole(ctx, ['hr'], true),
  can_read_staff_hr: (ctx) => anyRole(ctx, ['hr', 'smt'], true),
  is_assessment_manager: (ctx) => anyRole(ctx, ['assessment_manager'], true),
  can_manage_other_half: (ctx) => anyRole(ctx, ['smt', 'other_half'], true),
  can_manage_student_groups: (ctx) => anyRole(ctx, ['smt', 'pastoral', 'school_office'], true),
  can_allocate_classes: (ctx) => anyRole(ctx, ['head_of_department', 'pastoral', 'school_office'], true),
  is_pastoral_or_smt: (ctx) => anyRole(ctx, ['smt', 'houseparent', 'head_of_boarding', 'pastoral'], true),
  can_edit_next_year: (ctx) => or([resource(ctx, '/admin/next-year'), resource(ctx, '/admin/import-classes')]),
  can_propose_fee_prices: (ctx) => or([anyRole(ctx, ['bursar', 'smt', 'principal', 'college_secretary'], true), resource(ctx, '/admin/lookups')]),
  can_edit_any_student_field: (ctx) => (ctx.isAdmin || ctx.editableFieldCount > 0 ? 'yes' : 'no'),
  // These also let a student or parent in, for their own rows; for staff
  // only the role part counts.
  can_view_student_tuckshop: (ctx) => anyRole(ctx, ['tuckshop', 'bursar', 'smt'], true),
  // Row-dependent: a role-wide part, else only certain rows.
  can_view_homework_marks: (ctx) => or([anyRole(ctx, ['smt'], true), 'some']),
  can_mark_student_group: (ctx) => or([anyRole(ctx, ['smt', 'pastoral', 'school_office'], true), 'some']),
  can_edit_behaviour_event: (ctx) => or([anyRole(ctx, ['smt', 'houseparent', 'head_of_boarding', 'pastoral', 'school_office'], true), 'some']),
  can_delete_result: (ctx) => or([anyRole(ctx, ['assessment_manager'], true), 'some']),
  is_hod_for_subject: (ctx) => (ctx.role === 'head_of_department' ? 'some' : 'no'),
  // Only ever true for a student or parent login.
  my_parent_ids: () => 'no',
  my_student_id: () => 'no',
  my_current_child_ids: () => 'no',
};

function anyRole(ctx, roles, adminPasses) {
  if (adminPasses && ctx.isAdmin) return 'yes';
  return roles.includes(ctx.role) ? 'yes' : 'no';
}

function resource(ctx, key) {
  return ctx.isAdmin || ctx.resources.has(key) ? 'yes' : 'no';
}

function or(values) {
  if (values.includes('yes')) return 'yes';
  if (values.includes('some')) return 'some';
  return 'no';
}

function and(values) {
  if (values.includes('no')) return 'no';
  if (values.includes('some')) return 'some';
  return 'yes';
}

function not(value) {
  if (value === 'yes') return 'no';
  if (value === 'no') return 'yes';
  return 'some';
}

// Split an expression on a top-level keyword (AND / OR), ignoring anything
// inside brackets or quotes.
function splitTopLevel(expr, keyword) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  const upper = expr.toUpperCase();
  const token = ` ${keyword} `;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") quote = !quote;
    if (quote) continue;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && upper.startsWith(token, i)) {
      parts.push(expr.slice(start, i));
      start = i + token.length;
      i += token.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim());
}

// True when the brackets at each end of expr enclose all of it.
function wrapped(expr) {
  if (!expr.startsWith('(') || !expr.endsWith(')')) return false;
  let depth = 0;
  let quote = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") quote = !quote;
    if (quote) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0 && i < expr.length - 1) return false;
    }
  }
  return true;
}

function arrayRoles(text) {
  return [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

// Judge one part with no top-level AND/OR left in it.
function evalAtom(atom, ctx) {
  const a = atom.trim();
  if (/^true$/i.test(a)) return 'yes';
  if (/^false$/i.test(a)) return 'no';
  // The removed demo-account flag (always passes now; see CLAUDE.md).
  if (/is_demo_account\(\)/.test(a) && !/auth\.uid\(\)/.test(a)) return 'yes';
  // A ticked ability (migration 329): read the role's ticks.
  const tick = a.match(/has_ability\('([^']+)'(?:::text)?,\s*'([^']+)'/);
  if (tick) return ctx.ticks.has(`${tick[1]}:${tick[2]}`) ? 'yes' : 'no';
  // A condition on the row's own values (status = 'draft', NOT
  // marks_released, …): it limits which rows, not which roles.
  if (!/auth\.uid\(\)/.test(a) && helperCalls(a).length === 0) return 'yes';
  if (/^NOT /i.test(a)) return not(evaluate(a.slice(4), ctx));
  if (/^auth\.role\(\) = 'authenticated'/.test(a) || /^auth\.uid\(\) IS NOT NULL$/.test(a)) return 'yes';
  let m = a.match(/^(user_has_staff_role|has_staff_role)\((.*)\)$/s);
  if (m) return anyRole(ctx, arrayRoles(m[2]), m[1] === 'user_has_staff_role');
  m = a.match(/^holds_staff_role\('([a-z_]+)'/);
  if (m) return anyRole(ctx, [m[1]], false);
  m = a.match(/^has_resource_access\('([^']+)'/);
  if (m) return resource(ctx, m[1]);
  m = a.match(/^([a-z_]+)\(/);
  if (m && ROLE_HELPERS[m[1]] && wrappedCall(a)) return ROLE_HELPERS[m[1]](ctx);
  // Checks that only a student or parent login can pass: the caller's
  // profile linked to a student or parent record.
  if (/my_parent_ids\(\)|my_student_id\(\)|my_current_child_ids\(\)|\b(p|pr|profiles)\.(student_id|parent_id)\b|role = '(parent|student)'/.test(a)) return 'no';
  // A subquery whose only check is a role-wide helper.
  const calls = helperCalls(a);
  if (!/auth\.uid\(\)/.test(a) && calls.every((c) => ROLE_HELPERS[c])) return and(calls.map((c) => ROLE_HELPERS[c](ctx)));
  // Anything tied to the caller (their own classes, events, messages, …).
  return 'some';
}

// The functions an expression calls, leaving out SQL's own words.
function helperCalls(a) {
  return [...a.matchAll(/\b([a-z_]+)\s?\(/gi)].map((c) => c[1])
    .filter((c) => !/^(ARRAY|ALL|ANY|EXISTS|IN|SELECT|NOT|AND|OR|ON|WHERE|coalesce|lower|upper|now|current_date)$/i.test(c));
}

// fn(...) with the closing bracket the end of the whole atom.
function wrappedCall(a) {
  const open = a.indexOf('(');
  return wrapped(a.slice(open));
}

function evaluate(expr, ctx) {
  let e = expr.trim();
  while (wrapped(e)) e = e.slice(1, -1).trim();
  const ors = splitTopLevel(e, 'OR');
  if (ors.length > 1) return or(ors.map((p) => evaluate(p, ctx)));
  const ands = splitTopLevel(e, 'AND');
  if (ands.length > 1) return and(ands.map((p) => evaluate(p, ctx)));
  return evalAtom(e, ctx);
}

export const ACTIONS = ['view', 'add', 'edit', 'delete'];
const ACTION_CMD = { view: 'SELECT', add: 'INSERT', edit: 'UPDATE', delete: 'DELETE' };
const GRANT_KEY = { view: 'can_select', add: 'can_insert', edit: 'can_update', delete: 'can_delete' };

// policies: rows from role_access_policies(); tables: rows of
// { table_name, rls_enabled, can_select, can_insert, can_update, can_delete }.
// Returns { [table]: { view, add, edit, delete } } of 'yes' | 'some' | 'no',
// plus viewRules, addRules, … : the names of the policies that allow it.
// ticks: Set of 'table:action' ticked for this role in role_abilities.
export function abilitiesForRole({ role, resources, editableFieldCount, ticks, policies, tables }) {
  const ctx = { role, isAdmin: role === 'admin', resources: resources || new Set(), editableFieldCount: editableFieldCount || 0, ticks: ticks || new Set() };
  const byTable = {};
  (policies || []).forEach((p) => {
    if (!(p.roles || []).some((r) => r === 'public' || r === 'authenticated')) return;
    (byTable[p.table_name] = byTable[p.table_name] || []).push(p);
  });
  const out = {};
  (tables || []).forEach((t) => {
    const result = {};
    ACTIONS.forEach((action) => {
      if (!t[GRANT_KEY[action]]) { result[action] = 'no'; return; }
      if (!t.rls_enabled) { result[action] = 'yes'; return; }
      const cmd = ACTION_CMD[action];
      const applies = (byTable[t.table_name] || []).filter((p) => p.cmd === cmd || p.cmd === 'ALL');
      const judged = applies.map((p) => {
        // INSERT is checked by WITH CHECK; UPDATE needs both USING and WITH CHECK.
        if (action === 'add') return evaluate(p.with_check || p.qual || 'false', ctx);
        if (action === 'edit') {
          const using = p.qual ? evaluate(p.qual, ctx) : 'yes';
          return p.with_check ? and([using, evaluate(p.with_check, ctx)]) : using;
        }
        return evaluate(p.qual || 'false', ctx);
      });
      result[action] = or(judged);
      // The policies that let this role in, by name, for the page to show.
      result[`${action}Rules`] = applies.filter((_, i) => judged[i] !== 'no').map((p) => p.policy_name);
    });
    out[t.table_name] = result;
  });
  return out;
}

// For tests: judge a single expression.
export function judgeExpression(expr, ctx) {
  return evaluate(expr, { isAdmin: ctx.role === 'admin', resources: new Set(), editableFieldCount: 0, ticks: new Set(), ...ctx });
}
