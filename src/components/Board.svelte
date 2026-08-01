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
  /* Trello sizes a lane to its cards, so a short list stays short. The empty
     space below it is still a drop target - that is handled by hit-testing in
     dnd.svelte.js, deliberately not by stretching the visible lane. */
  .board > :global(.stack) { max-height: 100%; }
</style>
