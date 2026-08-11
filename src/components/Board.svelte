<script>
  import Stack from './Stack.svelte';
  import DragPreview from './DragPreview.svelte';

  let { stacks, boardId, client, onDrop, onOpenCard, onSelect, selectedIds = [], dragIds, onClearSelection, onUploadAttachment, onAttachLink } = $props();
</script>

<!-- Clicking empty board space clears the selection (PLAN.md §6). The handler
  sits on the board rather than the window so a click inside a modal or the
  topbar does not silently drop a selection the user is still building. -->
<svelte:document onkeydown={(e) => e.key === 'Escape' && onClearSelection?.()} />

<div
  class="board"
  data-board
  role="region"
  aria-label="Kanban-Board"
  onpointerdown={(e) => e.target === e.currentTarget && onClearSelection?.()}
>
  {#each stacks as stack (stack.id)}
    <Stack {stack} {onDrop} {onOpenCard} {onSelect} {selectedIds} {dragIds} {onUploadAttachment} {onAttachLink} />
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
