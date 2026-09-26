export function matchesCard(card, { query = '', mine = false, openOnly = false, user }) {
  if (openOnly && card.done) return false;
  if (mine && !(card.assignedUsers ?? []).some((entry) =>
    (entry.type == null || entry.type === 0) && (entry.participant?.uid ?? entry.participant ?? entry.uid) === (user?.uid ?? user?.id ?? user))) return false;
  const text = [card.title, card.description, ...(card.labels ?? []).map((label) => label.title)].join(' ').toLocaleLowerCase('de');
  return query.trim().toLocaleLowerCase('de').split(/\s+/).every((part) => text.includes(part));
}

export async function loadSearchBoards(boards, getStacks, onResult, isCurrent) {
  const queue = [...boards];
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length && isCurrent()) {
      const board = queue.shift();
      try {
        const stacks = await getStacks(board.id);
        if (isCurrent()) onResult(board, stacks, !stacks);
      } catch {
        if (isCurrent()) onResult(board, null, true);
      }
    }
  }));
}
