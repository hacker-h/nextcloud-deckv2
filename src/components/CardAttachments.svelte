<script>
  let {
    attachments = [],
    onUpload,
    onRename,
    onDelete,
    onRestore,
    onDownload,
  } = $props();

  let input;
  let dragging = $state(false);
  let pending = $state(false);
  let error = $state(null);
  let failedFile = $state(null);
  let renamingId = $state(null);
  let renameDraft = $state('');

  const live = $derived(attachments.filter((a) => !a.deletedAt));
  const deleted = $derived(attachments.filter((a) => a.deletedAt));

  function formatSize(bytes) {
    if (bytes == null) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = Number(bytes);
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
  }

  async function run(action) {
    if (pending) return false;
    pending = true;
    error = null;
    try {
      await action();
      return true;
    } catch (err) {
      error = err?.message ?? 'Something went wrong';
      return false;
    } finally {
      pending = false;
    }
  }

  async function upload(file) {
    if (!file) return;
    const ok = await run(() => onUpload?.(file));
    failedFile = ok ? null : file;
  }

  async function onPick(e) {
    const file = e.currentTarget.files?.[0];
    // Clearing lets the same filename be re-picked after a failure, which the
    // browser otherwise suppresses because the input value is unchanged.
    e.currentTarget.value = '';
    await upload(file);
  }

  // File drags must never bubble: the board treats an escaping drag as the
  // start of a card move, which would drag the card out from under the modal.
  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onDragEnter(e) {
    swallow(e);
    dragging = true;
  }

  function onDragLeave(e) {
    swallow(e);
    dragging = false;
  }

  async function onDrop(e) {
    swallow(e);
    dragging = false;
    await upload(e.dataTransfer?.files?.[0]);
  }

  function retry() {
    if (failedFile) upload(failedFile);
  }

  function startRename(attachment) {
    renamingId = attachment.id;
    renameDraft = attachment.name;
  }

  async function submitRename(attachment) {
    const name = renameDraft.trim();
    if (!name || name === attachment.name) {
      renamingId = null;
      return;
    }
    const ok = await run(() => onRename?.(attachment, name));
    if (ok) renamingId = null;
  }
</script>

<section class="attachments">
  <div class="section-head">
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
      <path d="M10.5 5.5 6 10a1.8 1.8 0 0 0 2.5 2.5l4.5-4.5a3.2 3.2 0 0 0-4.5-4.5L3.6 8.4a4.6 4.6 0 0 0 6.5 6.5"/>
    </svg>
    <h3 class="legend">Anhänge</h3>
  </div>

  <button
    type="button"
    class="dropzone"
    class:dragging
    data-testid="dropzone"
    disabled={pending}
    onclick={() => input?.click()}
    ondragenter={onDragEnter}
    ondragover={swallow}
    ondragleave={onDragLeave}
    ondrop={onDrop}
  >
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
      <path d="M12 16V5m0 0L8 9m4-4 4 4" />
      <path d="M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </svg>
    <span class="drop-title">Datei auswählen</span>
    <span class="drop-copy">oder hier ablegen</span>
  </button>
  <input
    class="file"
    type="file"
    aria-label="Datei anhängen"
    bind:this={input}
    onchange={onPick}
    disabled={pending}
    tabindex="-1"
  />

  {#if pending}<p class="hint" role="status">Wird hochgeladen…</p>{/if}

  {#if error}
    <p class="error" role="alert">
      {error}
      {#if failedFile}<button class="btn link" type="button" onclick={retry}>Erneut versuchen</button>{/if}
    </p>
  {/if}

  {#if live.length === 0}
    <p class="hint no-attach">Keine Anhänge</p>
  {:else}
    <div class="links-subhead">Links</div>
    <ul class="list">
      {#each live as attachment (attachment.id)}
        <li class="item">
          {#if renamingId === attachment.id}
            <input
              class="rename"
              type="text"
              aria-label="Name des Anhangs"
              bind:value={renameDraft}
              onkeydown={(e) => e.key === 'Enter' && submitRename(attachment)}
            />
            <button class="btn primary" type="button" disabled={pending} onclick={() => submitRename(attachment)}>
              Speichern
            </button>
            <button class="btn" type="button" onclick={() => (renamingId = null)}>Abbrechen</button>
          {:else}
            <svg class="item-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M10.5 5.5 6 10a1.8 1.8 0 0 0 2.5 2.5l4.5-4.5a3.2 3.2 0 0 0-4.5-4.5L3.6 8.4a4.6 4.6 0 0 0 6.5 6.5"/>
            </svg>
            <a
              class="name"
              href={attachment.data || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onclick={(e) => {
                if (!attachment.data) {
                  e.preventDefault();
                  onDownload?.(attachment);
                }
              }}
            >
              {attachment.name}
            </a>
            <span class="meta">{formatSize(attachment.size)}</span>
            <button class="icon-menu-btn" type="button" onclick={() => onDownload?.(attachment)} title="Herunterladen" aria-label="Herunterladen">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11"/>
              </svg>
            </button>
            <button class="icon-menu-btn" type="button" onclick={() => startRename(attachment)} title="Umbenennen" aria-label="Umbenennen">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="13" cy="8" r="1.5" />
              </svg>
            </button>
            <button class="icon-menu-btn" type="button" disabled={pending} onclick={() => run(() => onDelete?.(attachment))} title="Löschen" aria-label="Löschen">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4.5 4.5v9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-9" />
              </svg>
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if deleted.length}
    <ul class="list deleted">
      {#each deleted as attachment (attachment.id)}
        <li class="item">
          <span class="name struck">{attachment.name}</span>
          <button class="btn link" type="button" disabled={pending} onclick={() => run(() => onRestore?.(attachment))}>
            Wiederherstellen
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .attachments { display: flex; flex-direction: column; gap: 12px; }

  .section-head {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #9fadbc;
  }

  .legend {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #b6c2cf;
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 112px;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 16px 12px;
    border: 1px dashed #38414a;
    border-radius: 8px;
    background: #22272b;
    color: #9fadbc;
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }
  .dropzone:hover:not(:disabled), .dropzone:focus-visible, .dragging {
    border-color: #579dff;
    background: #2c333a;
    color: #d6e4f0;
  }
  .dropzone:focus-visible { outline: 2px solid #579dff; outline-offset: 2px; }
  .dropzone:disabled { opacity: .6; cursor: wait; }
  .drop-title { margin-top: 4px; color: #b6c2cf; font-size: 13px; font-weight: 600; }
  .drop-copy { font-size: 11px; }

  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .links-subhead {
    margin-left: 0;
    font-size: 12px;
    font-weight: 600;
    color: #9fadbc;
  }

  ul { margin: 0; padding: 0; list-style: none; }
  .list { display: flex; flex-direction: column; gap: 6px; margin-left: 0; }
  .deleted { opacity: .7; }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 8px;
    background: #22272b;
    border: 1px solid #38414a;
  }

  .item-icon { color: #9fadbc; flex: 0 0 auto; }

  .name {
    flex: 1;
    min-width: 0;
    color: #579dff;
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name:hover { text-decoration: underline; color: #85b8ff; }
  .struck { text-decoration: line-through; }

  .meta { font-size: 12px; color: #9fadbc; }

  .icon-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: #2c333a;
    border: 0;
    border-radius: 6px;
    color: #9fadbc;
    cursor: pointer;
  }
  .icon-menu-btn:hover { background: #38414a; color: #ffffff; }

  .rename {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid #579dff;
    border-radius: 6px;
    background: #1d2125;
    color: #b6c2cf;
    font: inherit;
  }

  .btn {
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: #a1bdd914;
    color: #b6c2cf;
    font: inherit;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: #a1bdd925; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .primary { background: #579dff; color: #1d2125; font-weight: 600; }
  .link { padding: 2px 4px; background: transparent; color: #9fadbc; font-size: 12px; text-decoration: underline; }
  .link:hover:not(:disabled) { background: transparent; color: #b6c2cf; }

  .hint, .error, .no-attach { margin: 0; margin-left: 28px; font-size: 13px; color: #9fadbc; }
  .error { display: flex; align-items: center; gap: 8px; color: #f87171; }
</style>
