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
    {:else}
      <p class="empty">No cards</p>
    {/each}
  </div>
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
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 8px;
    flex: 0 0 auto;
  }
  .title {
    margin: 0;
    font-size: var(--font-size);
    font-weight: 600;
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

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
    padding: 0 8px 8px;
    overflow-y: auto;
    /* min-height:0 is required or the flex child refuses to shrink and the
       stack scrolls the whole board instead of itself. */
    min-height: 0;
  }

  .empty {
    margin: 4px 2px;
    font-size: 13px;
    color: var(--text-dim);
    font-style: italic;
  }
</style>
