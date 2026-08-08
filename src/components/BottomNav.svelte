<script>
  let { inboxOpen = false, switcherOpen = false, onInbox, onSwitchBoards } = $props();
</script>

<nav class="dock" aria-label="Views">
  <button
    class="tab"
    class:active={inboxOpen}
    type="button"
    aria-pressed={inboxOpen}
    onclick={() => onInbox?.()}
  >
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="1.9" y="2.6" width="12.2" height="10.8" rx="2"/>
      <path d="M1.9 9.4h3.2l.9 1.6h4l.9-1.6h3.2"/>
    </svg>
    Posteingang
  </button>

  <button class="tab" type="button" disabled title="Planer erscheint mit Kalender-Synchronisation">
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2.2" y="3.2" width="11.6" height="10.6" rx="2"/>
      <path d="M2.2 6.6h11.6M5.4 1.9v2.6M10.6 1.9v2.6"/>
    </svg>
    Planer
  </button>

  <button class="tab active" type="button" aria-pressed="true">
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="2"/>
      <path d="M6.2 2.8v10.4M9.8 2.8v10.4"/>
    </svg>
    Board
  </button>

  <span class="sep" aria-hidden="true"></span>

  <button
    class="tab"
    type="button"
    aria-haspopup="menu"
    aria-expanded={switcherOpen}
    onclick={() => onSwitchBoards?.()}
  >
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="1.6" y="4.2" width="8.6" height="8" rx="1.8"/>
      <path d="M5.4 4.2V3a1.4 1.4 0 0 1 1.4-1.4h6.2A1.4 1.4 0 0 1 14.4 3v6.2a1.4 1.4 0 0 1-1.4 1.4h-1.2"/>
    </svg>
    Boards wechseln
  </button>
</nav>

<style>
  .dock {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 45;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px;
    background: #1F2023F2;
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 12px;
    box-shadow: 0 10px 28px rgb(0 0 0 / 48%);
    backdrop-filter: blur(8px);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: none;
    border: 0;
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 20px;
    white-space: nowrap;
    cursor: pointer;
  }
  .tab:hover:not(:disabled) { background: #A1BDD914; color: var(--text); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tab:disabled { opacity: .45; cursor: default; }

  /* Trello marks the live view with a tinted pill and an underline stub. */
  .tab.active {
    position: relative;
    background: var(--selected-bg);
    color: var(--accent);
  }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 18px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    transform: translateX(-50%);
  }

  .sep {
    width: 1px;
    height: 22px;
    margin: 0 4px;
    background: rgb(255 255 255 / 12%);
  }
</style>
