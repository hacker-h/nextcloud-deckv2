import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CalendarMappingStore } from './calendar-mappings.js';

describe('CalendarMappingStore', () => {
  it('persists mappings per Deck user with owner-only permissions', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'deck-calendar-mappings-')), 'mappings.json');
    const store = new CalendarMappingStore({ filePath });
    store.put({ user: 'alice', entryKey: 'card:7:42', eventId: 'event-a' });
    store.put({ user: 'bob', entryKey: 'card:7:42', eventId: 'event-b' });

    const reloaded = new CalendarMappingStore({ filePath });
    expect(reloaded.get('alice', 'card:7:42')).toMatchObject({ eventId: 'event-a' });
    expect(reloaded.list('bob')).toEqual([expect.objectContaining({ eventId: 'event-b' })]);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(1);
  });

  it('removes only the requested mapping', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'deck-calendar-remove-')), 'mappings.json');
    const store = new CalendarMappingStore({ filePath });
    store.put({ user: 'alice', entryKey: 'one', eventId: '1' });
    store.put({ user: 'alice', entryKey: 'two', eventId: '2' });
    expect(store.remove('alice', 'one')).toMatchObject({ eventId: '1' });
    expect(store.get('alice', 'one')).toBeNull();
    expect(store.get('alice', 'two')).toMatchObject({ eventId: '2' });
  });
});
