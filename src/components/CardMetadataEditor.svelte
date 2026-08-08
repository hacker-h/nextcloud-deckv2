<script>
  let {
    card,
    labels = [],
    participants = [],
    onAssignLabel,
    onRemoveLabel,
    onAssignUser,
    onUnassignUser,
    error = null,
  } = $props();

  let labelsOpen = $state(false);
  let peopleOpen = $state(false);
  let labelQuery = $state('');
  let peopleQuery = $state('');
  let pending = $state(new Set());

  const matches = (text, query) =>
    String(text).toLowerCase().includes(query.trim().toLowerCase());

  const shownLabels = $derived(labels.filter((l) => matches(l.title, labelQuery)));
  const shownParticipants = $derived(
    participants.filter((p) => matches(p.displayName ?? p.id, peopleQuery)),
  );

  const activeLabels = $derived(card?.labels ?? []);
  const activeLabelIds = $derived(new Set(activeLabels.map((l) => l.id)));

  const assigned = $derived(card?.assignedUsers ?? []);
  const assignedIds = $derived(
    new Set(assigned.map((a) => a.participant?.uid ?? a.participant ?? a.id)),
  );

  function personOf(entry) {
    const p = entry.participant ?? entry;
    return {
      id: p.uid ?? p.id ?? p,
      displayName: p.displayName ?? p.uid ?? p.id ?? p,
      type: entry.type ?? 0,
    };
  }

  function initials(name) {
    return String(name).trim().slice(0, 2).toUpperCase();
  }

  // Deck rejects a second assign of the same label/user with a 400, so the key
  // is latched for the whole round trip to stop double-clicks reaching the API.
  async function guard(key, run) {
    if (pending.has(key)) return;
    pending = new Set(pending).add(key);
    try {
      await run();
    } finally {
      const next = new Set(pending);
      next.delete(key);
      pending = next;
    }
  }

  function toggleLabel(label) {
    const on = activeLabelIds.has(label.id);
    return guard(`label:${label.id}`, () =>
      on ? onRemoveLabel?.(label.id) : onAssignLabel?.(label.id),
    );
  }

  function togglePerson(person) {
    const on = assignedIds.has(person.id);
    return guard(`user:${person.id}`, () =>
      on ? onUnassignUser?.(person.id, person.type) : onAssignUser?.(person.id, person.type),
    );
  }
</script>

<section class="meta">
  <div class="group">
    <h3 class="legend" id="labels-legend">Labels</h3>
    <ul class="chips" aria-labelledby="labels-legend">
      {#each activeLabels as label (label.id)}
        <li>
          <span class="chip" style="background:#{label.color}">{label.title}</span>
        </li>
      {:else}
        <li class="muted">Keine Labels</li>
      {/each}
    </ul>
    <button class="btn" type="button" aria-expanded={labelsOpen} onclick={() => (labelsOpen = !labelsOpen)}>
      Labels bearbeiten
    </button>
    {#if labelsOpen}
      <input class="input search" type="search" aria-label="Labels suchen" bind:value={labelQuery} />
      <ul class="picker">
        {#each shownLabels as label (label.id)}
          <li>
            <button
              class="option"
              type="button"
              role="checkbox"
              aria-checked={activeLabelIds.has(label.id)}
              disabled={pending.has(`label:${label.id}`)}
              onclick={() => toggleLabel(label)}
            >
              <span class="swatch" style="background:#{label.color}"></span>
              <span class="option-text">{label.title}</span>
              {#if activeLabelIds.has(label.id)}<span class="tick" aria-hidden="true">✓</span>{/if}
            </button>
          </li>
        {:else}
          <li class="muted">Keine passenden Labels</li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="group">
    <h3 class="legend" id="members-legend">Mitglieder</h3>
    <ul class="chips" aria-labelledby="members-legend">
      {#each assigned as entry (personOf(entry).id)}
        {@const person = personOf(entry)}
        <li>
          <span class="avatar" title={person.displayName}>{initials(person.displayName)}</span>
        </li>
      {:else}
        <li class="muted">Keine Mitglieder</li>
      {/each}
    </ul>
    <button class="btn" type="button" aria-expanded={peopleOpen} onclick={() => (peopleOpen = !peopleOpen)}>
      Mitglieder bearbeiten
    </button>
    {#if peopleOpen}
      <input class="input search" type="search" aria-label="Mitglieder suchen" bind:value={peopleQuery} />
      <ul class="picker">
        {#each shownParticipants as person (person.id)}
          <li>
            <button
              class="option"
              type="button"
              role="checkbox"
              aria-checked={assignedIds.has(person.id)}
              disabled={pending.has(`user:${person.id}`)}
              onclick={() => togglePerson(person)}
            >
              <span class="avatar small">{initials(person.displayName)}</span>
              <span class="option-text">{person.displayName}</span>
              {#if assignedIds.has(person.id)}<span class="tick" aria-hidden="true">✓</span>{/if}
            </button>
          </li>
        {:else}
          <li class="muted">Keine passenden Mitglieder</li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if error}
    <p class="hint error" role="alert">{error}</p>
  {/if}
</section>

<style>
  .meta { display: flex; flex-direction: column; gap: 20px; }
  .group { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

  .legend {
    margin: 0;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  ul { margin: 0; padding: 0; list-style: none; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .muted { font-size: 12px; line-height: 16px; color: var(--text-dim); }

  .chip {
    display: inline-block;
    min-width: 40px;
    padding: 2px 8px;
    border-radius: 4px;
    color: #1d2125;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
  }

  .avatar {
    display: inline-flex;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: #1d2125;
    font-size: 11px;
    font-weight: 700;
  }
  .small { width: 24px; height: 24px; }

  .input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--stack-bg);
    color: var(--text);
    font: inherit;
  }
  .input:focus { border-color: var(--accent); outline: none; }
  .search { margin-bottom: 4px; }

  .picker {
    width: 100%;
    max-height: 220px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--stack-bg);
    overflow-y: auto;
  }

  .option {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .option:hover:not(:disabled) { background: var(--card-bg-hover); }
  .option:disabled { opacity: .6; cursor: progress; }
  .option-text { flex: 1; word-break: break-word; }
  .swatch { width: 24px; height: 16px; border-radius: 4px; }
  .tick { color: var(--accent); }

  .btn {
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: #a1bdd914;
    color: var(--text);
    cursor: pointer;
  }
  .btn:hover { background: #a1bdd925; }

  .hint { margin: 0; font-size: 12px; line-height: 16px; }
  .error { color: var(--danger); }
</style>
