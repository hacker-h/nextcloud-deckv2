<script>
  let { card, onSave, onDraftChange = () => {}, error = null } = $props();

  let editingTitle = $state(false);
  let titleDraft = $state('');
  let editingDesc = $state(false);
  let descDraft = $state('');

  const description = $derived(card?.description ?? '');

  // The description is explicit save/cancel, so an in-progress edit only exists
  // locally. Report it so closing the modal can offer to keep it.
  $effect(() => {
    onDraftChange(editingDesc && descDraft !== description);
  });
  const titleInvalid = $derived(editingTitle && !titleDraft.trim());

  const due = $derived(toLocalInput(card?.duedate));
  const overdue = $derived.by(() => {
    if (!card?.duedate) return false;
    const t = new Date(card.duedate).getTime();
    return !Number.isNaN(t) && t < Date.now();
  });

  // <input type="datetime-local"> speaks wall-clock time with no zone. Building
  // the string from local getters (instead of slicing toISOString, which is UTC)
  // is what keeps the displayed time from drifting by the zone offset.
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function startTitle() {
    titleDraft = card?.title ?? '';
    editingTitle = true;
  }

  async function commitTitle() {
    if (!editingTitle) return;
    const next = titleDraft.trim();
    if (!next) return;

    editingTitle = false;
    if (next !== card?.title) await onSave?.({ title: next });
  }

  function cancelTitle() {
    editingTitle = false;
    titleDraft = '';
  }

  function onTitleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTitle();
    }
  }

  function startDesc() {
    descDraft = description;
    editingDesc = true;
  }

  async function saveDesc() {
    editingDesc = false;
    if (descDraft !== description) await onSave?.({ description: descDraft });
  }

  function cancelDesc() {
    editingDesc = false;
    descDraft = '';
  }

  async function onDueChange(e) {
    const value = e.currentTarget.value;
    await onSave?.({ duedate: value ? new Date(value).toISOString() : null });
  }

  async function clearDue() {
    await onSave?.({ duedate: null });
  }
</script>

<section class="core">
  <div class="field">
    {#if editingTitle}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="title-input"
        type="text"
        aria-label="Card title"
        aria-invalid={titleInvalid}
        bind:value={titleDraft}
        onkeydown={onTitleKeydown}
        onblur={commitTitle}
        autofocus
      />
      {#if titleInvalid}
        <p class="hint" role="alert">Title cannot be empty</p>
      {/if}
    {:else}
      <button class="title" type="button" onclick={startTitle}>{card?.title ?? ''}</button>
    {/if}
  </div>

  <div class="field">
    <h3 class="legend">Description</h3>
    {#if editingDesc}
      <textarea class="desc-input" aria-label="Card description" rows="5" bind:value={descDraft}></textarea>
      <div class="actions">
        <button class="btn primary" type="button" onclick={saveDesc}>Save</button>
        <button class="btn" type="button" onclick={cancelDesc}>Cancel</button>
      </div>
    {:else if description}
      <p class="desc" data-testid="description">{description}</p>
      <button class="btn" type="button" onclick={startDesc}>Edit description</button>
    {:else}
      <button class="btn empty" type="button" onclick={startDesc}>Add a more detailed description</button>
    {/if}
  </div>

  <div class="field">
    <h3 class="legend">Due date</h3>
    <div class="actions">
      <input
        class="due-input"
        class:overdue
        type="datetime-local"
        aria-label="Due date"
        value={due}
        onchange={onDueChange}
      />
      {#if due}
        <button class="btn" type="button" onclick={clearDue}>Clear</button>
      {/if}
    </div>
    {#if overdue}<p class="hint overdue-text">Overdue</p>{/if}
  </div>

  {#if error}
    <p class="hint error" role="alert">{error}</p>
  {/if}
</section>

<style>
  .core { display: flex; flex-direction: column; gap: 20px; }
  .field { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

  .legend {
    margin: 0;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  .title {
    width: 100%;
    padding: 4px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font-size: 18px;
    line-height: 24px;
    text-align: left;
    word-break: break-word;
    cursor: pointer;
  }
  .title:hover { background: var(--card-bg-hover); }

  .title-input, .desc-input, .due-input {
    width: 100%;
    padding: 6px 8px;
    border: 2px solid var(--accent);
    border-radius: 6px;
    background: var(--stack-bg);
    color: var(--text);
    font: inherit;
  }
  .title-input { font-size: 18px; line-height: 24px; }
  .desc-input { resize: vertical; }
  .due-input { width: auto; border-width: 1px; border-color: var(--border); }
  .due-input.overdue { border-color: var(--danger); }

  /* pre-wrap keeps author line breaks without ever interpreting markup, which
     is what makes plain-text rendering safe here. */
  .desc {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

  .btn {
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: #a1bdd914;
    color: var(--text);
    cursor: pointer;
  }
  .btn:hover { background: #a1bdd925; }
  .primary { background: var(--accent); color: #1d2125; }
  .empty { width: 100%; text-align: left; color: var(--text-dim); }

  .hint { margin: 0; font-size: 12px; line-height: 16px; color: var(--text-dim); }
  .error, .overdue-text { color: var(--danger); }
</style>
