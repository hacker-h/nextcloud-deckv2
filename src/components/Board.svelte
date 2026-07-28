<script>
  import Stack from './Stack.svelte';
  let { stacks, boardId, client } = $props();
</script>

<div class="board">
  {#each stacks as stack (stack.id)}
    <Stack {stack} cardUrl={(cardId) => client.cardUrl(boardId, cardId)} />
  {/each}
</div>

<style>
  .board {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    height: 100%;
    padding: 12px;
    overflow-x: auto;
    overflow-y: hidden;
  }
  /* Stacks size to content but never exceed the viewport; each scrolls
     internally past that. Full-height stacks would leave large empty wells
     under short lists. */
  .board > :global(.stack) { max-height: 100%; }
</style>
