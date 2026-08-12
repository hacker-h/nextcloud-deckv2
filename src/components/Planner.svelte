<script>
  import { applyCalendarPulls, calendarEntries, unscheduledEntries } from '../lib/calendar.js';

  let {
    calendar,
    deckClient,
    board,
    stacks = [],
    onCard = () => {},
    onOpenCard = () => {},
  } = $props();

  let anchor = $state(startOfWeek(new Date()));
  let loading = $state(true);
  let syncing = $state(false);
  let status = $state(null);
  let error = $state(null);
  let events = $state([]);
  let mappings = $state([]);
  let calendars = $state([]);
  let selectedCalendarId = $state('');
  let syncResult = $state(null);
  let scheduling = $state(null);
  let scheduleDate = $state('');
  let scheduleTime = $state('12:00');
  let recurrenceFreq = $state('');
  let recurrenceEnd = $state('never');
  let recurrenceCount = $state(10);
  let recurrenceUntil = $state('');
  let reminderMinutes = $state(15);
  let initializedBoard = null;

  const entries = $derived(calendarEntries(stacks, board?.id));
  const unscheduled = $derived(unscheduledEntries(entries));
  const datedEntries = $derived(entries.filter((entry) => entry.dueAt));
  const days = $derived(Array.from({ length: 7 }, (_, index) => addDays(anchor, index)));
  const range = $derived({ start: anchor.toISOString(), end: addDays(anchor, 7).toISOString() });
  const mappingByEvent = $derived(new Map(mappings.map((mapping) => [mapping.eventId, mapping])));

  $effect(() => {
    if (!board?.id || initializedBoard === String(board.id)) return;
    initializedBoard = String(board.id);
    refresh({ synchronize: true });
  });

  async function refresh({ synchronize = false } = {}) {
    loading = true;
    error = null;
    try {
      status = await calendar.status();
      if (!status.enabled) return;
      if (!status.connected) throw new Error(status.reloginRequired ? 'Proton Calendar muss erneut verbunden werden.' : 'Proton Calendar ist nicht bereit.');

      const calendarData = await calendar.calendars();
      calendars = (calendarData.calendars ?? []).filter((item) => !item.readOnly);
      selectedCalendarId ||= calendarData.targetCalendarId ?? calendarData.defaultCalendarId ?? calendars[0]?.id ?? '';
      if (synchronize) await synchronizeEntries();
      const planner = await calendar.planner(range);
      events = planner.events ?? [];
      mappings = planner.mappings ?? [];
    } catch (caught) {
      error = caught?.message ?? 'Kalender konnte nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  async function synchronizeEntries() {
    syncing = true;
    try {
      syncResult = await calendar.sync(entries, {
        calendarId: selectedCalendarId || undefined,
        autoCreate: true,
        scopeBoardIds: [String(board.id)],
        pruneMissing: true,
      });
      if (syncResult.pulled?.length) {
        await applyCalendarPulls(deckClient, stacks, syncResult.pulled, onCard);
      }
      return syncResult;
    } finally {
      syncing = false;
    }
  }

  function moveWeek(delta) {
    anchor = addDays(anchor, delta * 7);
    refresh();
  }

  function today() {
    anchor = startOfWeek(new Date());
    refresh();
  }

  function beginSchedule(entry, date = entry.dueAt) {
    scheduling = entry;
    const parsed = date ? new Date(date.length === 10 ? `${date}T12:00:00` : date) : new Date();
    scheduleDate = localDate(parsed);
    scheduleTime = entry.kind === 'checklist' ? '12:00' : localTime(parsed);
    const mapping = mappings.find((item) => item.entryKey === entryKey(entry));
    recurrenceFreq = mapping?.recurrence?.freq ?? '';
    recurrenceCount = mapping?.recurrence?.count ?? 10;
    recurrenceUntil = mapping?.recurrence?.until?.slice(0, 10) ?? '';
    recurrenceEnd = mapping?.recurrence?.count ? 'count' : mapping?.recurrence?.until ? 'until' : 'never';
  }

  async function saveSchedule() {
    if (!scheduling || !scheduleDate) return;
    syncing = true;
    error = null;
    try {
      const dueAt = scheduling.kind === 'checklist'
        ? scheduleDate
        : new Date(`${scheduleDate}T${scheduleTime || '12:00'}`).toISOString();
      const recurrence = recurrenceFreq ? {
        freq: recurrenceFreq,
        ...(recurrenceEnd === 'count' ? { count: Number(recurrenceCount) } : {}),
        ...(recurrenceEnd === 'until' && recurrenceUntil ? { until: new Date(`${recurrenceUntil}T23:59:59`).toISOString() } : {}),
      } : null;
      const next = { ...scheduling, dueAt };

      await applyCalendarPulls(deckClient, stacks, [{ entryKey: entryKey(next), title: next.title, dueAt }], onCard);
      await calendar.schedule(next, {
        calendarId: selectedCalendarId || undefined,
        recurrence,
        reminderMinutes: reminderMinutes ? Number(reminderMinutes) : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      scheduling = null;
      await refresh();
    } catch (caught) {
      error = caught?.message ?? 'Termin konnte nicht gespeichert werden.';
    } finally {
      syncing = false;
    }
  }

  async function resolveConflict(conflict, winner) {
    const entry = entries.find((candidate) => entryKey(candidate) === conflict.entryKey);
    if (!entry) return;
    syncing = true;
    try {
      if (winner === 'deck') {
        const mapping = mappings.find((item) => item.entryKey === conflict.entryKey);
        await calendar.schedule(entry, {
          calendarId: (mapping?.calendarId ?? selectedCalendarId) || undefined,
          recurrence: mapping?.recurrence ?? null,
        });
      } else {
        await applyCalendarPulls(deckClient, stacks, [{
          entryKey: conflict.entryKey,
          title: conflict.proton.title,
          dueAt: conflict.proton.dueAt,
        }], onCard);
      }
      await refresh({ synchronize: winner === 'proton' });
    } finally {
      syncing = false;
    }
  }

  function dropOnDay(event, day) {
    event.preventDefault();
    const key = event.dataTransfer?.getData('text/calendar-entry');
    const entry = entries.find((candidate) => entryKey(candidate) === key);
    if (entry) beginSchedule(entry, localDate(day));
  }

  function eventsFor(day) {
    return events.filter((event) => sameDay(new Date(event.occurrenceStart ?? event.start), day));
  }

  function deckDatesFor(day) {
    return datedEntries.filter((entry) => sameDay(new Date(entry.dueAt.length === 10 ? `${entry.dueAt}T12:00:00` : entry.dueAt), day));
  }

  function linked(event) {
    return mappingByEvent.get(event.seriesId ?? event.id) ?? mappingByEvent.get(event.id);
  }

  function entryKey(entry) {
    return entry.kind === 'checklist'
      ? `checklist:${entry.boardId}:${entry.cardId}:${entry.itemId}`
      : `card:${entry.boardId}:${entry.cardId}`;
  }

  function openEntry(entry) {
    onOpenCard({ card: { id: Number(entry.cardId), stackId: Number(entry.stackId) } });
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function startOfWeek(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
  }

  function sameDay(left, right) {
    return localDate(left) === localDate(right);
  }

  function localDate(value) {
    const date = new Date(value);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localTime(value) {
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function dayLabel(day) {
    return day.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function timeLabel(event) {
    if (event.allDay) return 'Ganztägig';
    return new Date(event.occurrenceStart ?? event.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="planner" aria-label="Proton Kalender Planer">
  <header class="planner-head">
    <div>
      <p class="eyebrow">Proton Calendar</p>
      <h1>Deine Woche, zusammengeführt</h1>
    </div>
    <div class="head-actions">
      {#if status?.enabled}
        <span class:offline={!status.connected} class="sync-pill">{status.connected ? 'Verbunden' : 'Aktion nötig'}</span>
      {/if}
      <button type="button" onclick={() => refresh({ synchronize: true })} disabled={syncing}>{syncing ? 'Synchronisiert…' : 'Jetzt synchronisieren'}</button>
    </div>
  </header>

  {#if error}<p class="alert" role="alert">{error}</p>{/if}

  {#if loading}
    <div class="planner-loading" aria-label="Kalender wird geladen">Kalender wird entschlüsselt…</div>
  {:else if !status?.enabled}
    <div class="empty-state">
      <strong>Proton Calendar ist serverseitig noch nicht konfiguriert.</strong>
      <span>API-URL, Token und erlaubtes Deck-Konto müssen im Deployment gesetzt werden.</span>
    </div>
  {:else}
    <div class="toolbar">
      <button type="button" onclick={() => moveWeek(-1)} aria-label="Vorherige Woche">←</button>
      <button type="button" onclick={today}>Heute</button>
      <strong>{anchor.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })} – {addDays(anchor, 6).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
      <button type="button" onclick={() => moveWeek(1)} aria-label="Nächste Woche">→</button>
      {#if calendars.length > 1}
        <label class="calendar-choice">Kalender
          <select bind:value={selectedCalendarId}>
            {#each calendars as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
          </select>
        </label>
      {/if}
    </div>

    {#if syncResult?.conflicts?.length}
      <section class="conflicts" aria-label="Synchronisierungskonflikte">
        <strong>{syncResult.conflicts.length} Konflikt{syncResult.conflicts.length === 1 ? ' braucht' : 'e brauchen'} deine Entscheidung.</strong>
        {#each syncResult.conflicts as conflict (conflict.entryKey)}
          <div class="conflict-row">
            <span>{conflict.deck.title}</span>
            <button type="button" onclick={() => resolveConflict(conflict, 'deck')}>Deck behalten</button>
            <button type="button" onclick={() => resolveConflict(conflict, 'proton')}>Proton behalten</button>
          </div>
        {/each}
      </section>
    {/if}

    <div class="workspace">
      <aside class="backlog">
        <h2>Nicht eingeplant <span>{unscheduled.length}</span></h2>
        <p>Auf einen Tag ziehen oder direkt planen.</p>
        <div class="backlog-list">
          {#each unscheduled as entry (entryKey(entry))}
            <button
              class="backlog-card"
              type="button"
              draggable="true"
              ondragstart={(event) => event.dataTransfer?.setData('text/calendar-entry', entryKey(entry))}
              onclick={() => beginSchedule(entry)}
            >
              <span>{entry.title}</span>
              <small>{entry.kind === 'checklist' ? 'Checklistenpunkt' : 'Karte'}</small>
            </button>
          {:else}<span class="muted">Alles hat einen Termin.</span>{/each}
        </div>
      </aside>

      <div class="week-grid">
        {#each days as day (day.toISOString())}
          <section class:today={sameDay(day, new Date())} class="day" role="group" aria-label={dayLabel(day)} ondragover={(event) => event.preventDefault()} ondrop={(event) => dropOnDay(event, day)}>
            <h2>{dayLabel(day)}</h2>
            <div class="day-events">
              {#each eventsFor(day) as event (`${event.id}:${event.occurrenceStart ?? event.start}`)}
                <article class:linked={Boolean(linked(event))} class="event">
                  <div class="event-time">{timeLabel(event)} {event.isRecurring ? '↻' : ''}</div>
                  <strong>{event.title}</strong>
                  <small>{linked(event) ? 'Deck ↔ Proton' : 'Proton'}</small>
                </article>
              {/each}
              {#each deckDatesFor(day).filter((entry) => !mappings.some((mapping) => mapping.entryKey === entryKey(entry))) as entry (entryKey(entry))}
                <button class="event deck-only" type="button" onclick={() => beginSchedule(entry)}>
                  <div class="event-time">{entry.kind === 'checklist' ? 'Ganztägig' : localTime(entry.dueAt)}</div>
                  <strong>{entry.title}</strong>
                  <small>Nur Deck · mit Proton verbinden</small>
                </button>
              {/each}
              {#if !eventsFor(day).length && !deckDatesFor(day).length}<span class="drop-hint">Hier ablegen</span>{/if}
            </div>
          </section>
        {/each}
      </div>
    </div>
  {/if}
</section>

{#if scheduling}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (scheduling = null)}>
    <div class="schedule-dialog" role="dialog" aria-modal="true" aria-label="In Proton Calendar einplanen">
      <header><div><p class="eyebrow">Deck ↔ Proton</p><h2>{scheduling.title}</h2></div><button type="button" aria-label="Schließen" onclick={() => (scheduling = null)}>×</button></header>
      <label>Datum <input type="date" bind:value={scheduleDate} /></label>
      {#if scheduling.kind !== 'checklist'}<label>Uhrzeit <input type="time" bind:value={scheduleTime} /></label>{/if}
      <label>Wiederholung
        <select bind:value={recurrenceFreq}>
          <option value="">Einmalig</option><option value="DAILY">Täglich</option><option value="WEEKLY">Wöchentlich</option><option value="MONTHLY">Monatlich</option><option value="YEARLY">Jährlich</option>
        </select>
      </label>
      {#if recurrenceFreq}
        <label>Ende
          <select bind:value={recurrenceEnd}><option value="never">Ohne Enddatum</option><option value="count">Nach Terminen</option><option value="until">An einem Datum</option></select>
        </label>
        {#if recurrenceEnd === 'count'}<label>Anzahl <input type="number" min="2" max="10000" bind:value={recurrenceCount} /></label>{/if}
        {#if recurrenceEnd === 'until'}<label>Bis <input type="date" bind:value={recurrenceUntil} /></label>{/if}
      {/if}
      <label>Erinnerung (Minuten) <input type="number" min="1" max="10000" bind:value={reminderMinutes} /></label>
      <div class="dialog-actions"><button type="button" onclick={() => (scheduling = null)}>Abbrechen</button><button class="primary" type="button" onclick={saveSchedule} disabled={syncing || !scheduleDate}>In Proton einplanen</button></div>
    </div>
  </div>
{/if}

<style>
  .planner { height: 100%; min-height: 0; padding: 18px 20px 82px; overflow: auto; background: linear-gradient(135deg, rgb(14 19 32 / 96%), rgb(27 24 45 / 94%)); }
  .planner-head, .toolbar, .workspace, .conflict-row, .schedule-dialog header, .dialog-actions { display: flex; align-items: center; }
  .planner-head { justify-content: space-between; gap: 20px; margin-bottom: 14px; }
  h1, h2, p { margin: 0; } h1 { color: #f4f1ff; font-size: 24px; } h2 { font-size: 14px; }
  .eyebrow { color: #a78bfa; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  button, select, input { border: 1px solid rgb(255 255 255 / 13%); border-radius: 7px; background: #262439; color: #f4f1ff; padding: 7px 10px; }
  button { cursor: pointer; } button:hover:not(:disabled) { background: #34304d; } button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #9f8cff; outline-offset: 2px; }
  .head-actions, .toolbar { gap: 8px; } .sync-pill { padding: 5px 9px; border-radius: 999px; background: #183d34; color: #79e2bf; font-size: 12px; } .sync-pill.offline { background: #4b2c2b; color: #ffb4ab; }
  .toolbar { margin-bottom: 14px; } .toolbar strong { min-width: 280px; text-align: center; } .calendar-choice { margin-left: auto; display: flex; gap: 8px; align-items: center; color: #bdb8d3; }
  .alert, .conflicts { margin: 10px 0; padding: 10px 12px; border: 1px solid #f8716866; border-radius: 8px; background: #461f28; color: #ffd2d0; }
  .conflicts { display: grid; gap: 8px; } .conflict-row { gap: 8px; } .conflict-row span { flex: 1; }
  .workspace { align-items: stretch; gap: 12px; min-width: 1050px; }
  .backlog { flex: 0 0 220px; padding: 12px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 10px; background: rgb(13 16 26 / 72%); }
  .backlog h2 { display: flex; justify-content: space-between; } .backlog p, .muted { margin: 4px 0 12px; color: #9d98b3; font-size: 12px; }
  .backlog-list { display: grid; gap: 7px; } .backlog-card { display: grid; gap: 3px; text-align: left; background: #29283b; } .backlog-card small { color: #aaa5c0; }
  .week-grid { display: grid; grid-template-columns: repeat(7, minmax(118px, 1fr)); flex: 1; gap: 7px; }
  .day { min-height: 440px; padding: 8px; border: 1px solid rgb(255 255 255 / 9%); border-radius: 10px; background: rgb(16 19 29 / 70%); } .day.today { border-color: #9f8cff; box-shadow: inset 0 3px #9f8cff; } .day > h2 { padding: 4px 2px 9px; color: #ccc7dd; text-transform: capitalize; }
  .day-events { display: grid; gap: 7px; } .event { display: grid; gap: 2px; padding: 8px; border-left: 3px solid #6d5cae; border-radius: 7px; background: #28263a; color: #f4f1ff; text-align: left; } .event.linked { border-left-color: #68d8b6; } .event.deck-only { width: 100%; border-left-color: #579dff; }
  .event-time, .event small { color: #aaa5c0; font-size: 11px; } .drop-hint { display: grid; place-items: center; min-height: 70px; border: 1px dashed rgb(255 255 255 / 15%); border-radius: 7px; color: #77728a; font-size: 12px; }
  .empty-state, .planner-loading { display: grid; gap: 5px; place-items: center; min-height: 260px; color: #bdb8d3; } .empty-state strong { color: #f4f1ff; }
  .modal-backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px; background: rgb(4 5 10 / 76%); }
  .schedule-dialog { display: grid; gap: 13px; width: min(420px, 100%); padding: 18px; border: 1px solid #ffffff22; border-radius: 12px; background: #1f1d2d; box-shadow: 0 24px 70px #0009; }
  .schedule-dialog header { justify-content: space-between; gap: 16px; } .schedule-dialog header h2 { margin-top: 3px; font-size: 18px; } .schedule-dialog label { display: grid; gap: 5px; color: #bdb8d3; font-size: 12px; } .dialog-actions { justify-content: flex-end; gap: 8px; } .primary { background: #6553a9; border-color: #8d7ad7; }
  @media (max-width: 760px) { .planner { padding-inline: 10px; } .planner-head { align-items: flex-start; } .head-actions { flex-direction: column; align-items: flex-end; } .workspace { min-width: 920px; } }
</style>
