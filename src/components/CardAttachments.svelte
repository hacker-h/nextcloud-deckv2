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
  <h3 class="legend">Attachments</h3>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dropzone"
    class:dragging
    data-testid="dropzone"
    ondragenter={onDragEnter}
    ondragover={swallow}
    ondragleave={onDragLeave}
    ondrop={onDrop}
  >
    <p class="hint">Drop a file here</p>
    <input
      class="file"
      type="file"
      aria-label="Attach a file"
      bind:this={input}
      onchange={onPick}
      disabled={pending}
    />
  </div>

  {#if pending}<p class="hint" role="status">Uploading…</p>{/if}

  {#if error}
    <p class="error" role="alert">
      {error}
      {#if failedFile}<button class="btn link" type="button" onclick={retry}>Retry</button>{/if}
    </p>
  {/if}

  {#if live.length === 0}
    <p class="hint">No attachments</p>
  {:else}
    <ul class="list">
      {#each live as attachment (attachment.id)}
        <li class="item">
          {#if renamingId === attachment.id}
            <input
              class="rename"
              type="text"
              aria-label="Attachment name"
              bind:value={renameDraft}
              onkeydown={(e) => e.key === 'Enter' && submitRename(attachment)}
            />
            <button class="btn primary" type="button" disabled={pending} onclick={() => submitRename(attachment)}>
              Save
            </button>
            <button class="btn" type="button" onclick={() => (renamingId = null)}>Cancel</button>
          {:else}
            <span class="name">{attachment.name}</span>
            <span class="meta">{formatSize(attachment.size)}</span>
            <button class="btn link" type="button" onclick={() => onDownload?.(attachment)}>Download</button>
            <button class="btn link" type="button" onclick={() => startRename(attachment)}>Rename</button>
            <button class="btn link" type="button" disabled={pending} onclick={() => run(() => onDelete?.(attachment))}>
              Delete
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
            Restore
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .attachments { display: flex; flex-direction: column; gap: 12px; }

  .legend {
    margin: 0;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px dashed var(--border);
    border-radius: 8px;
    background: var(--stack-bg);
  }
  .dragging { border-color: var(--accent); background: var(--card-bg-hover); }

  .file { color: var(--text-dim); font: inherit; }

  ul { margin: 0; padding: 0; list-style: none; }
  .list { display: flex; flex-direction: column; gap: 4px; }
  .deleted { opacity: .7; }

  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--stack-bg);
  }

  .name { flex: 1; min-width: 0; word-break: break-all; }
  .struck { text-decoration: line-through; }
  .meta { font-size: 12px; color: var(--text-dim); }

  .rename {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--board-bg);
    color: var(--text);
    font: inherit;
  }

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
  .link { padding: 2px 4px; background: transparent; color: var(--text-dim); font-size: 12px; text-decoration: underline; }
  .link:hover:not(:disabled) { background: transparent; color: var(--text); }

  .hint, .error { margin: 0; font-size: 12px; line-height: 16px; color: var(--text-dim); }
  .error { display: flex; align-items: center; gap: 8px; color: var(--danger); }
</style>
