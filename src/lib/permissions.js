// Read-only boards are still filtered out in deck.js today, but `view` remains
// a first-class computed level so the deferred read-only UI needs no model
// change when those boards start flowing through the app.

export function accessLevel(board) {
  const permissions = board?.permissions ?? {};
  if (permissions.PERMISSION_MANAGE) return 'manage';
  if (permissions.PERMISSION_EDIT) return 'edit';
  return 'view';
}

export function canEditBoard(board) {
  return accessLevel(board) !== 'view';
}
