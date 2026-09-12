import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ConnectionStatus from './ConnectionStatus.svelte';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const healthy = () => Promise.resolve(new Response(JSON.stringify({ status: 'ok' })));
const api = (online) => window.dispatchEvent(new CustomEvent('deck:connection', { detail: { online } }));

it('checks the server, reports API failure and recovers on browser reconnect', async () => {
  vi.stubGlobal('fetch', vi.fn(healthy));
  render(ConnectionStatus);
  await screen.findByRole('status', { name: 'Online – Server erreichbar' });
  api(false);
  await screen.findByRole('status', { name: 'Offline – keine Serververbindung' });
  window.dispatchEvent(new Event('online'));
  await screen.findByRole('status', { name: 'Online – Server erreichbar' });
  expect(fetch).toHaveBeenCalledWith('/healthz', expect.objectContaining({ cache: 'no-store' }));
});

it('does not report online merely because the browser has a network', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  render(ConnectionStatus);
  await screen.findByRole('status', { name: 'Offline – keine Serververbindung' });
});

it('ignores an old successful probe after an API failure', async () => {
  let resolve;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolve = r; })));
  render(ConnectionStatus);
  api(false);
  resolve(new Response(JSON.stringify({ status: 'ok' })));
  await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Offline – keine Serververbindung'));
});

it('reacts immediately to browser offline and removes listeners on unmount', async () => {
  vi.stubGlobal('fetch', vi.fn(healthy));
  const { unmount } = render(ConnectionStatus);
  await screen.findByRole('status', { name: 'Online – Server erreichbar' });
  window.dispatchEvent(new Event('offline'));
  await screen.findByRole('status', { name: 'Offline – keine Serververbindung' });
  unmount();
  const count = fetch.mock.calls.length;
  window.dispatchEvent(new Event('online'));
  expect(fetch).toHaveBeenCalledTimes(count);
});
