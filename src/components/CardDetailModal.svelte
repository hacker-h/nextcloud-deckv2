<script>
  import Toast from './Toast.svelte';

  let {
    card = null,
    loading = false,
    error = null,
    dirty = false,
    onClose,
    onRetry,
    onSave,
    onDiscard,
    onUploadAttachment,
    onAttachLink,
    main,
    sidebar,
  } = $props();

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let dialog = $state(null);
  let confirming = $state(false);
  let toast = $state(null);
  let isDraggingOver = $state(false);
  let dragType = $state('file');

  const titleId = 'card-detail-title';

  // Captured at creation rather than at close time: by then focus has already
  // moved into the dialog, so activeElement would name a node about to vanish.
  const opener = typeof document === 'undefined' ? null : document.activeElement;

  $effect(() => {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    const first = dialog?.querySelector(FOCUSABLE);
    if (first) first.focus();
    else dialog?.focus();

    return () => {
      body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  });

  function requestClose() {
    if (dirty) {
      confirming = true;
      return;
    }
    onClose?.();
  }

  function focusables() {
    return [...(dialog?.querySelectorAll(FOCUSABLE) ?? [])];
  }

  // A native <dialog> would trap focus for free, but it renders in the top
  // layer, which breaks the board's stacking context and backdrop gradient.
  function trapTab(e) {
    const items = focusables();
    if (!items.length) {
      e.preventDefault();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (e.shiftKey && (active === first || !dialog.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key === 'Tab') trapTab(e);
  }

  async function handlePaste(e) {
    if (!onUploadAttachment && !onAttachLink) return;

    // Check for file items first
    const items = e.clipboardData?.items;
    let fileToUpload = null;
    if (items) {
      for (const item of items) {
        if (item.kind === 'file') {
          fileToUpload = item.getAsFile();
          break;
        }
      }
    }

    if (fileToUpload) {
      e.preventDefault();
      let file = fileToUpload;
      if (!file.name || file.name === 'image.png') {
        const ext = (file.type.split('/')[1] || 'png').replace('+xml', '');
        file = new File([fileToUpload], `pasted-image-${Date.now()}.${ext}`, { type: fileToUpload.type });
      }

      toast = { status: 'uploading', message: 'Datei wird hochgeladen ...' };
      try {
        await onUploadAttachment?.(file);
        toast = { status: 'success', message: 'Erfolgreich' };
      } catch (err) {
        toast = { status: 'error', message: err?.message ?? 'Upload fehlgeschlagen' };
      }
      return;
    }

    // Check for text URL paste
    const active = document.activeElement;
    const isTextInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

    const pastedText = e.clipboardData?.getData('text/plain')?.trim();
    if (pastedText && /^https?:\/\/[^\s]+$/i.test(pastedText) && !isTextInput && onAttachLink) {
      e.preventDefault();
      toast = { status: 'uploading', message: 'Link anhängen ...' };
      try {
        await onAttachLink(pastedText);
        toast = { status: 'success', message: 'Erfolgreich' };
      } catch (err) {
        toast = { status: 'error', message: err?.message ?? 'Link konnte nicht angehängt werden' };
      }
    }
  }

  function onModalDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    isDraggingOver = true;
  }

  function onModalDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer;
    if (dt?.types?.includes('text/uri-list') || dt?.types?.includes('text/plain')) {
      dragType = 'link';
    } else {
      dragType = 'file';
    }
    isDraggingOver = true;
  }

  function onModalDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.target === e.currentTarget || !e.relatedTarget) {
      isDraggingOver = false;
    }
  }

  async function onModalDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    isDraggingOver = false;

    const dt = e.dataTransfer;
    if (!dt) return;

    const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (uri && /^https?:\/\/[^\s]+$/i.test(uri.trim()) && onAttachLink) {
      toast = { status: 'uploading', message: 'Link anhängen ...' };
      try {
        await onAttachLink(uri.trim());
        toast = { status: 'success', message: 'Erfolgreich' };
      } catch (err) {
        toast = { status: 'error', message: err?.message ?? 'Link konnte nicht angehängt werden' };
      }
      return;
    }

    const file = dt.files?.[0];
    if (file && onUploadAttachment) {
      toast = { status: 'uploading', message: 'Datei wird hochgeladen ...' };
      try {
        await onUploadAttachment(file);
        toast = { status: 'success', message: 'Erfolgreich' };
      } catch (err) {
        toast = { status: 'error', message: err?.message ?? 'Upload fehlgeschlagen' };
      }
    }
  }

  function onBackdrop(e) {
    if (e.target === e.currentTarget) requestClose();
  }

  async function saveAndClose() {
    await onSave?.();
    confirming = false;
    onClose?.();
  }

  function discardAndClose() {
    confirming = false;
    onDiscard?.();
    onClose?.();
  }
</script>

<svelte:window onkeydown={onKeydown} onpaste={handlePaste} />

<div
  class="backdrop"
  role="presentation"
  onpointerdown={onBackdrop}
  ondragenter={onModalDragEnter}
  ondragover={onModalDragOver}
  ondragleave={onModalDragLeave}
  ondrop={onModalDrop}
>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-busy={loading}
    tabindex="-1"
    bind:this={dialog}
  >
    {#if isDraggingOver}
      <div class="drop-overlay" role="presentation">
        <div class="drop-box">
          <svg viewBox="0 0 16 16" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11"/>
          </svg>
          <span>{dragType === 'link' ? 'Link anhängen' : 'Dateien für Upload ablegen.'}</span>
        </div>
      </div>
    {/if}
    <header class="head">
      <h2 class="title" id={titleId}>{card?.title ?? 'Card'}</h2>
      <button class="icon" type="button" onclick={requestClose} aria-label="Kartendetails schließen">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </header>

    {#if loading}
      <div class="body" data-testid="detail-skeleton">
        <div class="skeleton line wide"></div>
        <div class="skeleton line"></div>
        <div class="skeleton block"></div>
      </div>
    {:else if error}
      <div class="body error" role="alert">
        <p class="message">{error}</p>
        <button class="btn primary" type="button" onclick={() => onRetry?.()}>Erneut versuchen</button>
      </div>
    {:else}
      <div class="body columns">
        <div class="col main">{@render main?.()}</div>
        <aside class="col side">{@render sidebar?.()}</aside>
      </div>
    {/if}

    {#if confirming}
      <div class="confirm" role="alertdialog" aria-label="Ungespeicherte Änderungen">
        <p class="message">Sie haben ungespeicherte Änderungen.</p>
        <div class="actions">
          <button class="btn primary" type="button" onclick={saveAndClose}>Speichern</button>
          <button class="btn danger" type="button" onclick={discardAndClose}>Verwerfen</button>
          <button class="btn" type="button" onclick={() => (confirming = false)}>Weiter bearbeiten</button>
        </div>
      </div>
    {/if}
  </div>
</div>

{#if toast}
  <Toast status={toast.status} message={toast.message} onClose={() => (toast = null)} />
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    justify-content: center;
    /* Trello anchors the card dialog near the top rather than centring it, so
       long cards grow downward instead of jumping as content loads. */
    align-items: flex-start;
    padding: 48px 16px;
    overflow-y: auto;
    background: #0e0f1180;
  }

  .dialog {
    width: 100%;
    max-width: 768px;
    background: var(--card-bg);
    border-radius: var(--stack-radius);
    box-shadow: 0 8px 24px #01040466, 0 0 0 1px var(--border);
    color: var(--text);
    outline: none;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 16px 16px 8px;
  }

  .title {
    flex: 1;
    margin: 0;
    font-size: 18px;
    line-height: 24px;
    word-break: break-word;
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
  }
  .icon:hover { background: var(--card-bg-hover); color: var(--text); }

  .body { padding: 8px 16px 16px; }

  .columns { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 640px) {
    .columns { grid-template-columns: minmax(0, 1fr) 200px; }
  }
  .col { min-width: 0; }

  .error { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
  .message { margin: 0; color: var(--text-dim); }

  .btn {
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: #a1bdd914;
    color: var(--text);
    cursor: pointer;
  }
  .btn:hover { background: #a1bdd925; }
  .primary { background: var(--accent); color: #1d2125; }
  .danger { background: var(--danger); color: #1d2125; }

  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.85);
    border: 2px dashed #005fcc;
    border-radius: var(--modal-radius, 12px);
    backdrop-filter: blur(4px);
    pointer-events: none;
  }

  .drop-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #ffffff;
    font-size: 16px;
    font-weight: 600;
  }

  .actions { display: flex; flex-wrap: wrap; gap: 8px; }

  .skeleton { background: #a1bdd914; border-radius: 6px; }
  .line { height: 14px; margin-bottom: 10px; }
  .wide { width: 70%; }
  .block { height: 96px; }
</style>
