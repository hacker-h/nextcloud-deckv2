<script>
  import { matchesCard, loadSearchBoards } from '../lib/card-search.js';
  import { shortcut } from '../lib/shortcuts.js';
  let { boards, current, stacks, user, loadStacks, onPick, onClose, initialMine = false } = $props();
  let dialog;
  let input;
  let query = $state('');
  // svelte-ignore state_referenced_locally -- initial mode only, filter is subsequently user-controlled.
  let mine = $state(initialMine);
  // svelte-ignore state_referenced_locally
  let openOnly = $state(initialMine);
  // svelte-ignore state_referenced_locally
  let scope = $state(initialMine ? 'all' : 'board');
  let loaded = $state([]);
  let failures = $state([]);
  let remaining = $state(0);
  let retry = $state(0);
  $effect(() => { dialog?.showModal(); input?.focus(); });
  $effect(() => {
    retry;
    if (scope !== 'all') return;
    let active = true;
    loaded = []; failures = []; remaining = boards.length;
    void loadSearchBoards(boards, loadStacks, (board, data, failed) => {
      remaining -= 1;
      if (failed) failures = [...failures, board.title];
      else loaded = [...loaded, ...data.flatMap((stack) => stack.cards.map((card) => ({ card, stack, board })))];
    }, () => active);
    return () => { active = false; };
  });
  const entries = $derived(scope === 'board'
    ? stacks.flatMap((stack) => stack.cards.map((card) => ({ card, stack, board: current }))) : loaded);
  const results = $derived(entries.filter(({ card }) => matchesCard(card, { query, mine, openOnly, user })));
  function pick(entry) { dialog.close(); onPick(entry); }
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="search-title">
  <header><h2 id="search-title">Karten suchen</h2><button onclick={() => dialog.close()} title="Schließen (Esc)" aria-label="Suche schließen">✕</button></header>
  <input bind:this={input} bind:value={query} class="query" placeholder="Titel, Beschreibung oder Label…" aria-label="Karten suchen" onkeydown={(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); }} />
  <nav aria-label="Suchbereich">
    <button aria-pressed={scope === 'board'} onclick={() => scope = 'board'}>Dieses Board</button>
    <button aria-pressed={scope === 'all'} onclick={() => scope = 'all'}>Alle Boards</button>
  </nav>
  <div class="filters">
    <label><input type="checkbox" bind:checked={mine} /> Meine Aufgaben</label>
    <label><input type="checkbox" bind:checked={openOnly} /> Nur unerledigte</label>
  </div>
  <p role="status">{results.length} Treffer{scope === 'all' && remaining ? ` · ${remaining} Boards werden noch geladen…` : ''}</p>
  {#if scope === 'all' && failures.length}<p role="alert">Suche unvollständig: {failures.join(', ')} <button onclick={() => retry += 1}>Erneut laden</button></p>{/if}
  <ul>
    {#each results.slice(0, 200) as entry (`${entry.board.id}:${entry.card.id}`)}
      <li><button class="result" onclick={() => pick(entry)}><strong>{entry.card.title}</strong><span>{entry.board.title} · {entry.stack.title}{entry.card.done ? ' · Erledigt' : ''}</span></button></li>
    {/each}
  </ul>
  {#if results.length > 200}<p>Erste 200 Treffer. Suche weiter eingrenzen.</p>{/if}
  <footer>Suche öffnen: {shortcut('K')} · Ersten Treffer öffnen: Enter · Schließen: Esc</footer>
</dialog>

<style>
  dialog { width: min(680px, calc(100vw - 32px)); max-height: 85vh; background: #222a30; color: var(--text); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
  dialog::backdrop { background: #0009; }
  header { display: flex; justify-content: space-between; align-items: center; } h2 { font-size: 20px; margin: 0 0 16px; }
  button, .query { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 8px 12px; }
  .query { width: 100%; } nav, .filters { display: flex; gap: 12px; margin-top: 16px; }
  button { cursor: pointer; } button[aria-pressed="true"] { background: #174c75; border-color: #579dff; }
  p, footer, .result span { font-size: 12px; color: var(--text-dim); }
  ul { padding: 0; list-style: none; max-height: 45vh; overflow: auto; }
  .result { display: grid; gap: 6px; text-align: left; width: 100%; margin-bottom: 6px; }
  .result:hover { border-color: var(--accent); } strong { font-weight: 500; }
</style>
