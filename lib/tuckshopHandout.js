// Who can use /tuckshop/hand-out: the tuckshop staff and the tuckshop owner
// only, not admins or the bursar (asked for 28 Sep 2026, migration 230).
// hasAccess() lets every admin into every page, so the page and its
// dashboard link check staff roles directly. The database functions check
// the same roles with has_staff_role(), which admins don't pass either.
export const HANDOUT_ROLES = ['tuckshop', 'tuckshop_owner'];

export const canHandOut = (staffRoles) => (staffRoles || []).some((r) => HANDOUT_ROLES.includes(r));
