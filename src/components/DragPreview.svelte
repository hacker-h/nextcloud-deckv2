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
    {#if drag.count > 1}
      <span class="stacked stacked-2" aria-hidden="true"></span>
      <span class="stacked stacked-1" aria-hidden="true"></span>
    {/if}
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
  .inner { min-height: 36px; padding: 8px 12px; position: relative; z-index: 2; }

  /* Peeking edges behind the primary card, so a multi-card drag reads as a
     stack rather than a single tile with a number attached. */
  .stacked {
    position: absolute;
    inset: 0;
    border-radius: var(--card-radius);
    background: var(--card-bg);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 6%);
  }
  .stacked-1 { transform: translate(3px, 3px); z-index: 1; }
  .stacked-2 { transform: translate(6px, 6px); z-index: 0; opacity: .7; }
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
