// Nova-T exports carry "Other Half sets" and "Sports" blocks for every year, but
// the Other Half (Sports Academy included) is chosen by students in Formwork at
// /other-half, never allocated as classes, so these blocks are left off the
// block lists. The rows stay in curriculum_blocks; a re-import would recreate them.
const OTHER_HALF_BLOCK_NAMES = ['other half sets', 'other half', 'sports'];

export function isOtherHalfBlock(blockName) {
  return OTHER_HALF_BLOCK_NAMES.includes(String(blockName || '').trim().toLowerCase());
}

export function withoutOtherHalfBlocks(blocks) {
  return (blocks || []).filter((b) => !isOtherHalfBlock(b.block_name));
}
