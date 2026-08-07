<script>
  import Card from './Card.svelte';
  import { drag } from '../lib/dnd.svelte.js';

  let {
    state,
    collapsed = false,
    onToggle,
    onDrop,
    onOpenCard,
    onSelect,
    selectedIds = [],
    dragIds,
  } = $props();

  const stackId = $derived(state.stack?.id ?? null);
  const isOver = $derived(drag.active && stackId != null && drag.overStack === stackId);
  const visible = $derived(
    drag.active ? state.cards.filter((c) => !drag.cardIds.includes(c.id)) : state.cards
  );
  const placeholderAt = $derived(isOver ? (drag.overIndex ?? visible.length) : -1);
  const placeholderHeights = $derived(drag.heights.length ? drag.heights : [drag.h || 36]);
</script>

<aside class="rail" class:collapsed class:over={isOver}>
  <header class="head">
    {#if !collapsed}
      <h2 class="title">Inbox</h2>
      <span class="count">{state.cards.length}</span>
    {/if}
    <button
      class="toggle"
      type="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand inbox' : 'Collapse inbox'}
      title={collapsed ? 'Expand inbox' : 'Collapse inbox'}
      onclick={() => onToggle?.()}
    >
      {collapsed ? '▤' : '‹'}
    </button>
  </header>

  {#if !collapsed}
    {#if state.error}
      <p class="err">{state.error}</p>
    {:else}
      <!-- data-stack-id makes the panel a drop target for the shared pointer
           drag engine, which hit-tests lanes by that attribute alone. -->
      <div class="cards" data-cards data-stack-id={stackId}>
        {#each visible as card, i (card.id)}
          {#if i === placeholderAt}
            {#each placeholderHeights as h}
              <div class="placeholder" style="height:{h}px"></div>
            {/each}
          {/if}
          <Card
            {card}
            {onDrop}
            {onOpenCard}
            {onSelect}
            {dragIds}
            selected={selectedIds.includes(card.id)}
          />
        {/each}
        {#if placeholderAt >= visible.length}
          {#each placeholderHeights as h}
            <div class="placeholder" style="height:{h}px"></div>
          {/each}
        {/if}
        {#if !visible.length && placeholderAt < 0}
          <p class="empty">Drag cards here from any board.</p>
        {/if}
      </div>
    {/if}
  {/if}
</aside>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    flex: 0 0 var(--inbox-w);
    width: var(--inbox-w);
    max-height: 100%;
    background: var(--stack-bg);
    border-right: 1px solid rgb(255 255 255 / 8%);
    transition: background 120ms ease;
  }
  .rail.collapsed { flex-basis: var(--rail-w); width: var(--rail-w); }
  .rail.over { background: #1B1E12; }

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
    font-size: 20px;
    font-weight: 650;
    line-height: 24px;
    color: var(--text-dim);
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .toggle {
    margin-left: auto;
    background: none;
    border: 0;
    border-radius: 6px;
    padding: 4px 8px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .count + .toggle { margin-left: 0; }
  .toggle:hover { background: #A1BDD914; color: var(--text); }

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
    padding: 4px 8px;
    overflow-y: auto;
    min-height: 0;
    flex: 1 1 auto;
  }

  .placeholder {
    flex: 0 0 auto;
    background: #A1BDD914;
    border-radius: var(--card-radius);
  }

  .empty, .err {
    margin: 8px 4px;
    font-size: 12px;
    line-height: 16px;
    color: var(--text-dim);
  }
  .err { color: #FD9891; }
</style>
