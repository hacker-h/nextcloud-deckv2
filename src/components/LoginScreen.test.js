import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import LoginScreen from './LoginScreen.svelte';

describe('LoginScreen', () => {
  it('renders the instance name and starts sign-in from idle', async () => {
    const onSignIn = vi.fn();
    const user = userEvent.setup();
    render(LoginScreen, {
      props: { instanceName: 'https://cloud.example.test', status: 'anonymous', onSignIn },
    });

    expect(screen.getByText('cloud.example.test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in with Nextcloud' }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders pending state in a live region and cancels', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(LoginScreen, {
      props: { instanceName: 'cloud.example.test', status: 'pending', onCancel },
    });

    expect(screen.getByRole('status')).toHaveTextContent(/waiting for you to approve/i);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a real reopen link when pending has a loginUrl', () => {
    render(LoginScreen, {
      props: {
        instanceName: 'cloud.example.test',
        status: 'pending',
        loginUrl: 'https://cloud.example.test/login/v2/flow',
      },
    });

    const link = screen.getByRole('link', { name: 'Open the sign-in page again' });
    expect(link).toHaveAttribute('href', 'https://cloud.example.test/login/v2/flow');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders expiry copy and retries sign-in', async () => {
    const onSignIn = vi.fn();
    const user = userEvent.setup();
    render(LoginScreen, {
      props: { instanceName: 'cloud.example.test', status: 'anonymous', expired: true, onSignIn },
    });

    expect(screen.getByRole('status')).toHaveTextContent(/20 minutes/i);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders error messages', () => {
    render(LoginScreen, {
      props: { instanceName: 'cloud.example.test', status: 'anonymous', error: 'Could not start sign-in.' },
    });

    expect(screen.getByText('Could not start sign-in.')).toBeInTheDocument();
  });

  it('focuses the primary action on mount', () => {
    render(LoginScreen, {
      props: { instanceName: 'cloud.example.test', status: 'anonymous' },
    });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in with Nextcloud' }));
  });
});
