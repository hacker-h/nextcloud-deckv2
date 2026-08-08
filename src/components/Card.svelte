<script>
  import { draggable } from '../lib/dnd.svelte.js';
  import ImageLightbox from './ImageLightbox.svelte';
  import { getChecklistSummary } from '../lib/checklist.js';
  import { isTemplateCard } from '../lib/cards.js';

  let { card, onDrop, onOpenCard, onSelect, selected = false, selectionMode = false, dragIds, onUploadAttachment, onAttachLink } = $props();

  let lightboxSrc = $state(null);
  let lightboxTitle = $state('');
  let isDraggingOver = $state(false);
  let dragType = $state('file');

  const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const due = $derived.by(() => {
    if (!card.duedate) return null;
    const d = new Date(card.duedate);
    return Number.isNaN(d.getTime()) ? null : `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  });

  const labels = $derived(card.labels ?? []);
  const checklistSummary = $derived(getChecklistSummary(card.description));
  const isTemplate = $derived(isTemplateCard(card));
  const hasDesc = $derived(Boolean(card.description?.trim()));
  const hasMeta = $derived(due || hasDesc || card.commentsCount > 0 || card.attachmentCount > 0 || checklistSummary.total > 0 || isTemplate);

  const imageAttachment = $derived.by(() => {
    if (card.coverUrl) return { url: card.coverUrl, name: card.title };
    if (!card.attachments?.length) return null;
    return card.attachments.find((a) =>
      a.mimetype?.startsWith('image/') ||
      /\.(png|jpe?g|gif|svg|webp)$/i.test(a.name ?? '')
    );
  });

  const thumbnailUrl = $derived.by(() => {
    if (!imageAttachment) return null;
    if (imageAttachment.url) return imageAttachment.url;
    if (imageAttachment.id && card.boardId && card.stackId && card.id) {
      return `/api/v1.0/boards/${card.boardId}/stacks/${card.stackId}/cards/${card.id}/attachments/${imageAttachment.id}/file`;
    }
    return null;
  });

  function openThumb(e) {
    e.stopPropagation();
    if (thumbnailUrl) {
      lightboxSrc = thumbnailUrl;
      lightboxTitle = imageAttachment?.name ?? card.title;
    }
  }

  function onTileDragOver(e) {
    const dt = e.dataTransfer;
    if (dt?.types?.includes('Files') || dt?.types?.includes('text/uri-list') || dt?.types?.includes('text/plain')) {
      e.preventDefault();
      e.stopPropagation();
      isDraggingOver = true;
    }
  }

  function onTileDragEnter(e) {
    const dt = e.dataTransfer;
    if (dt?.types?.includes('Files') || dt?.types?.includes('text/uri-list') || dt?.types?.includes('text/plain')) {
      e.preventDefault();
      e.stopPropagation();
      if (dt.types.includes('text/uri-list')) dragType = 'link';
      else dragType = 'file';
      isDraggingOver = true;
    }
  }

  function onTileDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.target === e.currentTarget || !e.relatedTarget) {
      isDraggingOver = false;
    }
  }

  async function onTileDrop(e) {
    const dt = e.dataTransfer;
    if (!dt?.files?.length && !dt?.getData('text/uri-list') && !dt?.getData('text/plain')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    isDraggingOver = false;

    const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (uri && /^https?:\/\/[^\s]+$/i.test(uri.trim()) && onAttachLink) {
      await onAttachLink(card, uri.trim());
      return;
    }

    const file = dt.files?.[0];
    if (file && onUploadAttachment) {
      await onUploadAttachment(card, file);
    }
  }

  // Keyboard activation bypasses the pointer gesture machine entirely: there is
  // no drag to disambiguate, so Enter/Space open the card directly.
  function onKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onOpenCard?.({ card });
  }
</script>

<div
  class="card"
  class:selected
  role="button"
  tabindex="0"
  aria-label={card.title}
  aria-pressed={selected}
  data-card-id={card.id}
  onkeydown={onKeydown}
  ondragenter={onTileDragEnter}
  ondragover={onTileDragOver}
  ondragleave={onTileDragLeave}
  ondrop={onTileDrop}
  use:draggable={() => ({
    card,
    onDrop,
    cardIds: dragIds?.(card) ?? [card.id],
    onActivate: () => onOpenCard?.({ card }),
    onSelect: () => onSelect?.({ card }),
  })}
>
  {#if isDraggingOver}
    <div class="card-drop-overlay" role="presentation">
      <span>{dragType === 'link' ? 'Link anhängen' : 'Dateien für Upload ablegen.'}</span>
    </div>
  {/if}
  <div class="inner">
    {#if selectionMode || selected}
      <div class="checkbox" class:checked={selected} aria-hidden="true">
        {#if selected}
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.5 8.5l3 3 6-6"/>
          </svg>
        {/if}
      </div>
    {/if}
    {#if labels.length}
      <div class="labels">
        {#each labels as l (l.id)}
          <span class="label" style="background:#{l.color}" title={l.title}></span>
        {/each}
      </div>
    {/if}

    <div class="card-content">
      <span class="title">{card.title}</span>
      {#if isTemplate}
        <div class="template-badge-pill" title="Diese Karte ist eine Vorlage">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M4 12V4h5l3 3v5H4z" stroke-linejoin="round"/>
            <path d="M9 4v3h3" stroke-linejoin="round"/>
          </svg>
          Diese Karte ist eine Vorlage
        </div>
      {/if}
      {#if thumbnailUrl}
        <button
          class="thumb-btn"
          type="button"
          onclick={openThumb}
          onpointerdown={(e) => e.stopPropagation()}
          title="Vorschau vergrößern"
          aria-label="Vorschau vergrößern"
        >
          <img src={thumbnailUrl} alt={imageAttachment?.name ?? card.title} class="thumb-img" />
        </button>
      {/if}
    </div>

    {#if hasMeta}
      <div class="meta">
        {#if due}
          <span class="badge due" class:overdue={card.overdue}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.6"/>
              <path d="M2.2 6.4h11.6M5.4 1.8v2.6M10.6 1.8v2.6" stroke-linecap="round"/>
            </svg>
            {due}
          </span>
        {/if}
        {#if hasDesc}
          <span class="badge" title="Diese Karte hat eine Beschreibung" aria-label="Hat eine Beschreibung">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
              <rect x="2" y="3.6" width="12" height="1.3" rx=".65"/>
              <rect x="2" y="7.35" width="12" height="1.3" rx=".65"/>
              <rect x="2" y="11.1" width="8" height="1.3" rx=".65"/>
            </svg>
          </span>
        {/if}
        {#if card.commentsCount > 0}
          <span class="badge" title="{card.commentsCount} Kommentare">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path d="M14 9.4a1.9 1.9 0 0 1-1.9 1.9H5.4L2 14.2V3.5a1.9 1.9 0 0 1 1.9-1.9h8.2A1.9 1.9 0 0 1 14 3.5z" stroke-linejoin="round"/>
            </svg>
            {card.commentsCount}
          </span>
        {/if}
        {#if checklistSummary.total > 0}
          <span
            class="badge checklist-badge {checklistSummary.done === checklistSummary.total ? 'complete' : ''}"
            title="{checklistSummary.done} von {checklistSummary.total} Checklisten-Elementen erledigt"
          >
            ☑ {checklistSummary.done}/{checklistSummary.total}
          </span>
        {/if}
        {#if card.attachmentCount > 0}
          <span class="badge" title="{card.attachmentCount} Anhänge">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
              <path d="M10.5 5.5 6 10a1.8 1.8 0 0 0 2.5 2.5l4.5-4.5a3.2 3.2 0 0 0-4.5-4.5L3.6 8.4a4.6 4.6 0 0 0 6.5 6.5"/>
            </svg>
            {card.attachmentCount}
          </span>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if lightboxSrc}
  <ImageLightbox src={lightboxSrc} title={lightboxTitle} onClose={() => (lightboxSrc = null)} />
{/if}

<style>
  .card {
    position: relative;
    display: block;
    /* Cards are flex items in a column container. Without this they shrink
       below their content once the stack overflows, and the meta row spills
       outside the card onto the next one. */
    flex: 0 0 auto;
    background: var(--card-bg);
    border-radius: var(--card-radius);
    box-shadow: var(--card-shadow);
    color: var(--text);
    /* The whole tile becomes the drag handle in M4; text must never be
       selectable by dragging across it (PLAN.md §2.2). */
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
    /* No transition - Trello measures transition-duration 0s. Instant
       feedback is a large part of why it feels fast. */
  }
  .card:hover { background: var(--card-bg-hover); }
  /* Measured from Trello: 2px rgb(0,95,204), drawn inside so a selected card
     does not shift its neighbours. */
  .selected {
    background: var(--card-bg-hover);
    box-shadow: inset 0 0 0 2px rgb(0, 95, 204);
  }

  .checkbox {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1.5px solid var(--text-dim, #7a869a);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    pointer-events: none;
    transition-duration: 0s;
  }
  .checkbox.checked {
    background: #005fcc;
    border-color: #005fcc;
  }

  /* Trello: padding 8px 12px 4px, min-height 36px on the card itself. */
  .inner {
    min-height: 36px;
    /* 8 + 20 (line-height) + 8 = 36px for a plain single-line card, exactly
       matching Trello. */
    padding: 8px 12px;
  }

  .card-content {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .title {
    flex: 1;
    display: block;
    font-size: var(--font-size);
    line-height: var(--line-height);
    word-break: break-word;
  }

  .thumb-btn {
    flex: 0 0 auto;
    padding: 0;
    margin: 0;
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    overflow: hidden;
  }
  .thumb-btn:hover {
    outline: 2px solid var(--accent);
  }

  .thumb-img {
    display: block;
    width: 44px;
    height: 32px;
    object-fit: cover;
    border-radius: 4px;
  }

  .labels { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .label { width: 40px; height: 8px; border-radius: 4px; }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    margin-top: 2px;
    font-size: 12px;
    line-height: 14px;
    color: var(--text-dim);
  }
  .badge { display: inline-flex; align-items: center; gap: 4px; }
  .badge svg { display: block; }
  .due { padding: 2px 4px; border-radius: 4px; }
  .overdue { background: #5D1F1A; color: #FD9891; }
  .checklist-badge {
    padding: 2px 5px;
    border-radius: 4px;
    background: #2c333a;
    color: #b6c2cf;
    font-size: 11px;
    font-weight: 500;
  }
  .checklist-badge.complete {
    background: #1f845a;
    color: #ffffff;
  }

  .template-badge-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #1c2b42;
    color: #579dff;
    border: 1px solid #1f487e;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 12px;
    margin-top: 5px;
    width: fit-content;
  }

  .card-drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    background: rgba(0, 95, 204, 0.92);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    border-radius: var(--card-radius);
    pointer-events: none;
  }
</style>
