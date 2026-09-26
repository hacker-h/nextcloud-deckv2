<script>
  import { onMount } from 'svelte';
  import { dateKey, parseDate, period, monthWeeks, weekNumber, suggestTime } from '../../shared/planning.js';
  import { planningRequest } from '../lib/planning.js';
  import { drag } from '../lib/dnd.svelte.js';
  let { board, stacks, preferences, calendar, onClose, onOpenCard, onDeadline, readOnly = false } = $props();
  let month = $state(dateKey(new Date()));
  let plans = $state({});
  let events = $state([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let calendarHint = $state('');
  let message = $state('');
  let selected = $state('');
  let retry = $state(0);
  let pending = $state(null);
  let time = $state('');
  let deadline = $state('');
  let scheduleDialog;
  const weeks = $derived(monthWeeks(month));
  const monthPeriod = $derived(period('month', month));
  const cards = $derived(stacks.flatMap((stack) => stack.cards));
  const label = $derived(parseDate(month).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }));
  const highlighted = $derived(drag.planTarget ? period(drag.planTarget.granularity, drag.planTarget.start) : null);
  const items = $derived(cards.filter((card) => plans[card.id]?.plan).map((card) => ({ card, ...plans[card.id].plan }))
    .filter((entry) => entry.start < monthPeriod.end && entry.end > monthPeriod.start)
    .sort((a, b) => a.start.localeCompare(b.start)));

  $effect(() => {
    const id = board?.id; retry;
    if (!id) return;
    let active = true;
    loading = true; error = ''; plans = {}; selected = ''; pending = null;
    planningRequest(id).then((data) => { if (active) plans = data; })
      .catch((cause) => { if (active) error = cause.message; })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });
  $effect(() => {
    const range = monthPeriod;
    let active = true;
    events = []; calendarHint = 'Kalender wird geprüft…';
    calendar.planner({ start: new Date(`${range.start}T00:00:00`).toISOString(), end: new Date(`${range.end}T00:00:00`).toISOString() })
      .then((data) => { if (active) { events = (data.events ?? []).map((event) => ({ ...event, start: event.occurrenceStart ?? event.start, end: event.occurrenceEnd ?? event.end })); calendarHint = 'Termine aus dem verbundenen Kalender berücksichtigt'; } })
      .catch(() => { if (active) calendarHint = 'Externer Kalender nicht verfügbar; Vorschläge berücksichtigen nur deine Planung.'; });
    return () => { active = false; };
  });
  $effect(() => { if (pending) scheduleDialog?.showModal(); else scheduleDialog?.close(); });

  function navigate(delta) {
    const date = parseDate(monthPeriod.start); date.setMonth(date.getMonth() + delta); month = dateKey(date);
  }
  function count(granularity, start) {
    return items.filter((item) => item.granularity === granularity && item.start === start).length;
  }
  async function save(ids, plan, due = '') {
    if (readOnly || busy || loading) return;
    const boardId = board.id;
    busy = true; error = ''; message = '';
    try {
      for (const id of ids) {
        if (!cards.some((card) => card.id === id)) throw new Error('Bitte eine Karte dieses Boards wählen.');
        const result = await planningRequest(boardId, { cardId: id, plan, revision: plans[id]?.revision ?? null });
        if (board.id === boardId) plans = { ...plans, [id]: result };
        if (due) await onDeadline(id, due);
      }
      if (board.id === boardId) message = plan ? 'Planung gespeichert' : 'Planung entfernt';
    } catch (cause) {
      if (board.id === boardId) error = `${cause.message} Bereits gespeicherte Karten bleiben eingeplant.`;
    } finally { busy = false; }
  }
  function choose(ids, granularity, start) {
    if (readOnly || busy || loading) return;
    if (!ids.length || ids.some((id) => !cards.some((card) => card.id === id))) {
      error = 'Eine Karte dieses Boards ziehen oder unten auswählen.'; return;
    }
    const plan = { ...period(granularity, start), time: null };
    if ((preferences.state.timedPlanning && granularity === 'day') || preferences.state.askDeadline) {
      const busyTimes = items.filter((item) => item.time && !ids.includes(item.card.id)).map((item) => {
        const begin = new Date(`${item.start}T${item.time}`);
        return { start: begin.toISOString(), end: new Date(begin.getTime() + item.duration * 60000).toISOString() };
      });
      time = preferences.state.timedPlanning && granularity === 'day' ? suggestTime(start, [...events, ...busyTimes]) ?? '' : '';
      deadline = ''; pending = { ids, plan };
    } else void save(ids, plan);
  }
  onMount(() => {
    window.addEventListener('deck:plan-drop', drop);
    return () => window.removeEventListener('deck:plan-drop', drop);
  });
  function drop(event) {
    const { cardIds, target } = event.detail;
    choose(cardIds, target.granularity, target.start);
  }
  function confirm() {
    const next = pending; pending = null; scheduleDialog?.close();
    if (next) void save(next.ids, { ...next.plan, time: time || null, duration: time ? 30 : null }, deadline);
  }
</script>

<aside data-planning-panel aria-label="Planungskalender">
  <header><h2>Einplanen</h2><button onclick={onClose} title="Planung schließen" aria-label="Planung schließen">✕</button></header>
  <p class="hint">Karten auf einen Tag, eine Woche oder den Monat ziehen. Fälligkeit bleibt unabhängig.</p>
  <nav><button onclick={() => navigate(-1)} aria-label="Vorheriger Monat">‹</button><strong>{label}</strong><button onclick={() => navigate(1)} aria-label="Nächster Monat">›</button></nav>
  <button class="month-target" data-plan-start={readOnly ? undefined : monthPeriod.start} data-plan-kind="month" onclick={() => choose(selected ? [Number(selected)] : [], 'month', month)} disabled={readOnly || loading || busy}>Irgendwann im {label} {count('month', monthPeriod.start) || ''}</button>
  <div class="grid">
    <span>KW</span>{#each ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as day}<span>{day}</span>{/each}
    {#each weeks as week}
      <button class="week" data-plan-start={readOnly ? undefined : week[0]} data-plan-kind="week" title={`Woche ab ${week[0]} einplanen`} onclick={() => choose(selected ? [Number(selected)] : [], 'week', week[0])} disabled={readOnly || loading || busy}>{weekNumber(week[0])}{count('week', week[0]) ? ` ·${count('week', week[0])}` : ''}</button>
      {#each week as day}
        <button class:outside={day.slice(0, 7) !== month.slice(0, 7)} class:highlight={highlighted && day >= highlighted.start && day < highlighted.end} class:today={day === dateKey(new Date())} data-plan-start={readOnly ? undefined : day} data-plan-kind="day" title={`${day} einplanen`} onclick={() => choose(selected ? [Number(selected)] : [], 'day', day)} disabled={readOnly || loading || busy}>
          {Number(day.slice(-2))}{#if count('day', day)}<small>● {count('day', day)}</small>{/if}
        </button>
      {/each}
    {/each}
  </div>
  {#if !readOnly}<label class="hint">Ohne Ziehen: Karte wählen, dann Zeitraum anklicken<select bind:value={selected} aria-label="Karte zum Einplanen"><option value="">Karte auswählen…</option>{#each cards as card (card.id)}<option value={card.id}>{card.title}</option>{/each}</select></label>{/if}
  {#if loading}<p role="status">Planung wird geladen…</p>{/if}
  {#if busy}<p role="status">Planung wird gespeichert…</p>{/if}
  {#if message}<p role="status">✓ {message}</p>{/if}
  {#if error}<p role="alert" class="error">{error} <button onclick={() => retry += 1}>Neu laden</button></p>{/if}
  <p class="hint">{calendarHint}</p>
  {#if events.length}<details><summary>{events.length} Kalendertermine</summary><ul>{#each events as event}<li class="hint">{new Date(event.start).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {event.title ?? event.summary ?? 'Belegt'}</li>{/each}</ul></details>{/if}
  <ul>{#each items as item (item.card.id)}<li><button class="entry" onclick={() => onOpenCard({ card: item.card })}>{item.card.title}<small>{item.granularity === 'week' ? 'Woche ab ' : item.granularity === 'month' ? 'Monat ab ' : ''}{item.start}{item.time ? ` · ${item.time}` : ''}</small></button>{#if !readOnly}<button title="Planung entfernen" aria-label={`Planung für ${item.card.title} entfernen`} disabled={busy} onclick={() => save([item.card.id], null)}>×</button>{/if}</li>{/each}</ul>
</aside>

<dialog bind:this={scheduleDialog} onclose={() => pending = null} aria-labelledby="schedule-title">
  <h2 id="schedule-title">Planung festlegen</h2>
  <p>{pending?.plan.start}</p>
  {#if pending?.plan.granularity === 'day' && preferences.state.timedPlanning}<label>Uhrzeit (optional, 30 Minuten)<input type="time" bind:value={time} /></label><p class="hint">{calendarHint}</p>{/if}
  {#if preferences.state.askDeadline}<label>Zusätzlich fällig am (optional)<input type="date" bind:value={deadline} /></label>{/if}
  <button onclick={confirm}>Speichern</button><button onclick={() => { time = ''; deadline = ''; confirm(); }}>Nur Zeitraum</button><button onclick={() => scheduleDialog.close()} title="Abbrechen (Esc)">Abbrechen</button>
</dialog>

<style>
  aside { width: 350px; flex: 0 0 350px; background: #1e272d; padding: 16px; overflow: auto; border-left: 1px solid var(--border); color: var(--text); }
  header, nav { display: flex; justify-content: space-between; align-items: center; gap: 8px; } h2 { font-size: 18px; margin: 0; }
  button, select, input { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); border-radius: 5px; padding: 6px; cursor: pointer; }
  button:disabled { cursor: default; } button:hover:not(:disabled) { border-color: #85b8ff; }
  .hint, small { color: var(--text-dim); font-size: 12px; line-height: 1.5; } small { display: block; font-size: 10px; }
  .grid { display: grid; grid-template-columns: 30px repeat(7, 1fr); gap: 3px; margin: 12px 0; text-align: center; font-size: 11px; }
  .grid button { padding: 7px 0; min-height: 37px; } .outside { opacity: .45; } .today { border-color: #85b8ff; }
  .grid .highlight { background: #175f92; border-color: #85b8ff; opacity: 1; } .week { font-size: 10px; }
  .month-target, select { width: 100%; margin-top: 12px; } .month-target { background: #253d4c; }
  ul { list-style: none; padding: 0; } li { display: flex; gap: 4px; margin: 8px 0; } .entry { flex: 1; text-align: left; }
  .error { color: #fd9891; } dialog { max-width: 440px; background: #222a30; color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 24px; }
  dialog::backdrop { background: #0009; } dialog label { display: grid; gap: 8px; margin: 16px 0; }
  @media (max-width: 700px) { aside { position: fixed; right: 0; top: 65px; bottom: 80px; z-index: 20; width: min(350px, 92vw); } }
</style>
