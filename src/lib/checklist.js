/**
 * Utility functions to parse and serialize Trello-style checklists stored
 * in Nextcloud Deck card descriptions (Markdown format).
 */

export function parseChecklists(description = '') {
  if (!description) return { descriptionText: '', checklists: [] };

  const lines = description.split('\n');
  const textLines = [];
  const checklists = [];
  let currentChecklist = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for checklist header: e.g., "### Checkliste1" or "## Checkliste"
    const headerMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headerMatch && !line.match(/^#{2,4}\s+\[/)) {
      currentChecklist = {
        id: stableId('cl', checklists.length, headerMatch[1].trim()),
        title: headerMatch[1].trim(),
        items: []
      };
      checklists.push(currentChecklist);
      continue;
    }

    // Check for item line: e.g., "- [ ] Item text" or "- [x] Item text"
    const itemMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (itemMatch) {
      if (!currentChecklist) {
        currentChecklist = {
          id: stableId('cl', checklists.length, 'Checkliste'),
          title: 'Checkliste',
          items: []
        };
        checklists.push(currentChecklist);
      }

      const done = itemMatch[1].toLowerCase() === 'x';
      let rawText = itemMatch[2].trim();

      // Extract metadata like <!-- @username {due:YYYY-MM-DD} --> or @username {due:YYYY-MM-DD}
      let assignee = null;
      let duedate = null;
      let itemId = null;

      // HTML comment metadata
      const commentMatch = rawText.match(/<!--\s*(.*?)\s*-->/);
      if (commentMatch) {
        const metaStr = commentMatch[1];
        const userM = metaStr.match(/@([\w.-]+)/);
        if (userM) assignee = userM[1];

        const dueM = metaStr.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/);
        if (dueM) duedate = dueM[1];

        const idM = metaStr.match(/\bid:([\w.-]+)\b/);
        if (idM) itemId = idM[1];

        rawText = rawText.replace(/<!--\s*.*?\s*-->/, '').trim();
      } else {
        // Inline metadata tags: e.g., @user due:2026-08-26
        const dueM = rawText.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/);
        if (dueM) {
          duedate = dueM[1];
          rawText = rawText.replace(dueM[0], '').trim();
        }
        const userM = rawText.match(/@([\w.-]+)\b/);
        if (userM) {
          assignee = userM[1];
          rawText = rawText.replace(userM[0], '').trim();
        }
      }

      currentChecklist.items.push({
        id: itemId ?? stableId('item', checklists.length - 1, currentChecklist.items.length, rawText),
        text: rawText,
        done,
        assignee,
        duedate
      });
      continue;
    }

    // If we reach a non-checklist, non-header line, reset currentChecklist context
    if (line.trim() !== '' && !line.startsWith('-') && !line.startsWith('*')) {
      currentChecklist = null;
    }

    if (!currentChecklist) {
      textLines.push(line);
    }
  }

  // Clean trailing empty lines from description text
  const descriptionText = textLines.join('\n').trim();

  return { descriptionText, checklists };
}

export function serializeChecklists(descriptionText = '', checklists = []) {
  const parts = [];

  if (descriptionText && descriptionText.trim()) {
    parts.push(descriptionText.trim());
  }

  for (const cl of checklists) {
    if (!cl.title && cl.items.length === 0) continue;

    if (parts.length > 0) parts.push('');
    parts.push(`### ${cl.title || 'Checkliste'}`);

    for (const item of cl.items) {
      const mark = item.done ? 'x' : ' ';
      let line = `- [${mark}] ${item.text.trim()}`;

      const meta = [];
      if (item.id) meta.push(`id:${item.id}`);
      if (item.assignee) meta.push(`@${item.assignee}`);
      if (item.duedate) meta.push(`due:${item.duedate}`);

      if (meta.length > 0) {
        line += ` <!-- ${meta.join(' ')} -->`;
      }

      parts.push(line);
    }
  }

  return parts.join('\n');
}

export function getChecklistSummary(description = '') {
  const { checklists } = parseChecklists(description);
  let total = 0;
  let done = 0;

  for (const cl of checklists) {
    for (const item of cl.items) {
      total++;
      if (item.done) done++;
    }
  }

  return { total, done };
}

function stableId(prefix, ...parts) {
  const input = parts.join('\u0000');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}
