<script>
  let { src, title = 'Bildvorschau', onClose } = $props();
  let dialog;

  $effect(() => {
    dialog?.focus();
  });

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose?.();
    }
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  }
</script>

<div
  bind:this={dialog}
  class="backdrop"
  role="dialog"
  tabindex="-1"
  aria-modal="true"
  aria-label={title}
  onclick={handleBackdrop}
  onkeydown={onKeydown}
>
  <div class="container">
    <header class="bar">
      <span class="title">{title}</span>
      <button class="close" type="button" onclick={() => onClose?.()} aria-label="Schließen">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </header>
    <div class="image-wrapper">
      <img {src} alt={title} class="lightbox-img" />
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(6px);
  }

  .container {
    display: flex;
    flex-direction: column;
    max-width: 90vw;
    max-height: 90vh;
    background: #1e2227;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: #181b1f;
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .close:hover {
    background: var(--card-bg-hover);
    color: var(--text);
  }

  .image-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    overflow: auto;
  }

  .lightbox-img {
    max-width: 100%;
    max-height: calc(85vh - 60px);
    object-fit: contain;
    border-radius: 6px;
  }
</style>
