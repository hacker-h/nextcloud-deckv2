<script>
  import { drag } from '../lib/dnd.svelte.js';
</script>

{#if drag.active && drag.card}
  <!-- Follows the cursor. pointer-events:none is essential, otherwise
       elementsFromPoint hit-tests the preview instead of the stack underneath. -->
  <div
    class="preview"
    style="
      width:{drag.w}px;
      transform: translate3d({drag.x - drag.grabX}px, {drag.y - drag.grabY}px, 0) rotate(3deg);
    "
  >
    <div class="inner">
      <span class="title">{drag.card.title}</span>
    </div>
    {#if drag.count > 1}
      <span class="count">{drag.count}</span>
    {/if}
  </div>
{/if}

<style>
  .preview {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    pointer-events: none;
    background: var(--card-bg);
    border-radius: var(--card-radius);
    /* Trello lifts the dragged card with a heavier shadow and a slight tilt. */
    box-shadow: 0 12px 24px -6px rgba(0, 0, 0, .64), 0 0 0 1px rgba(255, 255, 255, .06);
    color: var(--text);
    will-change: transform;
  }
  .inner { min-height: 36px; padding: 8px 12px; }
  .title {
    display: block;
    font-size: var(--font-size);
    line-height: var(--line-height);
    word-break: break-word;
  }
  .count {
    position: absolute;
    top: -8px;
    right: -8px;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    background: var(--accent);
    color: #1D2125;
    font-size: 12px;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
  }
</style>
