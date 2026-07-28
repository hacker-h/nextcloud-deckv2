// Board ordering by most-recently-used (PLAN.md §8).
// The full switcher lands in M4.5; M1 needs ordering + search only.

const KEY = 'deckv2.mru';

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
};

export function touch(boardId) {
  const id = String(boardId);
  const next = [id, ...read().filter((x) => x !== id)].slice(0, 50);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota - MRU is a convenience, never fatal
  }
}

// Known boards first in MRU order, then the rest alphabetically.
export function sortByMru(boards) {
  const mru = read();
  const rank = new Map(mru.map((id, i) => [id, i]));
  return boards.slice().sort((a, b) => {
    const ra = rank.get(String(a.id));
    const rb = rank.get(String(b.id));
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.title.localeCompare(b.title);
  });
}
