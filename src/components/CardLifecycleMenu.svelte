<script>
  let { card, onArchive, onUnarchive, onDelete, error = null } = $props();

  let open = $state(false);
  let confirming = $state(null);
  let typedTitle = $state('');
  let pending = $state(false);

  const archived = $derived(Boolean(card?.archived));
  const title = $derived(card?.title ?? '');
  // Deck has no card-restore endpoint, so deletion is gated on retyping the
  // exact title rather than a plain confirm.
  const titleMatches = $derived(typedTitle === title);

  function start(action) {
    confirming = action;
    typedTitle = '';
    open = false;
  }

  function cancel() {
    confirming = null;
    typedTitle = '';
  }

  async function confirm() {
    if (pending) return;
    if (confirming === 'delete' && !titleMatches) return;

    const action =
      confirming === 'delete' ? onDelete : confirming === 'archive' ? onArchive : onUnarchive;

    pending = true;
    try {
      const ok = await action?.();
      if (ok !== false) cancel();
    } finally {
      pending = false;
    }
  }
</script>

<section class="lifecycle">
  <button
    class="btn"
    type="button"
    aria-expanded={open}
    aria-haspopup="menu"
    onclick={() => (open = !open)}
  >
    Actions
  </button>

  {#if open}
    <ul class="menu" role="menu">
      <li>
        {#if archived}
          <button class="item" type="button" role="menuitem" onclick={() => start('unarchive')}>
            Unarchive card
          </button>
        {:else}
          <button class="item" type="button" role="menuitem" onclick={() => start('archive')}>
            Archive card
          </button>
        {/if}
      </li>
      <li>
        <button class="item danger" type="button" role="menuitem" onclick={() => start('delete')}>
          Delete card
        </button>
      </li>
    </ul>
  {/if}

  {#if confirming === 'archive' || confirming === 'unarchive'}
    <div class="confirm" role="alertdialog" aria-label="Confirm {confirming}">
      <p class="copy">
        {confirming === 'archive'
          ? `Archive "${title}"? It leaves the board and stays available in the archive.`
          : `Unarchive "${title}"? It returns to its list.`}
      </p>
      <div class="actions">
        <button class="btn primary" type="button" disabled={pending} onclick={confirm}>
          {pending ? 'Working…' : confirming === 'archive' ? 'Archive' : 'Unarchive'}
        </button>
        <button class="btn" type="button" onclick={cancel}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if confirming === 'delete'}
    <div class="confirm" role="alertdialog" aria-label="Confirm delete">
      <p class="copy danger-text">
        Deleting "{title}" cannot be undone in Deck v2 — the API provides no way to restore a
        deleted card.
      </p>
      <label class="field">
        <span class="copy">Type the card title to confirm</span>
        <input class="input" type="text" aria-label="Confirm card title" bind:value={typedTitle} />
      </label>
      <div class="actions">
        <button
          class="btn danger-btn"
          type="button"
          disabled={pending || !titleMatches}
          onclick={confirm}
        >
          {pending ? 'Deleting…' : 'Delete card'}
        </button>
        <button class="btn" type="button" onclick={cancel}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if error}
    <p class="copy danger-text" role="alert">{error}</p>
  {/if}
</section>

<style>
  .lifecycle { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

  ul { margin: 0; padding: 0; list-style: none; }

  .menu {
    width: 100%;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--stack-bg);
  }

  .item {
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item:hover { background: var(--card-bg-hover); }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--stack-bg);
  }

  .field { display: flex; flex-direction: column; gap: 4px; }

  .input {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--board-bg);
    color: var(--text);
    font: inherit;
  }

  .actions { display: flex; flex-wrap: wrap; gap: 8px; }

  .btn {
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: #a1bdd914;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: #a1bdd925; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .primary { background: var(--accent); color: #1d2125; }
  .danger-btn { background: var(--danger); color: #1d2125; }
  .danger { color: var(--danger); }

  .copy { margin: 0; font-size: 12px; line-height: 16px; color: var(--text-dim); }
  .danger-text { color: var(--danger); }
</style>
