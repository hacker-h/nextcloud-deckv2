import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import BoardApp from './BoardApp.svelte';

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardApp account header', () => {
  it('renders the signed-in user in the header', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));

    render(BoardApp, { props: { currentUser: 'alice' } });

    expect(screen.getByLabelText('Signed in as alice')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('calls onSignOut exactly once from the header control', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(BoardApp, { props: { currentUser: 'alice', onSignOut } });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
