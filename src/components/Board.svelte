<script>
  import Stack from './Stack.svelte';
  import DragPreview from './DragPreview.svelte';

  let { stacks, boardId, client, onDrop, onOpenCard } = $props();
</script>

<div class="board" data-board>
  {#each stacks as stack (stack.id)}
    <Stack {stack} {onDrop} {onOpenCard} />
  {/each}
</div>

<DragPreview />

<style>
  .board {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    height: 100%;
    /* Trello: board padding 0 6px; vertical breathing room added here since
       our top bar sits directly above. */
    padding: 8px 6px;
    overflow-x: auto;
    overflow-y: hidden;
  }
  /* Lanes run the full height so the empty space under a short list is still
     that lane's drop target; each scrolls internally once its cards overflow. */
  .board > :global(.stack) { height: 100%; max-height: 100%; }
</style>
