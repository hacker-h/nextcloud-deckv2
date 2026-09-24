const positiveId = (value) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

export function parseCardRoute(hash) {
  if (!hash || hash === '#') return null;
  const match = hash.match(/^#\/boards\/(\d+)(?:\/cards\/(\d+))?\/?$/);
  if (!match || !positiveId(match[1]) || (match[2] && !positiveId(match[2]))) {
    throw new Error('Dieser Kartenlink ist ungültig.');
  }
  return { boardId: Number(match[1]), cardId: match[2] ? Number(match[2]) : null };
}

export function cardHash(boardId, cardId = null) {
  return `#/boards/${boardId}${cardId == null ? '' : `/cards/${cardId}`}`;
}

// Keeps history events separate from UI writes: pushState does not fire popstate.
export function createCardNavigation({ apply, requestClose, onError, browser = window }) {
  let activeUrl = browser.location.href;
  let pendingUrl = null;
  let generation = 0;
  let closing = 0;
  let disposed = false;
  let ready = false;

  function write(boardId, cardId = null, { replace = false } = {}) {
    if (closing || disposed || boardId == null) return;
    generation += 1;
    pendingUrl = null;
    const url = new URL(browser.location.href);
    url.hash = cardHash(boardId, cardId);
    if (url.href !== browser.location.href) {
      browser.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    }
    activeUrl = url.href;
  }

  async function restore({ initial = false } = {}) {
    const destination = browser.location.href;
    if (disposed || (!initial && ((destination === activeUrl && !pendingUrl) || destination === pendingUrl))) return;
    const token = ++generation;
    pendingUrl = destination;
    const previous = activeUrl;
    const isCurrent = () => !disposed && generation === token;
    try {
      closing += 1;
      let accepted;
      try { accepted = await requestClose(); }
      finally { closing -= 1; }
      if (!isCurrent()) return;
      if (!accepted) {
        browser.history.pushState(null, '', previous);
        activeUrl = previous;
        return;
      }
      activeUrl = destination;
      await apply(parseCardRoute(new URL(destination).hash), isCurrent);
    } catch (error) {
      if (isCurrent()) onError(error);
    } finally {
      if (isCurrent()) pendingUrl = null;
    }
  }

  const onNavigate = () => { if (ready) void restore(); };
  browser.addEventListener('popstate', onNavigate);
  browser.addEventListener('hashchange', onNavigate);
  return {
    write,
    restore: () => { ready = true; return restore({ initial: true }); },
    destroy() {
      disposed = true;
      generation += 1;
      browser.removeEventListener('popstate', onNavigate);
      browser.removeEventListener('hashchange', onNavigate);
    },
  };
}
