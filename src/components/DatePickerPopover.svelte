<script>
  let { currentDate = '', currentTime = '', onSave, onRemove, onClose } = $props();

  let dateValue = $state(currentDate || new Date().toISOString().slice(0, 10));
  // Reopening the picker on a card that already has a due time must show that
  // time, not reset it to noon and silently move the deadline on save.
  let timeValue = $state(currentTime || '12:00');
  let reminder = $state('Keine');

  function handleSave(e) {
    e.preventDefault();
    onSave?.({ duedate: dateValue, time: timeValue, reminder });
  }
</script>

<div class="popover-backdrop" onclick={onClose} role="presentation">
  <div
    class="popover"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-label="Fälligkeitsdatum ändern"
  >
    <div class="popover-header">
      <span class="popover-title">Fälligkeitsdatum ändern</span>
      <button class="close-btn" onclick={onClose} aria-label="Schließen">✕</button>
    </div>

    <form onsubmit={handleSave} class="popover-body">
      <label class="input-label" for="popover-date-input">Fälligkeitsdatum</label>
      <div class="date-time-row">
        <input
          id="popover-date-input"
          type="date"
          class="date-input"
          bind:value={dateValue}
        />
        <input
          type="time"
          class="time-input"
          aria-label="Uhrzeit"
          bind:value={timeValue}
        />
      </div>

      <label class="input-label" for="popover-reminder-select">Erinnerung aktivieren</label>
      <select id="popover-reminder-select" class="select-input" bind:value={reminder}>
        <option value="Keine">Keine</option>
        <option value="Zum Zeitpunkt des Fälligkeitsdatums">Zum Zeitpunkt des Fälligkeitsdatums</option>
        <option value="5 Minuten vorher">5 Minuten vorher</option>
        <option value="10 Minuten vorher">10 Minuten vorher</option>
        <option value="15 Minuten vorher">15 Minuten vorher</option>
        <option value="1 Stunde vorher">1 Stunde vorher</option>
        <option value="2 Stunden vorher">2 Stunden vorher</option>
        <option value="1 Tag vorher">1 Tag vorher</option>
        <option value="2 Tage vorher">2 Tage vorher</option>
      </select>

      <div class="popover-actions">
        <button type="submit" class="btn-primary">Speichern</button>
        {#if currentDate}
          <button type="button" class="btn-secondary" onclick={onRemove}>Entfernen</button>
        {/if}
      </div>
    </form>
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

  .date-time-row {
    display: flex;
    gap: 8px;
  }

  .date-input {
    flex: 2;
    background: #1d2125;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 8px 10px;
    color: #dee4ea;
    font-size: 13px;
    outline: none;
  }

  .time-input {
    flex: 1;
    background: #1d2125;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 8px 10px;
    color: #dee4ea;
    font-size: 13px;
    outline: none;
  }

  .select-input {
    width: 100%;
    background: #1d2125;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 8px 10px;
    color: #dee4ea;
    font-size: 13px;
    outline: none;
  }

  .popover-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
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
    text-align: center;
  }

  .btn-primary:hover {
    background: #85b8ff;
  }

  .btn-secondary {
    background: #2c333a;
    color: #f87171;
    font-weight: 500;
    font-size: 13px;
    border: 1px solid #3c444c;
    border-radius: 6px;
    padding: 8px 16px;
    cursor: pointer;
    text-align: center;
  }

  .btn-secondary:hover {
    background: #3c444c;
  }
</style>
