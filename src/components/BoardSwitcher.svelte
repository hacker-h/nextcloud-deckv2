<script>
  import AccessBadge from './AccessBadge.svelte';
  import { accessLevel } from '../lib/permissions.js';

  let { boards, current, onselect } = $props();

  let open = $state(false);
  let query = $state('');
  let input = $state(null);

  const filtered = $derived(
    boards.filter((b) => b.title.toLowerCase().includes(query.toLowerCase()))
  );

  function toggle() {
    open = !open;
    query = '';
    if (open) queueMicrotask(() => input?.focus());
  }

  function pick(board) {
    open = false;
    onselect(board);
  }

  function onkeydown(e) {
    if (e.key === 'Escape') { open = false; return; }
    if (e.key === 'Enter' && filtered.length) pick(filtered[0]);
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="switcher">
  <button class="trigger" onclick={toggle} aria-expanded={open}>
    <span class="name">{current?.title ?? 'Select board'}</span>
    <span class="caret" class:up={open}>▾</span>
  </button>

  {#if open}
    <!-- Click-away backdrop -->
    <button class="backdrop" onclick={() => (open = false)} aria-label="Close"></button>

    <div class="menu">
      <input
        bind:this={input}
        bind:value={query}
        {onkeydown}
        class="search"
        type="text"
        placeholder="Search boards…"
      />
      <ul class="list">
        {#each filtered as board (board.id)}
          <li>
            <button
              class="item"
              class:active={board.id === current?.id}
              onclick={() => pick(board)}
            >
              <span class="swatch" style="background:#{board.color}"></span>
              <span class="label">{board.title}</span>
              <span class="access"><AccessBadge level={accessLevel(board)} /></span>
            </button>
          </li>
        {:else}
          <li class="none">No matches</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .switcher { position: relative; }

  .trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 340px;
    padding: 6px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }
  .trigger:hover { background: var(--card-bg); border-color: var(--border); }

  .name {
    /* Trello board title: 16px / weight 653 / pure white */
    font-size: 16px;
    font-weight: 650;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caret { font-size: 11px; color: var(--text-dim); }
  .caret.up { transform: rotate(180deg); }

  .backdrop {
    position: fixed;
    inset: 0;
    background: none;
    border: 0;
    cursor: default;
    z-index: 10;
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: 300px;
    padding: 8px;
    background: var(--stack-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
  }

  .search {
    width: 100%;
    padding: 7px 9px;
    margin-bottom: 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    outline: none;
  }
  .search:focus { border-color: var(--accent); }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 320px;
    overflow-y: auto;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    background: none;
    border: 0;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
  }
  .item:hover { background: var(--card-bg-hover); }
  .item.active { color: var(--accent); font-weight: 600; }

  .swatch { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 3px; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .access { flex: 0 0 auto; margin-left: auto; }

  .none { padding: 8px; color: var(--text-dim); font-size: 13px; }
</style>
