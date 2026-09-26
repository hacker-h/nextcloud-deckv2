// Matches the board store's cache capacity: preloading past it would evict the
// boards we just fetched. Exported so the progress UI can size the total the
// same way the scheduler does.
export const PRELOAD_LIMIT = 50;

export function boardPreloadOrder(boards, activeId, mru = []) {
  const rank = new Map(mru.map((id, index) => [String(id), index]));
  return boards
    .filter((board) => board.id !== activeId)
    .slice()
    .sort((a, b) => {
      const aRank = rank.get(String(a.id));
      const bRank = rank.get(String(b.id));
      if (aRank !== undefined || bRank !== undefined) {
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        return aRank - bRank;
      }
      const aSize = a.stacks?.length ?? Number.MAX_SAFE_INTEGER;
      const bSize = b.stacks?.length ?? Number.MAX_SAFE_INTEGER;
      return aSize - bSize;
    });
}

// A pool rather than one sequential chain: preloading 17 boards one round-trip
// at a time cost 4.6s of wall clock for work the browser is happy to overlap.
// Workers pull from the front of the same priority-ordered queue, so MRU and
// small-first still win the first network slots — only the tail overlaps.
//
// Six is measured, not guessed: against a real Nextcloud, 17 boards took 4.6s
// serially, 2.5s at four workers and 1.4s at six, but 1.8s at eight — past six
// the server contends with itself and the extra parallelism costs time. It is
// also the bound `moveCards` already uses for the same reason.
export async function preloadBoards({
  boards,
  activeId,
  mru,
  idle,
  shouldContinue,
  preload,
  limit = PRELOAD_LIMIT,
  concurrency = 6,
  onProgress,
  isCached = () => false,
}) {
  const queue = boardPreloadOrder(boards, activeId, mru).slice(0, limit).filter((board) => !isCached(board.id));
  const total = queue.length;
  if (!total) return;

  let next = 0;
  let done = 0;
  // Deck's `/boards?details=1` payload carries stacks but no cards, so the card
  // total is unknowable before every board has been fetched. These are running
  // sums of what has actually arrived, never a denominator - a progress panel
  // that invented "of 3000" would be guessing at the user.
  let cards = 0;
  let stacks = 0;
  const loading = new Set();

  const report = (extra) => onProgress?.({
    done,
    total,
    cards,
    stacks,
    loading: [...loading],
    ...extra,
  });

  report();

  async function worker() {
    // `next` is read and advanced without an await between, so workers never
    // claim the same board despite sharing the queue.
    while (next < total) {
      const board = queue[next++];
      await idle();
      if (!shouldContinue()) return;
      loading.add(board.title ?? String(board.id));
      report({ boardId: board.id, title: board.title, status: 'loading' });
      const loaded = await preload(board.id);
      loading.delete(board.title ?? String(board.id));
      done += 1;
      if (loaded) {
        stacks += loaded.length;
        for (const stack of loaded) cards += stack.cards?.length ?? 0;
      }
      report({ boardId: board.id, title: board.title, status: loaded == null ? 'failed' : 'loaded' });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
}
