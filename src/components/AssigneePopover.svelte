<script>
  let { members = [], currentAssignee = null, onSelect, onClose } = $props();
  let searchQuery = $state('');

  function focusOnMount(node) {
    node.focus();
  }

  function closeFromBackdrop(event) {
    if (event.target === event.currentTarget) onClose?.();
  }

  let filteredMembers = $derived(
    members.filter((m) => {
      const q = searchQuery.toLowerCase();
      return (
        (m.displayname || m.uid || '').toLowerCase().includes(q) ||
        (m.uid || '').toLowerCase().includes(q)
      );
    })
  );
</script>

<div class="popover-backdrop" onclick={closeFromBackdrop} role="presentation">
  <div class="popover" role="dialog" tabindex="-1" aria-modal="true" aria-label="Zuweisen">
    <div class="popover-header">
      <span class="popover-title">Zuweisen</span>
      <button class="close-btn" onclick={onClose} aria-label="Schließen">✕</button>
    </div>

    <div class="popover-body">
      <input
        type="text"
        class="search-input"
        placeholder="Nach Benutzern suchen"
        bind:value={searchQuery}
        use:focusOnMount
      />

      <div class="section-title">Board-Mitglieder</div>

      <div class="member-list">
        {#each filteredMembers as member}
          {@const isAssigned = currentAssignee === (member.uid || member.displayname)}
          <button
            class="member-item {isAssigned ? 'selected' : ''}"
            onclick={() => onSelect?.(isAssigned ? null : member.uid || member.displayname)}
          >
            <div class="avatar">
              {(member.displayname || member.uid || 'U').slice(0, 2).toUpperCase()}
            </div>
            <span class="member-name">{member.displayname || member.uid}</span>
            {#if isAssigned}
              <span class="check-icon">✓</span>
            {/if}
          </button>
        {:else}
          <div class="empty-state">Keine Mitglieder gefunden</div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1300;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
  }

  .popover {
    width: 280px;
    background: #22272b;
    border: 1px solid #3c444c;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    color: #b6c2cf;
    overflow: hidden;
  }

  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #2c333a;
  }

  .popover-title {
    font-size: 14px;
    font-weight: 600;
    color: #dee4ea;
  }

  .close-btn {
    background: none;
    border: none;
    color: #9fadbc;
    font-size: 16px;
    cursor: pointer;
  }

  .popover-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .search-input {
    width: 100%;
    background: #1d2125;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 8px 10px;
    color: #dee4ea;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: #579dff;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: #9fadbc;
    margin-top: 4px;
  }

  .member-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
  }

  .member-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: #dee4ea;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }

  .member-item:hover {
    background: #2c333a;
  }

  .member-item.selected {
    background: rgba(87, 157, 255, 0.15);
  }

  .avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #e2b203;
    color: #1d2125;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .member-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .check-icon {
    color: #579dff;
    font-size: 14px;
    font-weight: bold;
  }

  .empty-state {
    font-size: 12px;
    color: #8c9bab;
    padding: 8px 0;
    text-align: center;
  }
</style>
