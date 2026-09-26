<script>
  let { preferences, onClose } = $props();
  let dialog;
  $effect(() => { dialog?.showModal(); });
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="options-title">
  <header><h2 id="options-title">Optionen</h2><button onclick={() => dialog.close()} title="Schließen (Esc)" aria-label="Optionen schließen">✕</button></header>
  <label><input type="checkbox" checked={preferences.state.autoCompleteDone} onchange={(e) => preferences.set('autoCompleteDone', e.currentTarget.checked)} /> In „Done“ automatisch als erledigt markieren</label>
  <p>Beim Verschieben in eine Liste namens „Done“. Das Fälligkeitsdatum bleibt erhalten. Bereits vorhandene Karten werden nicht verändert.</p>
  <label><input type="checkbox" checked={preferences.state.timedPlanning} onchange={(e) => preferences.set('timedPlanning', e.currentTarget.checked)} /> Beim Einplanen auf einen Tag eine Uhrzeit vorschlagen</label>
  <label><input type="checkbox" checked={preferences.state.askDeadline} onchange={(e) => preferences.set('askDeadline', e.currentTarget.checked)} /> Beim Einplanen zusätzlich nach einer Fälligkeit fragen</label>
  <p>Ohne diese Optionen wird der Zeitraum direkt gespeichert. Planung wird in Deck v2 gespeichert; ein Fälligkeitsdatum bleibt ein separates Deck-Feld.</p>
  <label>Boards sortieren
    <select value={preferences.state.boardSort} onchange={(e) => preferences.set('boardSort', e.currentTarget.value)}>
      <option value="recent">Zuletzt verwendet</option><option value="alphabetical">Alphabetisch</option>
    </select>
  </label>
  <p>Einstellungen gelten für dieses Benutzerkonto in diesem Browser.</p>
</dialog>

<style>
  dialog { width: min(480px, calc(100vw - 32px)); padding: 24px; background: var(--panel-bg, #222a30); color: var(--text); border: 1px solid var(--border); border-radius: 12px; }
  dialog::backdrop { background: #0009; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  h2 { margin: 0 0 24px; font-size: 20px; }
  label { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
  p { color: var(--text-dim); line-height: 1.5; font-size: 13px; }
  button, select { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; }
</style>
