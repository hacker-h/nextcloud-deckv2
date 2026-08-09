<script>
  import Toast from './Toast.svelte';
  import { clearExternalDrop } from '../lib/dnd.svelte.js';

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
  // Counts enter/leave pairs so crossing into a child element does not read as
  // leaving the modal. Never declared before, so every dragenter into the modal
  // threw ReferenceError and the drop handler never ran: dropping onto an open
  // card detail was broken outright, not merely mis-styled.
  let dragDepth = 0;

  const titleId = 'card-detail-title';

  // Captured at creation rather than at close time: by then focus has already
  // moved into the dialog, so activeElement would name a node about to vanish.
  const opener = typeof document === 'undefined' ? null : document.activeElement;

  $effect(() => {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    // A card lit by a drag that was still in flight when this modal opened will
    // never receive another drag event, so it can only be cleared from here.
    // The reported screenshot was exactly this: blue overlays frozen behind an
    // open card detail. Cleared on close too, since the modal swallowed every
    // drag event the board would otherwise have used to correct itself.
    clearExternalDrop();

    const first = dialog?.querySelector(FOCUSABLE);
    if (first) first.focus();
    else dialog?.focus();

    return () => {
      body.style.overflow = previousOverflow;
      clearExternalDrop();
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
      toast = { status: 'uploading', message: 'Link anhängen' };
      try {
        await onAttachLink(pastedText);
        toast = { status: 'success', message: 'Erfolgreich' };
      } catch (err) {
        toast = { status: 'error', message: err?.message ?? 'Link konnte nicht angehängt werden' };
      }
    }
  }

  function detectDragType(dt) {
    if (!dt) return 'file';
    const types = Array.from(dt.types || []);
    if (types.includes('text/uri-list')) return 'link';
    if ((types.includes('text/plain') || types.includes('text/html')) && !types.includes('Files')) {
      return 'link';
    }
    if (types.includes('Files')) return 'file';
    return 'link';
  }

  function onModalDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    // The board's cards claim ownership of the external-drop overlay on their
    // own dragover. stopPropagation is not enough to stop them: a card may
    // already be claiming from before this modal opened, and nothing would ever
    // clear it. Claiming "no card" on every modal dragover keeps the invariant
    // in one place instead of relying on event ordering.
    clearExternalDrop();
    isDraggingOver = true;
  }

  function onModalDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer;
    if (!dt) return;

    clearExternalDrop();
    dragDepth += 1;
    dragType = detectDragType(dt);
    isDraggingOver = true;
  }

  function onModalDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      isDraggingOver = false;
    }
  }

  async function onModalDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    isDraggingOver = false;

    const dt = e.dataTransfer;
    if (!dt) return;

    const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (uri && /^https?:\/\/[^\s]+$/i.test(uri.trim()) && onAttachLink) {
      toast = { status: 'uploading', message: 'Link anhängen' };
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
      toast = { status: 'uploading', message: 'Datei wird hochgeladen...' };
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
    /* Above BottomNav's dock (45). At 40 the nav floated over the open card and
       covered the comment composer, so a modal that is meant to be exclusive
       had another control painted on top of it. */
    z-index: 50;
    display: flex;
    justify-content: center;
    /* Trello anchors the card dialog near the top rather than centring it, so
       long cards grow downward instead of jumping as content loads. */
    align-items: flex-start;
    padding: 48px 16px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
  }

  .dialog {
    width: 100%;
    max-width: 768px;
    background: #282e33;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65);
    color: #b6c2cf;
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
    background: #0f172a; /* 100% OPAQUE SOLID DARK BACKGROUND */
    border: 2px dashed #0057d7;
    border-radius: var(--modal-radius, 12px);
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
