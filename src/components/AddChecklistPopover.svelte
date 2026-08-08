<script>
  let { title = 'Checkliste', onAdd, onClose, existingChecklists = [] } = $props();

  let checklistTitle = $state(title);
  let copyFrom = $state('(keine)');

  function handleSubmit(e) {
    e.preventDefault();
    if (!checklistTitle.trim()) return;
    onAdd?.({ title: checklistTitle.trim(), copyFrom });
  }
</script>

<div class="popover-backdrop" onclick={onClose} role="presentation">
  <div class="popover" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <div class="popover-header">
      <span class="popover-title">Checkliste hinzufügen</span>
      <button class="close-btn" onclick={onClose} aria-label="Schließen">✕</button>
    </div>

    <form onsubmit={handleSubmit} class="popover-body">
      <label class="input-label" for="checklist-title-input">Titel</label>
      <input
        id="checklist-title-input"
        type="text"
        class="text-input"
        bind:value={checklistTitle}
        placeholder="Checkliste"
        autofocus
      />

      <label class="input-label" for="checklist-copy-select">Elemente kopieren aus...</label>
      <select id="checklist-copy-select" class="select-input" bind:value={copyFrom}>
        <option value="(keine)">(keine)</option>
        {#each existingChecklists as cl}
          <option value={cl.title}>{cl.title}</option>
        {/each}
      </select>

      <div class="popover-actions">
        <button type="submit" class="btn-primary">Hinzufügen</button>
      </div>
    </form>
  </div>
</div>

<style>
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
    width: 300px;
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
    padding: 4px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: #2c333a;
    color: #dee4ea;
  }

  .popover-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .input-label {
    font-size: 12px;
    font-weight: 600;
    color: #9fadbc;
  }

  .text-input, .select-input {
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

  .text-input:focus, .select-input:focus {
    border-color: #579dff;
    box-shadow: 0 0 0 2px rgba(87, 157, 255, 0.2);
  }

  .popover-actions {
    display: flex;
    justify-content: flex-start;
    margin-top: 4px;
  }

  .btn-primary {
    background: #579dff;
    color: #1d2125;
    font-weight: 600;
    font-size: 14px;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-primary:hover {
    background: #85b8ff;
  }
</style>
