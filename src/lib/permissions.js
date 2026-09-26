export function accessLevel(board) {
  const permissions = board?.permissions ?? {};
  if (permissions.PERMISSION_MANAGE) return 'manage';
  if (permissions.PERMISSION_EDIT) return 'edit';
  return 'view';
}

export function canEditBoard(board) {
  return accessLevel(board) !== 'view';
}
