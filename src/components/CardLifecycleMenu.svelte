<script>
  import { onDestroy } from 'svelte';

  let { card, onArchive, onUnarchive, onDelete, error = null } = $props();

  let open = $state(false);
  let confirming = $state(null);
  let pending = $state(false);
  let deleteArmed = $state(false);
  let armTimer = null;

  const archived = $derived(Boolean(card?.archived));
  const title = $derived(card?.title ?? '');

  function start(action) {
    confirming = action;
    open = false;
    deleteArmed = action !== 'delete';
    if (action === 'delete') {
      armTimer = window.setTimeout(() => {
        deleteArmed = true;
        armTimer = null;
      }, 350);
    }
  }

  function cancel() {
    if (armTimer != null) window.clearTimeout(armTimer);
    armTimer = null;
    deleteArmed = false;
    confirming = null;
  }

  async function confirm() {
    if (pending) return;
    if (confirming === 'delete' && !deleteArmed) return;

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

  onDestroy(() => {
    if (armTimer != null) window.clearTimeout(armTimer);
  });
</script>

<section class="lifecycle">
  {#if !confirming}
    <button
      class="btn action-trigger"
      type="button"
      aria-expanded={open}
      aria-haspopup="menu"
      onclick={() => (open = !open)}
    >
      Aktionen
    </button>

    {#if open}
      <ul class="menu" role="menu">
        <li>
          {#if archived}
            <button class="item" type="button" role="menuitem" onclick={() => start('unarchive')}>
              Karte wiederherstellen
            </button>
          {:else}
            <button class="item" type="button" role="menuitem" onclick={() => start('archive')}>
              Karte archivieren
            </button>
          {/if}
        </li>
        <li>
          <button class="item danger" type="button" role="menuitem" onclick={() => start('delete')}>
            Karte löschen
          </button>
        </li>
      </ul>
    {/if}
  {/if}

  {#if confirming === 'archive' || confirming === 'unarchive'}
    <div
      class="confirm"
      role="alertdialog"
      aria-label={confirming === 'archive' ? 'Archivieren bestätigen' : 'Wiederherstellen bestätigen'}
    >
      <p class="copy">
        {confirming === 'archive'
          ? `"${title}" archivieren? Die Karte verlässt das Board und bleibt im Archiv verfügbar.`
          : `"${title}" wiederherstellen? Die Karte kehrt in ihre Liste zurück.`}
      </p>
      <div class="actions">
        <button class="btn primary" type="button" disabled={pending} onclick={confirm}>
          {pending ? 'Wird verarbeitet…' : confirming === 'archive' ? 'Archivieren' : 'Wiederherstellen'}
        </button>
        <button class="btn" type="button" onclick={cancel}>Abbrechen</button>
      </div>
    </div>
  {/if}

  {#if confirming === 'delete'}
    <div class="confirm" role="alertdialog" aria-label="Löschen bestätigen">
      <p class="copy danger-text">
        Das Löschen von "{title}" kann nicht rückgängig gemacht werden.
      </p>
      <div class="actions">
        <button
          class="btn danger-btn"
          type="button"
          disabled={pending || !deleteArmed}
          onclick={confirm}
        >
          {pending ? 'Wird gelöscht…' : 'Karte löschen'}
        </button>
        <button class="btn" type="button" onclick={cancel}>Abbrechen</button>
      </div>
    </div>
  {/if}

  {#if error}
    <p class="copy danger-text" role="alert">{error}</p>
  {/if}
</section>

<style>
  .lifecycle { display: flex; width: 100%; flex-direction: column; gap: 8px; align-items: stretch; }

  ul { margin: 0; padding: 0; list-style: none; }

  .menu {
    width: 100%;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--stack-bg);
  }
  .action-trigger { align-self: flex-start; }

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
    padding: 12px;
    border: 1px solid #78433f;
    border-radius: 8px;
    background: #332626;
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
