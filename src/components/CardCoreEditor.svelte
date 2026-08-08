<script>
  let { card, onSave, onDraftChange = () => {}, error = null } = $props();

  let editingTitle = $state(false);
  let titleDraft = $state('');
  let editingDesc = $state(false);
  let descDraft = $state('');

  const description = $derived(card?.description ?? '');

  $effect(() => {
    onDraftChange(editingDesc && descDraft !== description ? { description: descDraft } : null);
  });
  const titleInvalid = $derived(editingTitle && !titleDraft.trim());

  const due = $derived(toLocalInput(card?.duedate));
  const overdue = $derived.by(() => {
    if (!card?.duedate) return false;
    const t = new Date(card.duedate).getTime();
    return !Number.isNaN(t) && t < Date.now();
  });

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
  <div class="header-row">
    <span class="icon-circle" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="8" cy="8" r="6" />
      </svg>
    </span>
    <div class="title-container">
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
          <p class="hint" role="alert">Titel darf nicht leer sein</p>
        {/if}
      {:else}
        <button class="title-btn" type="button" onclick={startTitle}>{card?.title ?? ''}</button>
      {/if}
    </div>
  </div>

  <div class="action-pills">
    <button class="pill-btn" type="button" onclick={startDesc}>
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
      Hinzufügen
    </button>
    <button class="pill-btn" type="button">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M2.5 8.5L8.5 2.5h5v5L7.5 13.5z" />
      </svg>
      Labels
    </button>
    <button class="pill-btn" type="button">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5v4l2.5 2.5" />
      </svg>
      Datum
    </button>
    <button class="pill-btn" type="button">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
        <path d="M5.5 8.5l2 2 3.5-4" />
      </svg>
      Checkliste
    </button>
  </div>

  <div class="section-field">
    <div class="section-head">
      <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
      </svg>
      <h3 class="legend">Beschreibung</h3>
    </div>

    {#if editingDesc}
      <textarea class="desc-input" aria-label="Beschreibung der Karte" rows="4" placeholder="Detaillierte Beschreibung hinzufügen ..." bind:value={descDraft}></textarea>
      <div class="desc-actions">
        <button class="btn primary" type="button" onclick={saveDesc}>Speichern</button>
        <button class="btn ghost" type="button" onclick={cancelDesc}>Abbrechen</button>
        <div class="flex-spacer"></div>
        <button class="btn help-btn" type="button">Formatierungshilfe</button>
      </div>
    {:else if description}
      <div class="desc-box" onclick={startDesc} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && startDesc()}>
        <p class="desc" data-testid="description">{description}</p>
      </div>
    {:else}
      <button class="desc-placeholder-btn" type="button" aria-label="Fügen Sie eine detailliertere Beschreibung hinzu" onclick={startDesc}>
        Detaillierte Beschreibung hinzufügen ...
      </button>
    {/if}
  </div>

  <div class="section-field">
    <div class="section-head">
      <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5v4l2.5 2.5" />
      </svg>
      <h3 class="legend">Ablaufdatum</h3>
    </div>
    <div class="due-row">
      <input
        class="due-input"
        class:overdue
        type="datetime-local"
        aria-label="Ablaufdatum"
        value={due}
        onchange={onDueChange}
      />
      {#if due}
        <button class="btn ghost" type="button" onclick={clearDue}>Entfernen</button>
      {/if}
    </div>
    {#if overdue}<p class="hint overdue-text">Überfällig</p>{/if}
  </div>

  {#if error}
    <p class="hint error" role="alert">{error}</p>
  {/if}
</section>

<style>
  .core { display: flex; flex-direction: column; gap: 20px; }

  .header-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .icon-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 4px;
    color: #9fadbc;
  }

  .title-container {
    flex: 1;
  }

  .title-btn {
    width: 100%;
    padding: 2px 6px;
    margin-left: -6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #b6c2cf;
    font-size: 20px;
    font-weight: 600;
    line-height: 28px;
    text-align: left;
    word-break: break-word;
    cursor: pointer;
  }
  .title-btn:hover { background: #a1bdd914; }

  .title-input {
    width: 100%;
    padding: 4px 8px;
    margin-left: -6px;
    border: 2px solid #579dff;
    border-radius: 6px;
    background: #22272b;
    color: #b6c2cf;
    font-size: 20px;
    font-weight: 600;
    line-height: 28px;
  }

  .action-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: 28px;
  }

  .pill-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: #2c333a;
    border: 0;
    border-radius: 6px;
    color: #b6c2cf;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s ease;
  }
  .pill-btn:hover { background: #38414a; color: #ffffff; }

  .section-field {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

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

  .desc-placeholder-btn {
    width: 100%;
    padding: 12px 16px;
    margin-left: 28px;
    max-width: calc(100% - 28px);
    background: #22272b;
    border: 1px solid #38414a;
    border-radius: 8px;
    color: #9fadbc;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .desc-placeholder-btn:hover { background: #2c333a; }

  .desc-box {
    padding: 12px 16px;
    margin-left: 28px;
    max-width: calc(100% - 28px);
    background: #22272b;
    border: 1px solid #38414a;
    border-radius: 8px;
    color: #b6c2cf;
    cursor: pointer;
  }
  .desc-box:hover { background: #2c333a; }

  .desc-input {
    width: 100%;
    margin-left: 28px;
    max-width: calc(100% - 28px);
    padding: 12px 16px;
    background: #22272b;
    border: 2px solid #579dff;
    border-radius: 8px;
    color: #b6c2cf;
    font: inherit;
    font-size: 14px;
    resize: vertical;
  }

  .desc-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 28px;
    max-width: calc(100% - 28px);
    margin-top: 6px;
  }

  .flex-spacer { flex: 1; }

  .due-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 28px;
  }

  .due-input {
    padding: 6px 10px;
    background: #22272b;
    border: 1px solid #38414a;
    border-radius: 6px;
    color: #b6c2cf;
    font: inherit;
  }

  .btn {
    padding: 6px 12px;
    border: 0;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .primary { background: #579dff; color: #1d2125; font-weight: 600; }
  .primary:hover { background: #85b8ff; }
  .ghost { background: transparent; color: #9fadbc; }
  .ghost:hover { background: #a1bdd914; color: #b6c2cf; }
  .help-btn { background: #a1bdd914; color: #9fadbc; }
  .help-btn:hover { background: #a1bdd925; color: #b6c2cf; }

  .hint { margin: 0; margin-left: 28px; font-size: 12px; color: #9fadbc; }
  .error, .overdue-text { color: #f87171; }
</style>

