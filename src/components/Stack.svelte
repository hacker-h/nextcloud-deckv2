<script>
  import { tick } from 'svelte';
  import Card from './Card.svelte';
  import { drag } from '../lib/dnd.svelte.js';

  let { readOnly = false, stack, boardId, onDrop, onOpenCard, onSelect, selectedIds = [], dragIds, onUploadAttachment, onAttachLink, onAddCard } = $props();

  let adding = $state(false);
  let title = $state('');
  let saving = $state(false);
  let error = $state('');
  let input = $state();
  let addButton = $state();

  async function startAdding() {
    adding = true;
    error = '';
    await tick();
    input?.focus();
  }

  async function cancelAdding() {
    if (saving) return;
    adding = false;
    title = '';
    error = '';
    await tick();
    addButton?.focus();
  }

  async function submit() {
    const cleanTitle = title.trim();
    if (!cleanTitle || saving) return;
    saving = true;
    error = '';
    try {
      await onAddCard?.({ boardId, stackId: stack.id, title: cleanTitle });
      title = '';
      adding = false;
      await tick();
      addButton?.focus();
    } catch (cause) {
      error = cause?.message ?? 'Karte konnte nicht erstellt werden';
      await tick();
      input?.focus();
    } finally {
      saving = false;
    }
  }

  const isOver = $derived(drag.active && drag.overStack === stack.id);
  // Cards being dragged are hidden from the layout so the placeholder occupies
  // their space instead - otherwise the list visibly grows during a drag.
  const visible = $derived(
    drag.active ? stack.cards.filter((c) => !drag.cardIds.includes(c.id)) : stack.cards
  );
  const placeholderAt = $derived(isOver ? (drag.overIndex ?? visible.length) : -1);
  // One slot per dragged card, each the height that card had at its source, so
  // the gap the cards will occupy is the gap the user sees.
  const placeholderHeights = $derived(drag.heights.length ? drag.heights : [drag.h || 36]);
</script>

<section class="stack" class:over={isOver} data-stack-id={readOnly ? undefined : stack.id}>
  <header class="head">
    <h2 class="title">{stack.title}</h2>
    <span class="count">{stack.cards.length}</span>
  </header>

  <div class="cards" data-cards>
    {#each visible as card, i (card.id)}
      {#if i === placeholderAt}
        {#each placeholderHeights as h}
          <div class="placeholder" style="height:{h}px"></div>
        {/each}
      {/if}
      <Card {readOnly} {card} {onDrop} {onOpenCard} {onSelect} {dragIds} {onUploadAttachment} {onAttachLink} selected={selectedIds.includes(card.id)} selectionMode={selectedIds.length > 0} />
    {/each}
    {#if placeholderAt >= visible.length}
      {#each placeholderHeights as h}
        <div class="placeholder" style="height:{h}px"></div>
      {/each}
    {/if}
  </div>

  {#if !readOnly}
  <footer class="foot">
    {#if adding}
      <form class="composer" onsubmit={(event) => { event.preventDefault(); submit(); }}>
        <textarea
          bind:this={input}
          bind:value={title}
          class="title-input"
          aria-label={`Neue Karte in ${stack.title}`}
          placeholder="Titel für diese Karte eingeben"
          rows="3"
          disabled={saving}
          oninput={() => { error = ''; }}
          onkeydown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelAdding();
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        ></textarea>
        {#if error}<p class="composer-error" role="alert">{error}</p>{/if}
        <div class="composer-actions">
          <button class="save" type="submit" disabled={!title.trim() || saving}>
            {saving ? 'Wird hinzugefügt…' : 'Karte hinzufügen'}
          </button>
          <button class="cancel" type="button" aria-label="Abbrechen" disabled={saving} onclick={cancelAdding}>×</button>
        </div>
      </form>
    {:else}
      <button bind:this={addButton} class="add" type="button" disabled={!onAddCard} onclick={startAdding}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9"/>
        </svg>
        Eine Karte hinzufügen
      </button>
    {/if}
  </footer>
  {/if}
</section>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    flex: 0 0 var(--stack-w);
    width: var(--stack-w);
    max-height: 100%;
    background: var(--stack-bg);
    border-radius: var(--stack-radius);
    /* The whole list is a drop target, so dropping anywhere below the last card
       lands in this lane. */
    transition: background 120ms ease;
    /* Trello: list padding 0 0 4px */
    padding-bottom: 4px;
  }

  .stack.over { background: #1B1E12; }

  /* Trello: header padding 8px 8px 0, total height 40px */
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 10px 12px 4px;
    flex: 0 0 auto;
  }
  .title {
    margin: 0;
    /* Trello: 20px, weight 653, --ds-text-subtle */
    font-size: 20px;
    font-weight: 650;
    line-height: 24px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .foot {
    flex: 0 0 auto;
    padding: 0 8px 4px;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: 0;
    border-radius: 8px;
    color: #96999E;  /* Trello add-card label */
    text-align: left;
    cursor: pointer;
  }
  .add:hover:not(:disabled) { background: #A1BDD914; color: var(--text); }
  .add:disabled { opacity: .55; cursor: default; }

  .composer { display: grid; gap: 8px; }
  .title-input {
    width: 100%;
    min-height: 72px;
    resize: vertical;
    border: 1px solid #579DFF;
    border-radius: var(--card-radius);
    padding: 10px 12px;
    background: var(--card-bg);
    color: var(--text);
    font: inherit;
    line-height: 1.35;
    box-shadow: 0 0 0 1px #579DFF;
  }
  .title-input:focus { outline: 0; }
  .composer-actions { display: flex; align-items: center; gap: 6px; }
  .save, .cancel {
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .save { padding: 8px 12px; background: #579DFF; color: #101214; font-weight: 650; }
  .save:hover:not(:disabled) { background: #85B8FF; }
  .save:disabled { opacity: .55; cursor: default; }
  .cancel { width: 34px; height: 34px; background: transparent; color: var(--text-dim); font-size: 24px; }
  .cancel:hover:not(:disabled) { background: #A1BDD914; color: var(--text); }
  .composer-error { margin: 0; color: #F87168; font-size: 12px; }

  /* The drop indicator. Trello shows a recessed slot that the cards animate
     around; the 120ms ease is what makes it feel deliberate rather than jumpy. */
  .placeholder {
    flex: 0 0 auto;
    background: #A1BDD914;
    border-radius: var(--card-radius);
    animation: grow 120ms ease;
  }
  @keyframes grow {
    from { height: 0; opacity: 0; }
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
    /* Trello: cards wrapper padding 4px, widened slightly for the scrollbar */
    padding: 4px 8px;
    overflow-y: auto;
    /* min-height:0 is required, or the flex child refuses to shrink and the
       whole board scrolls instead of the stack. */
    min-height: 0;
  }
</style>
