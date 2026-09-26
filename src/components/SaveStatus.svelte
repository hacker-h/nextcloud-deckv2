<script>
  let { state } = $props();
</script>
{#if state.pending || state.failed || state.saved}
  <span role="status" class:error={Boolean(state.failed)} title={state.failed ? 'Eine Änderung ist fehlgeschlagen. Prüfe die Fehlermeldung und versuche die Aktion erneut.' : 'Status der Deck-Schreibzugriffe; Kalender-Sync wird separat angezeigt.'}>
    {state.pending ? `${state.pending} wird gespeichert…` : state.failed ? 'Speichern fehlgeschlagen' : '✓ Gespeichert'}
  </span>
{/if}
<style>span { font-size: 12px; color: var(--text-dim); white-space: nowrap; } .error { color: #fd9891; }</style>
