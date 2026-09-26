export const commandKey = () => /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg';
export const shortcut = (key) => `${commandKey()}+${key}`;
export function isEditing(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}
