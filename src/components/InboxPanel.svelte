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
    <span class="glyph" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1.9" y="2.6" width="12.2" height="10.8" rx="2"/>
        <path d="M1.9 9.4h3.2l.9 1.6h4l.9-1.6h3.2"/>
      </svg>
    </span>
    {#if !collapsed}
      <h2 class="title">Posteingang</h2>
      <span class="count">{state.cards.length}</span>
    {/if}
    <button
      class="toggle"
      type="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Posteingang erweitern' : 'Posteingang einklappen'}
      title={collapsed ? 'Posteingang erweitern' : 'Posteingang einklappen'}
      onclick={() => onToggle?.()}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={collapsed ? 'M6 3.5 10.5 8 6 12.5' : 'M10 3.5 5.5 8 10 12.5'}/>
      </svg>
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
          <div class="empty">
            <span class="empty-art" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <rect x="6" y="10" width="36" height="28" rx="4"/>
                <path d="M6 27h9l2.6 4.4h12.8L33 27h9"/>
              </svg>
            </span>
            <p class="empty-title">Aufgaben konsolidieren</p>
            <p class="empty-body">Ob als E-Mail, mündlich mitgeteilt oder weitergeleitet – erfassen Sie alles schnell in Trello.</p>
          </div>
        {/if}
      </div>

      <footer class="privacy">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3.4" y="7" width="9.2" height="6.6" rx="1.6"/>
          <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7"/>
        </svg>
        Der Posteingang ist nur für Sie sichtbar
      </footer>
    {/if}
  {/if}
</aside>

<style>
  /* A floating panel rather than a flush rail: Trello insets the inbox, rounds
     it and tints it away from the board so it reads as a separate surface. */
  .rail {
    display: flex;
    flex-direction: column;
    flex: 0 0 var(--inbox-w);
    width: var(--inbox-w);
    margin: 8px 0 8px 8px;
    max-height: calc(100% - 16px);
    background:
      linear-gradient(180deg, #1D2740 0%, #151A2B 42%, #12141C 100%);
    border: 1px solid rgb(255 255 255 / 9%);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 34%);
    transition: box-shadow 120ms ease, border-color 120ms ease;
  }
  .rail.collapsed {
    flex-basis: var(--rail-w);
    width: var(--rail-w);
    align-items: center;
    /* Collapsed it is a tab, not a column, so it shrinks to its header. */
    align-self: flex-start;
  }
  .rail.over {
    border-color: var(--accent);
    box-shadow: 0 8px 24px rgb(0 0 0 / 34%), inset 0 0 0 1px var(--accent);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 12px 14px 8px;
    flex: 0 0 auto;
  }
  .rail.collapsed .head { padding: 12px 0 8px; flex-direction: column; }
  .glyph { display: flex; flex: 0 0 auto; color: var(--text-dim); }
  .title {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
    line-height: 22px;
    color: #fff;
  }
  .count {
    margin-left: auto;
    min-width: 20px;
    padding: 1px 7px;
    border-radius: 10px;
    background: #A1BDD914;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .toggle {
    display: flex;
    margin-left: auto;
    background: none;
    border: 0;
    border-radius: 6px;
    padding: 5px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .count + .toggle { margin-left: 0; }
  .toggle:hover { background: #A1BDD914; color: var(--text); }
  .toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
    padding: 4px 10px;
    overflow-y: auto;
    min-height: 0;
    flex: 1 1 auto;
  }

  .placeholder {
    flex: 0 0 auto;
    background: #A1BDD914;
    border-radius: var(--card-radius);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    margin: auto 0;
    padding: 16px 8px;
    text-align: center;
  }
  .empty-art { color: #4C5878; margin-bottom: 10px; }
  .empty-title {
    margin: 0;
    font-size: 14px;
    font-weight: 650;
    color: var(--text);
  }
  .empty-body {
    margin: 0;
    font-size: 12px;
    line-height: 17px;
    color: var(--text-dim);
  }

  .privacy {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 10px 12px 12px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .err {
    margin: 8px 12px;
    font-size: 12px;
    line-height: 16px;
    color: #FD9891;
  }
</style>
