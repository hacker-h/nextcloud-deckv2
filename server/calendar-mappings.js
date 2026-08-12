import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class CalendarMappingStore {
  constructor({ filePath } = {}) {
    if (!filePath) throw new Error('CalendarMappingStore requires filePath');
    this.filePath = filePath;
    this.data = this.#load();
  }

  list(user) {
    return Object.values(this.data.mappings).filter((mapping) => mapping.user === user);
  }

  get(user, entryKey) {
    return this.data.mappings[storeKey(user, entryKey)] ?? null;
  }

  put(mapping) {
    if (!mapping?.user || !mapping?.entryKey) throw new Error('Mapping requires user and entryKey');
    const saved = { ...mapping };
    this.data.mappings[storeKey(saved.user, saved.entryKey)] = saved;
    this.#save();
    return saved;
  }

  remove(user, entryKey) {
    const key = storeKey(user, entryKey);
    const existing = this.data.mappings[key] ?? null;
    if (existing) {
      delete this.data.mappings[key];
      this.#save();
    }
    return existing;
  }

  #load() {
    try {
      chmodSync(this.filePath, 0o600);
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return { version: 1, mappings: parsed.mappings ?? {} };
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, mappings: {} };
      throw error;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.filePath), 0o700);
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.filePath);
    chmodSync(this.filePath, 0o600);
  }
}

function storeKey(user, entryKey) {
  return `${user}\u0000${entryKey}`;
}
