<script>
  import { DeckClient } from './lib/deck.js';
  import { createBoardStore } from './lib/store.svelte.js';
  import { touch, sortByMru } from './lib/mru.js';
  import Board from './components/Board.svelte';
  import BoardSwitcher from './components/BoardSwitcher.svelte';

  const client = new DeckClient({
    baseUrl: import.meta.env.VITE_NC_URL,
    username: import.meta.env.VITE_NC_USER,
    password: import.meta.env.VITE_NC_PASS,
  });

  const board = createBoardStore(client);

  let boards = $state([]);
  let current = $state(null);

  const stacks = $derived(board.state.stacks);
  const loading = $derived(board.state.loading);
  const error = $derived(board.state.error);
  const cardCount = $derived(stacks.reduce((n, s) => n + s.cards.length, 0));

  async function loadBoards() {
    const { data } = await client.getBoards();
    boards = sortByMru(data);
    return boards;
  }

  async function openBoard(b) {
    if (!b) return;
    current = b;
    touch(b.id);
    await board.load(b.id);
  }

  function handleDrop({ cardIds, toStackId, index }) {
    board.moveCards({ cardIds, toStackId, index, boardId: current.id });
  }

  async function init() {
    try {
      const list = await loadBoards();
      await openBoard(list[0]);
    } catch (e) {
      board.state.error = e.message;
      board.state.loading = false;
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
      {#if board.state.pending > 0}
        <span class="pending" title="Saving to Deck">
          {board.state.pending} saving…
        </span>
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
      <Board {stacks} boardId={current?.id} {client} onDrop={handleDrop} />
    {/if}
  </div>

  {#if board.state.toast}
    <div class="toast">{board.state.toast.text}</div>
  {/if}
</div>

<style>
  .app { display: flex; height: 100%; }

  .rail {
    flex: 0 0 var(--rail-w);
    display: flex;
    justify-content: center;
    padding-top: 14px;
    background: rgba(0, 0, 0, .26);
    backdrop-filter: blur(6px);
    border-right: 1px solid rgba(255, 255, 255, .09);
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
    background: rgba(0, 0, 0, .26);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid rgba(255, 255, 255, .09);
  }
  .stat { font-size: 12px; color: var(--text-dim); }
  .pending { font-size: 12px; color: var(--accent); }

  /* Failures surface here rather than blocking the board (PLAN.md §4.1). */
  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    max-width: 520px;
    padding: 10px 16px;
    background: #5D1F1A;
    border: 1px solid #A5342B;
    border-radius: 8px;
    color: #FFD5D2;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .5);
  }

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
