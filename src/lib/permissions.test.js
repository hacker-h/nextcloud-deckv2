import { describe, expect, it } from 'vitest';
import { accessLevel, canEditBoard } from './permissions.js';

describe('board permission access levels', () => {
  it.each([
    ['full-manage payload', { permissions: { PERMISSION_READ: true, PERMISSION_EDIT: true, PERMISSION_MANAGE: true, PERMISSION_SHARE: true } }, 'manage', true],
    ['edit-but-not-manage payload', { permissions: { PERMISSION_READ: true, PERMISSION_EDIT: true, PERMISSION_MANAGE: false } }, 'edit', true],
    [
      'live board 109 read-only payload',
      { permissions: { PERMISSION_READ: true, PERMISSION_EDIT: false, PERMISSION_MANAGE: false, PERMISSION_SHARE: false } },
      'view',
      false,
    ],
    ['empty board object', {}, 'view', false],
    ['undefined board', undefined, 'view', false],
    ['null board', null, 'view', false],
    ['empty permissions object', { permissions: {} }, 'view', false],
  ])('derives %s as %s', (_name, board, level, editable) => {
    expect(accessLevel(board)).toBe(level);
    expect(canEditBoard(board)).toBe(editable);
  });
});
