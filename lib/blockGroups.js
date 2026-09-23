// A compound curriculum block (Class, Pathway, Vocational) is a choice of one
// group per student, where a group can bundle several subjects — Pathway
// "101" is 101/Bi, 101/Ch, 101/Co, 101/Cv and 101/Ph together. The group is
// the class_code prefix before the "/", except where classes.block_group
// names it explicitly (Year 12, where every class is "12a/..." and the group
// is the set number across subjects — see migration 149).
export function classGroupKey(c) {
  if (c.block_group) return c.block_group;
  const idx = c.class_code.lastIndexOf('/');
  return idx === -1 ? c.class_code : c.class_code.slice(0, idx);
}

// Map of group key -> classes, in the order the groups first appear.
export function groupClassesByKey(classes) {
  const byKey = new Map();
  for (const c of classes) {
    const key = classGroupKey(c);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
  return byKey;
}
