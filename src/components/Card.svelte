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
        <span class="badge" class:overdue={card.overdue}>{due}</span>
      {/if}
      {#if hasDesc}
        <span class="badge icon" title="Has description" aria-label="Has description">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
            <rect x="2" y="4" width="12" height="1.4" rx=".7" />
            <rect x="2" y="7.3" width="12" height="1.4" rx=".7" />
            <rect x="2" y="10.6" width="8" height="1.4" rx=".7" />
          </svg>
        </span>
      {/if}
      {#if card.commentsCount > 0}
        <span class="badge icon" title="{card.commentsCount} comments">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d="M8 1.5c-3.6 0-6.5 2.3-6.5 5.2 0 1.7 1 3.2 2.6 4.1-.1.8-.5 1.8-1.3 2.7 1.6-.2 3-1 3.8-1.7.4.1.9.1 1.4.1 3.6 0 6.5-2.3 6.5-5.2S11.6 1.5 8 1.5z"/>
          </svg>
          {card.commentsCount}
        </span>
      {/if}
      {#if card.attachmentCount > 0}
        <span class="badge icon" title="{card.attachmentCount} attachments">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <path d="M10.5 5.5 6 10a1.8 1.8 0 0 0 2.5 2.5l4.5-4.5a3.2 3.2 0 0 0-4.5-4.5L3.6 8.4a4.6 4.6 0 0 0 6.5 6.5"/>
          </svg>
          {card.attachmentCount}
        </span>
      {/if}
    </div>
  {/if}
</a>

<style>
  .card {
    display: block;
    min-height: var(--card-h);
    padding: 8px 10px;
    background: var(--card-bg);
    border-radius: var(--card-radius);
    box-shadow: 0 1px 1px rgba(0, 0, 0, .25);
    color: var(--text);
    text-decoration: none;
    /* The whole tile is the drag handle from M4 on; text must never be
       selectable by dragging across it (PLAN.md §2.2). */
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
    /* No transition: Trello measures transition-duration 0s, and instant
       feedback is a large part of why it feels fast. */
  }
  .card:hover { background: var(--card-bg-hover); }

  .title {
    display: block;
    line-height: 20px;
    word-break: break-word;
  }

  .labels { display: flex; gap: 4px; margin-bottom: 6px; }
  .label { width: 32px; height: 8px; border-radius: 4px; }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .badge { display: inline-flex; align-items: center; gap: 3px; }
  .icon svg { display: block; opacity: .85; }
  .overdue { color: var(--danger); font-weight: 600; }
</style>
