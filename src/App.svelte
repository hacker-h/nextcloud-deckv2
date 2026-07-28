<script>
  import { DeckClient } from './lib/deck.js';
  import { touch, sortByMru } from './lib/mru.js';
  import Board from './components/Board.svelte';
  import BoardSwitcher from './components/BoardSwitcher.svelte';

  const client = new DeckClient({
    baseUrl: import.meta.env.VITE_NC_URL,
    username: import.meta.env.VITE_NC_USER,
    password: import.meta.env.VITE_NC_PASS,
  });

  let boards = $state([]);
  let current = $state(null);
  let stacks = $state([]);
  let loading = $state(true);
  let error = $state(null);

  // ETag cache per board, so revisiting a board issues a conditional request
  // and the server answers 304 with no payload (M0.4: 0.14s, zero bytes).
  const etags = new Map();
  const cache = new Map();

  const cardCount = $derived(stacks.reduce((n, s) => n + s.cards.length, 0));

  async function loadBoards() {
    const { data } = await client.getBoards();
    boards = sortByMru(data);
    return boards;
  }

  async function openBoard(board) {
    if (!board) return;
    current = board;
    touch(board.id);
    loading = true;
    error = null;

    try {
      const res = await client.getStacks(board.id, etags.get(board.id));
      if (res.notModified) {
        stacks = cache.get(board.id) ?? [];
      } else {
        stacks = res.data;
        cache.set(board.id, res.data);
        if (res.etag) etags.set(board.id, res.etag);
      }
    } catch (e) {
      error = e.message;
      stacks = [];
    } finally {
      loading = false;
    }
  }

  async function init() {
    loading = true;
    error = null;
    try {
      const list = await loadBoards();
      await openBoard(list[0]);
    } catch (e) {
      error = e.message;
      loading = false;
    }
  }

  init();
</script>

<div class="app">
  <!-- Inbox rail: visual placeholder only, behaviour lands in M4.5. -->
  <aside class="rail" title="Inbox (coming in M4.5)">
    <span class="rail-icon">▤</span>
  </aside>

  <div class="main">
    <header class="topbar">
      <BoardSwitcher {boards} {current} onselect={openBoard} />
      {#if !loading && !error}
        <span class="stat">{stacks.length} lists · {cardCount} cards</span>
      {/if}
    </header>

    {#if error}
      <div class="state">
        <p class="err">{error}</p>
        <button class="retry" onclick={() => (current ? openBoard(current) : init())}>
          Retry
        </button>
      </div>
    {:else if loading}
      <!-- Skeletons, not a spinner: the board must never look blocked. -->
      <div class="board-skel">
        {#each Array(5) as _, i}
          <div class="skel-stack">
            <div class="skel-head"></div>
            {#each Array(3 + ((i * 2) % 4)) as _}
              <div class="skel-card"></div>
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      <Board {stacks} boardId={current?.id} {client} />
    {/if}
  </div>
</div>

<style>
  .app { display: flex; height: 100%; }

  .rail {
    flex: 0 0 var(--rail-w);
    display: flex;
    justify-content: center;
    padding-top: 14px;
    background: var(--stack-bg);
    border-right: 1px solid var(--border);
  }
  .rail-icon { color: var(--text-dim); font-size: 18px; }

  .main { display: flex; flex-direction: column; flex: 1; min-width: 0; }

  .topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    height: var(--topbar-h);
    flex: 0 0 var(--topbar-h);
    padding: 0 12px;
    background: var(--topbar-bg);
    border-bottom: 1px solid var(--border);
  }
  .stat { font-size: 12px; color: var(--text-dim); }

  .state { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; padding: 24px; }
  .err { margin: 0; color: var(--danger); }
  .retry {
    padding: 6px 14px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }
  .retry:hover { background: var(--card-bg-hover); }

  .board-skel { display: flex; gap: 12px; padding: 12px; overflow: hidden; }
  .skel-stack {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
    flex: 0 0 var(--stack-w);
    padding: 10px 8px;
    background: var(--stack-bg);
    border-radius: var(--stack-radius);
  }
  .skel-head { height: 16px; width: 45%; margin: 2px 4px 6px; border-radius: 4px; background: var(--card-bg); }
  .skel-card { height: var(--card-h); border-radius: var(--card-radius); background: var(--card-bg); opacity: .6; }
</style>
