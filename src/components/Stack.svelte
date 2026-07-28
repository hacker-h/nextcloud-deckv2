<script>
  import Card from './Card.svelte';
  let { stack, cardUrl } = $props();
</script>

<section class="stack">
  <header class="head">
    <h2 class="title">{stack.title}</h2>
    <span class="count">{stack.cards.length}</span>
  </header>

  <div class="cards">
    {#each stack.cards as card (card.id)}
      <Card {card} href={cardUrl(card.id)} />
    {/each}
  </div>

  <!-- Trello shows this footer on every list. Card creation lands in M6;
       until then it is a disabled affordance, not a dead control. -->
  <footer class="foot">
    <button class="add" disabled title="Adding cards arrives in M6">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <path d="M8 3.5v9M3.5 8h9"/>
      </svg>
      Add a card
    </button>
  </footer>
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
    /* Trello: list padding 0 0 4px */
    padding-bottom: 4px;
  }

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
