<script>
  let { status = 'uploading', message = 'Datei wird hochgeladen ...', onClose } = $props();

  $effect(() => {
    if (status === 'success') {
      const t = setTimeout(() => {
        onClose?.();
      }, 3000);
      return () => clearTimeout(t);
    }
  });
</script>

<div class="toast" class:success={status === 'success'} class:error={status === 'error'} role="status" aria-live="polite">
  <div class="icon">
    {#if status === 'uploading'}
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 7.5v4M8 4.8h.01" stroke-linecap="round" />
      </svg>
    {:else if status === 'success'}
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#4bce97" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" stroke="#4bce97" stroke-width="1.5" fill="none" />
        <path d="M5.2 8.2l2 2 3.8-4" />
      </svg>
    {:else}
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="var(--danger)" stroke-width="1.8" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 5v4M8 11.2h.01" stroke-linecap="round" />
      </svg>
    {/if}
  </div>

  <span class="message">{message}</span>

  <button class="close" type="button" onclick={() => onClose?.()} aria-label="Schließen">
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  </button>
</div>

<style>
  .toast {
    position: fixed;
    bottom: 24px;
    left: 24px;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 240px;
    padding: 10px 14px;
    background: #282e33;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    font-size: 13px;
    font-weight: 500;
    line-height: 18px;
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    color: #cecfd2;
  }

  .message {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .close:hover {
    background: var(--card-bg-hover);
    color: var(--text);
  }
</style>
