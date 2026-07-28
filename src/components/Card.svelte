<script>
  let { card, href } = $props();

  const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const due = $derived.by(() => {
    if (!card.duedate) return null;
    const d = new Date(card.duedate);
    return Number.isNaN(d.getTime()) ? null : `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  });

  const labels = $derived(card.labels ?? []);
  const hasDesc = $derived(Boolean(card.description?.trim()));
  const hasMeta = $derived(due || hasDesc || card.commentsCount > 0 || card.attachmentCount > 0);
</script>

<a class="card" {href} target="_blank" rel="noopener noreferrer">
  <div class="inner">
    {#if labels.length}
      <div class="labels">
        {#each labels as l (l.id)}
          <span class="label" style="background:#{l.color}" title={l.title}></span>
        {/each}
      </div>
    {/if}

    <span class="title">{card.title}</span>

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
          <span class="badge" title="This card has a description" aria-label="Has description">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
              <rect x="2" y="3.6" width="12" height="1.3" rx=".65"/>
              <rect x="2" y="7.35" width="12" height="1.3" rx=".65"/>
              <rect x="2" y="11.1" width="8" height="1.3" rx=".65"/>
            </svg>
          </span>
        {/if}
        {#if card.commentsCount > 0}
          <span class="badge" title="{card.commentsCount} comments">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path d="M14 9.4a1.9 1.9 0 0 1-1.9 1.9H5.4L2 14.2V3.5a1.9 1.9 0 0 1 1.9-1.9h8.2A1.9 1.9 0 0 1 14 3.5z" stroke-linejoin="round"/>
            </svg>
            {card.commentsCount}
          </span>
        {/if}
        {#if card.attachmentCount > 0}
          <span class="badge" title="{card.attachmentCount} attachments">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
              <path d="M10.5 5.5 6 10a1.8 1.8 0 0 0 2.5 2.5l4.5-4.5a3.2 3.2 0 0 0-4.5-4.5L3.6 8.4a4.6 4.6 0 0 0 6.5 6.5"/>
            </svg>
            {card.attachmentCount}
          </span>
        {/if}
      </div>
    {/if}
  </div>
</a>

<style>
  .card {
    display: block;
    /* Cards are flex items in a column container. Without this they shrink
       below their content once the stack overflows, and the meta row spills
       outside the card onto the next one. */
    flex: 0 0 auto;
    background: var(--card-bg);
    border-radius: var(--card-radius);
    box-shadow: var(--card-shadow);
    color: var(--text);
    text-decoration: none;
    /* The whole tile becomes the drag handle in M4; text must never be
       selectable by dragging across it (PLAN.md §2.2). */
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
    /* No transition - Trello measures transition-duration 0s. Instant
       feedback is a large part of why it feels fast. */
  }
  .card:hover { background: var(--card-bg-hover); }

  /* Trello: padding 8px 12px 4px, min-height 36px on the card itself. */
  .inner {
    min-height: 36px;
    /* 8 + 20 (line-height) + 8 = 36px for a plain single-line card, exactly
       matching Trello. */
    padding: 8px 12px;
  }

  .title {
    display: block;
    font-size: var(--font-size);
    line-height: var(--line-height);
    word-break: break-word;
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
</style>
