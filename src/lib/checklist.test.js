import { describe, it, expect } from 'vitest';
import { parseChecklists, serializeChecklists, getChecklistSummary } from './checklist.js';

describe('checklist markdown parser & serializer', () => {
  it('parses empty or non-checklist description', () => {
    const res = parseChecklists('Hello world\nThis is standard text.');
    expect(res.descriptionText).toBe('Hello world\nThis is standard text.');
    expect(res.checklists).toEqual([]);
  });

  it('parses single checklist with items', () => {
    const md = `Standard description

### Checkliste1
- [ ] Aufgabe 1
- [ ] Aufgabe 2
- [x] Aufgabe 3`;

    const res = parseChecklists(md);
    expect(res.descriptionText).toBe('Standard description');
    expect(res.checklists.length).toBe(1);
    expect(res.checklists[0].title).toBe('Checkliste1');
    expect(res.checklists[0].items.length).toBe(3);
    expect(res.checklists[0].items[0].text).toBe('Aufgabe 1');
    expect(res.checklists[0].items[0].done).toBe(false);
    expect(res.checklists[0].items[2].text).toBe('Aufgabe 3');
    expect(res.checklists[0].items[2].done).toBe(true);
  });

  it('parses item metadata (assignee and due date)', () => {
    const md = `### Checkliste
- [ ] Item 1 <!-- @MM due:2026-08-26 -->
- [x] Item 2 <!-- due:2026-08-20 -->`;

    const res = parseChecklists(md);
    const items = res.checklists[0].items;
    expect(items[0].assignee).toBe('MM');
    expect(items[0].duedate).toBe('2026-08-26');
    expect(items[1].assignee).toBeNull();
    expect(items[1].duedate).toBe('2026-08-20');
  });

  it('keeps checklist item ids stable and persists explicit ids', () => {
    const legacy = `### Checkliste\n- [ ] Stable item <!-- due:2026-08-26 -->`;
    const first = parseChecklists(legacy).checklists[0].items[0];
    const second = parseChecklists(legacy).checklists[0].items[0];
    expect(first.id).toBe(second.id);

    const serialized = serializeChecklists('', [{ title: 'Checkliste', items: [first] }]);
    expect(serialized).toContain(`id:${first.id}`);
    expect(parseChecklists(serialized).checklists[0].items[0].id).toBe(first.id);
  });

  it('serializes checklists back to clean markdown', () => {
    const checklists = [
      {
        title: 'Checkliste1',
        items: [
          { text: 'Aufgabe 1', done: false, assignee: null, duedate: null },
          { text: 'Aufgabe 2', done: true, assignee: 'MM', duedate: '2026-08-26' }
        ]
      }
    ];

    const md = serializeChecklists('Description text', checklists);
    expect(md).toContain('Description text');
    expect(md).toContain('### Checkliste1');
    expect(md).toContain('- [ ] Aufgabe 1');
    expect(md).toContain('- [x] Aufgabe 2 <!-- @MM due:2026-08-26 -->');
  });

  it('calculates checklist summary metrics correctly', () => {
    const md = `### Checklist
- [ ] Task 1
- [x] Task 2
- [x] Task 3
- [ ] Task 4`;

    const summary = getChecklistSummary(md);
    expect(summary.total).toBe(4);
    expect(summary.done).toBe(2);
  });
});
