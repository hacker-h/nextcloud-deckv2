import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import App from './App.svelte';

function authWith(state, overrides = {}) {
  return {
    state,
    check: vi.fn(),
    signIn: vi.fn().mockResolvedValue('https://cloud.example.test/login'),
    signOut: vi.fn(),
    cancel: vi.fn(),
    handleUnauthorized: vi.fn(),
    ...overrides,
  };
}

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App auth gate', () => {
  it('shows a quiet splash while checking', () => {
    const auth = authWith({ status: 'checking', user: null, error: null, loginUrl: null, expired: false, instance: null });

    render(App, { props: { auth } });

    expect(screen.getByLabelText('Checking sign-in status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Nextcloud' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(auth.check).toHaveBeenCalledTimes(1);
  });

  it('shows LoginScreen while anonymous', () => {
    const auth = authWith({ status: 'anonymous', user: null, error: null, loginUrl: null, expired: false, instance: 'https://cloud.example.test' });

    render(App, { props: { auth } });

    expect(screen.getByRole('button', { name: 'Sign in with Nextcloud' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('shows LoginScreen waiting state while pending', () => {
    const auth = authWith({ status: 'pending', user: null, error: null, loginUrl: 'https://cloud.example.test/login', expired: false, instance: 'https://cloud.example.test' });

    render(App, { props: { auth } });

    expect(screen.getByRole('status')).toHaveTextContent(/waiting for you to approve/i);
  });

  it('shows BoardApp with the authenticated user', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    const auth = authWith({ status: 'authenticated', user: 'alice', error: null, loginUrl: null, expired: false, instance: 'https://cloud.example.test' });

    render(App, { props: { auth } });

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Nextcloud' })).not.toBeInTheDocument();
  });

  it('starts sign-in and opens the returned URL', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const auth = authWith({ status: 'anonymous', user: null, error: null, loginUrl: null, expired: false, instance: 'https://cloud.example.test' });
    const user = userEvent.setup();

    render(App, { props: { auth } });
    await user.click(screen.getByRole('button', { name: 'Sign in with Nextcloud' }));

    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://cloud.example.test/login', '_blank', 'noopener,noreferrer');
  });
});
