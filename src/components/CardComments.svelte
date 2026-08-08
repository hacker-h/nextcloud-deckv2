<script>
  let { comments = [], onAdd, onEdit, onDelete } = $props();

  let draft = $state('');
  let replyTo = $state(null);
  let replyDraft = $state('');
  let editingId = $state(null);
  let editDraft = $state('');

  let pending = $state(false);
  let error = $state(null);
  // The payload that failed is retained verbatim so Retry re-sends exactly what
  // the user wrote instead of whatever the composer holds by then.
  let failed = $state(null);

  const threads = $derived.by(() => {
    const byParent = new Map();
    for (const c of comments) {
      if (c.parentId == null) continue;
      const siblings = byParent.get(c.parentId) ?? [];
      siblings.push(c);
      byParent.set(c.parentId, siblings);
    }
    return comments
      .filter((c) => c.parentId == null)
      .map((c) => ({ comment: c, replies: byParent.get(c.id) ?? [] }));
  });

  function when(iso) {
    if (!iso) return '';
    const d = new Date(Number.isFinite(iso) ? iso * 1000 : iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  function initials(name) {
    return String(name ?? '?').trim().slice(0, 2).toUpperCase();
  }

  async function run(action, attempt) {
    if (pending) return false;
    pending = true;
    error = null;
    try {
      await action();
      failed = null;
      return true;
    } catch (err) {
      error = err?.message ?? 'Something went wrong';
      failed = attempt;
      return false;
    } finally {
      pending = false;
    }
  }

  async function submit() {
    const message = draft.trim();
    if (!message) return;

    const ok = await run(() => onAdd?.(message, {}), { kind: 'add', message });
    if (ok) draft = '';
  }

  async function submitReply(parent) {
    const message = replyDraft.trim();
    if (!message) return;

    const ok = await run(
      () => onAdd?.(message, { parentId: parent.id }),
      { kind: 'add', message, parentId: parent.id },
    );
    if (ok) {
      replyDraft = '';
      replyTo = null;
    }
  }

  function startEdit(comment) {
    editingId = comment.id;
    editDraft = comment.message;
  }

  async function submitEdit(comment) {
    const message = editDraft.trim();
    if (!message) return;

    const ok = await run(() => onEdit?.(comment, message), { kind: 'edit', comment, message });
    if (ok) editingId = null;
  }

  function remove(comment) {
    return run(() => onDelete?.(comment), { kind: 'delete', comment });
  }

  function retry() {
    const a = failed;
    if (!a) return;
    if (a.kind === 'add') return run(() => onAdd?.(a.message, { parentId: a.parentId }), a);
    if (a.kind === 'edit') return run(() => onEdit?.(a.comment, a.message), a);
    return run(() => onDelete?.(a.comment), a);
  }
</script>

{#snippet body(comment)}
  <div class="row">
    <span class="avatar">{initials(comment.actorDisplayName)}</span>
    <div class="bubble">
      <p class="byline">
        <span class="author">{comment.actorDisplayName}</span>
        <time>{when(comment.creationDateTime)}</time>
      </p>
      {#if editingId === comment.id}
        <textarea class="input" aria-label="Kommentar bearbeiten" rows="3" bind:value={editDraft}></textarea>
        <div class="actions">
          <button class="btn primary" type="button" disabled={pending || !editDraft.trim()} onclick={() => submitEdit(comment)}>
            Speichern
          </button>
          <button class="btn" type="button" onclick={() => (editingId = null)}>Abbrechen</button>
        </div>
      {:else}
        <p class="message">{comment.message}</p>
        <div class="actions">
          <button class="btn link" type="button" onclick={() => (replyTo = replyTo === comment.id ? null : comment.id)}>
            Antworten
          </button>
          {#if comment.canEdit}
            <button class="btn link" type="button" onclick={() => startEdit(comment)}>Bearbeiten</button>
            <button class="btn link" type="button" disabled={pending} onclick={() => remove(comment)}>Löschen</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<section class="comments">
  <h3 class="legend">Kommentare</h3>

  <form
    class="composer"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <textarea class="input" aria-label="Kommentar schreiben" rows="3" bind:value={draft}></textarea>
    <button class="btn primary" type="submit" disabled={pending || !draft.trim()}>
      {pending ? 'Wird gespeichert…' : 'Kommentieren'}
    </button>
  </form>

  {#if error}
    <p class="error" role="alert">
      {error}
      <button class="btn link" type="button" onclick={retry}>Erneut versuchen</button>
    </p>
  {/if}

  {#if threads.length === 0}
    <p class="empty">Noch keine Kommentare</p>
  {:else}
    <ul class="thread">
      {#each threads as { comment, replies } (comment.id)}
        <li>
          {@render body(comment)}
          {#if replyTo === comment.id}
            <form
              class="composer reply"
              onsubmit={(e) => {
                e.preventDefault();
                submitReply(comment);
              }}
            >
              <textarea class="input" aria-label="Write a reply" rows="2" bind:value={replyDraft}></textarea>
              <button class="btn primary" type="submit" disabled={pending || !replyDraft.trim()}>Send reply</button>
            </form>
          {/if}
          {#if replies.length}
            <ul class="replies">
              {#each replies as reply (reply.id)}
                <li>{@render body(reply)}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .comments { display: flex; flex-direction: column; gap: 12px; }

  .legend {
    margin: 0;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  ul { margin: 0; padding: 0; list-style: none; }
  .thread { display: flex; flex-direction: column; gap: 12px; }
  .replies { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 0 36px; }

  .composer { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .reply { margin: 8px 0 0 36px; }

  .input {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--stack-bg);
    color: var(--text);
    font: inherit;
    resize: vertical;
  }
  .input:focus { border-color: var(--accent); outline: none; }

  .row { display: flex; gap: 8px; align-items: flex-start; }

  .avatar {
    display: inline-flex;
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: #1d2125;
    font-size: 11px;
    font-weight: 700;
  }

  .bubble { flex: 1; min-width: 0; }

  .byline { display: flex; gap: 8px; margin: 0 0 2px; font-size: 12px; line-height: 16px; color: var(--text-dim); }
  .author { font-weight: 600; color: var(--text); }

  /* pre-wrap keeps author line breaks while the text stays plain, never markup. */
  .message {
    margin: 0;
    padding: 8px;
    border-radius: 6px;
    background: var(--stack-bg);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }

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

  .empty, .error { margin: 0; font-size: 12px; line-height: 16px; color: var(--text-dim); }
  .error { display: flex; align-items: center; gap: 8px; color: var(--danger); }
</style>
