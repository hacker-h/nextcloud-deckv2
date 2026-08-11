<script>
  import AssigneePopover from './AssigneePopover.svelte';
  import DatePickerPopover from './DatePickerPopover.svelte';

  let {
    checklist,
    members = [],
    onUpdateChecklist,
    onDeleteChecklist
  } = $props();

  let hideChecked = $state(false);
  let isAddingItem = $state(false);
  let newItemText = $state('');
  let newItemAssignee = $state(null);
  let newItemDueDate = $state(null);

  let showDeleteConfirm = $state(false);

  function focusOnMount(node) {
    node.focus();
  }

  function closeDeleteFromBackdrop(event) {
    if (event.target === event.currentTarget) showDeleteConfirm = false;
  }

  // Popover state for existing items
  let activePopover = $state(null); // { type: 'assignee'|'date', itemId: string }

  let totalItems = $derived(checklist.items.length);
  let doneItems = $derived(checklist.items.filter((i) => i.done).length);
  let progressPercent = $derived(
    totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0
  );

  let visibleItems = $derived(
    hideChecked ? checklist.items.filter((i) => !i.done) : checklist.items
  );

  function toggleItem(item) {
    const updatedItems = checklist.items.map((i) =>
      i.id === item.id ? { ...i, done: !i.done } : i
    );
    onUpdateChecklist?.({ ...checklist, items: updatedItems });
  }

  function handleAddItem(e) {
    e.preventDefault();
    if (!newItemText.trim()) return;

    const newItem = {
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      text: newItemText.trim(),
      done: false,
      assignee: newItemAssignee,
      duedate: newItemDueDate
    };

    onUpdateChecklist?.({ ...checklist, items: [...checklist.items, newItem] });
    newItemText = '';
    // Keep focus and stay open for fast bulk creation!
  }

  function deleteItem(itemId) {
    const updatedItems = checklist.items.filter((i) => i.id !== itemId);
    onUpdateChecklist?.({ ...checklist, items: updatedItems });
  }

  function setItemAssignee(itemId, assignee) {
    const updatedItems = checklist.items.map((i) =>
      i.id === itemId ? { ...i, assignee } : i
    );
    onUpdateChecklist?.({ ...checklist, items: updatedItems });
    activePopover = null;
  }

  function setItemDueDate(itemId, duedate) {
    const updatedItems = checklist.items.map((i) =>
      i.id === itemId ? { ...i, duedate } : i
    );
    onUpdateChecklist?.({ ...checklist, items: updatedItems });
    activePopover = null;
  }

  function formatDueDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
    return `${d.getDate()}. ${months[d.getMonth()]}`;
  }

  function getDueDateClass(item) {
    if (item.done) return 'badge-green';
    if (!item.duedate) return 'badge-gray';
    const now = new Date();
    const due = new Date(item.duedate);
    if (due < now) return 'badge-red';
    return 'badge-gray';
  }
</script>

<div class="checklist-container">
  <!-- Checklist Header -->
  <div class="checklist-header">
    <div class="title-row">
      <span class="header-icon">☑</span>
      <h4 class="checklist-title">{checklist.title || 'Checkliste'}</h4>
    </div>

    <div class="header-actions">
      {#if doneItems > 0}
        <button
          class="btn-toggle-checked"
          onclick={() => (hideChecked = !hideChecked)}
        >
          {hideChecked ? 'Erledigte Elemente anzeigen' : 'Ausgewählte Elemente ausblenden'}
        </button>
      {/if}

      <button class="btn-delete" onclick={() => (showDeleteConfirm = true)}>
        Löschen
      </button>
    </div>
  </div>

  <!-- Delete Confirm Popover -->
  {#if showDeleteConfirm}
    <div class="popover-backdrop" onclick={closeDeleteFromBackdrop} role="presentation">
      <div class="popover" role="alertdialog" tabindex="-1" aria-modal="true" aria-label="Checkliste löschen">
        <div class="popover-header">
          <span class="popover-title">Checkliste löschen?</span>
          <button class="close-btn" onclick={() => (showDeleteConfirm = false)}>✕</button>
        </div>
        <div class="popover-body">
          <p class="delete-warning">
            Das Löschen einer Checkliste ist endgültig und kann nicht rückgängig gemacht werden.
          </p>
          <button
            class="btn-confirm-delete"
            onclick={() => {
              showDeleteConfirm = false;
              onDeleteChecklist?.(checklist.id);
            }}
          >
            Checkliste löschen
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Progress Bar -->
  <div class="progress-section">
    <span class="progress-text">{progressPercent}%</span>
    <div class="progress-bar-track">
      <div
        class="progress-bar-fill {progressPercent === 100 ? 'complete' : ''}"
        style="width: {progressPercent}%;"
      ></div>
    </div>
  </div>

  <!-- Items List -->
  <div class="items-list">
    {#each visibleItems as item (item.id)}
      <div class="item-row {item.done ? 'done' : ''}">
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={item.done}
            onchange={() => toggleItem(item)}
          />
          <span class="checkbox-custom"></span>
        </label>

        <span class="item-text">{item.text}</span>

        <!-- Item Badges / Actions -->
        <div class="item-badges">
          {#if item.duedate}
            <button
              class="due-badge {getDueDateClass(item)}"
              onclick={() => (activePopover = { type: 'date', itemId: item.id })}
            >
              🕒 {formatDueDate(item.duedate)}
            </button>
          {:else}
            <button
              class="badge-icon-btn"
              title="Frist hinzufügen"
              onclick={() => (activePopover = { type: 'date', itemId: item.id })}
            >
              🕒
            </button>
          {/if}

          {#if item.assignee}
            <button
              class="avatar-badge"
              title="Zugewiesen: {item.assignee}"
              onclick={() => (activePopover = { type: 'assignee', itemId: item.id })}
            >
              {item.assignee.slice(0, 2).toUpperCase()}
            </button>
          {:else}
            <button
              class="badge-icon-btn"
              title="Zuweisen"
              onclick={() => (activePopover = { type: 'assignee', itemId: item.id })}
            >
              👤+
            </button>
          {/if}

          <button
            class="badge-icon-btn item-menu-btn"
            title="Löschen"
            onclick={() => deleteItem(item.id)}
          >
            •••
          </button>
        </div>
      </div>
    {/each}
  </div>

  <!-- Item Composer -->
  {#if isAddingItem}
    <form class="item-composer" onsubmit={handleAddItem}>
      <input
        type="text"
        class="composer-input"
        placeholder="Element hinzufügen"
        bind:value={newItemText}
        use:focusOnMount
      />

      <div class="composer-actions">
        <button type="submit" class="btn-primary">Hinzufügen</button>
        <button
          type="button"
          class="btn-cancel"
          onclick={() => {
            isAddingItem = false;
            newItemText = '';
          }}
        >
          Abbrechen
        </button>

        <div class="composer-meta-actions">
          <button
            type="button"
            class="meta-btn {newItemAssignee ? 'active' : ''}"
            onclick={() => (activePopover = { type: 'assignee', itemId: 'new' })}
          >
            👤 Zuweisen {newItemAssignee ? `(${newItemAssignee})` : ''}
          </button>

          <button
            type="button"
            class="meta-btn {newItemDueDate ? 'active' : ''}"
            onclick={() => (activePopover = { type: 'date', itemId: 'new' })}
          >
            🕒 Frist {newItemDueDate ? `(${formatDueDate(newItemDueDate)})` : ''}
          </button>
        </div>
      </div>
    </form>
  {:else}
    <button class="btn-add-item" onclick={() => (isAddingItem = true)}>
      Element hinzufügen
    </button>
  {/if}

  <!-- Active Popovers for Assignee / Date -->
  {#if activePopover?.type === 'assignee'}
    <AssigneePopover
      {members}
      currentAssignee={
        activePopover.itemId === 'new'
          ? newItemAssignee
          : checklist.items.find((i) => i.id === activePopover.itemId)?.assignee
      }
      onSelect={(user) => {
        if (activePopover.itemId === 'new') {
          newItemAssignee = user;
          activePopover = null;
        } else {
          setItemAssignee(activePopover.itemId, user);
        }
      }}
      onClose={() => (activePopover = null)}
    />
  {/if}

  {#if activePopover?.type === 'date'}
    <DatePickerPopover
      currentDate={
        activePopover.itemId === 'new'
          ? newItemDueDate
          : checklist.items.find((i) => i.id === activePopover.itemId)?.duedate
      }
      onSave={({ duedate }) => {
        if (activePopover.itemId === 'new') {
          newItemDueDate = duedate;
          activePopover = null;
        } else {
          setItemDueDate(activePopover.itemId, duedate);
        }
      }}
      onRemove={() => {
        if (activePopover.itemId === 'new') {
          newItemDueDate = null;
          activePopover = null;
        } else {
          setItemDueDate(activePopover.itemId, null);
        }
      }}
      onClose={() => (activePopover = null)}
    />
  {/if}
</div>

<style>
  .checklist-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
    background: #282e33;
    padding: 12px;
    border-radius: 8px;
  }

  .checklist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-icon {
    font-size: 16px;
    color: #9fadbc;
  }

  .checklist-title {
    font-size: 16px;
    font-weight: 600;
    color: #dee4ea;
    margin: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-toggle-checked, .btn-delete {
    background: #2c333a;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 4px 10px;
    color: #b6c2cf;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-toggle-checked:hover, .btn-delete:hover {
    background: #3c444c;
    color: #dee4ea;
  }

  .progress-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .progress-text {
    font-size: 11px;
    color: #9fadbc;
    font-weight: 600;
    width: 28px;
  }

  .progress-bar-track {
    flex: 1;
    height: 8px;
    background: #3a4047;
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: #579dff;
    border-radius: 4px;
    transition: width 0.3s ease, background 0.3s ease;
  }

  .progress-bar-fill.complete {
    background: #4bce97;
  }

  .items-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    background: transparent;
    transition: background 0.15s ease;
  }

  .item-row:hover {
    background: #2c333a;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .checkbox-label input {
    display: none;
  }

  .checkbox-custom {
    width: 16px;
    height: 16px;
    border: 2px solid #8c9bab;
    border-radius: 4px;
    display: inline-block;
    position: relative;
  }

  .checkbox-label input:checked + .checkbox-custom {
    background: #579dff;
    border-color: #579dff;
  }

  .checkbox-label input:checked + .checkbox-custom::after {
    content: '✓';
    position: absolute;
    top: -2px;
    left: 2px;
    color: #1d2125;
    font-size: 12px;
    font-weight: bold;
  }

  .item-text {
    flex: 1;
    font-size: 14px;
    color: #dee4ea;
  }

  .item-row.done .item-text {
    text-decoration: line-through;
    color: #8c9bab;
  }

  .item-badges {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .due-badge {
    border: none;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .badge-gray {
    background: #2c333a;
    color: #b6c2cf;
  }

  .badge-green {
    background: #1f845a;
    color: #ffffff;
  }

  .badge-red {
    background: #c9372c;
    color: #ffffff;
  }

  .avatar-badge {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #e2b203;
    color: #1d2125;
    font-size: 10px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .badge-icon-btn {
    background: transparent;
    border: none;
    color: #9fadbc;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
  }

  .badge-icon-btn:hover {
    background: #3c444c;
    color: #dee4ea;
  }

  .item-composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .composer-input {
    width: 100%;
    background: #1d2125;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 8px 10px;
    color: #dee4ea;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
  }

  .composer-input:focus {
    border-color: #579dff;
  }

  .composer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-primary {
    background: #579dff;
    color: #1d2125;
    font-weight: 600;
    font-size: 13px;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    cursor: pointer;
  }

  .btn-cancel {
    background: transparent;
    color: #9fadbc;
    font-size: 13px;
    border: none;
    cursor: pointer;
  }

  .btn-cancel:hover {
    color: #dee4ea;
  }

  .composer-meta-actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }

  .meta-btn {
    background: #2c333a;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 4px 8px;
    color: #b6c2cf;
    font-size: 12px;
    cursor: pointer;
  }

  .meta-btn.active {
    background: rgba(87, 157, 255, 0.2);
    border-color: #579dff;
    color: #579dff;
  }

  .btn-add-item {
    align-self: flex-start;
    background: #2c333a;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 6px 12px;
    color: #dee4ea;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-add-item:hover {
    background: #3c444c;
  }

  /* Popover styles */
  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
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
  }

  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #2c333a;
  }

  .popover-title {
    font-size: 13px;
    font-weight: 600;
    color: #dee4ea;
  }

  .close-btn {
    background: none;
    border: none;
    color: #9fadbc;
    font-size: 14px;
    cursor: pointer;
  }

  .popover-body {
    padding: 12px;
  }

  .delete-warning {
    font-size: 13px;
    color: #b6c2cf;
    margin-bottom: 12px;
  }

  .btn-confirm-delete {
    width: 100%;
    background: #c9372c;
    color: #ffffff;
    font-weight: 600;
    font-size: 13px;
    border: none;
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
  }
</style>
