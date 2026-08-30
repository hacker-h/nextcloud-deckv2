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

export async function preloadBoards({ boards, activeId, mru, idle, shouldContinue, preload, limit = 50 }) {
  for (const board of boardPreloadOrder(boards, activeId, mru).slice(0, limit)) {
    await idle();
    if (!shouldContinue()) return;
    await preload(board.id);
  }
}
