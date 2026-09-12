<script>
  import { onMount } from 'svelte';

  let status = $state('checking');
  const label = $derived(status === 'online'
    ? 'Online – Server erreichbar'
    : status === 'offline' ? 'Offline – keine Serververbindung' : 'Verbindung wird geprüft');

  onMount(() => {
    let controller;
    let stopped = false;
    let generation = 0;
    const offline = () => {
      generation += 1;
      controller?.abort();
      status = 'offline';
    };
    async function check() {
      if (!navigator.onLine) return offline();
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      const probe = controller;
      const timeout = setTimeout(() => probe.abort(), 5000);
      try {
        const response = await fetch('/healthz', { cache: 'no-store', signal: controller.signal });
        const body = response.ok ? await response.json() : null;
        if (!stopped && current === generation) status = body?.status === 'ok' ? 'online' : 'offline';
      } catch {
        if (!stopped && current === generation) status = 'offline';
      } finally {
        clearTimeout(timeout);
      }
    }
    function apiStatus(event) {
      if (!event.detail.online) offline();
      else if (navigator.onLine) {
        generation += 1;
        controller?.abort();
        status = 'online';
      }
    }
    window.addEventListener('online', check);
    window.addEventListener('offline', offline);
    window.addEventListener('deck:connection', apiStatus);
    const interval = setInterval(check, 15000);
    check();
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(interval);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', offline);
      window.removeEventListener('deck:connection', apiStatus);
    };
  });
</script>

<div class="connection-status" role="status" aria-live="polite" aria-label={label} title={label}>
  <span class:online={status === 'online'} class:offline={status === 'offline'}></span>
</div>

<style>
  .connection-status {
    position: fixed;
    bottom: 8px;
    left: 12px;
    z-index: 9999;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(16, 18, 20, .85);
  }
  span { width: 8px; height: 8px; border-radius: 50%; background: #a3a3a3; }
  span.online { background: #4ade80; }
  span.offline { background: #f87171; }
  .connection-status:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
